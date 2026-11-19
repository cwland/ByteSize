import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";
import { MET } from "../src/lib/activity.js";

// §40b: steps and workouts (typed, or sent by the phone), and workout calories in the plan.
let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
beforeEach(async () => {
  await t.reset();
  await t.login(); // admin "alex", America/Denver
  at("2026-11-18"); // a Wednesday; weeks start on Sunday by default (Nov 15–21)
});
afterAll(async () => t.close());

const TODAY = "2026-11-18";
/** Noon in Denver on that day */
const at = (day: string) => (t.clock.date = new Date(`${day}T19:00:00Z`));
const steps = (day: string, body: Record<string, unknown>) => t.api("PUT", `/api/steps/${day}`, body);
const workout = (body: Record<string, unknown>) => t.api("POST", "/api/workouts", { day: TODAY, type: "walk", minutes: 30, ...body });
const activity = async (day = TODAY) => (await t.api("GET", `/api/activity/${day}`)).body;
const dayView = async (day = TODAY) => (await t.api("GET", `/api/day/${day}`)).body;

// A food of `calories`, logged once on `day` (treat: marked as a treat)
let foodId = 0;
async function eat(day: string, calories: number, treat?: boolean) {
  const f = (await t.api("POST", "/api/my-foods", { name: `Food ${++foodId}`, servings: [{ label: "1", grams: 100 }], nutrients: { calories } })).body.food;
  const res = await t.api("POST", "/api/log", { day, meal: "lunch", food: { kind: "user_food", id: f.id }, servingIndex: 0, unit: "serving", quantity: 1, fraction: 1, ...(treat === undefined ? {} : { treat }) });
  expect(res.status).toBe(200);
  return res.body.entry;
}
// Targets 1,500–2,000 from `day` on
async function plan(day: string) {
  const before = t.clock.date;
  at(day);
  expect((await t.api("PUT", "/api/targets", { calories: { min: 1500, max: 2000 }, protein_g: { min: 100, max: 120 }, fiber_g: { min: 25, max: 30 }, water_ml: { min: 2000, max: 3000 } })).status).toBe(200);
  t.clock.date = before;
}
async function mode(m: Record<string, unknown>, day = TODAY) {
  const before = t.clock.date;
  at(day);
  const res = await t.api("PUT", "/api/workout-calories", { countPct: 50, weeklyCap: 1000, ...m });
  t.clock.date = before;
  return res;
}

describe("steps", () => {
  it("starts empty: no steps, no workouts, nothing earned", async () => {
    expect(await activity()).toEqual({ day: TODAY, steps: null, stepsSource: null, typedSteps: null, stepGoal: null, workouts: [], earned: 0, activeMinutes: 0 });
  });

  it("+ Steps sets the day's total; again replaces it", async () => {
    expect((await steps(TODAY, { steps: 4200 })).body).toEqual({ day: TODAY, steps: 4200, stepsSource: "manual" });
    await steps(TODAY, { steps: 5100 });
    expect(await activity()).toMatchObject({ steps: 5100, stepsSource: "manual", typedSteps: 5100 });
  });

  it("the Health number wins over the typed one; the phone resending replaces its own number only", async () => {
    await steps(TODAY, { steps: 3000 });
    await steps(TODAY, { steps: 7000, source: "health" });
    await steps(TODAY, { steps: 7400, source: "health" }); // a resend: still one row
    expect(await activity()).toMatchObject({ steps: 7400, stepsSource: "health", typedSteps: 3000 });
    const { activitySteps } = await import("../src/db/schema.js");
    expect((await t.app.db.select().from(activitySteps)).length).toBe(2);
  });

  it("deleting the typed steps leaves Health's; 404 when there's nothing to delete", async () => {
    await steps(TODAY, { steps: 3000 });
    await steps(TODAY, { steps: 7000, source: "health" });
    expect((await t.api("DELETE", `/api/steps/${TODAY}`)).status).toBe(204);
    expect(await activity()).toMatchObject({ steps: 7000, typedSteps: null });
    expect((await t.api("DELETE", `/api/steps/${TODAY}`)).status).toBe(404);
    expect((await t.api("DELETE", `/api/steps/${TODAY}?source=health`)).status).toBe(204);
    expect((await activity()).steps).toBeNull();
  });

  it("past days are fine; future days and bad numbers are not", async () => {
    expect((await steps("2026-11-01", { steps: 10000 })).status).toBe(200);
    const future = await steps("2026-11-19", { steps: 100 });
    expect([future.status, future.body.error]).toEqual([400, "Choose today or an earlier day"]);
    for (const bad of [{ steps: -1 }, { steps: 1.5 }, { steps: 500001 }, {}, { steps: 10, source: "watch" }]) expect((await steps(TODAY, bad)).status).toBe(400);
    expect((await t.api("PUT", "/api/steps/2026-02-30", { steps: 1 })).status).toBe(400);
  });

  it("a day in the person's own time zone: just after midnight in Denver is already 'today' there", async () => {
    t.clock.date = new Date("2026-11-19T07:30:00Z"); // 00:30 on Nov 19 in Denver
    expect((await steps("2026-11-19", { steps: 50 })).status).toBe(200);
  });
});

describe("workouts", () => {
  it("+ Workout adds one with type, minutes, calories (optional) and a note; edit and delete it", async () => {
    const res = await workout({ type: "run", minutes: 25, calories: 280, note: "Easy loop" });
    expect(res.status).toBe(200);
    const w = res.body.workout;
    expect(w).toEqual({ id: expect.any(Number), day: TODAY, type: "run", minutes: 25, calories: 280, source: "manual", externalId: null, note: "Easy loop" });
    await workout({ type: "strength", minutes: 40 }); // calories not known
    expect(await activity()).toMatchObject({ earned: 280, activeMinutes: 65, workouts: [{ type: "run" }, { type: "strength", calories: null }] });

    const edited = await t.api("PATCH", `/api/workouts/${w.id}`, { minutes: 30, calories: null, note: "" });
    expect(edited.body.workout).toMatchObject({ minutes: 30, calories: null, note: null });
    expect((await t.api("DELETE", `/api/workouts/${w.id}`)).status).toBe(204);
    expect((await t.api("DELETE", `/api/workouts/${w.id}`)).status).toBe(404);
    expect((await activity()).workouts).toMatchObject([{ type: "strength" }]);
  });

  it("checks what it's given; future days are refused, editing included", async () => {
    for (const bad of [{ type: "skydiving" }, { minutes: 0 }, { minutes: 1441 }, { minutes: 2.5 }, { calories: -5 }, { calories: 10001 }, { day: "2026-11-19" }, { note: "x".repeat(501) }]) {
      expect([bad, (await workout(bad)).status]).toEqual([bad, 400]);
    }
    const w = (await workout({})).body.workout;
    expect((await t.api("PATCH", `/api/workouts/${w.id}`, { day: "2026-11-25" })).status).toBe(400);
    expect((await t.api("PATCH", "/api/workouts/999999", { minutes: 5 })).status).toBe(404);
  });

  it("the day defaults to today", async () => {
    const res = await t.api("POST", "/api/workouts", { type: "yoga", minutes: 20 });
    expect(res.body.workout.day).toBe(TODAY);
  });

  it("Health workouts need the phone's id; sending the same id again updates it instead of adding another", async () => {
    expect((await workout({ source: "health" })).status).toBe(400);
    const first = (await workout({ source: "health", externalId: "HK-1", type: "cycling", minutes: 40, calories: 350 })).body.workout;
    const again = (await workout({ source: "health", externalId: "HK-1", type: "cycling", minutes: 42, calories: 362 })).body.workout;
    expect(again.id).toBe(first.id);
    expect((await activity()).workouts).toEqual([expect.objectContaining({ externalId: "HK-1", minutes: 42, calories: 362, source: "health" })]);
  });

  it("a typed workout never matches or re-sources a Health one: externalId is for Health sends only", async () => {
    const hk = (await workout({ source: "health", externalId: "HK-7", minutes: 40 })).body.workout;
    const typed = await workout({ externalId: "HK-7", minutes: 5 });
    expect([typed.status, typed.body.error]).toEqual([400, "Only workouts from Health carry an externalId"]);
    expect((await activity()).workouts).toEqual([expect.objectContaining({ id: hk.id, source: "health", minutes: 40 })]);
  });

  it("Estimate: MET × body weight × hours, from the person's weight; without one it says what to do", async () => {
    const none = await t.api("GET", "/api/workouts/estimate?type=walk&minutes=60");
    expect([none.status, none.body.error]).toEqual([409, "Add your weight first, then Estimate can work it out"]);
    expect((await t.api("PUT", "/api/weigh-ins/2026-11-18", { weightKg: 100 })).status).toBe(200);
    const est = await t.api("GET", "/api/workouts/estimate?type=run&minutes=30");
    expect(est.body).toEqual({ calories: Math.round(MET.run * 100 * 0.5), met: MET.run, weightKg: 100 });
    expect((await t.api("GET", "/api/workouts/estimate?type=nap&minutes=30")).status).toBe(400);
  });

  it("a range: one row per day with steps, workouts, active minutes and earned, and the workouts themselves", async () => {
    await steps("2026-11-16", { steps: 8000 });
    await workout({ day: "2026-11-17", minutes: 45, calories: 300 });
    const res = await t.api("GET", "/api/activity?from=2026-11-16&to=2026-11-18");
    expect(res.body.days).toEqual([
      { day: "2026-11-16", steps: 8000, stepsSource: "manual", workouts: 0, activeMinutes: 0, earned: 0 },
      { day: "2026-11-17", steps: null, stepsSource: null, workouts: 1, activeMinutes: 45, earned: 300 },
      { day: "2026-11-18", steps: null, stepsSource: null, workouts: 0, activeMinutes: 0, earned: 0 },
    ]);
    expect(res.body.workouts).toMatchObject([{ day: "2026-11-17", minutes: 45 }]);
    expect((await t.api("GET", "/api/activity?from=2026-11-18&to=2026-11-16")).status).toBe(400);
    expect((await t.api("GET", "/api/activity?from=2024-01-01&to=2026-11-18")).status).toBe(400); // over a year
  });
});

describe("workout calories in the plan", () => {
  it("defaults to Just show them: earned shows, the range is unchanged", async () => {
    await plan("2026-11-01");
    expect((await t.api("GET", "/api/workout-calories")).body).toEqual({ settings: { mode: "show", countPct: 50, weeklyCap: 1000 }, effectiveFrom: null });
    await workout({ calories: 320 });
    const d = await dayView();
    expect(d.targets.calories).toEqual({ min: 1500, max: 2000 });
    expect(d.exercise).toEqual({ calories: 320 });
    expect(d.workoutCalories).toMatchObject({ mode: "show", earned: 320, added: 0, bank: null, planCalories: { min: 1500, max: 2000 } });
    expect(d.activity).toMatchObject({ earned: 320, workouts: [{ calories: 320 }] });
  });

  it("checks the setting: the four counts, a cap of 0–5,000", async () => {
    for (const bad of [{ mode: "double" }, { mode: "add", countPct: 60 }, { mode: "bank", weeklyCap: -1 }, { mode: "bank", weeklyCap: 5001 }, { mode: "bank", weeklyCap: 10.5 }]) {
      expect([bad, (await mode(bad)).status]).toEqual([bad, 400]);
    }
    expect((await mode({ mode: "bank", weeklyCap: 0 })).status).toBe(200);
    expect((await mode({ mode: "bank", weeklyCap: 5000 })).body).toEqual({ settings: { mode: "bank", countPct: 50, weeklyCap: 5000 }, effectiveFrom: TODAY });
  });

  it("Add to that day: the day's min and max grow by earned × the count", async () => {
    await plan("2026-11-01");
    await mode({ mode: "add", countPct: 75 });
    await workout({ calories: 400 });
    const d = await dayView();
    expect(d.targets.calories).toEqual({ min: 1800, max: 2300 });
    expect(d.workoutCalories).toMatchObject({ mode: "add", countPct: 75, earned: 400, added: 300 });
    expect(d.meals.dinner.suggested).toBe(Math.round(0.35 * 2050)); // suggestions follow the day's grown range
  });

  it("a change applies from that day forward: past days keep what they had", async () => {
    await plan("2026-11-01");
    await workout({ day: "2026-11-10", calories: 400 });
    await workout({ day: TODAY, calories: 400 });
    await mode({ mode: "add", countPct: 100 }, "2026-11-12");
    expect((await dayView("2026-11-10")).targets.calories).toEqual({ min: 1500, max: 2000 });
    expect((await dayView(TODAY)).targets.calories).toEqual({ min: 1900, max: 2400 });
    await mode({ mode: "show" }); // today: back to showing; the 12th–17th stay as they were
    expect((await dayView(TODAY)).targets.calories).toEqual({ min: 1500, max: 2000 });
    await workout({ day: "2026-11-13", calories: 200 });
    expect((await dayView("2026-11-13")).targets.calories).toEqual({ min: 1700, max: 2200 });
    expect((await t.api("GET", "/api/workout-calories")).body).toMatchObject({ settings: { mode: "show" }, effectiveFrom: TODAY });
  });

  it("Weekly bank: workouts fill it for the week; an over day is covered from it and counts as in range", async () => {
    await plan("2026-11-01");
    await mode({ mode: "bank", countPct: 50 }, "2026-11-15");
    await workout({ day: "2026-11-15", calories: 800 }); // +400
    await workout({ day: "2026-11-16", calories: 600 }); // +300
    await eat("2026-11-17", 2250); // over by 250: covered
    const d = await dayView();
    expect(d.targets.calories).toEqual({ min: 1500, max: 2000 }); // the bank never grows the range
    expect(d.workoutCalories.bank).toEqual({
      weekStart: "2026-11-15",
      balance: 450,
      deposited: 700,
      spent: 250,
      weeklyCap: 1000,
      days: [
        { day: "2026-11-15", deposit: 400, spent: 0 },
        { day: "2026-11-16", deposit: 300, spent: 0 },
        { day: "2026-11-17", deposit: 0, spent: 250 },
        { day: "2026-11-18", deposit: 0, spent: 0 },
      ],
      thisDay: { overBy: 0, covered: 0, treatSpent: 0 },
    });
    const tue = await dayView("2026-11-17");
    expect(tue.workoutCalories.bank).toMatchObject({ balance: 450, thisDay: { overBy: 250, covered: 250, treatSpent: 0 } });
    expect(tue.workoutCalories.status).toBe("in");
  });

  it("the bank resets on the person's week start, and unspent calories don't carry over", async () => {
    await plan("2026-11-01");
    await mode({ mode: "bank" }, "2026-11-01");
    await workout({ day: "2026-11-14", calories: 1000 }); // Saturday: last week
    expect((await dayView("2026-11-14")).workoutCalories.bank.balance).toBe(500);
    expect((await dayView("2026-11-15")).workoutCalories.bank.balance).toBe(0);
    // Weeks starting Monday: Saturday the 14th and Sunday the 15th are the same week
    expect((await t.api("PUT", "/api/settings/me", { mealWindows: { breakfast: "10:30", lunch: "14:30", snacks: "17:00", dinner: "21:00" }, waterButtonsMl: [237], weekStart: 1 })).status).toBe(200);
    expect((await dayView("2026-11-15")).workoutCalories.bank).toMatchObject({ weekStart: "2026-11-09", balance: 500 });
  });

  it("a treat spends from the bank on purpose; the entry is marked and the bank shows it", async () => {
    await plan("2026-11-01");
    await mode({ mode: "bank", countPct: 100 }, "2026-11-15");
    await workout({ day: "2026-11-16", calories: 500 });
    await eat(TODAY, 1900);
    const treat = await eat(TODAY, 300, true);
    expect(treat.treat).toBe(true);
    const d = await dayView();
    expect(d.entries.map((e: { treat: boolean }) => e.treat)).toEqual([false, true]);
    expect(d.workoutCalories.bank).toMatchObject({ balance: 200, spent: 300, thisDay: { treatSpent: 300, overBy: 0, covered: 0 } });
    expect(d.workoutCalories.status).toBe("in");
    // Untick the treat: the day is over by 200, which the bank still covers
    expect((await t.api("PATCH", `/api/log/${treat.id}`, { treat: false })).body.entry.treat).toBe(false);
    expect((await dayView()).workoutCalories.bank).toMatchObject({ balance: 300, thisDay: { treatSpent: 0, overBy: 200, covered: 200 } });
  });

  it("water can't be a treat", async () => {
    const water = (await t.api("POST", "/api/log", { day: TODAY, water_ml: 250 })).body.entry;
    const res = await t.api("PATCH", `/api/log/${water.id}`, { treat: true });
    expect([res.status, res.body.error]).toEqual([400, "Water can't be a treat"]);
  });

  it("a treat never combines with the same food logged as a normal entry", async () => {
    const f = (await t.api("POST", "/api/my-foods", { name: "Cookie", servings: [{ label: "1", grams: 30 }], nutrients: { calories: 150 } })).body.food;
    const log = (treat: boolean) => t.api("POST", "/api/log", { day: TODAY, meal: "snacks", food: { kind: "user_food", id: f.id }, servingIndex: 0, unit: "serving", quantity: 1, fraction: 1, treat });
    await log(false);
    expect((await log(true)).body.combined).toBeUndefined();
    expect((await log(false)).body.combined).toBeDefined(); // the normal one grows
    expect((await dayView()).entries.map((e: { treat: boolean; quantity: number }) => [e.treat, e.quantity])).toEqual([
      [false, 2],
      [true, 1],
    ]);
  });

  it("food calories left under the range never go into the bank", async () => {
    await plan("2026-11-01");
    await mode({ mode: "bank" }, "2026-11-15");
    await eat("2026-11-15", 900);
    await eat("2026-11-16", 1000);
    expect((await dayView()).workoutCalories.bank).toMatchObject({ balance: 0, deposited: 0 });
  });

  it("the weekly cap holds deposits", async () => {
    await plan("2026-11-01");
    await mode({ mode: "bank", countPct: 100, weeklyCap: 600 }, "2026-11-15");
    await workout({ day: "2026-11-15", calories: 500 });
    await workout({ day: "2026-11-16", calories: 500 });
    expect((await dayView()).workoutCalories.bank).toMatchObject({ balance: 600, deposited: 600, weeklyCap: 600 });
  });

  it("weekly trends judge the average calories against the day ranges grown by workouts, so the mark agrees with 'N in range'", async () => {
    await plan("2026-11-01");
    await mode({ mode: "add", countPct: 100 }, "2026-11-15");
    for (const d of ["2026-11-15", "2026-11-16", "2026-11-17"]) {
      await workout({ day: d, calories: 500 });
      await eat(d, 2300);
    }
    const [week] = (await t.api("GET", "/api/trends/weekly?weeks=1")).body.weeks;
    expect(week).toMatchObject({ caloriesInRange: 3, avg: { calories: 2300 }, status: { calories: "in" } });
  });

  it("weekly trends in bank mode: the average is judged as the days are, what the bank paid off the maximum (§46)", async () => {
    await plan("2026-11-01");
    await mode({ mode: "bank", countPct: 100 }, "2026-11-15");
    await workout({ day: "2026-11-15", calories: 900 });
    for (const d of ["2026-11-15", "2026-11-16", "2026-11-17"]) await eat(d, 2250); // each over by 250: all covered
    const [week] = (await t.api("GET", "/api/trends/weekly?weeks=1")).body.weeks;
    expect(week).toMatchObject({ caloriesInRange: 3, avg: { calories: 2250 }, status: { calories: "in" } });
  });

  it("weekly trends in bank mode: a treat paid from the bank isn't held against the average either; over the bank is still above (§46)", async () => {
    await plan("2026-11-01");
    await mode({ mode: "bank", countPct: 100 }, "2026-11-15");
    await workout({ day: "2026-11-15", calories: 300 });
    await eat("2026-11-15", 1900);
    await eat("2026-11-15", 300, true); // a treat: from the bank
    await eat("2026-11-16", 2600); // over by 600, nothing left: above
    const [week] = (await t.api("GET", "/api/trends/weekly?weeks=1")).body.weeks;
    // (2200 + 2600) / 2 = 2400; the bank paid 300 of it: 2250 judged against 2,000 - still above, as day 2 is
    expect(week).toMatchObject({ caloriesInRange: 1, avg: { calories: 2400 }, status: { calories: "above" } });
    await workout({ day: "2026-11-16", calories: 600 }); // now Monday's overage is covered too
    const [after] = (await t.api("GET", "/api/trends/weekly?weeks=1")).body.weeks;
    expect(after).toMatchObject({ caloriesInRange: 2, status: { calories: "in" } });
  });

  it("calorie days: each day's calories against its range, with bank-covered days in range (what streaks, badges and goals count)", async () => {
    await plan("2026-11-01");
    await mode({ mode: "bank", countPct: 100 }, "2026-11-15");
    await workout({ day: "2026-11-15", calories: 300 });
    await eat("2026-11-15", 1800); // in
    await eat("2026-11-16", 2200); // over by 200: covered
    await eat("2026-11-17", 2400); // over by 400: only 100 left
    await eat("2026-11-18", 1200); // below
    const { calorieDays } = await import("../src/lib/calorieDays.js");
    const days = await calorieDays(t.app.db, 1, "2026-11-14", TODAY);
    expect(days.map((d) => [d.day, d.status])).toEqual([
      ["2026-11-14", null], // nothing logged
      ["2026-11-15", "in"],
      ["2026-11-16", "in"],
      ["2026-11-17", "above"],
      ["2026-11-18", "below"],
    ]);
    // Weekly trends count them
    const weeks = (await t.api("GET", "/api/trends/weekly?weeks=1")).body.weeks;
    expect(weeks[0]).toMatchObject({ start: "2026-11-15", caloriesInRange: 2 });
  });
});
