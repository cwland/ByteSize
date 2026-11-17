// Weight-loss plan calculator (design §9). Pure: no I/O, no clock reads.

import { KG_PER_LB } from "./weight.js";

export type PlanId = "maintenance" | "relaxed" | "steady" | "accelerated" | "vigorous";
export type Range = { min: number; max: number };
export type Activity = "sitting" | "some" | "most" | "physical";
export const ACTIVITIES = ["sitting", "some", "most", "physical"] as const satisfies readonly Activity[];
export type Body = {
  sex: "male" | "female";
  birthDate: string; // YYYY-MM-DD
  heightCm: number;
  weightKg: number;
  goalWeightKg: number;
  activity: Activity;
  glp1: boolean;
};
export type PlanTargets = { calories: Range; protein_g: Range; fiber_g: Range; water_ml: Range };
export type Plan = {
  id: PlanId;
  name: string;
  lbsPerWeek: number;
  calories: number;
  weeksToGoal: number | null;
  recommended: boolean;
  notRecommended: boolean;
  bestFor: string;
  targets: PlanTargets;
};
export type PlanResult = { tdee: number; floor: number; plans: Plan[]; recommended: PlanId | null };

// "How active is your day, not counting workouts?" (design §10)
export const ACTIVITY: Record<Activity, number> = {
  sitting: 1.2,
  some: 1.3,
  most: 1.4,
  physical: 1.5,
};

type PlanDef = {
  id: PlanId;
  name: string;
  lbsPerWeek: number;
  deficit: number;
  /** g of protein per lb of goal weight: [low, high] */
  protein: readonly [number, number];
  fiber: Range;
  bestFor: string;
  /** calories either side of the plan's number (default CALORIE_SPREAD) */
  spread?: number;
};

export const PLAN_DEFS: readonly PlanDef[] = [
  { id: "maintenance", name: "Maintenance", lbsPerWeek: 0, deficit: 0, protein: [0.8, 1.0], fiber: { min: 30, max: 35 }, spread: 100,
    bestFor: "Reached your goal, taking a break, or a vacation week" },
  { id: "relaxed", name: "Relaxed", lbsPerWeek: 0.5, deficit: 250, protein: [0.8, 0.9], fiber: { min: 30, max: 35 },
    bestFor: "Easing into a new dose, minimal side effects and strength gains" },
  { id: "steady", name: "Steady", lbsPerWeek: 1, deficit: 500, protein: [0.9, 1.0], fiber: { min: 30, max: 35 },
    bestFor: "The sweet spot: sustainable loss, high energy and no muscle loss" },
  { id: "accelerated", name: "Accelerated", lbsPerWeek: 1.5, deficit: 750, protein: [0.95, 1.05], fiber: { min: 28, max: 32 },
    bestFor: "Strong appetite suppression, when eating more feels forced" },
  { id: "vigorous", name: "Vigorous", lbsPerWeek: 2, deficit: 1000, protein: [1.0, 1.1], fiber: { min: 25, max: 30 },
    bestFor: "The fastest loss, and the hardest to sustain" },
];

const CALORIE_SPREAD = 50;
const WATER_ML: Range = { min: 1893, max: 3785 };

/** On a GLP-1, never recommend a plan faster than this (design §9, 2026-11-16 23:20). */
const GLP1_FASTEST: PlanId = "accelerated";

const ymd = (d: string) => d.split("-").map(Number) as [number, number, number];

/**
 * Exact age in whole years on `today` (both YYYY-MM-DD; `today` is the person's own local day).
 * A Feb 29 birthday counts from Mar 1 in non-leap years.
 */
export function age(birthDate: string, today: string): number {
  const [by, bm, bd] = ymd(birthDate);
  const [ty, tm, td] = ymd(today);
  const hadBirthday = tm > bm || (tm === bm && td >= bd);
  return ty - by - (hadBirthday ? 0 : 1);
}

/** Mifflin-St Jeor, with the exact age on `today` (the person's local day). */
export function bmr(body: Body, today: string): number {
  return 10 * body.weightKg + 6.25 * body.heightCm - 5 * age(body.birthDate, today) + (body.sex === "male" ? 5 : -161);
}

export function tdee(body: Body, today: string): number {
  return Math.round(bmr(body, today) * ACTIVITY[body.activity]);
}

function planTargets(body: Body, def: PlanDef, calories: number, floor: number | null): PlanTargets {
  const lbs = body.goalWeightKg / KG_PER_LB;
  // floor null: a "Not recommended" plan keeps its own range, shown honestly
  const spread = def.spread ?? CALORIE_SPREAD;
  const min = floor === null ? calories - spread : Math.max(calories - spread, floor);
  return {
    calories: { min, max: Math.max(calories + spread, min) },
    protein_g: { min: Math.round(def.protein[0] * lbs), max: Math.round(def.protein[1] * lbs) },
    fiber_g: { ...def.fiber },
    water_ml: { ...WATER_ML },
  };
}

export function buildPlans(body: Body, today: string): PlanResult {
  const t = tdee(body, today);
  const floor = Math.round(Math.max(1200, 0.65 * t));
  const losing = body.goalWeightKg < body.weightKg;
  // Round to 1e-6 lb so float noise (e.g. 70.0000000001) can't push ceil() up a week.
  const lbsToLose = losing ? Math.round(((body.weightKg - body.goalWeightKg) / KG_PER_LB) * 1e6) / 1e6 : 0;

  const plans: Plan[] = PLAN_DEFS.map((d) => {
    const calories = t - d.deficit;
    const notRecommended = losing ? calories < floor : false;
    return {
      id: d.id,
      name: d.name,
      lbsPerWeek: d.lbsPerWeek,
      calories,
      weeksToGoal: losing && d.lbsPerWeek > 0 ? Math.ceil(lbsToLose / d.lbsPerWeek) : null,
      recommended: false,
      notRecommended,
      bestFor: d.bestFor,
      // Plans that aren't "Not recommended" never start below the safe floor
      targets: planTargets(body, d, calories, notRecommended ? null : floor),
    };
  });

  let recommended: PlanId | null = null;
  if (losing) {
    const safe = (id: PlanId) => plans.find((p) => p.id === id)!.calories >= floor;
    // Recommend Steady; if Steady is under the floor, the fastest plan at or above it (only Relaxed can be).
    if (safe("steady")) recommended = "steady";
    else if (safe("relaxed")) recommended = "relaxed";
    // Explicit GLP-1 cap, kept for future rule changes.
    if (recommended && body.glp1) {
      const order = PLAN_DEFS.map((d) => d.id);
      if (order.indexOf(recommended) > order.indexOf(GLP1_FASTEST)) recommended = GLP1_FASTEST;
    }
  } else {
    // At or past the goal: hold steady
    recommended = "maintenance";
  }
  for (const p of plans) p.recommended = p.id === recommended;

  return { tdee: t, floor, plans, recommended };
}

/** Thin wrapper: the targets on a plan's card (what selecting it sets). */
export function targetsForPlan(body: Body, today: string, plan: PlanId): PlanTargets {
  return buildPlans(body, today).plans.find((p) => p.id === plan)!.targets;
}

const num = (n: number) => n.toLocaleString("en-US");

function lbsText(lbs: number): string {
  const whole = Math.floor(lbs);
  const half = lbs - whole >= 0.5 ? "½" : "";
  return whole === 0 ? half || "0" : `${whole}${half}`;
}

/** Deterministic explanation, used when AI is off. */
export function planExplanation(result: PlanResult, body: Body): string {
  if (body.goalWeightKg >= body.weightKg) {
    const m = result.plans.find((p) => p.id === "maintenance")!;
    return `You're at your goal. Maintenance holds you at about ${num(m.calories)} calories a day — ` +
      `keep protein at ${m.targets.protein_g.min}–${m.targets.protein_g.max} g to hold on to muscle.`;
  }
  const plan = result.plans.find((p) => p.id === result.recommended);
  if (!plan) {
    return `Every plan here would put you under a safe calorie floor of ${num(result.floor)}. ` +
      "Set your targets with your care team, then enter them under Goals.";
  }
  const protein = plan.targets.protein_g.min;
  const first = `${plan.name} keeps you at ${num(plan.calories)} calories, ${plan.calories > result.floor ? "above" : "right at"} your ${num(result.floor)} floor, ` +
    `and loses about ${lbsText(plan.lbsPerWeek)} lb a week.`;
  const second = body.glp1
    ? `On a GLP-1, slower loss helps protect muscle — aim for at least ${num(protein)} g of protein.`
    : `Aim for at least ${num(protein)} g of protein.`;
  return `${first} ${second}`;
}
