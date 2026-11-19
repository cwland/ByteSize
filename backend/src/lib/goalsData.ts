// Goals (§40c): reading a person's data for goal progress. The progress maths are in lib/goals.ts (pure); routes/goals.ts
// serves goals and keeps results once a goal ends. Insights (§43) reads active goals from here, without keeping anything.
import { and, asc, eq, gte, isNull, lte, or } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { activitySteps, goals, logEntries, targets, weighIns, workouts } from "../db/schema.js";
import { activityDays } from "./activity.js";
import { calorieDays, weekStartFor } from "./calorieDays.js";
import { addDays, vacationCheck } from "./days.js";
import { progressOf, type DayFacts, type GoalProgress, type GoalSpec } from "./goals.js";
import { sumNutrients, type Nutrients } from "./nutrients.js";
import { trendOf } from "./weight.js";
import { inForce } from "./workoutCalories.js";

type GoalRow = typeof goals.$inferSelect;
export const specOf = (g: GoalRow): GoalSpec => ({ type: g.type as GoalSpec["type"], target: g.target, period: g.period, measure: g.measure ?? null, start: g.startDay, end: g.endDay, endedEarly: g.endedAt !== null });

/** What each day from `from` to `to` held, as goals count it, and the weight trend up to `to`. */
export async function goalFacts(db: Db, userId: number, from: string, to: string, weekStart: number): Promise<{ days: DayFacts[]; trend: { day: string; trendKg: number }[] }> {
  const [entries, targetRows, calorie, weights, onVacation, stepRows, workoutRows] = await Promise.all([
    db
      .select({ day: logEntries.day, source: logEntries.source, nutrients: logEntries.nutrients })
      .from(logEntries)
      .where(and(eq(logEntries.userId, userId), gte(logEntries.day, from), lte(logEntries.day, to))),
    db.select().from(targets).where(and(eq(targets.userId, userId), lte(targets.effectiveFrom, to))),
    calorieDays(db, userId, from, to, weekStart),
    db.select({ day: weighIns.day, weightKg: weighIns.weightKg }).from(weighIns).where(and(eq(weighIns.userId, userId), lte(weighIns.day, to))),
    vacationCheck(db, userId),
    db.select({ day: activitySteps.day, source: activitySteps.source, steps: activitySteps.steps }).from(activitySteps).where(and(eq(activitySteps.userId, userId), gte(activitySteps.day, from), lte(activitySteps.day, to))),
    db.select({ day: workouts.day, minutes: workouts.minutes, calories: workouts.calories }).from(workouts).where(and(eq(workouts.userId, userId), gte(workouts.day, from), lte(workouts.day, to))),
  ]);
  const byDay = new Map<string, { foods: Nutrients[]; all: Nutrients[] }>();
  for (const e of entries) {
    const d = byDay.get(e.day) ?? { foods: [], all: [] };
    d.all.push(e.nutrients as Nutrients);
    if (e.source !== "water") d.foods.push(e.nutrients as Nutrients);
    byDay.set(e.day, d);
  }
  const inRange = new Set(calorie.filter((d) => d.status === "in").map((d) => d.day));
  const weighed = new Set(weights.map((w) => w.day));
  const active = new Map(activityDays(stepRows, workoutRows, from, to).map((a) => [a.day, a]));
  const days: DayFacts[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const log = byDay.get(d);
    // The day's totals as the Day totals show them (unknown counted as 0); the minimums in force that day
    const foods = sumNutrients(log?.foods ?? []);
    const water = sumNutrients(log?.all ?? []).water_ml ?? 0;
    const t = inForce(targetRows, d);
    const a = active.get(d)!;
    days.push({
      day: d,
      logged: (log?.foods.length ?? 0) > 0,
      // Something must be logged: a minimum of 0 doesn't make an empty day a hit
      protein: !!t && (log?.foods.length ?? 0) > 0 && (foods.protein_g ?? 0) >= t.proteinMin,
      fiber: !!t && (log?.foods.length ?? 0) > 0 && (foods.fiber_g ?? 0) >= t.fiberMin,
      water: !!t && water > 0 && water >= t.waterMin,
      calories: inRange.has(d),
      weighed: weighed.has(d),
      steps: a.steps,
      workouts: a.workouts,
      activeMinutes: a.activeMinutes,
      vacation: onVacation(d),
    });
  }
  return { days, trend: trendOf(weights) };
}


/**
 * The person's goals running today (started, not ended, not ended early) with their live progress. Read only: unlike
 * Goals' own reading, nothing is kept or awarded here.
 */
export async function activeGoals(db: Db, userId: number, today: string): Promise<{ name: string; type: string; target: number; period: string; end: string | null; progress: GoalProgress }[]> {
  const rows = await db
    .select()
    .from(goals)
    .where(and(eq(goals.userId, userId), isNull(goals.result), isNull(goals.endedAt), lte(goals.startDay, today), or(isNull(goals.endDay), gte(goals.endDay, today))))
    .orderBy(asc(goals.createdAt), asc(goals.id));
  if (!rows.length) return [];
  const weekStart = await weekStartFor(db, userId);
  const facts = await goalFacts(db, userId, rows.map((g) => g.startDay).sort()[0], today, weekStart);
  return rows.map((g) => ({ name: g.name, type: g.type, target: g.target, period: g.period, end: g.endDay, progress: progressOf(specOf(g), { ...facts, today, weekStart }) }));
}
