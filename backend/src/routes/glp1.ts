import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, asc, eq, gt, gte, lte } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { glp1Settings, glp1Shots, logEntries, sideEffects, users } from "../db/schema.js";
import { HttpError, badRequest, notFound } from "../lib/errors.js";
import { requireUser } from "../lib/guards.js";
import { addDays, DAY, localDay } from "../lib/days.js";
import { sumNutrients, type Nutrients } from "../lib/nutrients.js";
import { AFTER_INJECTION_DAYS, afterInjection, doseHistory, nextDueDay, nextSite, scheduleStatus, SIDE_EFFECTS, SITES } from "../lib/glp1.js";

// GLP-1: settings (medication, dose, injection weekday), shots (one per day), side-effect check-ins
// (one per day) and the after-injection view. Who is asking comes only from the login.

const SHOT_LIST_LIMIT = 60;
const MAX_SIDE_EFFECT_DAYS = 400;

const note = z
  .string()
  .max(500, "Keep the note under 500 characters")
  .transform((s) => s.trim() || null)
  .nullish();
const dose = z.number().positive("Enter a dose above 0").max(100, "That dose looks too high");
const medication = z.string().trim().min(1, "Enter the medication").max(60, "Keep the medication name short");

const settingsBody = z.object({
  medication,
  doseMg: dose,
  injectionWeekday: z.number().int().min(0).max(6),
});
const shotBody = z.object({
  doseMg: dose.optional(),
  medication: medication.optional(),
  site: z.enum(SITES, "Choose an injection site"),
  note,
});
const level = z.union([z.literal(1), z.literal(2), z.literal(3)], "Choose mild, medium or strong");
const sideEffectBody = z.object({
  effects: z.partialRecord(z.enum(SIDE_EFFECTS, "Unknown side effect"), level),
  note,
});
const rangeQuery = z.object({ from: DAY, to: DAY });

type ShotRow = typeof glp1Shots.$inferSelect;
const toShot = (r: ShotRow) => ({ day: r.day, medication: r.medication, doseMg: r.doseMg, site: r.site, note: r.note });

async function todayFor(app: FastifyInstance, userId: number): Promise<string> {
  const [u] = await app.db.select({ timezone: users.timezone }).from(users).where(eq(users.id, userId));
  if (!u) throw new HttpError(401, "Not logged in");
  return localDay(u.timezone, app.now());
}

/** A day from the URL that isn't after the person's today. */
async function pastDay(app: FastifyInstance, userId: number, raw: string): Promise<string> {
  const day = DAY.parse(raw);
  if (day > (await todayFor(app, userId))) throw badRequest("That day hasn't happened yet");
  return day;
}

async function settingsFor(db: Db, userId: number) {
  const [s] = await db.select().from(glp1Settings).where(eq(glp1Settings.userId, userId));
  return s ? { medication: s.medication, doseMg: s.doseMg, injectionWeekday: s.injectionWeekday } : null;
}

/** GET /api/glp1: settings, last shot, schedule status, suggested site, recent shots and dose history. */
async function glp1View(app: FastifyInstance, userId: number) {
  const today = await todayFor(app, userId);
  const settings = await settingsFor(app.db, userId);
  const rows = await app.db.select().from(glp1Shots).where(eq(glp1Shots.userId, userId)).orderBy(asc(glp1Shots.day));
  const last = rows[rows.length - 1] ?? null;
  const nextDue = nextDueDay(today, last?.day ?? null, settings?.injectionWeekday ?? null);
  return {
    settings,
    lastShot: last ? toShot(last) : null,
    nextDue,
    ...scheduleStatus(today, nextDue),
    suggestedSite: nextSite(last?.site),
    shots: rows.slice(-SHOT_LIST_LIMIT).reverse().map(toShot),
    doseHistory: doseHistory(rows),
  };
}

export default async function glp1Routes(app: FastifyInstance) {
  const { db } = app;

  app.get("/api/glp1", async (req) => glp1View(app, requireUser(req)));

  app.put("/api/glp1/settings", async (req) => {
    const userId = requireUser(req);
    const b = settingsBody.parse(req.body ?? {});
    await db
      .insert(glp1Settings)
      .values({ userId, ...b })
      .onConflictDoUpdate({ target: glp1Settings.userId, set: { ...b, updatedAt: new Date() } });
    return glp1View(app, userId);
  });

  // One shot per day (a second one that day replaces it). Dose and medication default to the settings;
  // a different one on the latest shot becomes the current dose (a backdated shot leaves it alone).
  app.put("/api/glp1/shots/:day", async (req) => {
    const userId = requireUser(req);
    const day = await pastDay(app, userId, (req.params as { day: string }).day);
    const b = shotBody.parse(req.body ?? {});
    const settings = await settingsFor(db, userId);
    const doseMg = b.doseMg ?? settings?.doseMg;
    const med = b.medication ?? settings?.medication;
    if (doseMg === undefined || med === undefined) throw badRequest("Set up your medication and dose first");
    await db.transaction(async (tx) => {
      const values = { medication: med, doseMg, site: b.site, note: b.note ?? null };
      await tx
        .insert(glp1Shots)
        .values({ userId, day, ...values })
        .onConflictDoUpdate({ target: [glp1Shots.userId, glp1Shots.day], set: values });
      const [later] = await tx.select({ id: glp1Shots.id }).from(glp1Shots).where(and(eq(glp1Shots.userId, userId), gt(glp1Shots.day, day))).limit(1);
      if (settings && !later && (settings.doseMg !== doseMg || settings.medication !== med)) {
        await tx.update(glp1Settings).set({ doseMg, medication: med, updatedAt: new Date() }).where(eq(glp1Settings.userId, userId));
      }
    });
    return glp1View(app, userId);
  });

  app.delete("/api/glp1/shots/:day", async (req) => {
    const userId = requireUser(req);
    const day = DAY.parse((req.params as { day: string }).day);
    const gone = await db.delete(glp1Shots).where(and(eq(glp1Shots.userId, userId), eq(glp1Shots.day, day))).returning({ id: glp1Shots.id });
    if (!gone.length) throw notFound("Shot");
    return glp1View(app, userId);
  });

  // Over the last 12 weeks: average calories and protein by days since the most recent shot (0-6),
  // over days with food logged (water alone doesn't count). Shown once there are 2 or more shots.
  app.get("/api/glp1/after-injection", async (req) => {
    const userId = requireUser(req);
    const today = await todayFor(app, userId);
    const from = addDays(today, -(AFTER_INJECTION_DAYS - 1));
    const shots = await db
      .select({ day: glp1Shots.day })
      .from(glp1Shots)
      .where(and(eq(glp1Shots.userId, userId), lte(glp1Shots.day, today)))
      .orderBy(asc(glp1Shots.day));
    const rows = await db
      .select({ day: logEntries.day, source: logEntries.source, nutrients: logEntries.nutrients })
      .from(logEntries)
      .where(and(eq(logEntries.userId, userId), gte(logEntries.day, from), lte(logEntries.day, today)));
    const byDay = new Map<string, { food: boolean; nutrients: Nutrients[] }>();
    for (const r of rows) {
      const d = byDay.get(r.day) ?? { food: false, nutrients: [] };
      if (r.source !== "water") d.food = true;
      d.nutrients.push(r.nutrients as Nutrients);
      byDay.set(r.day, d);
    }
    // Day totals the way the day view sums them
    const foodDays = [...byDay].filter(([, d]) => d.food).map(([day, d]) => {
      const s = sumNutrients(d.nutrients);
      return { day, calories: s.calories ?? 0, protein: s.protein_g ?? 0 };
    });
    return { enough: shots.length >= 2, days: afterInjection(shots.map((s) => s.day), foodDays) };
  });

  // How the person felt on a day; nothing ticked and no note clears the day
  app.put("/api/side-effects/:day", async (req) => {
    const userId = requireUser(req);
    const day = await pastDay(app, userId, (req.params as { day: string }).day);
    const b = sideEffectBody.parse(req.body ?? {});
    const effects = b.effects as Record<string, 1 | 2 | 3>;
    const noteText = b.note ?? null;
    if (!Object.keys(effects).length && !noteText) {
      await db.delete(sideEffects).where(and(eq(sideEffects.userId, userId), eq(sideEffects.day, day)));
      return { sideEffect: null };
    }
    await db
      .insert(sideEffects)
      .values({ userId, day, effects, note: noteText })
      .onConflictDoUpdate({ target: [sideEffects.userId, sideEffects.day], set: { effects, note: noteText } });
    return { sideEffect: { day, effects, note: noteText } };
  });

  app.get("/api/side-effects", async (req) => {
    const userId = requireUser(req);
    const { from, to } = rangeQuery.parse(req.query ?? {});
    if (from > to || addDays(from, MAX_SIDE_EFFECT_DAYS - 1) < to) throw badRequest(`Choose up to ${MAX_SIDE_EFFECT_DAYS} days`);
    const rows = await db
      .select()
      .from(sideEffects)
      .where(and(eq(sideEffects.userId, userId), gte(sideEffects.day, from), lte(sideEffects.day, to)))
      .orderBy(asc(sideEffects.day));
    return { days: rows.map((r) => ({ day: r.day, effects: r.effects, note: r.note })) };
  });
}
