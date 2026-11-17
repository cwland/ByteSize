import { describe, expect, it } from "vitest";
import {
  ACTIVITY,
  PLAN_DEFS,
  bmr,
  buildPlans,
  planExplanation,
  targetsForPlan,
  tdee,
  type Body,
  type PlanId,
} from "../src/lib/plans.js";

const today = new Date("2026-11-17T12:00:00Z");

// 6'0", 250 lb, goal 180 lb, 40 years old
const A: Body = {
  sex: "male", birthYear: 1986, heightCm: 177.8, weightKg: 113.3980925, goalWeightKg: 81.6466266,
  activity: "sedentary", glp1: true,
};
// 5'0", 140 lb, goal 120 lb, 60 years old: no safe plan
const B: Body = {
  sex: "female", birthYear: 1966, heightCm: 152.4, weightKg: 63.50293, goalWeightKg: 54.43108,
  activity: "sedentary", glp1: true,
};
// Steady is under the floor, Relaxed is above it
const C: Body = {
  sex: "female", birthYear: 1976, heightCm: 160, weightKg: 70, goalWeightKg: 60,
  activity: "sedentary", glp1: false,
};

const byId = (r: ReturnType<typeof buildPlans>, id: PlanId) => r.plans.find((p) => p.id === id)!;

describe("plan calculator", () => {
  it("defines activity multipliers and the four plans", () => {
    expect(ACTIVITY).toEqual({ sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very: 1.9 });
    expect(PLAN_DEFS.map((p) => [p.id, p.name, p.lbsPerWeek, p.deficit])).toEqual([
      ["relaxed", "Relaxed", 0.5, 250],
      ["steady", "Steady", 1, 500],
      ["accelerated", "Accelerated", 1.5, 750],
      ["vigorous", "Vigorous", 2, 1000],
    ]);
  });

  it("computes Mifflin-St Jeor BMR and TDEE with age from the UTC year", () => {
    expect(bmr(A, today)).toBeCloseTo(2050.23, 2);
    expect(tdee(A, today)).toBe(2460);
    expect(bmr(C, today)).toBeCloseTo(1289, 6);
    expect(tdee(C, today)).toBe(1547);
  });

  it("body A: four plans, steady recommended, vigorous under the floor", () => {
    const r = buildPlans(A, today);
    expect(r.tdee).toBe(2460);
    expect(r.floor).toBe(1599);
    expect(r.plans.map((p) => p.id)).toEqual(["relaxed", "steady", "accelerated", "vigorous"]);
    expect(r.plans.map((p) => p.calories)).toEqual([2210, 1960, 1710, 1460]);
    expect(r.plans.map((p) => p.weeksToGoal)).toEqual([140, 70, 47, 35]);
    expect(r.recommended).toBe("steady");
    expect(r.plans.map((p) => p.recommended)).toEqual([false, true, false, false]);
    expect(r.plans.map((p) => p.notRecommended)).toEqual([false, false, false, true]);
  });

  it("body A: targets for the steady plan", () => {
    expect(targetsForPlan(A, 1960)).toEqual({
      calories: { min: 1810, max: 2110 },
      protein_g: { min: 126, max: 180 },
      fiber_g: { min: 25, max: 38 },
      water_ml: { min: 1893, max: 3785 },
    });
  });

  it("body A: explanation names the plan, calories, floor and GLP-1 protein advice", () => {
    expect(planExplanation(buildPlans(A, today), A)).toBe(
      "Steady keeps you at 1,960 calories, above your 1,599 floor, and loses about 1 lb a week. " +
        "On a GLP-1, slower loss helps protect muscle — aim for at least 126 g of protein.",
    );
  });

  it("body B: no safe plan, nothing recommended, points to the care team", () => {
    const r = buildPlans(B, today);
    expect(r.tdee).toBe(1352);
    expect(r.floor).toBe(1200);
    expect(r.plans.map((p) => p.calories)).toEqual([1102, 852, 602, 352]);
    expect(r.plans.every((p) => p.notRecommended)).toBe(true);
    expect(r.plans.some((p) => p.recommended)).toBe(false);
    expect(r.recommended).toBeNull();
    const text = planExplanation(r, B);
    expect(text).toContain("care team");
    expect(text).toBe(
      "Every plan here would put you under a safe calorie floor of 1,200. " +
        "Set your targets with your care team, then enter them under Goals.",
    );
  });

  it("body C: steady under the floor falls back to relaxed", () => {
    const r = buildPlans(C, today);
    expect(r.tdee).toBe(1547);
    expect(r.floor).toBe(1200);
    expect(byId(r, "steady").calories).toBe(1047);
    expect(byId(r, "steady").notRecommended).toBe(true);
    expect(byId(r, "relaxed").calories).toBe(1297);
    expect(byId(r, "relaxed").notRecommended).toBe(false);
    expect(r.recommended).toBe("relaxed");
    expect(planExplanation(r, C)).toBe(
      "Relaxed keeps you at 1,297 calories, above your 1,200 floor, and loses about ½ lb a week. " +
        "Aim for at least 93 g of protein.",
    );
  });

  it("goal at or above current weight: no recommendation and no weeks to goal", () => {
    for (const goalWeightKg of [A.weightKg, A.weightKg + 5]) {
      const body = { ...A, goalWeightKg };
      const r = buildPlans(body, today);
      expect(r.recommended).toBeNull();
      expect(r.plans.every((p) => p.weeksToGoal === null)).toBe(true);
      expect(r.plans.every((p) => !p.notRecommended && !p.recommended)).toBe(true);
      const text = planExplanation(r, body);
      expect(text).not.toContain("care team");
      expect(text).toContain("Goals");
    }
  });

  it("on a GLP-1 the recommendation is never faster than accelerated", () => {
    // Very high TDEE so every plan clears the floor; the rule still picks steady, never vigorous.
    const big: Body = { ...A, weightKg: 180, activity: "very" };
    const r = buildPlans(big, today);
    expect(r.plans.every((p) => !p.notRecommended)).toBe(true);
    expect(r.recommended).toBe("steady");
  });

  it("the calorie range never starts below the safe floor", () => {
    const r = buildPlans(C, today);
    const relaxed = r.plans.find((p) => p.id === "relaxed")!;
    expect(relaxed.calories).toBe(1297);
    expect(targetsForPlan(C, relaxed.calories, r.floor).calories).toEqual({ min: 1200, max: 1447 });
    expect(targetsForPlan(A, 1960, 1599).calories).toEqual({ min: 1810, max: 2110 }); // above the floor: unchanged
  });
});
