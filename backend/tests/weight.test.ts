import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestApp, type TestApp } from "./helpers.js";
import { projectionOf, trendOf, type EstimateOptions } from "../src/lib/weight.js";
const T28: EstimateOptions = { basis: "trend", days: 28 }; // the old Goals-tab projection
import { addDays } from "../src/lib/days.js";
import { userBody, weighInSkips } from "../src/db/schema.js";

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
    expect(projectionOf([], 80, today, T28)).toEqual({ status: "not_enough" });
    expect(projectionOf([{ day: today, trendKg: 100 }], 80, today, T28)).toEqual({ status: "not_enough" });
  });

  it("needs them at least 7 days apart within the last 28 days", () => {
    const close = [
      { day: addDays(today, -6), trendKg: 101 },
      { day: today, trendKg: 100 },
    ];
    expect(projectionOf(close, 80, today, T28)).toEqual({ status: "not_enough" });
    // 7 days apart is enough
    expect(projectionOf([{ day: addDays(today, -7), trendKg: 101 }, close[1]], 80, today, T28).status).toBe("ok");
    // ...but not when the older one is outside the 28-day window
    const old = [
      { day: addDays(today, -40), trendKg: 105 },
      { day: addDays(today, -30), trendKg: 103 },
      { day: addDays(today, -2), trendKg: 100 },
    ];
    expect(projectionOf(old, 80, today, T28)).toEqual({ status: "not_enough" });
  });

  it("projects the goal date for a steady 0.5 kg/week loss", () => {
    // 95 → 90 at 0.5 kg/week is 10 weeks
    const p = projectionOf(steady(95), 90, today, T28);
    expect(p.status).toBe("ok");
    expect(p.kgPerWeek).toBeCloseTo(0.5, 9);
    expect(p.date).toBe(addDays(today, 70));
  });

  it("projects from today even when the last weigh-in was days ago, and never into the past", () => {
    const pts = steady(90.01).slice(0, -3); // last weigh-in 3 days ago, a hair above goal
    const p = projectionOf(pts, 90, today, T28);
    expect(p.status).toBe("ok");
    expect(p.date! > today).toBe(true);
  });

  it("projects from where the trend is today when the last weigh-in was 10 days ago", () => {
    // The line reaches 95 today; the last weigh-in (10 days ago) had it at 95 + 10 × 0.5/7
    const pts = steady(95).slice(0, -10);
    expect(pts[pts.length - 1].day).toBe(addDays(today, -10));
    const p = projectionOf(pts, 90, today, T28);
    expect(p).toEqual({ status: "ok", date: addDays(today, 70), kgPerWeek: expect.closeTo(0.5, 9) });
    // Already past the goal by today's estimate: tomorrow, still ok
    expect(projectionOf(steady(89.7).slice(0, -10), 90, today, T28)).toEqual({ status: "ok", date: addDays(today, 1), kgPerWeek: expect.closeTo(0.5, 9) });
  });

  it("a plateau after a loss is not_losing, not a goal date thousands of years away", () => {
    const start = "2026-04-01";
    const series = [{ day: start, weightKg: 100 }, ...Array.from({ length: 200 }, (_, i) => ({ day: addDays(start, i + 1), weightKg: 90 }))];
    const last = series[series.length - 1].day;
    const p = projectionOf(trendOf(series), 80, last, T28);
    expect(p.status).toBe("not_losing");
    expect(p.date).toBeUndefined();
  });

  it("a goal more than 3 years away is not_losing", () => {
    // 0.5 kg/week: 1095 days is 78.2 kg away
    expect(projectionOf(steady(95), 95 - (1095 * 0.5) / 7 + 0.01, today, T28).status).toBe("ok");
    expect(projectionOf(steady(95), 95 - (1096 * 0.5) / 7, today, T28)).toEqual({ status: "not_losing", kgPerWeek: expect.closeTo(0.5, 9) });
  });

  it("is not_losing for a gain or a flat trend", () => {
    const gain = steady(95).map((p, i, all) => ({ ...p, trendKg: all[all.length - 1 - i].trendKg }));
    const g = projectionOf(gain, 90, today, T28);
    expect(g.status).toBe("not_losing");
    expect(g.kgPerWeek).toBeCloseTo(-0.5, 9);
    expect(g.date).toBeUndefined();
    const flat = steady(95).map((p) => ({ ...p, trendKg: 95 }));
    expect(projectionOf(flat, 90, today, T28).status).toBe("not_losing");
  });

  it("is reached at or below a goal under the starting weight, even without 7 days of weigh-ins", () => {
    expect(projectionOf(steady(90), 90, today, T28)).toEqual({ status: "reached" });
    expect(projectionOf([{ day: addDays(today, -1), trendKg: 95 }, { day: today, trendKg: 85 }], 90, today, T28)).toEqual({ status: "reached" });
  });

  it("a goal at or above the starting weight is never reached: nothing to lose toward is not_losing", () => {
    expect(projectionOf([{ day: today, trendKg: 85 }], 90, today, T28)).toEqual({ status: "not_losing" });
    expect(projectionOf([{ day: today, trendKg: 90 }], 90, today, T28)).toEqual({ status: "not_losing" });
    expect(projectionOf(steady(90).map((p) => ({ ...p, trendKg: 90 })), 92, today, T28)).toEqual({ status: "not_losing" });
  });

  it("gives the rate but no date without a goal", () => {
    const p = projectionOf(steady(95), null, today, T28);
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

// Alex is in America/Denver (UTC−7): 05:30 UTC on Nov 18 is still Nov 17 there
const NOW = new Date("2026-11-18T05:30:00Z");
const TODAY = "2026-11-17";
const BODY = { sex: "male", birthDate: "1986-01-01", heightCm: 177.8, weightKg: 100, goalWeightKg: 80, activity: "sitting", glp1: false } as const;
const weigh = (day: string, weightKg: number, note?: string) => t.api("PUT", `/api/weigh-ins/${day}`, note === undefined ? { weightKg } : { weightKg, note });
const bodyWeight = async () => (await t.db.select({ w: userBody.weightKg }).from(userBody).where(eq(userBody.userId, 1)))[0]?.w;

const fromHealth = (day: string, weightKg: number) => t.api("PUT", `/api/weigh-ins/${day}`, { weightKg, source: "health" });
const weightOn = async (day: string) => (await t.api("GET", "/api/weight")).body.weighIns.find((w: { day: string }) => w.day === day)?.weightKg;

// I5: weigh-ins from Apple Health fill only empty days, and never a day whose weigh-in was deleted
describe("weigh-ins from Health", () => {
  beforeEach(() => {
    t.clock.date = NOW;
  });

  it("saves a Health weigh-in on an empty day", async () => {
    const r = await fromHealth("2026-11-16", 82.4);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ weighIn: { day: "2026-11-16", weightKg: 82.4, note: null }, skipped: false });
    expect(await weightOn("2026-11-16")).toBe(82.4);
  });

  it("skips a Health weigh-in when the day has one", async () => {
    await weigh("2026-11-16", 80);
    const r = await fromHealth("2026-11-16", 79);
    expect(r.status).toBe(200);
    expect(r.body.skipped).toBe(true);
    expect(r.body.weighIn.weightKg).toBe(80);
    expect(await weightOn("2026-11-16")).toBe(80);
    // nor another Health one
    await fromHealth("2026-11-15", 81);
    expect((await fromHealth("2026-11-15", 82)).body.skipped).toBe(true);
    expect(await weightOn("2026-11-15")).toBe(81);
  });

  it("skips a Health weigh-in on a deleted day", async () => {
    await weigh("2026-11-16", 80);
    await t.api("DELETE", "/api/weigh-ins/2026-11-16");
    const r = await fromHealth("2026-11-16", 79);
    expect(r.body).toEqual({ weighIn: null, skipped: true });
    expect(await weightOn("2026-11-16")).toBeUndefined();
  });

  it("a typed weigh-in clears the deleted mark", async () => {
    await weigh("2026-11-16", 80);
    await t.api("DELETE", "/api/weigh-ins/2026-11-16");
    expect((await weigh("2026-11-16", 78)).body.skipped).toBe(false);
    expect(await t.db.select().from(weighInSkips)).toEqual([]);
    await t.api("DELETE", "/api/weigh-ins/2026-11-16"); // marked again
    expect((await fromHealth("2026-11-16", 77)).body.skipped).toBe(true);
  });

  it("a typed weigh-in replaces a Health one", async () => {
    await fromHealth("2026-11-16", 79);
    await weigh("2026-11-16", 78);
    expect(await weightOn("2026-11-16")).toBe(78);
  });

  it("Health weigh-ins in the future are refused", async () => {
    const r = await fromHealth("2026-11-18", 79);
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ error: "Choose today or an earlier day" });
  });

  it("one person's deleted day doesn't block another's", async () => {
    await weigh("2026-11-16", 80);
    await t.api("DELETE", "/api/weigh-ins/2026-11-16");
    const other = await t.createUser("sam");
    t.setToken(other.token);
    expect((await fromHealth("2026-11-16", 70)).body.skipped).toBe(false);
  });

  it("checks the source", async () => {
    expect((await t.api("PUT", "/api/weigh-ins/2026-11-16", { weightKg: 80, source: "scale" })).status).toBe(400);
  });
});

describe("weigh-ins", () => {
  beforeEach(() => {
    t.clock.date = NOW;
  });

  it("saves a weigh-in and a second one that day replaces it", async () => {
    const first = await weigh(TODAY, 99.5, "after coffee");
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ weighIn: { day: TODAY, weightKg: 99.5, note: "after coffee" }, skipped: false });
    const second = await weigh(TODAY, 99.1);
    expect(second.body).toEqual({ weighIn: { day: TODAY, weightKg: 99.1, note: null }, skipped: false });
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
    for (const w of [29.9, 350.1, "90"]) expect((await t.api("PUT", `/api/weigh-ins/${TODAY}`, { weightKg: w })).status).toBe(400);
    expect((await weigh(TODAY, 29.9)).body.details[0].message).toBe("Enter a weight between 30 and 350 kg");
    expect((await weigh(TODAY, 30)).status).toBe(200);
    expect((await weigh(TODAY, 350)).status).toBe(200);
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
    await t.api("DELETE", `/api/weigh-ins/${TODAY}`); // the body's own weigh-in; removing it leaves the body at 100
    expect(await bodyWeight()).toBe(100);
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

  it("saving the body with a new weight weighs in today (local day); the same weight adds nothing", async () => {
    await weigh("2026-11-01", 101);
    await t.api("PUT", "/api/body", BODY); // first save: 100 kg
    const list = async () => (await t.api("GET", "/api/weight")).body.weighIns.map((w: any) => [w.day, w.weightKg, w.note]);
    expect(await list()).toEqual([["2026-11-01", 101, null], [TODAY, 100, null]]);
    await weigh(TODAY, 99, "morning");
    await t.api("PUT", "/api/body", { ...BODY, weightKg: 99, goalWeightKg: 75 }); // weight unchanged
    expect(await list()).toEqual([["2026-11-01", 101, null], [TODAY, 99, "morning"]]);
    await t.api("PUT", "/api/body", { ...BODY, weightKg: 98.5 }); // changed: replaces today's weight, keeps the note
    expect(await list()).toEqual([["2026-11-01", 101, null], [TODAY, 98.5, "morning"]]);
    expect(await bodyWeight()).toBe(98.5);
  });

  it("saving the body with a weight within 0.05 kg of the stored one (a units round trip) adds no weigh-in", async () => {
    await t.api("PUT", "/api/body", BODY); // 100 kg, weighs in today
    await t.api("DELETE", `/api/weigh-ins/${TODAY}`);
    await weigh("2026-11-10", 100); // the latest: the body stays 100 kg
    const days = async () => (await t.api("GET", "/api/weight")).body.weighIns.map((w: any) => w.day);
    await t.api("PUT", "/api/body", { ...BODY, weightKg: 100.04 }); // e.g. 220.5 lb → 100.0175 kg
    expect(await days()).toEqual(["2026-11-10"]);
    await t.api("PUT", "/api/body", { ...BODY, weightKg: 100.1 }); // a real change
    expect(await days()).toEqual(["2026-11-10", TODAY]);
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
      goalDate: { status: "no_goal" },
      replanHint: false,
    });
  });

  it("gives the goal date (§40a) by default from the last 12 weeks' weigh-ins, whatever window is asked for", async () => {
    await t.api("PUT", "/api/body", BODY); // goal 80 kg
    for (let i = 0; i < 21; i++) await weigh(addDays(TODAY, -2 * (20 - i)), 100 - 0.2 * i); // every other day for 6 weeks
    const w = (await t.api("GET", `/api/weight?from=${TODAY}&to=${TODAY}`)).body;
    expect(w.goalDate).toMatchObject({ status: "ok", kgPerWeek: expect.any(Number), toGoKg: expect.any(Number), weeks: { min: expect.any(Number), max: expect.any(Number) } });
    expect(w.goalDate.kgPerWeek).toBeGreaterThan(0);
    expect(w.goalDate.toGoKg).toBeCloseTo(w.latest.weightKg - 80, 9); // scale: from the latest weigh-in
    expect(w.goalDate.earliest <= w.goalDate.date && w.goalDate.date <= w.goalDate.latest).toBe(true);
    expect(w.goalDate.earliest > TODAY).toBe(true);
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

  it("a single weigh-in is not enough; a gain is not losing; at a goal at or above the start is not_losing, not reached", async () => {
    await t.api("PUT", "/api/body", BODY);
    await t.api("DELETE", `/api/weigh-ins/${TODAY}`); // the body's own weigh-in
    await weigh("2026-11-01", 90);
    expect((await t.api("GET", "/api/weight")).body.projection).toEqual({ status: "not_enough" });
    await weigh("2026-11-10", 92);
    await weigh(TODAY, 94);
    const gain = (await t.api("GET", "/api/weight")).body;
    expect(gain.projection.status).toBe("not_losing");
    expect(gain.projection.date).toBeUndefined();
    expect(gain.lostKg).toBeLessThan(0);
    await t.api("PUT", "/api/body", { ...BODY, weightKg: 94, goalWeightKg: 95 }); // started at 90: nothing to lose
    expect((await t.api("GET", "/api/weight")).body.projection).toEqual({ status: "not_losing" });
    await t.api("PUT", "/api/body", { ...BODY, weightKg: 94, goalWeightKg: 85 });
    await weigh("2026-10-20", 99); // now the start is 99 kg, and the trend is under an 95.5 kg goal
    await t.api("PUT", "/api/body", { ...BODY, weightKg: 94, goalWeightKg: 95.5 });
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

  it("an account that chose its plan before targets_weight_kg existed measures from its first weigh-in", async () => {
    await t.api("PUT", "/api/body", BODY); // weighs in 100 kg today... move that to an earlier day
    await t.api("DELETE", `/api/weigh-ins/${TODAY}`);
    await weigh("2026-10-01", 100); // the migration's starting weigh-in
    await t.api("POST", "/api/plans/select", { plan: "steady" });
    await t.db.update(userBody).set({ targetsWeightKg: null }).where(eq(userBody.userId, 1));
    await weigh("2026-11-10", 95.47);
    expect((await t.api("GET", "/api/weight")).body.replanHint).toBe(false);
    await weigh(TODAY, 95.46);
    expect((await t.api("GET", "/api/weight")).body.replanHint).toBe(true);
  });

  it("no plan chosen: no hint, however far the weight moves", async () => {
    await weigh("2026-10-01", 100);
    await weigh(TODAY, 90);
    expect((await t.api("GET", "/api/weight")).body.replanHint).toBe(false);
  });
});
