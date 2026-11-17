// Weight-loss plan calculator (design §9). Pure: no I/O, no clock reads.

export type PlanId = "relaxed" | "steady" | "accelerated" | "vigorous";
export type Range = { min: number; max: number };
export type Activity = "sedentary" | "light" | "moderate" | "active" | "very";
export type Body = {
  sex: "male" | "female";
  birthYear: number;
  heightCm: number;
  weightKg: number;
  goalWeightKg: number;
  activity: Activity;
  glp1: boolean;
};
export type Plan = {
  id: PlanId;
  name: string;
  lbsPerWeek: number;
  calories: number;
  weeksToGoal: number | null;
  recommended: boolean;
  notRecommended: boolean;
};
export type PlanResult = { tdee: number; floor: number; plans: Plan[]; recommended: PlanId | null };
export type PlanTargets = { calories: Range; protein_g: Range; fiber_g: Range; water_ml: Range };

const KG_PER_LB = 0.45359237;

export const ACTIVITY: Record<Activity, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very: 1.9,
};

export const PLAN_DEFS: readonly { id: PlanId; name: string; lbsPerWeek: number; deficit: number }[] = [
  { id: "relaxed", name: "Relaxed", lbsPerWeek: 0.5, deficit: 250 },
  { id: "steady", name: "Steady", lbsPerWeek: 1, deficit: 500 },
  { id: "accelerated", name: "Accelerated", lbsPerWeek: 1.5, deficit: 750 },
  { id: "vigorous", name: "Vigorous", lbsPerWeek: 2, deficit: 1000 },
];

/** On a GLP-1, never recommend a plan faster than this (design §9, 2026-11-16 23:20). */
const GLP1_FASTEST: PlanId = "accelerated";

/** Mifflin-St Jeor. Age is today's UTC year minus birth year. */
export function bmr(body: Body, today: Date): number {
  const age = today.getUTCFullYear() - body.birthYear;
  return 10 * body.weightKg + 6.25 * body.heightCm - 5 * age + (body.sex === "male" ? 5 : -161);
}

export function tdee(body: Body, today: Date): number {
  return Math.round(bmr(body, today) * ACTIVITY[body.activity]);
}

export function buildPlans(body: Body, today: Date): PlanResult {
  const t = tdee(body, today);
  const floor = Math.round(Math.max(1200, 0.65 * t));
  const losing = body.goalWeightKg < body.weightKg;
  // Round to 1e-6 lb so float noise (e.g. 70.0000000001) can't push ceil() up a week.
  const lbsToLose = losing ? Math.round(((body.weightKg - body.goalWeightKg) / KG_PER_LB) * 1e6) / 1e6 : 0;

  const plans: Plan[] = PLAN_DEFS.map((d) => {
    const calories = t - d.deficit;
    return {
      id: d.id,
      name: d.name,
      lbsPerWeek: d.lbsPerWeek,
      calories,
      weeksToGoal: losing ? Math.ceil(lbsToLose / d.lbsPerWeek) : null,
      recommended: false,
      notRecommended: losing ? calories < floor : false,
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
    for (const p of plans) p.recommended = p.id === recommended;
  }

  return { tdee: t, floor, plans, recommended };
}

function goalLbs(body: Body): number {
  return body.goalWeightKg / KG_PER_LB;
}

// floor: the safe calorie floor (buildPlans().floor). The range never starts below it, even for a plan that was
// chosen against advice; such a range is pulled up to the floor rather than left under it.
export function targetsForPlan(body: Body, planCalories: number, floor = 0): PlanTargets {
  const lbs = goalLbs(body);
  const min = Math.max(planCalories - 150, floor);
  return {
    calories: { min, max: Math.max(planCalories + 150, min) },
    protein_g: { min: Math.round(0.7 * lbs), max: Math.round(1.0 * lbs) },
    fiber_g: { min: 25, max: 38 },
    water_ml: { min: 1893, max: 3785 },
  };
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
    return "Your goal is at or above your current weight, so none of these weight-loss plans apply. " +
      "Set your targets under Goals for now.";
  }
  const plan = result.plans.find((p) => p.id === result.recommended);
  if (!plan) {
    return `Every plan here would put you under a safe calorie floor of ${num(result.floor)}. ` +
      "Set your targets with your care team, then enter them under Goals.";
  }
  const protein = targetsForPlan(body, plan.calories).protein_g.min;
  const first = `${plan.name} keeps you at ${num(plan.calories)} calories, ${plan.calories > result.floor ? "above" : "right at"} your ${num(result.floor)} floor, ` +
    `and loses about ${lbsText(plan.lbsPerWeek)} lb a week.`;
  const second = body.glp1
    ? `On a GLP-1, slower loss helps protect muscle — aim for at least ${num(protein)} g of protein.`
    : `Aim for at least ${num(protein)} g of protein.`;
  return `${first} ${second}`;
}
