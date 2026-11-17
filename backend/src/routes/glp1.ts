import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, asc, desc, eq, gt, gte, lte } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { glp1Settings, glp1Shots, logEntries, sideEffects } from "../db/schema.js";
import { badRequest, notFound } from "../lib/errors.js";
import { requireUser } from "../lib/guards.js";
import { addDays, DAY, todayFor } from "../lib/days.js";
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
      .onConflictDoUpdate({ target: glp1Settings.userId, set: { ...b, updatedAt: app.now() } });
    return glp1View(app, userId);
  });

  // One shot per day (a second one that day replaces it). Left out, dose, medication and note keep that
  // day's shot's own (a new shot: dose and medication from the settings). A different dose or medication
  // sent for the latest shot (or a new latest shot's) becomes the current one (a backdated shot leaves it alone).
  app.put("/api/glp1/shots/:day", async (req) => {
    const userId = requireUser(req);
    const day = await pastDay(app, userId, (req.params as { day: string }).day);
    const b = shotBody.parse(req.body ?? {});
    const settings = await settingsFor(db, userId);
    const [existing] = await db.select().from(glp1Shots).where(and(eq(glp1Shots.userId, userId), eq(glp1Shots.day, day)));
    const doseMg = b.doseMg ?? existing?.doseMg ?? settings?.doseMg;
    const med = b.medication ?? existing?.medication ?? settings?.medication;
    if (doseMg === undefined || med === undefined) throw badRequest("Set up your medication and dose first");
    const noteText = b.note === undefined ? (existing?.note ?? null) : b.note;
    await db.transaction(async (tx) => {
      const values = { medication: med, doseMg, site: b.site, note: noteText };
      await tx
        .insert(glp1Shots)
        .values({ userId, day, ...values })
        .onConflictDoUpdate({ target: [glp1Shots.userId, glp1Shots.day], set: values });
      const [later] = await tx.select({ id: glp1Shots.id }).from(glp1Shots).where(and(eq(glp1Shots.userId, userId), gt(glp1Shots.day, day))).limit(1);
      // Only a dose or medication sent with this shot, or a new latest shot, speaks for the current one: re-saving
      // the latest shot (e.g. a new site) mustn't undo a dose changed in the settings since
      const speaks = b.doseMg !== undefined || b.medication !== undefined || !existing;
      if (settings && speaks && !later && (settings.doseMg !== doseMg || settings.medication !== med)) {
        await tx.update(glp1Settings).set({ doseMg, medication: med, updatedAt: app.now() }).where(eq(glp1Settings.userId, userId));
      }
    });
    return glp1View(app, userId);
  });

  app.delete("/api/glp1/shots/:day", async (req) => {
    const userId = requireUser(req);
    const day = DAY.parse((req.params as { day: string }).day);
    await db.transaction(async (tx) => {
      const gone = await tx.delete(glp1Shots).where(and(eq(glp1Shots.userId, userId), eq(glp1Shots.day, day))).returning({ id: glp1Shots.id });
      if (!gone.length) throw notFound("Shot");
      // The latest shot gone: the current dose goes back to the now-latest shot's (none left: unchanged)
      const [later] = await tx.select({ id: glp1Shots.id }).from(glp1Shots).where(and(eq(glp1Shots.userId, userId), gt(glp1Shots.day, day))).limit(1);
      if (later) return;
      const [latest] = await tx.select().from(glp1Shots).where(eq(glp1Shots.userId, userId)).orderBy(desc(glp1Shots.day)).limit(1);
      if (latest) await tx.update(glp1Settings).set({ doseMg: latest.doseMg, medication: latest.medication, updatedAt: app.now() }).where(eq(glp1Settings.userId, userId));
    });
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
    const byDay = new Map<string, { food: boolean; nutrients: Nutrients[]; foods: Nutrients[] }>();
    for (const r of rows) {
      const d = byDay.get(r.day) ?? { food: false, nutrients: [], foods: [] };
      if (r.source !== "water") {
        d.food = true;
        d.foods.push(r.nutrients as Nutrients);
      }
      d.nutrients.push(r.nutrients as Nutrients);
      byDay.set(r.day, d);
    }
    // Day totals the way the day view sums them, but a nutrient no food that day has stays unknown (null)
    const foodDays = [...byDay].filter(([, d]) => d.food).map(([day, d]) => {
      const s = sumNutrients(d.nutrients);
      const known = (k: "calories" | "protein_g") => d.foods.some((n) => typeof n[k] === "number" && Number.isFinite(n[k]));
      return { day, calories: known("calories") ? (s.calories ?? 0) : null, protein: known("protein_g") ? (s.protein_g ?? 0) : null };
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
