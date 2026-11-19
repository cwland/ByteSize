import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestApp, type TestApp } from "./helpers.js";
import { badges, dashboardLayouts, goals, targets } from "../src/db/schema.js";

// §40c: goals with a start and end — progress from the person's own data, frozen once the end has passed.
let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
beforeEach(async () => {
  await t.reset();
  await t.login(); // admin "cory", America/Boise; weeks start on Sunday by default
  at(TODAY);
});
afterAll(async () => t.close());

const TODAY = "2026-11-18"; // a Wednesday (week Nov 15–21)
/** Noon in Boise on that day */
const at = (day: string) => (t.clock.date = new Date(`${day}T19:00:00Z`));
const create = (body: Record<string, unknown>) => t.api("POST", "/api/goals", body);
const list = async () => (await t.api("GET", "/api/goals")).body as { active: any[]; past: any[] };

let foodId = 0;
async function eat(day: string, nutrients: Record<string, number>) {
  const f = (await t.api("POST", "/api/my-foods", { name: `Food ${++foodId}`, servings: [{ label: "1", grams: 100 }], nutrients })).body.food;
  const res = await t.api("POST", "/api/log", { day, meal: "lunch", food: { kind: "user_food", id: f.id }, servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 });
  expect(res.status).toBe(200);
}
async function plan(day: string) {
  const before = t.clock.date;
  at(day);
  expect((await t.api("PUT", "/api/targets", { calories: { min: 1500, max: 2000 }, protein_g: { min: 100, max: 120 }, fiber_g: { min: 25, max: 30 }, water_ml: { min: 2000, max: 3000 } })).status).toBe(200);
  t.clock.date = before;
}

describe("making a goal", () => {
  it("starts today by default, named for its type, and shows its progress", async () => {
    await eat(TODAY, { calories: 500 });
    const r = await create({ type: "logging_days", target: 5, period: "week", end: "2026-12-12" });
    expect(r.status).toBe(200);
    expect(r.body.goal).toMatchObject({
      type: "logging_days",
      name: "Logging days",
      target: 5,
      period: "week",
      measure: null,
      start: TODAY,
      end: "2026-12-12",
      endedEarly: false,
      frozen: false,
      progress: { state: "active", current: { start: TODAY, end: "2026-11-21", value: 1, target: 3, status: "open" }, of: 4 },
    });
    expect(r.body.replaced).toBeNull();
    expect((await list()).active.map((g) => g.id)).toEqual([r.body.goal.id]);
  });

  it("each-week and each-month goals can be ongoing; a whole stretch, a streak and a weight need an end", async () => {
    expect((await create({ type: "workouts", target: 3, period: "week", end: null })).body.goal).toMatchObject({ end: null, progress: { of: null } });
    for (const body of [
      { type: "water_days", target: 10, period: "stretch" },
      { type: "streak", target: 7, period: "stretch", end: null },
      { type: "weight_by_date", target: 80, period: "stretch" },
    ]) {
      const r = await create(body);
      expect([r.status, r.body.error]).toEqual([400, "Choose an end date"]);
    }
    const s = await create({ type: "streak", target: 7, period: "week", end: "2026-12-31" });
    expect([s.status, s.body.error]).toEqual([400, "A Streak goal runs over the whole stretch"]);
  });

  it("an each-week or each-month goal with an end must hold a period it can be judged on (4 days of a week, 15 of a month)", async () => {
    const w = await create({ type: "workouts", target: 3, period: "week", end: "2026-11-20" }); // Wed–Fri
    expect([w.status, w.body.error]).toEqual([400, "Choose dates with at least 4 days in one week"]);
    const m = await create({ type: "workouts", target: 3, period: "month", end: "2026-11-30" }); // 13 days
    expect([m.status, m.body.error]).toEqual([400, "Choose dates with at least 15 days in one month"]);
    expect((await create({ type: "workouts", target: 3, period: "week", end: "2026-11-21" })).status).toBe(200);
  });

  it("checks the target for the type and period, and the dates", async () => {
    const bad: [Record<string, unknown>, string][] = [
      [{ type: "logging_days", target: 8, period: "week" }, "Choose 1 to 7 days a week"],
      [{ type: "protein_days", target: 0, period: "month" }, "Choose 1 to 31 days a month"],
      [{ type: "fiber_days", target: 2.5, period: "week" }, "Choose 1 to 7 days a week"],
      [{ type: "weigh_ins", target: 15, period: "stretch", end: "2026-11-27" }, "Choose 1 to 10 days in the stretch"],
      [{ type: "streak", target: 1, period: "stretch", end: "2026-11-27" }, "Choose a streak of 2 to 10 days"],
      [{ type: "steps", measure: "average", target: 100001, period: "week" }, "Choose 1 to 100,000 steps a day"],
      [{ type: "steps", target: 0, period: "week" }, "Choose 1 to 10,000,000 steps"],
      [{ type: "workouts", target: 1001, period: "month" }, "Choose 1 to 1,000 workouts"],
      [{ type: "active_minutes", target: -5, period: "week" }, "Choose 1 to 100,000 minutes"],
      [{ type: "weight_by_date", target: 10, period: "stretch", end: "2027-03-01" }, "Choose a weight between 20 and 400 kg"],
      [{ type: "logging_days", target: 5, period: "week", start: "2026-11-20", end: "2026-11-19" }, "The end can't be before the start"],
      [{ type: "logging_days", target: 5, period: "week", start: "2026-11-01", end: "2026-11-17" }, "Choose an end date from today on"],
      [{ type: "logging_days", target: 5, period: "week", end: "2030-01-01" }, "A goal can run for up to 3 years"],
      [{ type: "logging_days", target: 5, period: "week", start: "2025-11-01" }, "Choose a start within the last year"],
      [{ type: "nap_days", target: 5, period: "week" }, "Choose a kind of goal"],
      [{ type: "logging_days", target: 5, period: "fortnight" }, "Choose each week, each month or the whole stretch"],
      [{ type: "logging_days", target: 5, period: "week", name: "x".repeat(61) }, "Keep the name to 60 characters"],
    ];
    for (const [body, error] of bad) {
      const r = await create(body);
      expect([body, r.status, r.body.error]).toEqual([body, 400, error]);
    }
    expect(await t.db.select().from(goals)).toEqual([]);
  });

  it("only steps goals take a measure (total by default)", async () => {
    expect((await create({ type: "steps", target: 70000, period: "week" })).body.goal.measure).toBe("total");
    expect((await create({ type: "workouts", target: 3, period: "week", measure: "average" })).body.goal.measure).toBeNull();
  });
});

describe("progress from the data", () => {
  it("Protein, Fiber and Water days count days at or above the minimum in force that day", async () => {
    await plan("2026-11-01");
    await eat("2026-11-15", { calories: 1600, protein_g: 110, fiber_g: 20 });
    await eat("2026-11-16", { calories: 1600, protein_g: 90, fiber_g: 26 });
    await eat("2026-11-17", { calories: 1600, protein_g: 100, fiber_g: 25 });
    for (const [day, ml] of [["2026-11-15", 2000], ["2026-11-16", 1500], ["2026-11-17", 2500]] as const) await t.api("POST", "/api/log", { day, meal: "supplements", water_ml: ml });
    const g = async (type: string) => (await create({ type, target: 5, period: "week", start: "2026-11-15", end: "2026-11-21" })).body.goal.progress.current.value;
    expect([await g("protein_days"), await g("fiber_days"), await g("water_days")]).toEqual([2, 2, 2]);
  });

  it("Calorie days use the calorie-day rules: a day covered by the weekly bank counts", async () => {
    await plan("2026-11-01");
    at("2026-11-15");
    expect((await t.api("PUT", "/api/workout-calories", { mode: "bank", countPct: 100, weeklyCap: 1000 })).status).toBe(200);
    at(TODAY);
    await t.api("POST", "/api/workouts", { day: "2026-11-15", type: "run", minutes: 30, calories: 300 });
    await eat("2026-11-15", { calories: 1800 }); // in
    await eat("2026-11-16", { calories: 2200 }); // over by 200: covered by the bank
    await eat("2026-11-17", { calories: 2400 }); // over by 400: only 100 left
    await eat("2026-11-18", { calories: 1200 }); // below
    const r = await create({ type: "calorie_days", target: 5, period: "week", start: "2026-11-15", end: "2026-11-21" });
    expect(r.body.goal.progress.current).toMatchObject({ value: 2, target: 5 });
  });

  it("Logging days and Weigh-ins; a Streak within the stretch", async () => {
    for (const d of ["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-14", "2026-11-15"]) await eat(d, { calories: 100 });
    for (const d of ["2026-11-12", "2026-11-16"]) await t.api("PUT", `/api/weigh-ins/${d}`, { weightKg: 90 });
    const logging = (await create({ type: "logging_days", target: 4, period: "stretch", start: "2026-11-11", end: "2026-11-30" })).body.goal.progress.current;
    expect(logging).toMatchObject({ value: 4, status: "hit" });
    expect((await create({ type: "weigh_ins", target: 4, period: "week", start: "2026-11-08", end: "2026-11-21" })).body.goal.progress.periods.map((p: any) => p.value)).toEqual([1, 1]);
    // Nov 11–12 (from the start) = 2; the 13th breaks it; Nov 14–15 = 2. A vacation on the 13th joins them
    const streak = async () => (await create({ type: "streak", target: 5, period: "stretch", start: "2026-11-11", end: "2026-11-30" })).body.goal.progress.current.value;
    expect(await streak()).toBe(2);
    await t.api("POST", "/api/vacations", { from: "2026-11-13", to: "2026-11-13" });
    expect(await streak()).toBe(4);
  });

  it("Steps (Health's number over the typed one; total or average), Workouts and Active minutes", async () => {
    await t.api("PUT", "/api/steps/2026-11-15", { steps: 3000 });
    await t.api("PUT", "/api/steps/2026-11-15", { steps: 9000, source: "health" });
    await t.api("PUT", "/api/steps/2026-11-16", { steps: 5000 });
    await t.api("POST", "/api/workouts", { day: "2026-11-16", type: "walk", minutes: 30 });
    await t.api("POST", "/api/workouts", { day: "2026-11-17", type: "run", minutes: 25, calories: 250 });
    const week = { period: "week", start: "2026-11-15", end: "2026-11-21" };
    const value = async (body: Record<string, unknown>) => (await create({ ...week, ...body })).body.goal.progress.current.value;
    expect(await value({ type: "steps", measure: "total", target: 70000 })).toBe(14000);
    expect(await value({ type: "steps", measure: "average", target: 8000 })).toBe(7000);
    expect(await value({ type: "workouts", target: 3 })).toBe(2);
    expect(await value({ type: "active_minutes", target: 150 })).toBe(55);
  });

  it("Weight by a date: the trend weight, in kg", async () => {
    await t.api("PUT", "/api/weigh-ins/2026-11-01", { weightKg: 90 });
    await t.api("PUT", "/api/weigh-ins/2026-11-15", { weightKg: 88 });
    const g = (await create({ type: "weight_by_date", target: 85, period: "stretch", start: "2026-11-01", end: "2027-01-31" })).body.goal;
    expect(g.progress).toMatchObject({ state: "active", startKg: 90, current: { target: 85, status: "open" } });
    expect(g.progress.current.value).toBeCloseTo(90 - 2 * (1 - 0.9 ** 14), 3);
  });

  it("an Activity step goal: the active average-per-day steps goal is the widget's step goal", async () => {
    expect((await t.api("GET", `/api/activity/${TODAY}`)).body.stepGoal).toBeNull();
    await create({ type: "steps", measure: "total", target: 70000, period: "week" });
    expect((await t.api("GET", `/api/activity/${TODAY}`)).body.stepGoal).toBeNull();
    await create({ type: "steps", measure: "average", target: 9000, period: "week" });
    expect((await t.api("GET", `/api/activity/${TODAY}`)).body.stepGoal).toBe(9000);
    expect((await t.api("GET", "/api/activity/2026-11-17")).body.stepGoal).toBeNull(); // before it started
    // Replaced the same day: the new target at once (the old one ended today)
    await create({ type: "steps", measure: "average", target: 10000, period: "week" });
    expect((await t.api("GET", `/api/activity/${TODAY}`)).body.stepGoal).toBe(10000);
  });

  it("Water, Protein and Fiber days need something logged, even with a minimum of 0", async () => {
    const me = (await t.api("GET", "/api/auth/me")).body;
    const userId = me.id ?? me.user?.id;
    await t.db.insert(targets).values({ userId, effectiveFrom: "2026-11-01", caloriesMin: 1500, caloriesMax: 2000, proteinMin: 0, proteinMax: 100, fiberMin: 0, fiberMax: 30, waterMin: 0, waterMax: 3000 });
    await eat("2026-11-16", { calories: 500 });
    await t.api("POST", "/api/log", { day: "2026-11-17", meal: "supplements", water_ml: 250 });
    const value = async (type: string) => (await create({ type, target: 5, period: "week", start: "2026-11-15", end: "2026-11-21" })).body.goal.progress.current.value;
    expect([await value("protein_days"), await value("fiber_days"), await value("water_days")]).toEqual([1, 1, 1]);
  });

  it("an upcoming goal's weeks follow the person's week start", async () => {
    const me = (await t.api("GET", "/api/settings/me")).body;
    expect((await t.api("PUT", "/api/settings/me", { mealWindows: me.mealWindows, waterButtonsMl: me.waterButtonsMl, weekStart: 1 })).status).toBe(200);
    // Sun Dec 6 – Wed Dec 16 with Monday weeks: Dec 6 (1 day) and Dec 14–16 (3 days) aren't judged; Dec 7–13 is
    const g = (await create({ type: "workouts", target: 3, period: "week", start: "2026-12-06", end: "2026-12-16" })).body.goal;
    expect(g.progress).toMatchObject({ state: "upcoming", of: 1, needed: 1 });
  });
});

describe("replacing, editing, ending, deleting", () => {
  it("a new goal of the same type replaces the active one: it ends today and moves to Past goals", async () => {
    const old = (await create({ type: "workouts", target: 3, period: "week", start: "2026-11-01", end: null })).body.goal;
    const other = (await create({ type: "steps", target: 50000, period: "week" })).body.goal;
    const r = await create({ type: "workouts", target: 4, period: "month", end: "2027-02-28" });
    expect(r.body.replaced).toBe(old.id);
    const { active, past } = await list();
    expect(active.map((g) => g.id).sort()).toEqual([other.id, r.body.goal.id].sort());
    expect(past).toMatchObject([{ id: old.id, end: TODAY, endedEarly: true, frozen: false }]);
  });

  it("a goal of the same type that hasn't started yet is simply removed", async () => {
    const later = (await create({ type: "workouts", target: 3, period: "week", start: "2026-12-01", end: null })).body.goal;
    expect(later.progress.state).toBe("upcoming");
    const r = await create({ type: "workouts", target: 2, period: "week" });
    expect(r.body.replaced).toBe(later.id);
    expect(await list()).toMatchObject({ active: [{ id: r.body.goal.id }], past: [] });
  });

  it("edit changes the target, the name and the end date of an active goal", async () => {
    const g = (await create({ type: "logging_days", target: 5, period: "week", end: "2026-12-12" })).body.goal;
    const r = await t.api("PATCH", `/api/goals/${g.id}`, { target: 6, name: "  Log most days ", end: null });
    expect(r.status).toBe(200);
    expect(r.body.goal).toMatchObject({ target: 6, name: "Log most days", end: null, type: "logging_days", start: TODAY });
    expect((await t.api("PATCH", `/api/goals/${g.id}`, { target: 9 })).body.error).toBe("Choose 1 to 7 days a week");
    expect((await t.api("PATCH", `/api/goals/${g.id}`, { end: "2026-11-17" })).body.error).toBe("Choose an end date from today on");
    expect((await t.api("PATCH", `/api/goals/${g.id}`, { name: "" })).body.goal.name).toBe("Logging days");
    expect((await t.api("PATCH", "/api/goals/999999", { target: 5 })).status).toBe(404);
  });

  it("End now ends it today: in Past goals at once, worked out live until today is over, then frozen", async () => {
    await eat("2026-11-10", { calories: 100 });
    await eat(TODAY, { calories: 100 });
    const g = (await create({ type: "logging_days", target: 1, period: "week", start: "2026-11-08", end: null })).body.goal;
    const ended = await t.api("POST", `/api/goals/${g.id}/end`);
    expect(ended.status).toBe(200);
    expect(ended.body.goal).toMatchObject({ end: TODAY, endedEarly: true, frozen: false, progress: { state: "active", hit: 2 } });
    expect((await list()).past.map((x) => x.id)).toEqual([g.id]);
    // A finished goal can't be edited or ended again
    expect((await t.api("PATCH", `/api/goals/${g.id}`, { target: 2 })).status).toBe(409);
    expect((await t.api("POST", `/api/goals/${g.id}/end`)).status).toBe(409);
    at("2026-11-19");
    expect((await list()).past).toMatchObject([{ id: g.id, frozen: true, progress: { state: "completed", hit: 2, of: 2 } }]);
  });

  it("an upcoming goal can't be ended (delete it instead)", async () => {
    const g = (await create({ type: "logging_days", target: 1, period: "week", start: "2026-12-01" })).body.goal;
    const r = await t.api("POST", `/api/goals/${g.id}/end`);
    expect([r.status, r.body.error]).toEqual([409, "This goal hasn't started yet. Delete it instead."]);
  });

  it("delete removes a goal, active or past", async () => {
    const g = (await create({ type: "logging_days", target: 1, period: "week" })).body.goal;
    expect((await t.api("DELETE", `/api/goals/${g.id}`)).status).toBe(204);
    expect((await t.api("DELETE", `/api/goals/${g.id}`)).status).toBe(404);
    expect(await list()).toEqual({ active: [], past: [] });
  });
});

describe("freezing", () => {
  it("once the end date has passed the result is worked out once and kept: later edits to old days don't flip it", async () => {
    await eat("2026-11-18", { calories: 100 });
    const g = (await create({ type: "logging_days", target: 3, period: "stretch", end: "2026-11-20" })).body.goal;
    await eat("2026-11-19", { calories: 100 });
    at("2026-11-20"); // the last day: still live
    expect((await list()).active).toMatchObject([{ id: g.id, frozen: false, progress: { current: { value: 2 } } }]);
    at("2026-11-21"); // over: frozen as missed
    const { active, past } = await list();
    expect(active).toEqual([]);
    expect(past).toMatchObject([{ id: g.id, frozen: true, endedEarly: false, progress: { state: "missed", periods: [{ value: 2, target: 3, status: "missed" }] } }]);
    const [row] = await t.db.select().from(goals).where(eq(goals.id, g.id));
    expect(row.frozenAt).not.toBeNull();
    // Logging the missing day afterwards changes nothing
    await eat("2026-11-20", { calories: 100 });
    expect((await t.api("GET", `/api/goals/${g.id}`)).body.goal.progress).toMatchObject({ state: "missed", periods: [{ value: 2 }] });
  });

  it("completing a goal earns the Goal met badge (on its end day), once", async () => {
    for (const d of ["2026-11-18", "2026-11-19"]) await eat(d, { calories: 100 });
    await create({ type: "logging_days", target: 2, period: "stretch", end: "2026-11-19" });
    expect((await t.api("GET", "/api/badges")).body.badges.find((b: any) => b.id === "goal_met")).toEqual({ id: "goal_met", earnedOn: null, seen: false, count: 0 });
    at("2026-11-25");
    const b = (await t.api("GET", "/api/badges")).body;
    expect(b.badges.find((x: any) => x.id === "goal_met")).toEqual({ id: "goal_met", earnedOn: "2026-11-19", seen: false, count: 1 });
    expect(b.new).toContain("goal_met");
    expect((await t.db.select().from(badges)).filter((x) => x.badge === "goal_met")).toHaveLength(1);
  });

  it("Goal met counts every completed goal: the latest one's day, and new again for each", async () => {
    for (const d of ["2026-11-18", "2026-11-19", "2026-11-20"]) await eat(d, { calories: 100 });
    await create({ type: "logging_days", target: 1, period: "stretch", end: "2026-11-18" });
    at("2026-11-19");
    let met = (await t.api("GET", "/api/badges")).body.badges.find((b: any) => b.id === "goal_met");
    expect(met).toEqual({ id: "goal_met", earnedOn: "2026-11-18", seen: false, count: 1 });
    await t.api("POST", "/api/badges/seen", { ids: ["goal_met"] });
    await create({ type: "weigh_ins", target: 1, period: "stretch", end: "2026-11-20" });
    at("2026-11-20");
    expect((await t.api("PUT", "/api/weigh-ins/2026-11-20", { weightKg: 90 })).status).toBe(200);
    at("2026-11-21");
    const b = (await t.api("GET", "/api/badges")).body;
    met = b.badges.find((x: any) => x.id === "goal_met");
    expect(met).toEqual({ id: "goal_met", earnedOn: "2026-11-20", seen: false, count: 2 });
    expect(b.new).toContain("goal_met");
  });

  it("ending early: a stretch isn't judged (Ended, no badge); a week goal is judged on the weeks that went by", async () => {
    await eat(TODAY, { calories: 100 });
    const stretch = (await create({ type: "logging_days", target: 1, period: "stretch", end: "2026-12-31" })).body.goal;
    const week = (await create({ type: "weigh_ins", target: 1, period: "week", start: "2026-11-01", end: null })).body.goal;
    await t.api("PUT", `/api/weigh-ins/2026-11-03`, { weightKg: 90 });
    await t.api("PUT", `/api/weigh-ins/2026-11-10`, { weightKg: 90 });
    await t.api("PUT", `/api/weigh-ins/${TODAY}`, { weightKg: 90 });
    await t.api("POST", `/api/goals/${stretch.id}/end`);
    await t.api("POST", `/api/goals/${week.id}/end`);
    at("2026-11-19");
    const past = (await list()).past;
    expect(past.find((g) => g.id === stretch.id).progress).toMatchObject({ state: "ended", of: 0 });
    // Nov 1–7 and 8–14 whole, Nov 15–18: 4 days, judged too
    expect(past.find((g) => g.id === week.id).progress).toMatchObject({ state: "completed", hit: 3, of: 3 });
    expect((await t.api("GET", "/api/badges")).body.badges.find((b: any) => b.id === "goal_met").count).toBe(1);
  });

  it("End now with only a 4–6 day partial week to judge earns no Goal met: Ended early (§46)", async () => {
    // Started Sunday, ended Wednesday: Nov 15–18 is the only period, cut short by End now
    const g = (await create({ type: "weigh_ins", target: 1, period: "week", start: "2026-11-15", end: null })).body.goal;
    await t.api("PUT", `/api/weigh-ins/${TODAY}`, { weightKg: 90 });
    await t.api("POST", `/api/goals/${g.id}/end`);
    at("2026-11-19");
    const p = (await list()).past[0].progress;
    expect(p).toMatchObject({ state: "ended", hit: 0, of: 0, periods: [{ start: "2026-11-15", end: TODAY, status: "unjudged" }] });
    expect((await t.db.select().from(badges)).filter((x) => x.badge === "goal_met")).toEqual([]);
  });

  it("each month too: End now with only a partial month to judge is Ended early (§46)", async () => {
    const g = (await create({ type: "logging_days", target: 1, period: "month", start: "2026-11-01", end: null })).body.goal;
    await eat(TODAY, { calories: 100 });
    await t.api("POST", `/api/goals/${g.id}/end`);
    at("2026-11-19");
    expect((await list()).past[0].progress).toMatchObject({ state: "ended", of: 0 });
  });

  it("ending a weekly goal on its first day earns nothing", async () => {
    await eat("2026-11-21", { calories: 100 });
    at("2026-11-21"); // a Saturday
    const g = (await create({ type: "logging_days", target: 1, period: "week", end: null })).body.goal;
    await t.api("POST", `/api/goals/${g.id}/end`);
    at("2026-11-22");
    expect((await list()).past[0].progress).toMatchObject({ state: "ended", hit: 0, of: 0 });
    expect((await t.db.select().from(badges)).filter((x) => x.badge === "goal_met")).toEqual([]);
  });

  it("goals read at the same moment are judged once: one result, one Goal met (§46)", async () => {
    for (const d of ["2026-11-18", "2026-11-19"]) await eat(d, { calories: 100 });
    const a = (await create({ type: "logging_days", target: 2, period: "stretch", end: "2026-11-19" })).body.goal;
    const b = (await create({ type: "weigh_ins", target: 1, period: "stretch", end: "2026-11-19" })).body.goal;
    await t.api("PUT", `/api/weigh-ins/${TODAY}`, { weightKg: 90 });
    at("2026-11-25");
    const reads = await Promise.all([
      t.api("GET", "/api/goals"),
      t.api("GET", "/api/badges"),
      t.api("GET", `/api/goals/${a.id}`),
      t.api("GET", "/api/goals"),
      t.api("GET", `/api/goals/${b.id}`),
      t.api("GET", "/api/badges"),
    ]);
    expect(reads.map((r) => r.status)).toEqual(Array(6).fill(200));
    const rows = await t.db.select().from(goals);
    expect(rows.map((r) => (r.result as any).state).sort()).toEqual(["completed", "completed"]);
    // Every reader saw the same kept result
    for (const r of [reads[0], reads[3]]) expect(r.body.past.map((g: any) => g.progress.state)).toEqual(["completed", "completed"]);
    const met = (await t.api("GET", "/api/badges")).body.badges.find((x: any) => x.id === "goal_met");
    expect(met).toMatchObject({ earnedOn: "2026-11-19", count: 2 });
    expect((await t.db.select().from(badges)).filter((x) => x.badge === "goal_met")).toHaveLength(1);
  });

  it("deleting a completed goal keeps the Goal met count (§46)", async () => {
    await eat(TODAY, { calories: 100 });
    const g = (await create({ type: "logging_days", target: 1, period: "stretch", end: TODAY })).body.goal;
    at("2026-11-19");
    expect((await t.api("GET", "/api/badges")).body.badges.find((b: any) => b.id === "goal_met").count).toBe(1);
    expect((await t.api("DELETE", `/api/goals/${g.id}`)).status).toBe(204);
    expect((await t.api("GET", "/api/badges")).body.badges.find((b: any) => b.id === "goal_met")).toMatchObject({ earnedOn: TODAY, count: 1 });
  });

  it("after restoring a backup from before the count (count 0), the next met goal counts on from the met goals, and deleting one doesn't lower it (§46 fix)", async () => {
    await eat(TODAY, { calories: 100 });
    const a = (await create({ type: "logging_days", target: 1, period: "stretch", end: TODAY })).body.goal;
    await create({ type: "weigh_ins", target: 1, period: "stretch", end: TODAY });
    await t.api("PUT", `/api/weigh-ins/${TODAY}`, { weightKg: 90 });
    at("2026-11-19");
    await list(); // both frozen as met
    // An older backup restored: the badge has no count
    await t.db.update(badges).set({ count: 0 }).where(eq(badges.badge, "goal_met"));
    expect((await t.api("GET", "/api/badges")).body.badges.find((b: any) => b.id === "goal_met").count).toBe(2);
    await eat("2026-11-19", { calories: 100 });
    await create({ type: "logging_days", target: 1, period: "stretch", end: "2026-11-19" });
    at("2026-11-20");
    expect((await t.api("GET", "/api/badges")).body.badges.find((b: any) => b.id === "goal_met").count).toBe(3);
    await t.api("DELETE", `/api/goals/${a.id}`);
    expect((await t.api("GET", "/api/badges")).body.badges.find((b: any) => b.id === "goal_met").count).toBe(3);
  });

  it("a goal keeps the week start it was made with: changing it later doesn't turn a missed goal into Ended (§46)", async () => {
    // Sun Nov 15 – Wed Nov 18 with Sunday weeks: one 4-day week, judged
    const g = (await create({ type: "logging_days", target: 4, period: "week", start: "2026-11-15", end: TODAY })).body.goal;
    expect(g.progress).toMatchObject({ of: 1 });
    // Tuesday weeks would cut it into 2 + 2 days, neither judged
    const me = (await t.api("GET", "/api/settings/me")).body;
    expect((await t.api("PUT", "/api/settings/me", { mealWindows: me.mealWindows, waterButtonsMl: me.waterButtonsMl, weekStart: 2 })).status).toBe(200);
    expect((await t.api("GET", `/api/goals/${g.id}`)).body.goal.progress).toMatchObject({ state: "active", of: 1, periods: [{ start: "2026-11-15", end: TODAY }] });
    at("2026-11-19");
    expect((await list()).past[0].progress).toMatchObject({ state: "missed", of: 1, done: 1 });
    const [row] = await t.db.select().from(goals).where(eq(goals.id, g.id));
    expect(row.weekStart).toBe(0);
  });

  it("an edit is checked against the goal's own week start (§46)", async () => {
    const g = (await create({ type: "workouts", target: 2, period: "week", start: "2026-11-15", end: "2026-11-30" })).body.goal;
    const me = (await t.api("GET", "/api/settings/me")).body;
    await t.api("PUT", "/api/settings/me", { mealWindows: me.mealWindows, waterButtonsMl: me.waterButtonsMl, weekStart: 2 });
    // Its Sunday weeks: Nov 15–18 is a judged 4-day week (Tuesday weeks would make it 2 + 2 days, nothing to judge)
    const r = await t.api("PATCH", `/api/goals/${g.id}`, { end: TODAY });
    expect(r.status).toBe(200);
    expect(r.body.goal.progress).toMatchObject({ of: 1, periods: [{ start: "2026-11-15", end: TODAY }] });
  });

  it("a missed goal earns no badge", async () => {
    await create({ type: "logging_days", target: 2, period: "stretch", end: "2026-11-19" });
    at("2026-11-25");
    await list();
    expect((await t.db.select().from(badges)).filter((x) => x.badge === "goal_met")).toEqual([]);
  });

  it("days are the person's: the end passes at midnight in their time zone", async () => {
    const g = (await create({ type: "logging_days", target: 1, period: "stretch", end: TODAY })).body.goal;
    t.clock.date = new Date("2026-11-19T06:30:00Z"); // 11:30 pm on the 18th in Boise
    expect((await t.api("GET", `/api/goals/${g.id}`)).body.goal.frozen).toBe(false);
    t.clock.date = new Date("2026-11-19T07:30:00Z"); // 12:30 am on the 19th
    expect((await t.api("GET", `/api/goals/${g.id}`)).body.goal.frozen).toBe(true);
  });

  it("past goals are newest first", async () => {
    const a = (await create({ type: "logging_days", target: 1, period: "stretch", end: "2026-11-19" })).body.goal;
    const b = (await create({ type: "workouts", target: 1, period: "stretch", end: "2026-11-25" })).body.goal;
    const c = (await create({ type: "steps", target: 1, period: "stretch", end: "2026-11-22" })).body.goal;
    at("2026-12-01");
    expect((await list()).past.map((g) => g.id)).toEqual([b.id, c.id, a.id]);
  });
});

describe("goal widgets in layouts", () => {
  const goalsLayout = { version: 1, columns: [["your-plan", "goal-date"], ["weight-chart"], ["badges"]] };

  it("a new goal joins the shortest column of the saved Goals layout, never the Dashboard's", async () => {
    expect((await t.api("PUT", "/api/layouts/goals", goalsLayout)).status).toBe(200);
    const dash = { version: 1, columns: [["food"], ["budget"], []] };
    expect((await t.api("PUT", "/api/layouts/dashboard", dash)).status).toBe(200);
    const g = (await create({ type: "logging_days", target: 5, period: "week" })).body.goal;
    expect((await t.api("GET", "/api/layouts/goals")).body.layout.columns).toEqual([["your-plan", "goal-date"], ["weight-chart", `goal:${g.id}`], ["badges"]]);
    expect((await t.api("GET", "/api/layouts/dashboard")).body.layout).toEqual(dash);
  });

  it("only columns in use count: an empty column stays empty", async () => {
    expect((await t.api("PUT", "/api/layouts/goals", { version: 1, columns: [["your-plan", "goal-date"], ["weight-chart", "badges"], []] })).status).toBe(200);
    const g = (await create({ type: "logging_days", target: 5, period: "week" })).body.goal;
    const h = (await create({ type: "workouts", target: 2, period: "week" })).body.goal;
    expect((await t.api("GET", "/api/layouts/goals")).body.layout.columns).toEqual([["your-plan", "goal-date", `goal:${g.id}`], ["weight-chart", "badges", `goal:${h.id}`], []]);
  });

  it("with no saved Goals layout nothing is saved (the app's default places active goals)", async () => {
    await create({ type: "logging_days", target: 5, period: "week" });
    expect((await t.api("GET", "/api/layouts/goals")).body).toEqual({ layout: null });
  });

  it("a goal widget can be put on either page; an ended or deleted goal's widget leaves every layout", async () => {
    const g = (await create({ type: "logging_days", target: 5, period: "week" })).body.goal;
    const h = (await create({ type: "workouts", target: 2, period: "week" })).body.goal;
    const dash = { version: 1, columns: [["food", `goal:${g.id}`], [`goal:${h.id}`], []] };
    expect((await t.api("PUT", "/api/layouts/dashboard", dash)).body).toEqual({ layout: dash });
    expect((await t.api("PUT", "/api/layouts/goals", { version: 1, columns: [[`goal:${g.id}`], [], []] })).status).toBe(200);
    await t.api("POST", `/api/goals/${g.id}/end`);
    expect((await t.api("GET", "/api/layouts/dashboard")).body.layout.columns).toEqual([["food"], [`goal:${h.id}`], []]);
    expect((await t.api("GET", "/api/layouts/goals")).body.layout.columns).toEqual([[], [], []]);
    await t.api("DELETE", `/api/goals/${h.id}`);
    expect((await t.api("GET", "/api/layouts/dashboard")).body.layout.columns).toEqual([["food"], [], []]);
    // Stored without them too
    const rows = await t.db.select().from(dashboardLayouts);
    expect(rows.flatMap((r) => r.columns.flat()).filter((id) => id.startsWith("goal:"))).toEqual([]);
  });

  it("a goal whose end has passed leaves layouts when read; a goal id that isn't one of your active goals is dropped", async () => {
    const g = (await create({ type: "logging_days", target: 1, period: "stretch", end: "2026-11-19" })).body.goal;
    expect((await t.api("PUT", "/api/layouts/dashboard", { version: 1, columns: [[`goal:${g.id}`, "goal:999999", "food"], [], []] })).body.layout.columns).toEqual([[`goal:${g.id}`, "food"], [], []]);
    at("2026-11-20");
    expect((await t.api("GET", "/api/layouts/dashboard")).body.layout.columns).toEqual([["food"], [], []]);
  });

  it("goal widgets must look like goal:<id>, and only once", async () => {
    const g = (await create({ type: "logging_days", target: 1, period: "week" })).body.goal;
    for (const columns of [[["goal:abc"]], [["goal:"]], [[`goal:${g.id}`, `goal:${g.id}`]]]) {
      expect((await t.api("PUT", "/api/layouts/goals", { version: 1, columns })).status).toBe(400);
    }
  });
});

describe("goals need a sign-in", () => {
  it("401 without one", async () => {
    for (const [m, url] of [["GET", "/api/goals"], ["POST", "/api/goals"], ["GET", "/api/goals/1"], ["PATCH", "/api/goals/1"], ["POST", "/api/goals/1/end"], ["DELETE", "/api/goals/1"]] as const) {
      const r = await t.app.inject({ method: m, url, payload: m === "GET" || m === "DELETE" ? undefined : {} });
      expect([m, url, r.statusCode]).toEqual([m, url, 401]);
    }
  });
});
