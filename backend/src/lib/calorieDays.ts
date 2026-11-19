// Each day's calories against its range with workout calories counted in (§40b): the grown range in "add" mode,
// the weekly bank in "bank" mode. The one place that decides whether a day's calories are "in range", so
// streaks, badges, weekly trends and goals (§40c) all count a bank-covered day as in range.
import { and, asc, eq, gte, lte, ne } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { logEntries, targets, userSettings, workoutCalorieModes, workouts } from "../db/schema.js";
import { addDays } from "./days.js";
import type { Nutrients } from "./nutrients.js";
import { weekStartOf } from "./trends.js";
import { bankWeek, DEFAULT_WORKOUT_CALORIES, inForce, type BankDay, type BankDayResult, type CountPct, type WorkoutCalorieSettings, type WorkoutMode } from "./workoutCalories.js";

const DEFAULT_WEEK_START = 0; // Sunday, as routes/settings-me.ts

export async function weekStartFor(db: Db, userId: number): Promise<number> {
  const [s] = await db.select({ weekStart: userSettings.weekStart }).from(userSettings).where(eq(userSettings.userId, userId));
  return s?.weekStart ?? DEFAULT_WEEK_START;
}

/** The person's workout-calorie setting history, oldest first. */
export async function modeRows(db: Db, userId: number, to?: string) {
  const rows = await db
    .select()
    .from(workoutCalorieModes)
    .where(and(eq(workoutCalorieModes.userId, userId), to ? lte(workoutCalorieModes.effectiveFrom, to) : undefined))
    .orderBy(asc(workoutCalorieModes.effectiveFrom), asc(workoutCalorieModes.id));
  return rows;
}

export const settingsOf = (row: typeof workoutCalorieModes.$inferSelect | null): WorkoutCalorieSettings =>
  row ? { mode: row.mode as WorkoutMode, countPct: row.countPct as CountPct, weeklyCap: row.weeklyCap } : { ...DEFAULT_WORKOUT_CALORIES };

export type CalorieWeek = { weekStart: string; days: BankDayResult[]; balance: number; deposited: number; spent: number; weeklyCap: number };

/**
 * Whole bank weeks (the person's week start) covering `from`..`to`, each worked out from its first day up to `to`.
 * Every day of each week up to `to` is in the result (days before `from` included, for the bank's sake).
 */
export async function calorieWeeks(db: Db, userId: number, from: string, to: string, weekStart?: number): Promise<CalorieWeek[]> {
  const ws = weekStart ?? (await weekStartFor(db, userId));
  const start = weekStartOf(from, ws);
  const [entries, targetRows, modes, done] = await Promise.all([
    db
      .select({ day: logEntries.day, nutrients: logEntries.nutrients, treat: logEntries.treat })
      .from(logEntries)
      .where(and(eq(logEntries.userId, userId), ne(logEntries.source, "water"), gte(logEntries.day, start), lte(logEntries.day, to))),
    db.select().from(targets).where(and(eq(targets.userId, userId), lte(targets.effectiveFrom, to))),
    modeRows(db, userId, to),
    db
      .select({ day: workouts.day, calories: workouts.calories })
      .from(workouts)
      .where(and(eq(workouts.userId, userId), gte(workouts.day, start), lte(workouts.day, to))),
  ]);
  const food = new Map<string, { food: number; treat: number }>();
  for (const e of entries) {
    const cal = (e.nutrients as Nutrients).calories ?? 0; // unknown as 0 (§31)
    const d = food.get(e.day) ?? { food: 0, treat: 0 };
    d.food += cal;
    if (e.treat) d.treat += cal;
    food.set(e.day, d);
  }
  const earned = new Map<string, number>();
  for (const w of done) earned.set(w.day, (earned.get(w.day) ?? 0) + (w.calories ?? 0));

  const weeks: CalorieWeek[] = [];
  for (let wk = start; wk <= to; wk = addDays(wk, 7)) {
    const days: BankDay[] = [];
    for (let d = wk; d <= to && d < addDays(wk, 7); d = addDays(d, 1)) {
      const t = inForce(targetRows, d);
      const f = food.get(d);
      days.push({
        day: d,
        settings: settingsOf(inForce(modes, d)),
        earned: earned.get(d) ?? 0,
        food: Math.round(f?.food ?? 0),
        treat: Math.round(f?.treat ?? 0),
        range: t ? { min: t.caloriesMin, max: t.caloriesMax } : null,
        logged: !!f,
      });
    }
    const w = bankWeek(days);
    weeks.push({ weekStart: wk, ...w, weeklyCap: days[days.length - 1].settings.weeklyCap });
  }
  return weeks;
}

/** Each day from `from` to `to` (oldest first): its calories against its range, a bank-covered day in range. */
export async function calorieDays(db: Db, userId: number, from: string, to: string, weekStart?: number): Promise<BankDayResult[]> {
  return (await calorieWeeks(db, userId, from, to, weekStart)).flatMap((w) => w.days).filter((d) => d.day >= from);
}
