import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, asc, eq, gte, isNull, lte, or } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { activitySteps, badges, dashboardLayouts, goals, logEntries, targets, weighIns, workouts } from "../db/schema.js";
import { HttpError, badRequest } from "../lib/errors.js";
import { requireUser } from "../lib/guards.js";
import { addDays, DAY, daysBetween, todayFor, vacationCheck } from "../lib/days.js";
import { activityDays } from "../lib/activity.js";
import { calorieDays, weekStartFor } from "../lib/calorieDays.js";
import { sumNutrients, type Nutrients } from "../lib/nutrients.js";
import { inForce } from "../lib/workoutCalories.js";
import { trendOf } from "../lib/weight.js";
import { GOAL_NAMES, GOAL_PERIODS, GOAL_TYPES, STEP_MEASURES, STRETCH_ONLY, isDayCount, progressOf, type DayFacts, type GoalProgress, type GoalSpec } from "../lib/goals.js";
import { GOAL_WIDGET, goalWidgetId } from "../lib/widgets.js";

// Goals with a start and end (§40c). Progress is worked out from the person's data each time a goal is read; once its
// end has passed (in their time zone) the result is worked out one last time and kept (goals.result), and a goal
// completed that way earns the "Goal met" badge. Who is asking comes only from the login (or a Read only key: reading).

const MAX_DAYS = 1096; // a goal runs for up to 3 years
const MAX_NAME = 60;
const ENDED = "This goal has finished, so it can't be changed";
const NOT_FOUND = "Goal not found";
const NOT_STARTED = "This goal hasn't started yet. Delete it instead.";

const idParam = z.object({ id: z.coerce.number().int().positive().max(2147483647) });
const name = z.string().max(500).optional().transform((s) => s?.trim());
const goalBody = z.object({
  type: z.enum(GOAL_TYPES, { error: "Choose a kind of goal" }),
  target: z.number({ error: "Enter a target" }).finite(),
  period: z.enum(GOAL_PERIODS, { error: "Choose each week, each month or the whole stretch" }),
  measure: z.enum(STEP_MEASURES, { error: "Steps count as a total or an average per day" }).nullish(),
  start: DAY.optional(),
  end: DAY.nullish(),
  name,
});
const goalPatch = z.object({ target: z.number({ error: "Enter a target" }).finite().optional(), end: DAY.nullish(), name });

/** The body, or a 400 that says what's wrong in words (the first problem) */
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value ?? {});
  if (!r.success) throw badRequest(r.error.issues[0].message);
  return r.data;
}

type GoalRow = typeof goals.$inferSelect;
const specOf = (g: GoalRow): GoalSpec => ({ type: g.type as GoalSpec["type"], target: g.target, period: g.period, measure: g.measure ?? null, start: g.startDay, end: g.endDay });
/** Ended early (End now, replaced) or its end has passed: in Past goals */
const isPast = (g: GoalRow, today: string) => g.endedAt !== null || (g.endDay !== null && g.endDay < today);

const fmt = (n: number) => n.toLocaleString("en-US");
const PER = { week: "a week", month: "a month", stretch: "in the stretch" } as const;

/** The goal's rules: the period its type allows, an end where needed, dates in range, a target that fits. */
function check(g: GoalSpec, today: string, isNew: boolean) {
  const label = GOAL_NAMES[g.type];
  if (STRETCH_ONLY.includes(g.type) && g.period !== "stretch") throw badRequest(`A ${label} goal runs over the whole stretch`);
  if (g.end === null && g.period === "stretch") throw badRequest("Choose an end date");
  if (isNew && g.start < addDays(today, -365)) throw badRequest("Choose a start within the last year");
  if (isNew && g.start > addDays(today, 365)) throw badRequest("Choose a start within the next year");
  if (g.end !== null) {
    if (g.end < today) throw badRequest("Choose an end date from today on");
    if (g.end < g.start) throw badRequest("The end can't be before the start");
    if (daysBetween(g.start, g.end) + 1 > MAX_DAYS) throw badRequest("A goal can run for up to 3 years");
  }
  const days = g.end === null ? 0 : daysBetween(g.start, g.end) + 1;
  const whole = (min: number, max: number, msg: string) => {
    if (!Number.isInteger(g.target) || g.target < min || g.target > max) throw badRequest(msg);
  };
  if (isDayCount(g.type)) {
    const max = g.period === "week" ? 7 : g.period === "month" ? 31 : days;
    return whole(1, max, `Choose 1 to ${fmt(max)} days ${PER[g.period]}`);
  }
  switch (g.type) {
    case "streak":
      return whole(2, days, `Choose a streak of 2 to ${fmt(days)} days`);
    case "steps":
      return g.measure === "average" ? whole(1, 100_000, "Choose 1 to 100,000 steps a day") : whole(1, 10_000_000, "Choose 1 to 10,000,000 steps");
    case "workouts":
      return whole(1, 1000, "Choose 1 to 1,000 workouts");
    case "active_minutes":
      return whole(1, 100_000, "Choose 1 to 100,000 minutes");
    case "weight_by_date":
      if (!(g.target >= 20 && g.target <= 400)) throw badRequest("Choose a weight between 20 and 400 kg");
  }
}

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
      protein: !!t && (foods.protein_g ?? 0) >= t.proteinMin,
      fiber: !!t && (foods.fiber_g ?? 0) >= t.fiberMin,
      water: !!t && water >= t.waterMin,
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
  if (started.length) {
    const weekStart = await weekStartFor(db, userId);
    const from = started.map((g) => g.startDay).sort()[0];
    const until = started.some((g) => g.endDay === null || g.endDay >= today) ? today : started.map((g) => g.endDay!).sort().at(-1)!;
    const facts = await goalFacts(db, userId, from, until, weekStart);
    for (const g of live) progress.set(g.id, progressOf(specOf(g), { ...facts, today, weekStart }));
  } else {
    for (const g of live) progress.set(g.id, progressOf(specOf(g), { days: [], trend: [], today, weekStart: 0 }));
  }
  for (const g of live) {
    if (g.endDay === null || g.endDay >= today) continue;
    // Over: keep this result (only if no one kept one first), and a completed goal earns Goal met on its end day
    const p = progress.get(g.id)!;
    const [kept] = await db
      .update(goals)
      .set({ result: p, frozenAt: new Date() })
      .where(and(eq(goals.id, g.id), isNull(goals.result)))
      .returning();
    if (kept) {
      g.result = kept.result;
      g.frozenAt = kept.frozenAt;
      if (p.state === "completed") await db.insert(badges).values({ userId, badge: "goal_met", earnedOn: g.endDay }).onConflictDoNothing();
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

/** A new goal joins the bottom of the shortest column of the saved Goals layout (none saved: the app's default places it). */
export async function addToGoalsPage(db: Db, userId: number, id: number) {
  const [row] = await db.select().from(dashboardLayouts).where(and(eq(dashboardLayouts.userId, userId), eq(dashboardLayouts.page, "goals")));
  if (!row) return;
  const columns = row.columns.map((c) => [...c]);
  while (columns.length < 3) columns.push([]);
  const shortest = columns.reduce((best, c, i) => (c.length < columns[best].length ? i : best), 0);
  columns[shortest].push(goalWidgetId(id));
  await db.update(dashboardLayouts).set({ columns }).where(and(eq(dashboardLayouts.userId, userId), eq(dashboardLayouts.page, "goals")));
}

/** The person's live average-per-day steps goal that holds `day`: the Activity widget's step goal (§40b) */
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
        lte(goals.startDay, day),
        or(isNull(goals.endDay), gte(goals.endDay, day)),
      ),
    )
    .orderBy(asc(goals.createdAt))
    .limit(1);
  return row?.target ?? null;
}

export default async function goalRoutes(app: FastifyInstance) {
  const { db } = app;

  const one = async (userId: number, id: number) => {
    const today = await todayFor(app, userId);
    const { active, past } = await goalsWithProgress(db, userId, today, id);
    const goal = active[0] ?? past[0];
    if (!goal) throw new HttpError(404, NOT_FOUND);
    return goal;
  };
  /** The goal, if it's this person's and still active */
  const activeRow = async (userId: number, id: number, today: string) => {
    const [row] = await db.select().from(goals).where(and(eq(goals.id, id), eq(goals.userId, userId)));
    if (!row) throw new HttpError(404, NOT_FOUND);
    if (isPast(row, today)) throw new HttpError(409, ENDED);
    return row;
  };

  app.get("/api/goals", async (req) => {
    const userId = requireUser(req);
    return goalsWithProgress(db, userId, await todayFor(app, userId));
  });

  app.get("/api/goals/:id", async (req) => {
    const userId = requireUser(req);
    return { goal: await one(userId, idParam.parse(req.params).id) };
  });

  // A new goal; one of the same type that's active ends today (Past goals), or is removed if it hasn't started
  app.post("/api/goals", async (req) => {
    const userId = requireUser(req);
    const b = parse(goalBody, req.body);
    const today = await todayFor(app, userId);
    const spec: GoalSpec = { type: b.type, target: b.target, period: b.period, measure: b.type === "steps" ? (b.measure ?? "total") : null, start: b.start ?? today, end: b.end ?? null };
    check(spec, today, true);
    if (b.name && b.name.length > MAX_NAME) throw badRequest(`Keep the name to ${MAX_NAME} characters`);
    const now = app.now();
    const { id, replaced } = await db.transaction(async (tx) => {
      const same = await tx
        .select()
        .from(goals)
        .where(and(eq(goals.userId, userId), eq(goals.type, spec.type), isNull(goals.endedAt), or(isNull(goals.endDay), gte(goals.endDay, today))));
      for (const old of same) {
        if (old.startDay > today) await tx.delete(goals).where(eq(goals.id, old.id));
        else await tx.update(goals).set({ endDay: today, endedAt: now }).where(eq(goals.id, old.id));
      }
      const [row] = await tx
        .insert(goals)
        .values({ userId, type: spec.type, target: spec.target, period: spec.period, measure: spec.measure, startDay: spec.start, endDay: spec.end, name: b.name || GOAL_NAMES[spec.type], createdAt: now })
        .returning({ id: goals.id });
      return { id: row.id, replaced: same.map((g) => g.id) };
    });
    await dropGoalWidgets(db, userId, replaced);
    await addToGoalsPage(db, userId, id);
    return { goal: await one(userId, id), replaced: replaced[0] ?? null };
  });

  // Edit: the target, the name and the end date of an active goal
  app.patch("/api/goals/:id", async (req) => {
    const userId = requireUser(req);
    const { id } = idParam.parse(req.params);
    const p = parse(goalPatch, req.body);
    const today = await todayFor(app, userId);
    const row = await activeRow(userId, id, today);
    const spec = { ...specOf(row), ...(p.target !== undefined ? { target: p.target } : {}), ...(p.end !== undefined ? { end: p.end } : {}) };
    check(spec, today, false);
    if (p.name && p.name.length > MAX_NAME) throw badRequest(`Keep the name to ${MAX_NAME} characters`);
    await db
      .update(goals)
      .set({ target: spec.target, endDay: spec.end, ...(p.name !== undefined ? { name: p.name || GOAL_NAMES[spec.type] } : {}) })
      .where(eq(goals.id, id));
    return { goal: await one(userId, id) };
  });

  // End now: it ends today (worked out live until today is over, then kept) and moves to Past goals
  app.post("/api/goals/:id/end", async (req) => {
    const userId = requireUser(req);
    const { id } = idParam.parse(req.params);
    const today = await todayFor(app, userId);
    const row = await activeRow(userId, id, today);
    if (row.startDay > today) throw new HttpError(409, NOT_STARTED);
    await db.update(goals).set({ endDay: today, endedAt: app.now() }).where(eq(goals.id, id));
    await dropGoalWidgets(db, userId, [id]);
    return { goal: await one(userId, id) };
  });

  app.delete("/api/goals/:id", async (req, reply) => {
    const userId = requireUser(req);
    const { id } = idParam.parse(req.params);
    const gone = await db
      .delete(goals)
      .where(and(eq(goals.id, id), eq(goals.userId, userId)))
      .returning({ id: goals.id });
    if (!gone.length) throw new HttpError(404, NOT_FOUND);
    await dropGoalWidgets(db, userId, [id]);
    return reply.status(204).send();
  });
}
