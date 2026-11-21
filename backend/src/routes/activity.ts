import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { activitySteps, userBody, workoutCalorieModes, workoutSkips, workouts } from "../db/schema.js";
import { HttpError, badRequest } from "../lib/errors.js";
import { requireUser } from "../lib/guards.js";
import { addDays, DAY, todayFor } from "../lib/days.js";
import { ACTIVITY_SOURCES, activityDays, daySteps, earnedOf, estimateCalories, MET, WORKOUT_TYPES } from "../lib/activity.js";
import { COUNT_PCTS, inForce, MAX_WEEKLY_CAP, WORKOUT_MODES } from "../lib/workoutCalories.js";
import { modeRows, settingsOf } from "../lib/calorieDays.js";
import { latestWeighIn } from "../lib/weighIns.js";
import { stepGoalOn } from "../lib/goalsData.js";

// Activity (§40b): steps and workouts, typed or sent by the phone (source "health", which upserts: steps by day,
// workouts by the phone's own id, so a phone can resend safely), and Goals › Your plan › Workout calories.
// Who is asking comes only from the login (or the person's API key).

const FUTURE = "Choose today or an earlier day";
const NOT_FOUND = "Workout not found";
const NO_WEIGHT = "Add your weight first, then Estimate can work it out";
const HEALTH_ID = "A workout from Health needs its externalId, so sending it again doesn't add it twice";
const TYPED_ID = "Only workouts from Health carry an externalId";
const MAX_RANGE_DAYS = 366;
const STEPS = "Enter steps between 0 and 500,000";
const MINUTES = "Enter minutes between 1 and 1,440";
const CALORIES = "Enter calories between 0 and 10,000";

const dayParam = z.object({ day: DAY });
const idParam = z.object({ id: z.coerce.number().int().positive().max(2147483647) });
const source = z.enum(ACTIVITY_SOURCES, { error: "Source is manual or health" });
const stepsBody = z.object({ steps: z.number({ error: STEPS }).int(STEPS).min(0, STEPS).max(500000, STEPS), source: source.default("manual") });
const stepsDelete = z.object({ source: source.default("manual") });
const type = z.enum(WORKOUT_TYPES, { error: `Choose a type: ${WORKOUT_TYPES.join(", ")}` });
const minutes = z.number({ error: MINUTES }).int(MINUTES).min(1, MINUTES).max(1440, MINUTES);
const calories = z.number({ error: CALORIES }).int(CALORIES).min(0, CALORIES).max(10000, CALORIES).nullable();
const note = z.string().trim().max(500, "Keep the note under 500 characters").nullish();
const workoutBody = z.object({
  day: DAY.optional(),
  type,
  minutes,
  calories: calories.optional(),
  note,
  source: source.default("manual"),
  externalId: z.string().trim().min(1).max(200).optional(),
});
const workoutPatch = z.object({ day: DAY, type, minutes, calories, note }).partial();
const estimateQuery = z.object({ type, minutes: z.coerce.number().int(MINUTES).min(1, MINUTES).max(1440, MINUTES) });
const rangeQuery = z.object({ from: DAY, to: DAY });
const modeBody = z.object({
  mode: z.enum(WORKOUT_MODES, { error: "Choose how workout calories count" }),
  countPct: z.union(COUNT_PCTS.map((n) => z.literal(n)) as [z.ZodLiteral<25>, z.ZodLiteral<50>, z.ZodLiteral<75>, z.ZodLiteral<100>], { error: "Count 25%, 50%, 75% or 100%" }).default(50),
  weeklyCap: z.number({ error: "Enter a weekly cap from 0 to 5,000" }).int("Enter a weekly cap from 0 to 5,000").min(0, "Enter a weekly cap from 0 to 5,000").max(MAX_WEEKLY_CAP, "Enter a weekly cap from 0 to 5,000").default(1000),
});

type WorkoutRow = typeof workouts.$inferSelect;
export const toWorkout = (r: WorkoutRow) => ({ id: r.id, day: r.day, type: r.type, minutes: r.minutes, calories: r.calories, source: r.source, externalId: r.externalId, note: r.note });

/** What the Activity widget shows for a day: its steps (Health's, else typed), the typed number, workouts, calories earned. */
export async function activityOn(db: Db, userId: number, day: string) {
  const [stepRows, rows, stepGoal] = await Promise.all([
    db.select({ source: activitySteps.source, steps: activitySteps.steps }).from(activitySteps).where(and(eq(activitySteps.userId, userId), eq(activitySteps.day, day))),
    db.select().from(workouts).where(and(eq(workouts.userId, userId), eq(workouts.day, day))).orderBy(asc(workouts.createdAt), asc(workouts.id)),
    stepGoalOn(db, userId, day),
  ]);
  const s = daySteps(stepRows);
  return {
    day,
    steps: s.steps,
    stepsSource: s.source,
    typedSteps: stepRows.find((r) => r.source === "manual")?.steps ?? null,
    // An average-per-day Steps goal holding the day (§40c)
    stepGoal,
    workouts: rows.map(toWorkout),
    earned: earnedOf(rows),
    activeMinutes: rows.reduce((n, r) => n + r.minutes, 0),
  };
}

export async function workoutCaloriesNow(db: Db, userId: number, today: string) {
  const row = inForce(await modeRows(db, userId, today), today);
  return { settings: settingsOf(row), effectiveFrom: row?.effectiveFrom ?? null };
}

export default async function activityRoutes(app: FastifyInstance) {
  const { db } = app;
  const notFuture = async (userId: number, day: string) => {
    if (day > (await todayFor(app, userId))) throw badRequest(FUTURE);
  };

  app.get("/api/activity/:day", async (req) => {
    const userId = requireUser(req);
    return activityOn(db, userId, dayParam.parse(req.params).day);
  });

  // A range (up to a year): one row per day, and the workouts themselves
  app.get("/api/activity", async (req) => {
    const userId = requireUser(req);
    const { from, to } = rangeQuery.parse(req.query ?? {});
    if (from > to) throw badRequest("The start day must not be after the end day");
    if (addDays(from, MAX_RANGE_DAYS - 1) < to) throw badRequest(`Choose up to ${MAX_RANGE_DAYS} days`);
    const [stepRows, rows] = await Promise.all([
      db.select({ day: activitySteps.day, source: activitySteps.source, steps: activitySteps.steps }).from(activitySteps).where(and(eq(activitySteps.userId, userId), gte(activitySteps.day, from), lte(activitySteps.day, to))),
      db.select().from(workouts).where(and(eq(workouts.userId, userId), gte(workouts.day, from), lte(workouts.day, to))).orderBy(asc(workouts.day), asc(workouts.createdAt), asc(workouts.id)),
    ]);
    return { days: activityDays(stepRows, rows, from, to), workouts: rows.map(toWorkout) };
  });

  // The day's total, per source: a second send replaces it
  app.put("/api/steps/:day", async (req) => {
    const userId = requireUser(req);
    const { day } = dayParam.parse(req.params);
    const b = stepsBody.parse(req.body ?? {});
    await notFuture(userId, day);
    const now = app.now();
    await db
      .insert(activitySteps)
      .values({ userId, day, source: b.source, steps: b.steps, updatedAt: now })
      .onConflictDoUpdate({ target: [activitySteps.userId, activitySteps.day, activitySteps.source], set: { steps: b.steps, updatedAt: now } });
    const a = await activityOn(db, userId, day);
    return { day, steps: a.steps, stepsSource: a.stepsSource };
  });

  app.delete("/api/steps/:day", async (req, reply) => {
    const userId = requireUser(req);
    const { day } = dayParam.parse(req.params);
    const { source: from } = stepsDelete.parse(req.query ?? {});
    const gone = await db
      .delete(activitySteps)
      .where(and(eq(activitySteps.userId, userId), eq(activitySteps.day, day), eq(activitySteps.source, from)))
      .returning({ id: activitySteps.id });
    if (!gone.length) throw new HttpError(404, "No steps to delete for that day");
    return reply.status(204).send();
  });

  // A workout; from Health its externalId (required, and only from Health) again updates the one already there
  app.post("/api/workouts", async (req) => {
    const userId = requireUser(req);
    const b = workoutBody.parse(req.body ?? {});
    if (b.source === "health" && !b.externalId) throw badRequest(HEALTH_ID);
    // A typed workout is always its own row: it can never match (and re-source) a Health one
    if (b.source === "manual" && b.externalId) throw badRequest(TYPED_ID);
    const day = b.day ?? (await todayFor(app, userId));
    await notFuture(userId, day);
    const now = app.now();
    const fields = { day, type: b.type, minutes: b.minutes, calories: b.calories ?? null, note: b.note || null, source: b.source, updatedAt: now };
    if (!b.externalId) {
      const [row] = await db.insert(workouts).values({ userId, ...fields, createdAt: now }).returning();
      return { workout: toWorkout(row), skipped: false };
    }
    // From Health, insert only (I5): one already here keeps his edits; one he deleted stays deleted. The person's
    // row is locked (as DELETE does) so a send racing a delete can't bring the workout back.
    const externalId = b.externalId;
    return db.transaction(async (tx) => {
      await tx.execute(sql`select 1 from users where id = ${userId} for update`);
      const [skip] = await tx.select({ id: workoutSkips.id }).from(workoutSkips).where(and(eq(workoutSkips.userId, userId), eq(workoutSkips.externalId, externalId)));
      if (skip) return { workout: null, skipped: true };
      const [row] = await tx
        .insert(workouts)
        .values({ userId, ...fields, externalId, createdAt: now })
        .onConflictDoNothing({ target: [workouts.userId, workouts.externalId], where: sql`${workouts.externalId} is not null` })
        .returning();
      if (row) return { workout: toWorkout(row), skipped: false };
      const [existing] = await tx.select().from(workouts).where(and(eq(workouts.userId, userId), eq(workouts.externalId, externalId)));
      return { workout: existing ? toWorkout(existing) : null, skipped: true };
    });
  });

  app.patch("/api/workouts/:id", async (req) => {
    const userId = requireUser(req);
    const { id } = idParam.parse(req.params);
    const p = workoutPatch.parse(req.body ?? {});
    if (p.day) await notFuture(userId, p.day);
    const set = { ...p, ...(p.note !== undefined ? { note: p.note || null } : {}), updatedAt: app.now() };
    const [row] = await db
      .update(workouts)
      .set(set)
      .where(and(eq(workouts.id, id), eq(workouts.userId, userId)))
      .returning();
    if (!row) throw new HttpError(404, NOT_FOUND);
    return { workout: toWorkout(row) };
  });

  app.delete("/api/workouts/:id", async (req, reply) => {
    const userId = requireUser(req);
    const { id } = idParam.parse(req.params);
    const gone = await db.transaction(async (tx) => {
      await tx.execute(sql`select 1 from users where id = ${userId} for update`);
      const rows = await tx
        .delete(workouts)
        .where(and(eq(workouts.id, id), eq(workouts.userId, userId)))
        .returning({ id: workouts.id, externalId: workouts.externalId });
      // A Health workout he deleted isn't brought back by the next sync
      const ext = rows[0]?.externalId;
      if (ext) await tx.insert(workoutSkips).values({ userId, externalId: ext }).onConflictDoNothing();
      return rows;
    });
    if (!gone.length) throw new HttpError(404, NOT_FOUND);
    return reply.status(204).send();
  });

  // + Workout's Estimate: standard MET for the type × the person's weight × hours
  app.get("/api/workouts/estimate", async (req) => {
    const userId = requireUser(req);
    const q = estimateQuery.parse(req.query ?? {});
    // The latest weigh-in, else the weight in the person's details
    const latest = await latestWeighIn(db, userId);
    const [body] = latest ? [] : await db.select({ weightKg: userBody.weightKg }).from(userBody).where(eq(userBody.userId, userId));
    const weightKg = latest?.weightKg ?? body?.weightKg;
    if (weightKg === undefined) throw new HttpError(409, NO_WEIGHT);
    return { calories: estimateCalories(q.type, q.minutes, weightKg), met: MET[q.type], weightKg };
  });

  // Goals › Your plan › Workout calories: the setting in force today; a change applies from today on
  app.get("/api/workout-calories", async (req) => {
    const userId = requireUser(req);
    return workoutCaloriesNow(db, userId, await todayFor(app, userId));
  });

  app.put("/api/workout-calories", async (req) => {
    const userId = requireUser(req);
    const b = modeBody.parse(req.body ?? {});
    const today = await todayFor(app, userId);
    await db.insert(workoutCalorieModes).values({ userId, effectiveFrom: today, ...b, createdAt: app.now() });
    return workoutCaloriesNow(db, userId, today);
  });
}
