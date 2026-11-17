import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, asc, desc, eq, gt } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { userBody, weighIns } from "../db/schema.js";
import { HttpError, badRequest } from "../lib/errors.js";
import { requireUser } from "../lib/guards.js";
import { DAY, todayFor } from "../lib/days.js";
import { projectionOf, replanHint, trendOf } from "../lib/weight.js";
import { targetsOn } from "./body-plans.js";

// Weigh-ins (one per day, in kg) and the weight trend toward the goal (design §13 A).
// Who is asking comes only from the login.

const NOT_FOUND = "Weigh-in not found";
const FUTURE = "Choose today or an earlier day";
const WEIGHT = "Enter a weight between 30 and 350 kg"; // the same range as the body form

const dayParam = z.object({ day: DAY });
const weighInBody = z.object({
  weightKg: z.number({ error: WEIGHT }).min(30, WEIGHT).max(350, WEIGHT),
  note: z.string().trim().max(500, "Keep the note under 500 characters").nullish(),
});
const rangeQuery = z
  .object({ from: DAY.optional(), to: DAY.optional() })
  .refine((q) => !q.from || !q.to || q.from <= q.to, "The start day must not be after the end day");

/** The database or a transaction on it */
export type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

async function latestWeighIn(db: DbOrTx, userId: number) {
  const [row] = await db.select().from(weighIns).where(eq(weighIns.userId, userId)).orderBy(desc(weighIns.day)).limit(1);
  return row ?? null;
}

/** The body weight (the plan's weight) follows the latest weigh-in; no body profile yet: nothing to update. */
async function syncBodyWeight(db: DbOrTx, userId: number, now: Date) {
  const latest = await latestWeighIn(db, userId);
  if (!latest) return;
  await db.update(userBody).set({ weightKg: latest.weightKg, updatedAt: now }).where(eq(userBody.userId, userId));
}

const isLatest = async (db: DbOrTx, userId: number, day: string) =>
  !(await db.select({ id: weighIns.id }).from(weighIns).where(and(eq(weighIns.userId, userId), gt(weighIns.day, day))).limit(1)).length;

/**
 * Saves the day's weigh-in (replacing one already there; note undefined keeps its note) and, when it is the
 * latest, makes it the body weight. Run it in a transaction so the two never disagree.
 */
export async function saveWeighIn(db: DbOrTx, userId: number, day: string, weightKg: number, note: string | null | undefined, now: Date) {
  const set = note === undefined ? { weightKg } : { weightKg, note };
  const [row] = await db
    .insert(weighIns)
    .values({ userId, day, weightKg, note: note ?? null })
    .onConflictDoUpdate({ target: [weighIns.userId, weighIns.day], set })
    .returning();
  // A backdated weigh-in leaves the body weight alone
  if (await isLatest(db, userId, day)) await syncBodyWeight(db, userId, now);
  return row;
}

export default async function weightRoutes(app: FastifyInstance) {
  const { db } = app;

  // One per day: a second weigh-in that day replaces it (note included)
  app.put("/api/weigh-ins/:day", async (req) => {
    const userId = requireUser(req);
    const { day } = dayParam.parse(req.params);
    const { weightKg, note } = weighInBody.parse(req.body ?? {});
    if (day > (await todayFor(app, userId))) throw badRequest(FUTURE);
    const row = await db.transaction((tx) => saveWeighIn(tx, userId, day, weightKg, note || null, app.now()));
    return { weighIn: { day: row.day, weightKg: row.weightKg, note: row.note } };
  });

  app.delete("/api/weigh-ins/:day", async (req, reply) => {
    const userId = requireUser(req);
    const { day } = dayParam.parse(req.params);
    const removed = await db.transaction(async (tx) => {
      const gone = await tx
        .delete(weighIns)
        .where(and(eq(weighIns.userId, userId), eq(weighIns.day, day)))
        .returning({ id: weighIns.id });
      // Removing the latest: the body weight falls back to the one before
      if (gone.length && (await isLatest(tx, userId, day))) await syncBodyWeight(tx, userId, app.now());
      return gone.length > 0;
    });
    if (!removed) throw new HttpError(404, NOT_FOUND);
    return reply.status(204).send();
  });

  // The trend is computed over every weigh-in, then the list is cut to from..to
  app.get("/api/weight", async (req) => {
    const userId = requireUser(req);
    const { from, to } = rangeQuery.parse(req.query ?? {});
    const rows = await db
      .select({ day: weighIns.day, weightKg: weighIns.weightKg, note: weighIns.note })
      .from(weighIns)
      .where(eq(weighIns.userId, userId))
      .orderBy(asc(weighIns.day));
    const [body] = await db
      .select({ goalKg: userBody.goalWeightKg, targetsWeightKg: userBody.targetsWeightKg })
      .from(userBody)
      .where(eq(userBody.userId, userId));
    const all = trendOf(rows);
    const first = all[0];
    const last = all[all.length - 1];
    const goalKg = body?.goalKg ?? null;
    // Plans chosen before targets_weight_kg was recorded: measure from the first weigh-in (only with a plan in force)
    const today = await todayFor(app, userId);
    const basisKg = body?.targetsWeightKg ?? (first && (await targetsOn(db, userId, today)) ? first.weightKg : null);
    return {
      weighIns: all
        .filter((p) => (!from || p.day >= from) && (!to || p.day <= to))
        .map((p) => ({ day: p.day, weightKg: p.weightKg, trendKg: p.trendKg, note: p.note })),
      start: first ? { day: first.day, weightKg: first.weightKg } : null,
      latest: last ? { day: last.day, weightKg: last.weightKg } : null,
      trendKg: last ? last.trendKg : null,
      goalKg,
      lostKg: first && last ? first.weightKg - last.trendKg : null,
      projection: projectionOf(all, goalKg, today),
      replanHint: replanHint(last?.weightKg ?? null, basisKg),
    };
  });
}
