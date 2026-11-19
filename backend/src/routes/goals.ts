import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, eq, gte, isNull, or } from "drizzle-orm";
import { goals } from "../db/schema.js";
import { HttpError, badRequest } from "../lib/errors.js";
import { requireUser } from "../lib/guards.js";
import { addDays, DAY, daysBetween, todayFor } from "../lib/days.js";
import { weekStartFor } from "../lib/calorieDays.js";
import { GOAL_NAMES, GOAL_PERIODS, GOAL_TYPES, MIN_JUDGED_DAYS, STEP_MEASURES, STRETCH_ONLY, isDayCount, periodsOf, type GoalSpec } from "../lib/goals.js";
import { addToGoalsPage, dropGoalWidgets, goalWeekStart, goalsWithProgress, isPast, specOf } from "../lib/goalsData.js";

// goalsWithProgress and the goal widget helpers live in lib/goalsData.ts (the demo seeder uses them too)

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

const fmt = (n: number) => n.toLocaleString("en-US");
const PER = { week: "a week", month: "a month", stretch: "in the stretch" } as const;

/** The goal's rules: the period its type allows, an end where needed, dates in range, a target that fits. */
function check(g: GoalSpec, today: string, isNew: boolean, weekStart: number) {
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
  // Each week / each month with an end: at least one period it can be judged on (a partial one needs 4 days / 15)
  if (g.end !== null && g.period !== "stretch") {
    const min = MIN_JUDGED_DAYS[g.period];
    const ok = periodsOf(g, weekStart, g.end).some((p) => daysBetween(p.start, p.end) + 1 >= Math.min(min, p.length));
    if (!ok) throw badRequest(`Choose dates with at least ${min} days in one ${g.period}`);
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
    const weekStart = await weekStartFor(db, userId); // kept on the goal: its weeks don't move if this changes later
    check(spec, today, true, weekStart);
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
        .values({ userId, type: spec.type, target: spec.target, period: spec.period, measure: spec.measure, startDay: spec.start, endDay: spec.end, name: b.name || GOAL_NAMES[spec.type], createdAt: now, weekStart })
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
    check(spec, today, false, goalWeekStart(row, await weekStartFor(db, userId)));
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
