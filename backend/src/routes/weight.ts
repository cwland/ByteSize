import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, asc, eq, sql } from "drizzle-orm";
import { isLatest, saveWeighIn, syncBodyWeight } from "../lib/weighIns.js";
import { userBody, userSettings, weighInSkips, weighIns } from "../db/schema.js";
import { HttpError, badRequest } from "../lib/errors.js";
import { requireUser } from "../lib/guards.js";
import { DAY, todayFor } from "../lib/days.js";
import { DEFAULT_ESTIMATE, goalDateOf, projectionOf, replanHint, trendOf, type EstimateOptions } from "../lib/weight.js";
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
  // health (I5): from Apple Health — fills only a day with no weigh-in that was never deleted
  source: z.enum(["manual", "health"], { error: "Source is manual or health" }).default("manual"),
});
const rangeQuery = z
  .object({ from: DAY.optional(), to: DAY.optional() })
  .refine((q) => !q.from || !q.to || q.from <= q.to, "The start day must not be after the end day");

export default async function weightRoutes(app: FastifyInstance) {
  const { db } = app;

  // One per day: a second weigh-in that day replaces it (note included). From Health it only fills an empty day that
  // was never deleted ({ skipped: true } otherwise); a typed one always saves and clears the day's deleted mark.
  app.put("/api/weigh-ins/:day", async (req) => {
    const userId = requireUser(req);
    const { day } = dayParam.parse(req.params);
    const { weightKg, note, source } = weighInBody.parse(req.body ?? {});
    if (day > (await todayFor(app, userId))) throw badRequest(FUTURE);
    const view = (r: { day: string; weightKg: number; note: string | null }) => ({ day: r.day, weightKg: r.weightKg, note: r.note });
    return db.transaction(async (tx) => {
      const here = and(eq(weighIns.userId, userId), eq(weighIns.day, day));
      if (source === "health") {
        // Lock the person's row so two phones syncing at once can't both fill the day
        await tx.execute(sql`select 1 from users where id = ${userId} for update`);
        const [existing] = await tx.select().from(weighIns).where(here);
        if (existing) return { weighIn: view(existing), skipped: true };
        const [skip] = await tx.select({ id: weighInSkips.id }).from(weighInSkips).where(and(eq(weighInSkips.userId, userId), eq(weighInSkips.day, day)));
        if (skip) return { weighIn: null, skipped: true };
      } else {
        await tx.delete(weighInSkips).where(and(eq(weighInSkips.userId, userId), eq(weighInSkips.day, day)));
      }
      const row = await saveWeighIn(tx, userId, day, weightKg, note || null, app.now(), source);
      return { weighIn: view(row), skipped: false };
    });
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
      // …and Apple Health won't fill the day again
      if (gone.length) await tx.insert(weighInSkips).values({ userId, day }).onConflictDoNothing();
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
      .select({ day: weighIns.day, weightKg: weighIns.weightKg, note: weighIns.note, source: weighIns.source })
      .from(weighIns)
      .where(eq(weighIns.userId, userId))
      .orderBy(asc(weighIns.day));
    const [body] = await db
      .select({ goalKg: userBody.goalWeightKg, targetsWeightKg: userBody.targetsWeightKg })
      .from(userBody)
      .where(eq(userBody.userId, userId));
    // The person's goal estimate (Settings › Profile); no settings row: scale weigh-ins over 12 weeks
    const [settings] = await db
      .select({ basis: userSettings.goalEstimateBasis, weeks: userSettings.goalEstimateWeeks })
      .from(userSettings)
      .where(eq(userSettings.userId, userId));
    const estimate: EstimateOptions = settings ? { basis: settings.basis, days: settings.weeks * 7 } : DEFAULT_ESTIMATE;
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
        .map((p) => ({ day: p.day, weightKg: p.weightKg, trendKg: p.trendKg, note: p.note, source: p.source ?? null })),
      start: first ? { day: first.day, weightKg: first.weightKg } : null,
      latest: last ? { day: last.day, weightKg: last.weightKg } : null,
      trendKg: last ? last.trendKg : null,
      goalKg,
      // Lost so far by the scale (first − latest weigh-in) and by the trend (first − latest trend)
      lostKg: first && last ? first.weightKg - last.weightKg : null,
      lostTrendKg: first && last ? first.weightKg - last.trendKg : null,
      projection: projectionOf(all, goalKg, today, estimate),
      goalDate: goalDateOf(all, goalKg, today, estimate), // §40a: the Goal date widget
      replanHint: replanHint(last?.weightKg ?? null, basisKg),
    };
  });
}
