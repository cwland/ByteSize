import { describe, expect, it } from "vitest";
import {
  ACTIVITY,
  PLAN_DEFS,
  age,
  bmr,
  buildPlans,
  planExplanation,
  targetsForPlan,
  tdee,
  type Body,
  type PlanId,
} from "../src/lib/plans.js";

const today = "2026-11-17";

// 6'0", 250 lb, goal 180 lb, 40 years old
const A: Body = {
  sex: "male", birthDate: "1986-01-01", heightCm: 177.8, weightKg: 113.3980925, goalWeightKg: 81.6466266,
  activity: "sitting", glp1: true,
};
// 5'0", 140 lb, goal 120 lb, 60 years old: no safe plan
const B: Body = {
  sex: "female", birthDate: "1966-01-01", heightCm: 152.4, weightKg: 63.50293, goalWeightKg: 54.43108,
  activity: "sitting", glp1: true,
};
// Steady is under the floor, Relaxed is above it (50 on 2026-11-17)
const C: Body = {
  sex: "female", birthDate: "1976-06-01", heightCm: 160, weightKg: 70, goalWeightKg: 60,
  activity: "sitting", glp1: false,
};
// Cory: 6'0", 226 lb → 180 lb, desk + daily walk, on a GLP-1 (52 on 2026-11-17)
const CORY: Body = {
  sex: "male", birthDate: "1974-06-01", heightCm: 182.88, weightKg: 102.51187562, goalWeightKg: 81.6466266,
  activity: "some", glp1: true,
};

const byId = (r: ReturnType<typeof buildPlans>, id: PlanId) => r.plans.find((p) => p.id === id)!;

describe("age", () => {
  it("is exact on the day before and the day of a birthday", () => {
    expect(age("1974-11-18", "2026-11-17")).toBe(51);
    expect(age("1974-11-18", "2026-11-18")).toBe(52);
    expect(age("1974-06-01", "2026-11-17")).toBe(52);
    expect(age("1974-12-31", "2026-01-01")).toBe(51);
  });

  it("counts a Feb 29 birthday from Mar 1 in non-leap years", () => {
    expect(age("2000-02-29", "2027-02-28")).toBe(26);
    expect(age("2000-02-29", "2027-03-01")).toBe(27);
    expect(age("2000-02-29", "2028-02-28")).toBe(27);
    expect(age("2000-02-29", "2028-02-29")).toBe(28);
  });
});

describe("plan calculator", () => {
  it("defines activity multipliers and the four plans", () => {
    expect(ACTIVITY).toEqual({ sitting: 1.2, some: 1.3, most: 1.4, physical: 1.5 });
    expect(PLAN_DEFS.map((p) => [p.id, p.name, p.lbsPerWeek, p.deficit, p.protein, p.fiber])).toEqual([
      ["maintenance", "Maintenance", 0, 0, [0.8, 1.0], { min: 30, max: 35 }],
      ["relaxed", "Relaxed", 0.5, 250, [0.8, 0.9], { min: 30, max: 35 }],
      ["steady", "Steady", 1, 500, [0.9, 1.0], { min: 30, max: 35 }],
      ["accelerated", "Accelerated", 1.5, 750, [0.95, 1.05], { min: 28, max: 32 }],
      ["vigorous", "Vigorous", 2, 1000, [1.0, 1.1], { min: 25, max: 30 }],
    ]);
    for (const d of PLAN_DEFS) expect(d.bestFor.length).toBeGreaterThan(10);
  });

  it("computes Mifflin-St Jeor BMR and TDEE with the exact age", () => {
    expect(bmr(A, today)).toBeCloseTo(2050.23, 2);
    expect(tdee(A, today)).toBe(2460);
    expect(bmr(C, today)).toBeCloseTo(1289, 6);
    expect(tdee(C, today)).toBe(1547);
    // A day before the 50th birthday is one year younger: +5 kcal BMR
    expect(bmr(C, "2026-05-31")).toBeCloseTo(1294, 6);
  });

  it("Cory: tdee, floor, calories, weeks and per-plan targets", () => {
    const r = buildPlans(CORY, today);
    expect(r.tdee).toBe(2487);
    expect(r.floor).toBe(1617);
    expect(r.plans.map((p) => p.calories)).toEqual([2487, 2237, 1987, 1737, 1487]);
    expect(r.recommended).toBe("steady");
    expect(r.plans.map((p) => p.recommended)).toEqual([false, false, true, false, false]);
    expect(r.plans.map((p) => p.notRecommended)).toEqual([false, false, false, false, true]);
    expect(r.plans.map((p) => p.weeksToGoal)).toEqual([null, 92, 46, 31, 23]);
    const water = { min: 1893, max: 3785 };
    expect(byId(r, "relaxed").targets).toEqual({ calories: { min: 2187, max: 2287 }, protein_g: { min: 144, max: 162 }, fiber_g: { min: 30, max: 35 }, water_ml: water });
    expect(byId(r, "steady").targets).toEqual({ calories: { min: 1937, max: 2037 }, protein_g: { min: 162, max: 180 }, fiber_g: { min: 30, max: 35 }, water_ml: water });
    expect(byId(r, "accelerated").targets).toEqual({ calories: { min: 1687, max: 1787 }, protein_g: { min: 171, max: 189 }, fiber_g: { min: 28, max: 32 }, water_ml: water });
    // Not recommended: its own range, not pulled up to the floor
    expect(byId(r, "vigorous").targets).toEqual({ calories: { min: 1437, max: 1537 }, protein_g: { min: 180, max: 198 }, fiber_g: { min: 25, max: 30 }, water_ml: water });
    for (const p of r.plans) {
      expect(typeof p.bestFor).toBe("string");
      expect(p.bestFor).toBe(PLAN_DEFS.find((d) => d.id === p.id)!.bestFor);
    }
  });

  it("body A: four plans, steady recommended, vigorous under the floor", () => {
    const r = buildPlans(A, today);
    expect(r.tdee).toBe(2460);
    expect(r.floor).toBe(1599);
    expect(r.plans.map((p) => p.id)).toEqual(["maintenance", "relaxed", "steady", "accelerated", "vigorous"]);
    expect(r.plans.map((p) => p.calories)).toEqual([2460, 2210, 1960, 1710, 1460]);
    expect(r.plans.map((p) => p.weeksToGoal)).toEqual([null, 140, 70, 47, 35]);
    expect(r.recommended).toBe("steady");
    expect(r.plans.map((p) => p.recommended)).toEqual([false, false, true, false, false]);
    expect(r.plans.map((p) => p.notRecommended)).toEqual([false, false, false, false, true]);
  });

  it("body A: targets for the steady plan (thin wrapper agrees with the card)", () => {
    const steady = byId(buildPlans(A, today), "steady");
    expect(steady.targets).toEqual({
      calories: { min: 1910, max: 2010 },
      protein_g: { min: 162, max: 180 },
      fiber_g: { min: 30, max: 35 },
      water_ml: { min: 1893, max: 3785 },
    });
    expect(targetsForPlan(A, today, "steady")).toEqual(steady.targets);
  });

  it("body A: explanation names the plan, calories, floor and GLP-1 protein advice", () => {
    expect(planExplanation(buildPlans(A, today), A)).toBe(
      "Steady keeps you at 1,960 calories, above your 1,599 floor, and loses about 1 lb a week. " +
        "On a GLP-1, slower loss helps protect muscle — aim for at least 162 g of protein.",
    );
  });

  it("body B: no safe plan, nothing recommended, points to the care team", () => {
    const r = buildPlans(B, today);
    expect(r.tdee).toBe(1352);
    expect(r.floor).toBe(1200);
    expect(r.plans.map((p) => p.calories)).toEqual([1352, 1102, 852, 602, 352]);
    // every weight-loss plan is under the floor; Maintenance (no deficit) isn't, but nothing is recommended
    expect(r.plans.filter((p) => p.id !== "maintenance").every((p) => p.notRecommended)).toBe(true);
    expect(r.plans.some((p) => p.recommended)).toBe(false);
    expect(r.plans.some((p) => p.recommended)).toBe(false);
    expect(r.recommended).toBeNull();
    // Every plan is not recommended: each keeps its own honest range
    expect(r.plans.map((p) => p.targets.calories)).toEqual([
      { min: 1252, max: 1452 }, { min: 1052, max: 1152 }, { min: 802, max: 902 }, { min: 552, max: 652 }, { min: 302, max: 402 },
    ]);
    const text = planExplanation(r, B);
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
        "Aim for at least 106 g of protein.",
    );
  });

  it("the calorie range of a plan that isn't 'not recommended' never starts below the floor", () => {
    const c = buildPlans(C, today);
    expect(byId(c, "relaxed").recommended).toBe(true);
    expect(byId(c, "relaxed").targets.calories).toEqual({ min: 1247, max: 1347 });
    for (const p of c.plans.filter((p) => !p.notRecommended)) expect(p.targets.calories.min).toBeGreaterThanOrEqual(c.floor);
    // Body C at 63 kg: relaxed is 1213, recommended, and 1213 − 50 would be under 1200 → pulled up
    const d = buildPlans({ ...C, weightKg: 63, goalWeightKg: 55 }, today);
    expect(d.floor).toBe(1200);
    expect(byId(d, "relaxed").calories).toBe(1213);
    expect(byId(d, "relaxed").recommended).toBe(true);
    expect(byId(d, "relaxed").targets.calories).toEqual({ min: 1200, max: 1263 });
    // ...while not-recommended steady keeps 963 ± 50
    expect(byId(d, "steady").notRecommended).toBe(true);
    expect(byId(d, "steady").targets.calories).toEqual({ min: 913, max: 1013 });
  });

  it("goal reached: Maintenance is recommended, no weeks to goal", () => {
    for (const goalWeightKg of [A.weightKg, A.weightKg + 5]) {
      const body = { ...A, goalWeightKg };
      const r = buildPlans(body, today);
      expect(r.recommended).toBe("maintenance");
      expect(r.plans.every((p) => p.weeksToGoal === null)).toBe(true);
      expect(r.plans.every((p) => !p.notRecommended)).toBe(true);
      expect(r.plans.filter((p) => p.recommended).map((p) => p.id)).toEqual(["maintenance"]);
      const text = planExplanation(r, body);
      expect(text).not.toContain("care team");
      expect(text).toContain("Maintenance");
    }
  });

  it("Maintenance holds Cory at his daily burn, ±100, and isn't recommended while he's losing", () => {
    const r = buildPlans(CORY, today);
    const m = byId(r, "maintenance");
    expect(m).toMatchObject({ name: "Maintenance", lbsPerWeek: 0, calories: 2487, weeksToGoal: null, recommended: false, notRecommended: false });
    expect(m.targets).toEqual({ calories: { min: 2387, max: 2587 }, protein_g: { min: 144, max: 180 }, fiber_g: { min: 30, max: 35 }, water_ml: { min: 1893, max: 3785 } });
    expect(m.bestFor).toMatch(/goal|break|vacation/i);
    expect(r.recommended).toBe("steady");
  });

  it("on a GLP-1 the recommendation is never faster than accelerated", () => {
    // Very high TDEE so every plan clears the floor; the rule still picks steady, never vigorous.
    const big: Body = { ...A, weightKg: 180, activity: "physical" };
    const r = buildPlans(big, today);
    expect(r.plans.every((p) => !p.notRecommended)).toBe(true);
    expect(r.recommended).toBe("steady");
  });
});
