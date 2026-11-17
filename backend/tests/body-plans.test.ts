import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";
import { buildPlans, planExplanation } from "../src/lib/plans.js";
import { localDay } from "../src/lib/days.js";

let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
beforeEach(async () => {
  await t.reset();
  await t.login();
});
afterAll(async () => t.close());

// Body A from the plan tests (240 lb → 180 lb, 5'10", sedentary man on a GLP-1)
const A = { sex: "male", birthYear: 1986, heightCm: 177.8, weightKg: 113.3980925, goalWeightKg: 81.6466266, activity: "sedentary", glp1: true } as const;
const STEADY = { calories: { min: 1810, max: 2110 }, protein_g: { min: 126, max: 180 }, fiber_g: { min: 25, max: 38 }, water_ml: { min: 1893, max: 3785 } };

// 05:30 UTC on Nov 18 is still Nov 17 in Denver (UTC−7)
const DAY1 = new Date("2026-11-18T05:30:00Z");
const at = (iso: string) => (t.clock.date = new Date(iso));

describe("localDay", () => {
  it("gives the date in the given time zone", () => {
    expect(localDay("America/Denver", DAY1)).toBe("2026-11-17");
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
    expect(put.body).toEqual({ body: close(A) });
    expect((await t.api("GET", "/api/body")).body).toEqual(put.body);

    const res = await t.api("GET", "/api/plans");
    expect(res.status).toBe(200);
    expect(res.body.tdee).toBe(2460);
    expect(res.body.floor).toBe(1599);
    expect(res.body.current).toBeNull();
    expect(res.body.plans.map((p: any) => [p.id, p.calories, p.recommended, p.notRecommended])).toEqual([
      ["relaxed", 2210, false, false],
      ["steady", 1960, true, false],
      ["accelerated", 1710, false, false],
      ["vigorous", 1460, false, true],
    ]);
    expect(Object.keys(res.body).sort()).toEqual(["current", "explanation", "floor", "plans", "tdee"]);
    // AI isn't set up: the fixed explanation
    expect(res.body.explanation).toBe(planExplanation(buildPlans(put.body.body, DAY1), put.body.body));
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
    t.clock.date = DAY1;
    for (const bad of [{ heightCm: 20 }, { weightKg: 1000 }, { goalWeightKg: 10 }, { birthYear: 1800 }, { birthYear: 2020 }, { activity: "couch" }, { sex: "other" }]) {
      const res = await t.api("PUT", "/api/body", { ...A, ...bad });
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    expect((await t.api("PUT", "/api/body", { ...A, birthYear: 2013 })).status).toBe(200); // 13 this year is fine
    expect((await t.api("GET", "/api/body")).body.body.birthYear).toBe(2013);
  });
});

describe("targets", () => {
  it("selecting a plan sets today's targets", async () => {
    t.clock.date = DAY1;
    await t.api("PUT", "/api/body", A);
    const res = await t.api("POST", "/api/plans/select", { plan: "steady" });
    expect(res.status).toBe(200);
    const today = localDay("America/Denver", t.app.now());
    expect(today).toBe("2026-11-17");
    expect(res.body).toEqual({ targets: { ...STEADY, plan: "steady", effectiveFrom: today } });
    expect((await t.api("GET", "/api/targets")).body).toEqual(res.body);
    expect((await t.api("GET", "/api/plans")).body.current).toBe("steady");
    expect((await t.api("POST", "/api/plans/select", { plan: "fastest" })).status).toBe(400);
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
    const defaults = { mealWindows: { breakfast: "10:30", lunch: "14:30", snacks: "17:00", dinner: "21:00" }, waterButtonsMl: [237, 473] };
    expect((await t.api("GET", "/api/settings/me")).body).toEqual(defaults);

    const changed = { mealWindows: { breakfast: "09:00", lunch: "13:00", snacks: "16:30", dinner: "20:00" }, waterButtonsMl: [250, 500, 750] };
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
});
