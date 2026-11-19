import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";
import { targets, weighIns } from "../src/db/schema.js";
import { trendOf } from "../src/lib/weight.js";

let t: TestApp;
let userId: number;
let toastId: number;
beforeAll(async () => (t = await setupTestApp()));
beforeEach(async () => {
  await t.reset();
  userId = (await t.login()).id; // admin "alex", America/Denver
  t.clock.date = new Date("2026-11-17T19:00:00Z"); // noon Tuesday Nov 17 in Denver
  toastId = (await t.api("POST", "/api/my-foods", toast)).body.food.id;
});
afterAll(async () => t.close());

const toast = { name: "Toast", servings: [{ label: "2 slices", grams: 60 }], nutrients: { calories: 160, protein_g: 6, fiber_g: 4 } };
const logToast = async (day: string, foodId = toastId) => {
  const r = await t.api("POST", "/api/log", { day, meal: "breakfast", food: { kind: "user_food", id: foodId }, servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 });
  expect(r.status).toBe(200);
};
const logWater = async (day: string, water_ml: number) => expect((await t.api("POST", "/api/log", { day, meal: "supplements", water_ml })).status).toBe(200);
const weekly = async (q = "") => (await t.api("GET", `/api/trends/weekly${q}`)).body.weeks;
const streakNow = async () => (await t.api("GET", "/api/day/today")).body.streak;
const NULLS = { calories: null, protein_g: null, fiber_g: null, water_ml: null };

describe("trend (pure)", () => {
  it("smooths by days between weigh-ins: trend0 = w0, trend += (w - trend) * (1 - 0.9^gap)", () => {
    const s = trendOf([
      { day: "2026-11-08", weightKg: 98 },
      { day: "2026-11-01", weightKg: 100 },
    ]);
    expect(s.map((p) => p.day)).toEqual(["2026-11-01", "2026-11-08"]);
    expect(s[0].trendKg).toBe(100);
    expect(s[1].trendKg).toBeCloseTo(100 + (98 - 100) * (1 - 0.9 ** 7), 10);
    expect(trendOf([])).toEqual([]);
  });
});

describe("weekly trends", () => {
  it("averages over days with food logged only; a week with nothing is all nulls; Sunday weeks by default", async () => {
    await logToast("2026-11-16");
    await logToast("2026-11-17");
    await logToast("2026-11-17");
    await logWater("2026-11-16", 1000);
    await logWater("2026-11-15", 500); // water only: not a logged day, and its water isn't counted
    const weeks = await weekly("?weeks=2");
    expect(weeks).toEqual([
      {
        start: "2026-11-15",
        end: "2026-11-21",
        daysLogged: 2,
        caloriesInRange: 0, // no targets: no day is judged
        avg: { calories: 240, protein_g: 9, fiber_g: 6, water_ml: 1000 }, // water: over logged days with water logged
        status: NULLS, // no targets
        weightChangeKg: null,
      },
      { start: "2026-11-08", end: "2026-11-14", daysLogged: 0, caloriesInRange: 0, avg: NULLS, status: NULLS, weightChangeKg: null },
    ]);
    expect(await weekly()).toHaveLength(12);
    expect((await t.api("GET", "/api/trends/weekly?weeks=0")).status).toBe(400);
    expect((await t.api("GET", "/api/trends/weekly?weeks=abc")).status).toBe(400);
  });

  it("week boundaries follow the person's week start", async () => {
    await logToast("2026-11-16"); // Monday
    await logToast("2026-11-17"); // Tuesday
    await logToast("2026-11-17");
    const settings = { mealWindows: { breakfast: "10:30", lunch: "14:30", snacks: "17:00", dinner: "21:00" }, waterButtonsMl: [237], weekStart: 2 };
    expect((await t.api("PUT", "/api/settings/me", settings)).status).toBe(200);
    const weeks = await weekly("?weeks=2");
    expect(weeks.map((w: any) => [w.start, w.end, w.daysLogged, w.avg.calories])).toEqual([
      ["2026-11-17", "2026-11-23", 1, 320],
      ["2026-11-10", "2026-11-16", 1, 160],
    ]);
  });

  it("a nutrient no logged food had stays unknown, not zero", async () => {
    const plain = (await t.api("POST", "/api/my-foods", { name: "Mystery bar", servings: [{ label: "1 bar", grams: 40 }], nutrients: { calories: 100 } })).body.food;
    await logToast("2026-11-16", plain.id);
    await logToast("2026-11-17", plain.id);
    await logToast("2026-11-17"); // toast has fiber: only that day counts toward fiber
    const [w] = await weekly("?weeks=1");
    expect(w.avg).toEqual({ calories: 180, protein_g: 6, fiber_g: 4, water_ml: null }); // no water logged either
  });

  it("judges each average against the targets in force", async () => {
    const t1 = { userId, plan: null, caloriesMin: 200, caloriesMax: 300, proteinMin: 10, proteinMax: 20, fiberMin: 1, fiberMax: 5, waterMin: 400, waterMax: 600 };
    await t.db.insert(targets).values([
      { ...t1, effectiveFrom: "2026-11-01" },
      { ...t1, effectiveFrom: "2026-11-15", caloriesMin: 100, caloriesMax: 150 }, // this week's
    ]);
    await logToast("2026-11-16");
    await logToast("2026-11-17");
    await logToast("2026-11-17");
    await logWater("2026-11-16", 500);
    await logToast("2026-11-10");
    const [now, before] = await weekly("?weeks=2");
    expect(now.status).toEqual({ calories: "above", protein_g: "below", fiber_g: "above", water_ml: "in" });
    expect(before.avg).toEqual({ calories: 160, protein_g: 6, fiber_g: 4, water_ml: null });
    expect(before.status).toEqual({ calories: "below", protein_g: "below", fiber_g: "in", water_ml: null });
  });

  it("each week's weight change is the change in trend weight; no weigh-in that week = null", async () => {
    await t.db.insert(weighIns).values([
      { userId, day: "2026-11-01", weightKg: 100 },
      { userId, day: "2026-11-08", weightKg: 98 },
      { userId, day: "2026-11-16", weightKg: 97 },
    ]);
    const t1 = 100 + (98 - 100) * (1 - 0.9 ** 7);
    const t2 = t1 + (97 - t1) * (1 - 0.9 ** 8);
    const weeks = await weekly("?weeks=4");
    expect(weeks.map((w: any) => w.start)).toEqual(["2026-11-15", "2026-11-08", "2026-11-01", "2026-10-25"]);
    expect(weeks[0].weightChangeKg).toBeCloseTo(t2 - t1, 3);
    expect(weeks[1].weightChangeKg).toBeCloseTo(t1 - 100, 3);
    expect(weeks[2].weightChangeKg).toBe(0); // the first weigh-in: nothing to change from yet
    expect(weeks[3].weightChangeKg).toBeNull();
  });
});

describe("vacations and the streak", () => {
  it("adds, lists and removes vacations; from must not be after to, at most 60 days", async () => {
    const add = (from: string, to: string) => t.api("POST", "/api/vacations", { from, to });
    const v = await add("2026-12-20", "2027-01-02");
    expect(v.status).toBe(200);
    expect(v.body.vacation).toEqual({ id: expect.any(Number), from: "2026-12-20", to: "2027-01-02" });
    expect((await add("2026-11-01", "2026-12-30")).status).toBe(200); // 60 days
    expect((await add("2026-11-01", "2026-12-31")).body).toEqual({ error: "A vacation can be at most 60 days" });
    expect((await add("2026-11-10", "2026-11-09")).body).toEqual({ error: "The end can't be before the start" });
    expect((await add("2026-02-30", "2026-03-01")).status).toBe(400);
    const list = (await t.api("GET", "/api/vacations")).body.vacations;
    expect(list.map((x: any) => x.from)).toEqual(["2026-12-20", "2026-11-01"]); // newest first
    expect((await t.api("DELETE", `/api/vacations/${v.body.vacation.id}`)).status).toBe(204);
    expect((await t.api("DELETE", `/api/vacations/${v.body.vacation.id}`)).status).toBe(404);
    expect((await t.api("GET", "/api/vacations")).body.vacations.map((x: any) => x.from)).toEqual(["2026-11-01"]);
  });

  it("vacation days without food neither count nor break the streak; removing the vacation recomputes it", async () => {
    for (const d of ["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-16", "2026-11-17"]) await logToast(d);
    expect(await streakNow()).toBe(2);
    const v = (await t.api("POST", "/api/vacations", { from: "2026-11-13", to: "2026-11-15" })).body.vacation;
    expect(await streakNow()).toBe(5); // 13-15 skipped, not counted
    expect((await t.api("DELETE", `/api/vacations/${v.id}`)).status).toBe(204);
    expect(await streakNow()).toBe(2);
    // a vacation day with food still counts
    await t.api("POST", "/api/vacations", { from: "2026-11-11", to: "2026-11-15" });
    expect(await streakNow()).toBe(5);
  });

  it("a vacation reaching today lets an empty today and yesterday keep the streak", async () => {
    for (const d of ["2026-11-13", "2026-11-14", "2026-11-15"]) await logToast(d);
    expect(await streakNow()).toBe(0);
    await t.api("POST", "/api/vacations", { from: "2026-11-16", to: "2026-11-20" });
    expect(await streakNow()).toBe(3);
  });
});
