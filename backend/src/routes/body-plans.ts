import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, desc, eq, lte } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { targets, userBody, users } from "../db/schema.js";
import { HttpError } from "../lib/errors.js";
import { requireUser } from "../lib/guards.js";
import { localDay } from "../lib/days.js";
import { logEvent } from "../lib/appLog.js";
import { buildPlans, planExplanation, targetsForPlan, type Body, type PlanId, type PlanResult, type PlanTargets } from "../lib/plans.js";

export type Targets = PlanTargets & { plan: PlanId | null; effectiveFrom: string };

const PLAN_IDS = ["relaxed", "steady", "accelerated", "vigorous"] as const;
const AI_EXPLAIN_MS = 8000;
const NO_BODY = "Tell ByteSize about yourself first";

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-17").refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)), "That isn't a real date");

const range = (max: number, int = false) => {
  const n = int ? z.number().int().min(0).max(max) : z.number().min(0).max(max);
  return z
    .object({ min: n, max: n })
    .refine((r) => r.min <= r.max, "The low end must not be above the high end");
};

const bodySchema = (now: Date) =>
  z
    .object({
      sex: z.enum(["male", "female"], { error: "Choose male or female" }),
      birthYear: z.number().int().min(1900, "Enter a birth year after 1900").max(now.getUTCFullYear() - 13, "ByteSize is for people 13 and older"),
      heightCm: z.number().min(100, "Enter a height between 100 and 250 cm").max(250, "Enter a height between 100 and 250 cm"),
      weightKg: z.number().min(30, "Enter a weight between 30 and 350 kg").max(350, "Enter a weight between 30 and 350 kg"),
      goalWeightKg: z.number().min(30, "Enter a goal weight between 30 and 350 kg").max(350, "Enter a goal weight between 30 and 350 kg"),
      activity: z.enum(["sedentary", "light", "moderate", "active", "very"], { error: "Choose an activity level" }),
      glp1: z.boolean(),
    });

const targetsSchema = z.object({ calories: range(10000, true), protein_g: range(1000), fiber_g: range(500), water_ml: range(20000) });

function rowToTargets(r: typeof targets.$inferSelect): Targets {
  return {
    calories: { min: r.caloriesMin, max: r.caloriesMax },
    protein_g: { min: r.proteinMin, max: r.proteinMax },
    fiber_g: { min: r.fiberMin, max: r.fiberMax },
    water_ml: { min: r.waterMin, max: r.waterMax },
    plan: (r.plan as PlanId | null) ?? null,
    effectiveFrom: r.effectiveFrom,
  };
}

/** The targets in force on `day` (YYYY-MM-DD): the latest effective_from on or before it (ties: newest row). */
export async function targetsOn(db: Db, userId: number, day: string): Promise<Targets | null> {
  const [row] = await db
    .select()
    .from(targets)
    .where(and(eq(targets.userId, userId), lte(targets.effectiveFrom, day)))
    .orderBy(desc(targets.effectiveFrom), desc(targets.id))
    .limit(1);
  return row ? rowToTargets(row) : null;
}

async function saveTargets(db: Db, userId: number, day: string, t: PlanTargets, plan: PlanId | null): Promise<Targets> {
  const [row] = await db
    .insert(targets)
    .values({
      userId,
      effectiveFrom: day,
      plan,
      caloriesMin: Math.round(t.calories.min),
      caloriesMax: Math.round(t.calories.max),
      proteinMin: t.protein_g.min,
      proteinMax: t.protein_g.max,
      fiberMin: t.fiber_g.min,
      fiberMax: t.fiber_g.max,
      waterMin: t.water_ml.min,
      waterMax: t.water_ml.max,
    })
    .returning();
  return rowToTargets(row);
}

async function loadBody(db: Db, userId: number): Promise<Body | null> {
  const [r] = await db.select().from(userBody).where(eq(userBody.userId, userId));
  return r ? { sex: r.sex, birthYear: r.birthYear, heightCm: r.heightCm, weightKg: r.weightKg, goalWeightKg: r.goalWeightKg, activity: r.activity, glp1: r.glp1 } : null;
}

async function today(app: FastifyInstance, userId: number): Promise<string> {
  const [u] = await app.db.select({ timezone: users.timezone }).from(users).where(eq(users.id, userId));
  if (!u) throw new HttpError(401, "Not logged in");
  return localDay(u.timezone, app.now());
}

// Two sentences from AI when it's ready; the fixed text when it's off, slow or fails.
async function explain(app: FastifyInstance, userId: number, result: PlanResult, body: Body): Promise<string> {
  const fallback = planExplanation(result, body);
  if (!(await app.ai.active("quick").catch(() => null))) return fallback;
  const n = (x: number) => x.toLocaleString("en-US");
  const facts = [
    `Maintenance (TDEE): ${n(result.tdee)} calories a day. Safe floor: ${n(result.floor)} calories.`,
    ...result.plans.map((p) => `${p.name}: ${n(p.calories)} calories, ${p.lbsPerWeek} lb a week, ${p.weeksToGoal ?? "no"} weeks to goal${p.recommended ? " (recommended)" : ""}${p.notRecommended ? " (below the floor, not recommended)" : ""}.`),
    `Recommended: ${result.recommended ?? "none — every plan is below the safe floor; they should set targets with their care team"}.`,
    `On a GLP-1 medication: ${body.glp1 ? "yes" : "no"}. Goal: lose ${n(Math.round((body.weightKg - body.goalWeightKg) / 0.45359237))} lb.`,
  ].join("\n");
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`No answer within ${AI_EXPLAIN_MS / 1000} s`));
      }, AI_EXPLAIN_MS);
    });
    const ask = app.ai.ask(
      "quick",
      'You explain weight-loss plans in a nutrition app. Using only the numbers given, write exactly 2 short, plain sentences: which plan suits this person and why, and one tip. Never suggest eating below the safe floor. Reply as JSON: {"explanation": "..."}',
      facts,
      { userId, maxTokens: 300, signal: controller.signal }
    );
    ask.catch(() => {}); // a late failure after the timeout is not an unhandled rejection
    const { json } = await Promise.race([ask, timeout]);
    const text = typeof json.explanation === "string" ? json.explanation.trim() : "";
    if (!text) throw new Error("The answer had no explanation");
    return text;
  } catch (err) {
    void logEvent(app.db, { category: "ai", level: "warning", source: "plans", event: "Plan explanation fell back to the fixed text", detail: (err as Error).message, userId });
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

export default async function bodyPlanRoutes(app: FastifyInstance) {
  const { db } = app;

  app.get("/api/body", async (req) => {
    const userId = requireUser(req);
    return { body: await loadBody(db, userId) };
  });

  app.put("/api/body", async (req) => {
    const userId = requireUser(req);
    const body = bodySchema(app.now()).parse(req.body ?? {});
    await db
      .insert(userBody)
      .values({ userId, ...body, updatedAt: app.now() })
      .onConflictDoUpdate({ target: userBody.userId, set: { ...body, updatedAt: app.now() } });
    // As stored (height and weights are float4 columns), so PUT and GET agree
    return { body: await loadBody(db, userId) };
  });

  app.get("/api/plans", async (req) => {
    const userId = requireUser(req);
    const body = await loadBody(db, userId);
    if (!body) throw new HttpError(409, NO_BODY);
    const result = buildPlans(body, app.now());
    const current = (await targetsOn(db, userId, await today(app, userId)))?.plan ?? null;
    return { tdee: result.tdee, floor: result.floor, plans: result.plans, explanation: await explain(app, userId, result, body), current };
  });

  app.post("/api/plans/select", async (req) => {
    const userId = requireUser(req);
    const { plan } = z.object({ plan: z.enum(PLAN_IDS, { error: "Choose one of the plans" }) }).parse(req.body ?? {});
    const body = await loadBody(db, userId);
    if (!body) throw new HttpError(409, NO_BODY);
    const chosen = buildPlans(body, app.now()).plans.find((p) => p.id === plan)!;
    return { targets: await saveTargets(db, userId, await today(app, userId), targetsForPlan(body, chosen.calories), plan) };
  });

  app.get("/api/targets", async (req) => {
    const userId = requireUser(req);
    const { day } = z.object({ day: DAY.optional() }).parse(req.query ?? {});
    return { targets: await targetsOn(db, userId, day ?? (await today(app, userId))) };
  });

  // Set by hand: replaces plan targets from today on (older days keep theirs)
  app.put("/api/targets", async (req) => {
    const userId = requireUser(req);
    const t = targetsSchema.parse(req.body ?? {});
    return { targets: await saveTargets(db, userId, await today(app, userId), t, null) };
  });
}
