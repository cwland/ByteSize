// Activity (§40b): steps and workouts. Pure: no I/O. Days are the person's local YYYY-MM-DD dates.

import { addDays } from "./days.js";

export const WORKOUT_TYPES = ["walk", "run", "cycling", "strength", "swim", "hike", "yoga", "hiit", "sport", "other"] as const;
export type WorkoutType = (typeof WORKOUT_TYPES)[number];
export const ACTIVITY_SOURCES = ["manual", "health"] as const;
export type ActivitySource = (typeof ACTIVITY_SOURCES)[number];

/**
 * Standard MET values (the Compendium of Physical Activities, a typical moderate effort for each): how many times
 * the energy of sitting still the activity takes. The web app's Estimate asks the server, so this is the only copy.
 */
export const MET: Record<WorkoutType, number> = {
  walk: 3.5, // walking, 3 mph
  run: 9.8, // running, 6 mph
  cycling: 7.5, // general, moderate
  strength: 5.0, // weight lifting, vigorous
  swim: 7.0, // laps, moderate
  hike: 6.0,
  yoga: 2.5,
  hiit: 8.0, // circuit / interval training
  sport: 7.0, // e.g. tennis, basketball
  other: 4.0,
};

/** Calories a workout burns, about: MET × body weight (kg) × hours, rounded. */
export function estimateCalories(type: WorkoutType, minutes: number, kg: number): number {
  return Math.round(MET[type] * kg * (minutes / 60));
}

/** The day's steps: the Health number when there is one, else the typed one; none: null. */
export function daySteps(rows: { source: string; steps: number }[]): { steps: number | null; source: ActivitySource | null } {
  const health = rows.find((r) => r.source === "health");
  const manual = rows.find((r) => r.source === "manual");
  const row = health ?? manual;
  return row ? { steps: row.steps, source: row.source as ActivitySource } : { steps: null, source: null };
}

/** Calories a workout earned: unknown counts as 0 (§31). */
export const earnedOf = (workouts: { calories: number | null }[]) => workouts.reduce((s, w) => s + (w.calories ?? 0), 0);

export type ActivityDay = { day: string; steps: number | null; stepsSource: ActivitySource | null; workouts: number; activeMinutes: number; earned: number };

/**
 * One row per day from `from` to `to` (inclusive, oldest first): the day's steps, how many workouts, their minutes
 * and calories earned. What goals (§40c) count steps, workouts and active minutes from.
 */
export function activityDays(
  steps: { day: string; source: string; steps: number }[],
  workouts: { day: string; minutes: number; calories: number | null }[],
  from: string,
  to: string
): ActivityDay[] {
  const out: ActivityDay[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const s = daySteps(steps.filter((r) => r.day === d));
    const w = workouts.filter((r) => r.day === d);
    out.push({ day: d, steps: s.steps, stepsSource: s.source, workouts: w.length, activeMinutes: w.reduce((n, r) => n + r.minutes, 0), earned: earnedOf(w) });
  }
  return out;
}
