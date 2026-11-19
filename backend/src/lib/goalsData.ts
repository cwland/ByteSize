// Goals (§40c): reading a person's data for goal progress. The progress maths are in lib/goals.ts (pure); routes/goals.ts
// serves goals and keeps results once a goal ends. Insights (§43) reads active goals from here, without keeping anything.
import { and, asc, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { activitySteps, badges, dashboardLayouts, goals, logEntries, targets, weighIns, workouts } from "../db/schema.js";
import { GOAL_WIDGET, goalWidgetId } from "./widgets.js";
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

/** Ended early (End now, replaced) or its end has passed: in Past goals */
export const isPast = (g: GoalRow, today: string) => g.endedAt !== null || (g.endDay !== null && g.endDay < today);


export type GoalView = ReturnType<typeof viewOf>;
const viewOf = (g: GoalRow, progress: GoalProgress) => ({
  id: g.id,
  type: g.type,
  name: g.name,
  target: g.target,
  period: g.period,
  measure: g.measure ?? null,
  start: g.startDay,
  end: g.endDay,
  createdAt: g.createdAt,
  endedEarly: g.endedAt !== null,
  frozen: g.result !== null,
  progress,
});

/**
 * The person's goals with their progress: live, or kept once the end has passed. Goals whose end has passed are
 * worked out one last time and kept now (each once: a second reader finds it kept); a completed one earns Goal met.
 */
export async function goalsWithProgress(db: Db, userId: number, today: string, only?: number) {
  const rows = await db
    .select()
    .from(goals)
    .where(and(eq(goals.userId, userId), only === undefined ? undefined : eq(goals.id, only)))
    .orderBy(asc(goals.createdAt), asc(goals.id));
  const live = rows.filter((g) => g.result === null);
  const progress = new Map<number, GoalProgress>();
  const started = live.filter((g) => g.startDay <= today);
  const weekStart = live.length ? await weekStartFor(db, userId) : 0;
  if (started.length) {
    const from = started.map((g) => g.startDay).sort()[0];
    const until = started.some((g) => g.endDay === null || g.endDay >= today) ? today : started.map((g) => g.endDay!).sort().at(-1)!;
    const facts = await goalFacts(db, userId, from, until, weekStart);
    for (const g of live) progress.set(g.id, progressOf(specOf(g), { ...facts, today, weekStart }));
  } else {
    for (const g of live) progress.set(g.id, progressOf(specOf(g), { days: [], trend: [], today, weekStart }));
  }
  for (const g of live) {
    if (g.endDay === null || g.endDay >= today) continue;
    // Over: keep this result (only if no one kept one first) and, in the same transaction, a completed goal earns Goal
    // met: on its end day (the latest goal met's), new again so it's celebrated (the count comes from the goals)
    const p = progress.get(g.id)!;
    const kept = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(goals)
        .set({ result: p, frozenAt: new Date() })
        .where(and(eq(goals.id, g.id), isNull(goals.result)))
        .returning();
      if (row && p.state === "completed") {
        await tx
          .insert(badges)
          .values({ userId, badge: "goal_met", earnedOn: g.endDay! })
          .onConflictDoUpdate({ target: [badges.userId, badges.badge], set: { earnedOn: sql`greatest(${badges.earnedOn}, excluded.earned_on)`, seen: false } });
      }
      return row;
    });
    if (kept) {
      g.result = kept.result;
      g.frozenAt = kept.frozenAt;
    } else {
      const [now] = await db.select().from(goals).where(eq(goals.id, g.id));
      if (now) Object.assign(g, now);
    }
  }
  const views = rows.map((g) => viewOf(g, (g.result as GoalProgress | null) ?? progress.get(g.id)!));
  return {
    active: views.filter((_, i) => !isPast(rows[i], today)),
    past: views
      .filter((_, i) => isPast(rows[i], today))
      .sort((a, b) => (a.end! < b.end! ? 1 : a.end! > b.end! ? -1 : b.id - a.id)),
  };
}

/** How many of the person's goals ended completed (the Goal met badge's count) */
export async function goalsMet(db: Db, userId: number): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(goals)
    .where(and(eq(goals.userId, userId), sql`${goals.result}->>'state' = 'completed'`));
  return r?.n ?? 0;
}

/** The ids of the person's active goals (not ended, end not passed): the goal widgets their layouts may hold. */
export async function activeGoalIds(db: Db, userId: number, today: string): Promise<Set<number>> {
  const rows = await db
    .select({ id: goals.id })
    .from(goals)
    .where(and(eq(goals.userId, userId), isNull(goals.endedAt), or(isNull(goals.endDay), gte(goals.endDay, today))));
  return new Set(rows.map((r) => r.id));
}

/** Layout columns with only known widgets and active goals (§40c) */
export function keepGoals(columns: string[][], active: Set<number>): string[][] {
  return columns.map((c) => c.filter((id) => {
    const m = GOAL_WIDGET.exec(id);
    return !m || active.has(Number(m[1]));
  }));
}

/** Takes these goals' widgets off the person's saved layouts. */
export async function dropGoalWidgets(db: Db, userId: number, ids: number[]) {
  if (!ids.length) return;
  const gone = new Set(ids.map(goalWidgetId));
  const rows = await db.select().from(dashboardLayouts).where(eq(dashboardLayouts.userId, userId));
  for (const r of rows) {
    if (!r.columns.flat().some((id) => gone.has(id))) continue;
    await db
      .update(dashboardLayouts)
      .set({ columns: r.columns.map((c) => c.filter((id) => !gone.has(id))) })
      .where(and(eq(dashboardLayouts.userId, userId), eq(dashboardLayouts.page, r.page)));
  }
}

/**
 * A new goal joins the bottom of the shortest column in use of the saved Goals layout (the leftmost of equals; an empty
 * column stays empty; none saved: the app's default places it, the same way).
 */
export async function addToGoalsPage(db: Db, userId: number, id: number) {
  const [row] = await db.select().from(dashboardLayouts).where(and(eq(dashboardLayouts.userId, userId), eq(dashboardLayouts.page, "goals")));
  if (!row) return;
  const columns = row.columns.map((c) => [...c]);
  while (columns.length < 3) columns.push([]);
  const used = columns.map((_, i) => i).filter((i) => columns[i].length > 0);
  const shortest = used.length ? used.reduce((best, i) => (columns[i].length < columns[best].length ? i : best), used[0]) : 0;
  columns[shortest].push(goalWidgetId(id));
  await db.update(dashboardLayouts).set({ columns }).where(and(eq(dashboardLayouts.userId, userId), eq(dashboardLayouts.page, "goals")));
}

/** The person's newest active (not ended, not kept) average-per-day steps goal that holds `day`: the Activity widget's step goal (§40b) */
export async function stepGoalOn(db: Db, userId: number, day: string): Promise<number | null> {
  const [row] = await db
    .select({ target: goals.target })
    .from(goals)
    .where(
      and(
        eq(goals.userId, userId),
        eq(goals.type, "steps"),
        eq(goals.measure, "average"),
        isNull(goals.result),
        isNull(goals.endedAt),
        lte(goals.startDay, day),
        or(isNull(goals.endDay), gte(goals.endDay, day)),
      ),
    )
    .orderBy(desc(goals.createdAt), desc(goals.id))
    .limit(1);
  return row?.target ?? null;
}

