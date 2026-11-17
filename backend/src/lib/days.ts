// Days are the user's local dates (YYYY-MM-DD in users.timezone), never UTC dates.

import { z } from "zod";
import { and, desc, eq, lte, ne } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { logEntries, vacations, type MealWindows } from "../db/schema.js";

/** The local date in `timeZone` at the moment `now`, as YYYY-MM-DD. */
export function localDay(timeZone: string, now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export const MEALS = ["breakfast", "lunch", "dinner", "snacks", "supplements"] as const;
export type Meal = (typeof MEALS)[number];

/** A day as the API takes it: a real YYYY-MM-DD date. */
export const DAY = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-17")
  .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d), "That isn't a real date");

/** `day` plus `n` days (n may be negative). */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Share of the day's calories suggested for each meal (supplements & water: none). */
export const MEAL_SPLIT: Record<Meal, number> = { breakfast: 0.2, lunch: 0.25, dinner: 0.35, snacks: 0.2, supplements: 0 };

/** Suggested calories for a meal: its share of the middle of the calorie range; null without targets or for supplements. */
export function suggestedFor(meal: Meal, calories: { min: number; max: number } | null | undefined): number | null {
  if (!calories || meal === "supplements") return null;
  return Math.round(MEAL_SPLIT[meal] * ((calories.min + calories.max) / 2));
}

/**
 * The meal a new entry goes to by default, from the local time in `timeZone` and the person's meal
 * windows (each the end time of that meal): before breakfast's end → breakfast, … after dinner's end → snacks.
 * The web app has the same function in frontend/src/meals.ts.
 */
export function mealFor(timeZone: string, now: Date, windows: MealWindows): Meal {
  const hhmm = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  if (hhmm < windows.breakfast) return "breakfast";
  if (hhmm < windows.lunch) return "lunch";
  if (hhmm < windows.snacks) return "snacks";
  if (hhmm < windows.dinner) return "dinner";
  return "snacks";
}

/** Days with at least one food (water doesn't count) on or before `today`, newest first. */
export async function loggedDays(db: Db, userId: number, today: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ day: logEntries.day })
    .from(logEntries)
    .where(and(eq(logEntries.userId, userId), ne(logEntries.source, "water"), lte(logEntries.day, today)))
    .orderBy(desc(logEntries.day))
    .limit(3700);
  return rows.map((r) => r.day);
}

/** A test for "is this day inside one of the person's vacations" (inclusive ranges). */
export async function vacationCheck(db: Db, userId: number): Promise<(day: string) => boolean> {
  const ranges = await db.select({ from: vacations.fromDay, to: vacations.toDay }).from(vacations).where(eq(vacations.userId, userId));
  return (day) => ranges.some((r) => r.from <= day && day <= r.to);
}

/**
 * Consecutive days with at least one food (water doesn't count) ending today, or yesterday when today has none.
 * A vacation day without food neither counts nor breaks it; a vacation day with food counts.
 */
export async function streak(db: Db, userId: number, today: string): Promise<number> {
  const days = await loggedDays(db, userId, today);
  if (!days.length) return 0;
  const logged = new Set(days);
  const onVacation = await vacationCheck(db, userId);
  const oldest = days[days.length - 1];
  let d = logged.has(today) ? today : addDays(today, -1);
  let n = 0;
  for (; d >= oldest; d = addDays(d, -1)) {
    if (logged.has(d)) n++;
    else if (!onVacation(d)) break;
  }
  return n;
}
