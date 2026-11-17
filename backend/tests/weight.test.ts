import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestApp, type TestApp } from "./helpers.js";
import { projectionOf, trendOf } from "../src/lib/weight.js";
import { addDays } from "../src/lib/days.js";
import { userBody } from "../src/db/schema.js";

// Trend: trend₀ = w₀; trend += (w − trend) × (1 − 0.9^gapDays). Projection over the last 28 days.
describe("trendOf", () => {
  it("smooths a known series, weighting a 14-day gap by 1 − 0.9^14", () => {
    const out = trendOf([
      { day: "2026-11-01", weightKg: 100 },
      { day: "2026-11-02", weightKg: 99 },
      { day: "2026-11-16", weightKg: 95 }, // missed a fortnight
      { day: "2026-11-19", weightKg: 96 },
    ]);
    expect(out.map((p) => p.day)).toEqual(["2026-11-01", "2026-11-02", "2026-11-16", "2026-11-19"]);
    expect(out[0].trendKg).toBe(100);
    expect(out[1].trendKg).toBeCloseTo(99.9, 9);
    expect(out[2].trendKg).toBeCloseTo(96.1209628302931, 9);
    expect(out[3].trendKg).toBeCloseTo(96.08818190328367, 9);
  });

  it("orders by day, so a backdated weigh-in lands in its place", () => {
    const out = trendOf([
      { day: "2026-11-05", weightKg: 98 },
      { day: "2026-11-01", weightKg: 100 },
    ]);
    expect(out.map((p) => p.day)).toEqual(["2026-11-01", "2026-11-05"]);
    expect(out[1].trendKg).toBeCloseTo(100 + (98 - 100) * (1 - 0.9 ** 4), 9);
  });

  it("is empty for no weigh-ins", () => {
    expect(trendOf([])).toEqual([]);
  });
});

describe("projectionOf", () => {
  const today = "2026-11-17";
  // A trend line losing exactly 0.5 kg a week, ending today at `end` kg
  const steady = (end: number, days = 21) =>
    Array.from({ length: days + 1 }, (_, i) => ({ day: addDays(today, i - days), trendKg: end + ((days - i) * 0.5) / 7 }));

  it("needs at least two weigh-ins", () => {
    expect(projectionOf([], 80, today)).toEqual({ status: "not_enough" });
    expect(projectionOf([{ day: today, trendKg: 100 }], 80, today)).toEqual({ status: "not_enough" });
  });

  it("needs them at least 7 days apart within the last 28 days", () => {
    const close = [
      { day: addDays(today, -6), trendKg: 101 },
      { day: today, trendKg: 100 },
    ];
    expect(projectionOf(close, 80, today)).toEqual({ status: "not_enough" });
    // 7 days apart is enough
    expect(projectionOf([{ day: addDays(today, -7), trendKg: 101 }, close[1]], 80, today).status).toBe("ok");
    // ...but not when the older one is outside the 28-day window
    const old = [
      { day: addDays(today, -40), trendKg: 105 },
      { day: addDays(today, -30), trendKg: 103 },
      { day: addDays(today, -2), trendKg: 100 },
    ];
    expect(projectionOf(old, 80, today)).toEqual({ status: "not_enough" });
  });

  it("projects the goal date for a steady 0.5 kg/week loss", () => {
    // 95 → 90 at 0.5 kg/week is 10 weeks
    const p = projectionOf(steady(95), 90, today);
    expect(p.status).toBe("ok");
    expect(p.kgPerWeek).toBeCloseTo(0.5, 9);
    expect(p.date).toBe(addDays(today, 70));
  });

  it("projects from today even when the last weigh-in was days ago, and never into the past", () => {
    const pts = steady(90.01).slice(0, -3); // last weigh-in 3 days ago, a hair above goal
    const p = projectionOf(pts, 90, today);
    expect(p.status).toBe("ok");
    expect(p.date! > today).toBe(true);
  });

  it("is not_losing for a gain or a flat trend", () => {
    const gain = steady(95).map((p, i, all) => ({ ...p, trendKg: all[all.length - 1 - i].trendKg }));
    const g = projectionOf(gain, 90, today);
    expect(g.status).toBe("not_losing");
    expect(g.kgPerWeek).toBeCloseTo(-0.5, 9);
    expect(g.date).toBeUndefined();
    const flat = steady(95).map((p) => ({ ...p, trendKg: 95 }));
    expect(projectionOf(flat, 90, today).status).toBe("not_losing");
  });

  it("is reached at or below the goal, even with one weigh-in", () => {
    expect(projectionOf(steady(90), 90, today)).toEqual({ status: "reached" });
    expect(projectionOf([{ day: today, trendKg: 85 }], 90, today)).toEqual({ status: "reached" });
  });

  it("gives the rate but no date without a goal", () => {
    const p = projectionOf(steady(95), null, today);
    expect(p.status).toBe("ok");
    expect(p.date).toBeUndefined();
    expect(p.kgPerWeek).toBeCloseTo(0.5, 9);
  });
});

let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
beforeEach(async () => {
  await t.reset();
  await t.login();
});
afterAll(async () => t.close());

// Cory is in America/Boise (UTC−7): 05:30 UTC on Nov 18 is still Nov 17 there
const NOW = new Date("2026-11-18T05:30:00Z");
const TODAY = "2026-11-17";
const BODY = { sex: "male", birthDate: "1986-01-01", heightCm: 177.8, weightKg: 100, goalWeightKg: 80, activity: "sitting", glp1: false } as const;
const weigh = (day: string, weightKg: number, note?: string) => t.api("PUT", `/api/weigh-ins/${day}`, note === undefined ? { weightKg } : { weightKg, note });
const bodyWeight = async () => (await t.db.select({ w: userBody.weightKg }).from(userBody).where(eq(userBody.userId, 1)))[0]?.w;

describe("weigh-ins", () => {
  beforeEach(() => {
    t.clock.date = NOW;
  });

  it("saves a weigh-in and a second one that day replaces it", async () => {
    const first = await weigh(TODAY, 99.5, "after coffee");
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ weighIn: { day: TODAY, weightKg: 99.5, note: "after coffee" } });
    const second = await weigh(TODAY, 99.1);
    expect(second.body).toEqual({ weighIn: { day: TODAY, weightKg: 99.1, note: null } });
    const got = (await t.api("GET", "/api/weight")).body;
    expect(got.weighIns).toEqual([{ day: TODAY, weightKg: 99.1, trendKg: 99.1, note: null }]);
  });

  it("takes the person's local day: tomorrow (even if it is already tomorrow in UTC) is refused", async () => {
    expect((await weigh("2026-11-18", 99)).body).toEqual({ error: "Choose today or an earlier day" });
    expect((await weigh("2026-11-18", 99)).status).toBe(400);
    expect((await weigh(TODAY, 99)).status).toBe(200);
    expect((await weigh("2026-10-01", 101)).status).toBe(200);
  });

  it("checks the weight and the day", async () => {
    for (const w of [19.9, 500.1, "90"]) expect((await t.api("PUT", `/api/weigh-ins/${TODAY}`, { weightKg: w })).status).toBe(400);
    expect((await weigh(TODAY, 20)).status).toBe(200);
    expect((await weigh(TODAY, 500)).status).toBe(200);
    expect((await weigh("2026-02-30", 90)).status).toBe(400);
    expect((await t.api("PUT", `/api/weigh-ins/${TODAY}`, {})).status).toBe(400);
  });

  it("deletes a weigh-in; deleting one that isn't there is a 404", async () => {
    await weigh(TODAY, 99);
    expect((await t.api("DELETE", `/api/weigh-ins/${TODAY}`)).status).toBe(204);
    expect((await t.api("DELETE", `/api/weigh-ins/${TODAY}`)).status).toBe(404);
    expect((await t.api("GET", "/api/weight")).body.weighIns).toEqual([]);
  });

  it("the latest weigh-in becomes the body weight; a backdated one doesn't", async () => {
    await t.api("PUT", "/api/body", BODY);
    await weigh("2026-11-10", 98);
    expect(await bodyWeight()).toBe(98);
    await weigh("2026-11-03", 99); // backdated
    expect(await bodyWeight()).toBe(98);
    await weigh(TODAY, 97);
    expect(await bodyWeight()).toBe(97);
    await weigh(TODAY, 96.5); // replacing today's is still the latest
    expect(await bodyWeight()).toBe(96.5);
    // Removing the latest falls back to the one before; removing an older one changes nothing
    await t.api("DELETE", "/api/weigh-ins/2026-11-03");
    expect(await bodyWeight()).toBe(96.5);
    await t.api("DELETE", `/api/weigh-ins/${TODAY}`);
    expect(await bodyWeight()).toBe(98);
  });

  it("a weigh-in without a body profile is still saved", async () => {
    expect((await weigh(TODAY, 99)).status).toBe(200);
    expect((await t.api("GET", "/api/body")).body).toEqual({ body: null });
  });
});

describe("GET /api/weight", () => {
  beforeEach(() => {
    t.clock.date = NOW;
  });

  it("is empty with no weigh-ins", async () => {
    expect((await t.api("GET", "/api/weight")).body).toEqual({
      weighIns: [],
      start: null,
      latest: null,
      trendKg: null,
      goalKg: null,
      lostKg: null,
      projection: { status: "not_enough" },
      replanHint: false,
    });
  });

  it("gives start, latest, trend, goal, lost so far and a projection; trend is over all weigh-ins, then windowed", async () => {
    await t.api("PUT", "/api/body", BODY);
    await weigh("2026-11-01", 100);
    await weigh("2026-11-02", 99);
    await weigh("2026-11-16", 95);
    await weigh(TODAY, 96, "salty dinner");
    const w = (await t.api("GET", "/api/weight?from=2026-11-10&to=2026-11-30")).body;
    const t16 = 99.9 + (95 - 99.9) * (1 - 0.9 ** 14);
    const t17 = t16 + (96 - t16) * (1 - 0.9);
    expect(w.weighIns).toEqual([
      { day: "2026-11-16", weightKg: 95, trendKg: expect.closeTo(t16, 9), note: null },
      { day: TODAY, weightKg: 96, trendKg: expect.closeTo(t17, 9), note: "salty dinner" },
    ]);
    expect(w.start).toEqual({ day: "2026-11-01", weightKg: 100 });
    expect(w.latest).toEqual({ day: TODAY, weightKg: 96 });
    expect(w.trendKg).toBeCloseTo(t17, 9);
    expect(w.goalKg).toBe(80);
    expect(w.lostKg).toBeCloseTo(100 - t17, 9);
    expect(w.projection.status).toBe("ok");
    expect(w.projection.date > TODAY).toBe(true);
    expect(w.projection.kgPerWeek).toBeGreaterThan(0);
    expect(w.replanHint).toBe(false); // no plan chosen yet
  });

  it("windows by from/to and checks them", async () => {
    await weigh("2026-11-01", 100);
    await weigh("2026-11-05", 99);
    await weigh("2026-11-09", 98);
    expect((await t.api("GET", "/api/weight?from=2026-11-02&to=2026-11-08")).body.weighIns.map((p: any) => p.day)).toEqual(["2026-11-05"]);
    expect((await t.api("GET", "/api/weight?to=2026-11-05")).body.weighIns.map((p: any) => p.day)).toEqual(["2026-11-01", "2026-11-05"]);
    expect((await t.api("GET", "/api/weight?from=2026-11-05")).body.weighIns.map((p: any) => p.day)).toEqual(["2026-11-05", "2026-11-09"]);
    expect((await t.api("GET", "/api/weight?from=nope")).status).toBe(400);
    expect((await t.api("GET", "/api/weight?from=2026-11-09&to=2026-11-01")).status).toBe(400);
  });

  it("a single weigh-in is not enough; a gain is not losing; at the goal is reached", async () => {
    await t.api("PUT", "/api/body", BODY);
    await weigh("2026-11-01", 90);
    expect((await t.api("GET", "/api/weight")).body.projection).toEqual({ status: "not_enough" });
    await weigh("2026-11-10", 92);
    await weigh(TODAY, 94);
    const gain = (await t.api("GET", "/api/weight")).body;
    expect(gain.projection.status).toBe("not_losing");
    expect(gain.projection.date).toBeUndefined();
    expect(gain.lostKg).toBeLessThan(0);
    await t.api("PUT", "/api/body", { ...BODY, weightKg: 94, goalWeightKg: 95 });
    expect((await t.api("GET", "/api/weight")).body.projection).toEqual({ status: "reached" });
  });

  it("suggests checking the plan once the latest weight is 4.54 kg or more from the plan's weight", async () => {
    await t.api("PUT", "/api/body", BODY); // 100 kg
    expect((await t.api("POST", "/api/plans/select", { plan: "steady" })).status).toBe(200);
    await weigh("2026-11-10", 95.47); // 4.53 kg off
    expect((await t.api("GET", "/api/weight")).body.replanHint).toBe(false);
    await weigh(TODAY, 95.46); // 4.54 kg off
    expect((await t.api("GET", "/api/weight")).body.replanHint).toBe(true);
    await weigh(TODAY, 104.54); // a gain counts too
    expect((await t.api("GET", "/api/weight")).body.replanHint).toBe(true);
    // Choosing a plan again records the new weight (the body follows the latest weigh-in)
    await t.api("POST", "/api/plans/select", { plan: "steady" });
    expect((await t.api("GET", "/api/weight")).body.replanHint).toBe(false);
  });
});
