import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";
import { buildPlans, planExplanation } from "../src/lib/plans.js";
import { localDay } from "../src/lib/days.js";
import { userBody } from "../src/db/schema.js";

let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
beforeEach(async () => {
  await t.reset();
  await t.login();
});
afterAll(async () => t.close());

// Body A from the plan tests (240 lb → 180 lb, 5'10", sedentary man on a GLP-1)
const A = { sex: "male", birthDate: "1986-01-01", heightCm: 177.8, weightKg: 113.3980925, goalWeightKg: 81.6466266, activity: "sitting", glp1: true } as const;
const STEADY = { calories: { min: 1910, max: 2010 }, protein_g: { min: 162, max: 180 }, fiber_g: { min: 30, max: 35 }, water_ml: { min: 1893, max: 3785 } };

// 05:30 UTC on Nov 18 is still Nov 17 in Boise (UTC−7)
const DAY1 = new Date("2026-11-18T05:30:00Z");
const at = (iso: string) => (t.clock.date = new Date(iso));

describe("localDay", () => {
  it("gives the date in the given time zone", () => {
    expect(localDay("America/Boise", DAY1)).toBe("2026-11-17");
    expect(localDay("UTC", DAY1)).toBe("2026-11-18");
    expect(localDay("Asia/Tokyo", new Date("2026-12-31T15:00:00Z"))).toBe("2027-01-01");
  });
});

describe("body and plans", () => {
  it("saves the body and lists plans with Steady recommended", async () => {
    t.clock.date = DAY1;
    expect((await t.api("GET", "/api/body")).body).toEqual({ body: null });
    const put = await t.api("PUT", "/api/body", A);
    expect(put.status).toBe(200);
    // Height and weights are stored as float4: equal to about 5 significant digits
    const close = (b: any) => ({ ...b, heightCm: expect.closeTo(A.heightCm, 3), weightKg: expect.closeTo(A.weightKg, 3), goalWeightKg: expect.closeTo(A.goalWeightKg, 3) });
    expect(put.body).toEqual({ body: { ...close(A), needsReview: false } });
    expect((await t.api("GET", "/api/body")).body).toEqual(put.body);

    const res = await t.api("GET", "/api/plans");
    expect(res.status).toBe(200);
    expect(res.body.tdee).toBe(2460);
    expect(res.body.floor).toBe(1599);
    expect(res.body.current).toBeNull();
    expect(res.body.plans.find((p: any) => p.id === "steady").targets).toEqual(STEADY);
    expect(res.body.plans.every((p: any) => typeof p.bestFor === "string" && p.bestFor.length > 0)).toBe(true);
    expect(res.body.plans.map((p: any) => [p.id, p.calories, p.recommended, p.notRecommended])).toEqual([
      ["maintenance", 2460, false, false],
      ["relaxed", 2210, false, false],
      ["steady", 1960, true, false],
      ["accelerated", 1710, false, false],
      ["vigorous", 1460, false, true],
    ]);
    expect(Object.keys(res.body).sort()).toEqual(["current", "explanation", "floor", "plans", "tdee"]);
    // AI isn't set up: the fixed explanation
    expect(res.body.explanation).toBe(planExplanation(buildPlans(put.body.body, "2026-11-17"), put.body.body));
    expect(res.body.explanation).toContain("Steady keeps you at 1,960 calories, above your 1,599 floor");
    expect(t.ai.calls).toHaveLength(0);
  });

  it("explains the plans with AI when it's ready, and falls back when it fails", async () => {
    t.clock.date = DAY1;
    await t.api("PUT", "/api/body", A);
    const ai = await t.api("PUT", "/api/settings/ai", { enabled: true, mode: "manual", maxPerRun: 50, timeoutSec: 3, services: [{ name: "Cloud", provider: "openrouter", apiKey: "or-key", model: "small" }] });
    expect(ai.status).toBe(200);
    t.ai.respond = () => ({ status: 200, json: { choices: [{ message: { content: '{"explanation": "Steady fits you best. Eat plenty of protein."}' } }] } });
    const res = await t.api("GET", "/api/plans");
    expect(res.body.explanation).toBe("Steady fits you best. Eat plenty of protein.");
    expect(t.ai.calls).toHaveLength(1);
    expect(JSON.stringify(t.ai.calls[0].body)).toContain("1,960");
    expect(t.ai.calls[0].body).toMatchObject({ max_tokens: 1000, reasoning: { effort: "low" } }); // room for models that think first

    t.ai.down = true;
    const fallback = await t.api("GET", "/api/plans");
    expect(fallback.status).toBe(200);
    expect(fallback.body.explanation).toContain("Steady keeps you at 1,960 calories");
  });

  it("no body yet is 409", async () => {
    const res = await t.api("GET", "/api/plans");
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Tell ByteSize about yourself first" });
    expect((await t.api("POST", "/api/plans/select", { plan: "steady" })).status).toBe(409);
  });

  it("rejects nonsense bodies", async () => {
    t.clock.date = DAY1; // Nov 17 in Boise, already Nov 18 in UTC
    for (const bad of [
      { heightCm: 20 }, { weightKg: 1000 }, { goalWeightKg: 10 }, { activity: "couch" }, { activity: "moderate" }, { sex: "other" },
      { birthDate: "1990-02-30" }, { birthDate: "2001-02-29" }, { birthDate: "1990-1-5" }, { birthDate: "yesterday" }, { birthDate: undefined },
      { birthYear: 1986, birthDate: undefined },
      { birthDate: "2013-11-18" }, // 12 in Boise today (13 in UTC)
      { birthDate: "1915-11-17" }, // 111
      { birthDate: "2030-01-01" }, // not born yet
    ]) {
      const res = await t.api("PUT", "/api/body", { ...A, ...bad });
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    expect((await t.api("PUT", "/api/body", { ...A, birthDate: "2013-11-17" })).status).toBe(200); // 13 today is fine
    expect((await t.api("GET", "/api/body")).body.body.birthDate).toBe("2013-11-17");
    expect((await t.api("PUT", "/api/body", { ...A, birthDate: "1916-11-16" })).status).toBe(200); // 110
    expect((await t.api("PUT", "/api/body", { ...A, birthDate: "2000-02-29" })).status).toBe(200); // a real leap day
  });

  it("age for the plans comes from the person's own day", async () => {
    t.clock.date = DAY1; // Boise: Nov 17, so someone born Nov 18 1986 is still 39 (UTC would say 40)
    await t.api("PUT", "/api/body", { ...A, birthDate: "1986-11-18" });
    expect((await t.api("GET", "/api/plans")).body.tdee).toBe(2466);
    at("2026-11-18T18:00:00Z");
    expect((await t.api("GET", "/api/plans")).body.tdee).toBe(2460);
  });

  it("asks once to check details: plans are 409 while needsReview, saving clears it", async () => {
    t.clock.date = DAY1;
    await t.api("PUT", "/api/body", A);
    await t.db.update(userBody).set({ needsReview: true });
    expect((await t.api("GET", "/api/body")).body.body.needsReview).toBe(true);
    const blocked = await t.api("GET", "/api/plans");
    expect(blocked.status).toBe(409);
    expect(blocked.body).toEqual({ error: "Check your details first" });
    expect((await t.api("POST", "/api/plans/select", { plan: "steady" })).status).toBe(409);
    const put = await t.api("PUT", "/api/body", A);
    expect(put.body.body.needsReview).toBe(false);
    expect((await t.api("GET", "/api/body")).body.body.needsReview).toBe(false);
    expect((await t.api("GET", "/api/plans")).status).toBe(200);
    expect((await t.api("GET", "/api/plans")).status).toBe(200); // no loop: stays answered
  });
});

describe("targets", () => {
  it("selecting a plan sets today's targets", async () => {
    t.clock.date = DAY1;
    await t.api("PUT", "/api/body", A);
    const res = await t.api("POST", "/api/plans/select", { plan: "steady" });
    expect(res.status).toBe(200);
    const today = localDay("America/Boise", t.app.now());
    expect(today).toBe("2026-11-17");
    expect(res.body).toEqual({ targets: { ...STEADY, plan: "steady", effectiveFrom: today } });
    expect((await t.api("GET", "/api/targets")).body).toEqual(res.body);
    expect((await t.api("GET", "/api/plans")).body.current).toBe("steady");
    expect((await t.api("POST", "/api/plans/select", { plan: "fastest" })).status).toBe(400);
  });

  it("selecting any plan sets exactly the targets on its card, even a not-recommended one", async () => {
    t.clock.date = DAY1;
    await t.api("PUT", "/api/body", A);
    const cards = (await t.api("GET", "/api/plans")).body.plans;
    for (const card of cards) {
      const res = await t.api("POST", "/api/plans/select", { plan: card.id });
      expect(res.status).toBe(200);
      expect(res.body.targets).toEqual({ ...card.targets, plan: card.id, effectiveFrom: "2026-11-17" });
    }
    const vigorous = cards.find((c: any) => c.id === "vigorous");
    expect(vigorous.notRecommended).toBe(true);
    expect(vigorous.targets.calories).toEqual({ min: 1410, max: 1510 }); // under the 1,599 floor, shown honestly
  });

  it("manual targets replace plan targets from today on, older days keep theirs", async () => {
    at("2026-11-17T18:00:00Z");
    expect((await t.api("GET", "/api/targets?day=2026-11-17")).body).toEqual({ targets: null });
    await t.api("PUT", "/api/body", A);
    await t.api("POST", "/api/plans/select", { plan: "steady" });

    at("2026-11-19T18:00:00Z");
    const manual = { calories: { min: 1500, max: 2000 }, protein_g: { min: 130, max: 170 }, fiber_g: { min: 30, max: 40 }, water_ml: { min: 2000, max: 3000 } };
    const put = await t.api("PUT", "/api/targets", manual);
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ targets: { ...manual, plan: null, effectiveFrom: "2026-11-19" } });

    expect((await t.api("GET", "/api/targets?day=2026-11-18")).body).toEqual({ targets: { ...STEADY, plan: "steady", effectiveFrom: "2026-11-17" } });
    expect((await t.api("GET", "/api/targets?day=2026-11-19")).body).toEqual(put.body);
    expect((await t.api("GET", "/api/targets?day=2026-12-25")).body).toEqual(put.body);
    expect((await t.api("GET", "/api/targets?day=2026-11-16")).body).toEqual({ targets: null });
    expect((await t.api("GET", "/api/plans")).body.current).toBeNull();

    expect((await t.api("GET", "/api/targets?day=yesterday")).status).toBe(400);
    expect((await t.api("PUT", "/api/targets", { ...manual, calories: { min: 2000, max: 1500 } })).status).toBe(400);
    expect((await t.api("PUT", "/api/targets", { ...manual, water_ml: undefined })).status).toBe(400);
  });
});

describe("personal settings", () => {
  it("settings me has meal windows and water buttons, and saves changes", async () => {
    const defaults = { mealWindows: { breakfast: "10:30", lunch: "14:30", snacks: "17:00", dinner: "21:00" }, waterButtonsMl: [237, 473], weekStart: 0 };
    expect((await t.api("GET", "/api/settings/me")).body).toEqual(defaults);

    const changed = { mealWindows: { breakfast: "09:00", lunch: "13:00", snacks: "16:30", dinner: "20:00" }, waterButtonsMl: [250, 500, 750], weekStart: 0 };
    const put = await t.api("PUT", "/api/settings/me", changed);
    expect(put.status).toBe(200);
    expect(put.body).toEqual(changed);
    expect((await t.api("GET", "/api/settings/me")).body).toEqual(changed);

    for (const bad of [
      { ...changed, mealWindows: { ...changed.mealWindows, dinner: "25:00" } },
      { ...changed, mealWindows: { ...changed.mealWindows, breakfast: "9:00" } },
      { ...changed, mealWindows: { ...changed.mealWindows, lunch: "08:00" } }, // before breakfast
      { ...changed, waterButtonsMl: [] },
      { ...changed, waterButtonsMl: [-5] },
    ]) {
      expect((await t.api("PUT", "/api/settings/me", bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await t.api("GET", "/api/settings/me")).body).toEqual(changed);
  });

  it("stores body measurements exactly (no float4 rounding)", async () => {
    const res = await t.api("PUT", "/api/body", A);
    expect(res.body.body).toMatchObject({ heightCm: A.heightCm, weightKg: A.weightKg, goalWeightKg: A.goalWeightKg });
    expect((await t.api("GET", "/api/body")).body.body).toMatchObject({ weightKg: A.weightKg, goalWeightKg: A.goalWeightKg });
  });

  it("Maintenance can be selected and sets its own targets", async () => {
    expect((await t.api("PUT", "/api/body", A)).status).toBe(200);
    const res = await t.api("POST", "/api/plans/select", { plan: "maintenance" });
    expect(res.status).toBe(200);
    expect(res.body.targets.plan).toBe("maintenance");
    const tdee = (await t.api("GET", "/api/plans")).body.tdee;
    expect(res.body.targets.calories).toEqual({ min: tdee - 100, max: tdee + 100 });
  });
});
