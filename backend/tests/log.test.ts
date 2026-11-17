import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestApp, type TestApp } from "./helpers.js";
import { twoUsers } from "./isolation.js";
import { offKnows, offProduct } from "./foodFakes.js";
import { userFoods } from "../src/db/schema.js";

let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
beforeEach(async () => {
  await t.reset();
  await t.login(); // admin "cory", America/Boise
  t.clock.date = new Date("2026-11-17T19:00:00Z"); // noon in Boise
});
afterAll(async () => t.close());

const DAY = "2026-11-17";
const toast = { name: "Toast", servings: [{ label: "2 slices", grams: 60 }], nutrients: { calories: 160, protein_g: 6, carbs_g: 30, fat_g: 2, fiber_g: 4 } };

/** A cereal bar from Open Food Facts: 400 kcal per 100 g, a 40 g bar, no fiber listed. */
async function bar() {
  offKnows(t, { "0012345678905": offProduct("0012345678905", "Crunchy bar", 400) });
  const food = (await t.api("GET", "/api/foods/barcode/0012345678905")).body.food;
  expect(food.servings).toEqual([
    { label: "100 g", grams: 100 },
    { label: "40 g", grams: 40 },
  ]);
  return food;
}
const myFood = async (f = toast) => (await t.api("POST", "/api/my-foods", f)).body.food;
const log = (food: { kind: string; id: number }, portion: Record<string, unknown> = {}, day = DAY, meal = "breakfast") =>
  t.api("POST", "/api/log", { day, meal, food: { kind: food.kind, id: food.id }, servingIndex: 0, unit: "serving", quantity: 1, fraction: 1, ...portion });
const getDay = async (day = DAY) => (await t.api("GET", `/api/day/${day}`)).body;
const steady = { calories: { min: 1810, max: 2110 }, protein_g: { min: 100, max: 140 }, fiber_g: { min: 25, max: 35 }, water_ml: { min: 1893, max: 3785 } };

describe("food log", () => {
  it("logs half a bar and snapshots it", async () => {
    const food = await bar();
    const res = await log(food, { servingIndex: 1, fraction: 0.5 });
    expect(res.status).toBe(200);
    expect(res.body.entry).toEqual({
      id: expect.any(Number),
      day: DAY,
      meal: "breakfast",
      name: "Crunchy bar",
      brand: "Acme",
      icon: food.icon,
      servingIndex: 1,
      unit: "serving",
      quantity: 1,
      fraction: 0.5,
      servings: food.servings,
      nutrients: { calories: 80, protein_g: 2, carbs_g: 10, fat_g: 4 },
      aiEstimated: false,
      source: "cache",
      sourceRef: `cache:${food.id}`,
    });
    expect((await getDay()).entries).toEqual([res.body.entry]);
  });

  it("logging your own food counts as using it", async () => {
    const food = await myFood();
    await log(food);
    await log(food);
    const [row] = await t.db.select().from(userFoods).where(eq(userFoods.id, food.id));
    expect(row.useCount).toBe(2);
    expect(row.lastUsedAt?.toISOString()).toBe("2026-11-17T19:00:00.000Z");
    expect((await log({ kind: "user_food", id: 99999 })).status).toBe(404);
    expect((await log({ kind: "cache", id: 99999 })).status).toBe(404);
  });

  it("editing the source food later doesn't change the logged entry", async () => {
    const food = await myFood();
    const entry = (await log(food, { quantity: 2 })).body.entry;
    expect(entry.nutrients.calories).toBe(320);
    expect(entry.sourceRef).toBe(`user_food:${food.id}`);
    expect((await t.api("PATCH", `/api/my-foods/${food.id}`, { name: "Rye toast", servings: [{ label: "1 slice", grams: 30 }], nutrients: { calories: 999 } })).status).toBe(200);
    expect((await getDay()).entries).toEqual([entry]);
    // ...and editing the entry re-reads only its snapshot
    const patched = await t.api("PATCH", `/api/log/${entry.id}`, { servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 });
    expect(patched.body.entry).toMatchObject({ name: "Toast", servings: toast.servings, nutrients: toast.nutrients });
  });

  it("PATCH portion rescales from the snapshot", async () => {
    const food = await bar();
    const entry = (await log(food, { servingIndex: 1 })).body.entry;
    expect(entry.nutrients.calories).toBe(160);
    const grams = await t.api("PATCH", `/api/log/${entry.id}`, { servingIndex: 0, unit: "g", quantity: 50, fraction: 1 });
    expect(grams.status).toBe(200);
    expect(grams.body.entry).toMatchObject({ unit: "g", quantity: 50, fraction: 1, nutrients: { calories: 200, protein_g: 5 } });
    const quarter = await t.api("PATCH", `/api/log/${entry.id}`, { fraction: 0.25 });
    expect(quarter.body.entry).toMatchObject({ unit: "g", quantity: 50, fraction: 0.25, nutrients: { calories: 50 } });
    expect((await t.api("PATCH", `/api/log/${entry.id}`, { fraction: 0 })).status).toBe(400);
    expect((await t.api("PATCH", `/api/log/${entry.id}`, { fraction: 1.5 })).status).toBe(400);
    expect((await t.api("PATCH", `/api/log/${entry.id}`, { quantity: -1 })).status).toBe(400);
    expect((await t.api("PATCH", `/api/log/${entry.id}`, { unit: "cup" })).body).toEqual({ error: "Can't measure this food in cup" });
    expect((await getDay()).entries[0].nutrients.calories).toBe(50);
    expect((await t.api("DELETE", `/api/log/${entry.id}`)).status).toBe(204);
    expect((await getDay()).entries).toEqual([]);
    expect((await t.api("DELETE", `/api/log/${entry.id}`)).status).toBe(404);
    expect((await t.api("PATCH", `/api/log/${entry.id}`, { fraction: 1 })).status).toBe(404);
  });

  it("move and copy entries to another day and meal", async () => {
    const food = await myFood();
    const a = (await log(food)).body.entry;
    const b = (await log(food, { quantity: 2 })).body.entry;

    const moved = await t.api("POST", "/api/log/move", { ids: [a.id], day: "2026-11-18", meal: "lunch", copy: false });
    expect(moved.status).toBe(200);
    expect(moved.body.entries).toEqual([{ ...a, day: "2026-11-18", meal: "lunch" }]);

    const copied = await t.api("POST", "/api/log/move", { ids: [b.id], day: "2026-11-18", meal: "dinner", copy: true });
    expect(copied.body.entries).toEqual([{ ...b, id: expect.any(Number), day: "2026-11-18", meal: "dinner" }]);
    expect(copied.body.entries[0].id).not.toBe(b.id);

    expect((await getDay()).entries).toEqual([b]);
    expect((await getDay("2026-11-18")).entries.map((e: any) => [e.id, e.meal])).toEqual([
      [a.id, "lunch"],
      [copied.body.entries[0].id, "dinner"],
    ]);
    expect((await t.api("POST", "/api/log/move", { ids: [], day: DAY, meal: "lunch", copy: false })).status).toBe(400);
  });

  it("can't move someone else's entry (404, nothing moved)", async () => {
    const { a, b } = await twoUsers(t);
    const annaFood = (await a.as("POST", "/api/my-foods", toast)).body.food;
    const benFood = (await b.as("POST", "/api/my-foods", toast)).body.food;
    const body = (food: any) => ({ day: DAY, meal: "breakfast", food: { kind: "user_food", id: food.id }, servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 });
    const annas = (await a.as("POST", "/api/log", body(annaFood))).body.entry;
    const bens = (await b.as("POST", "/api/log", body(benFood))).body.entry;

    for (const copy of [false, true]) {
      const res = await b.as("POST", "/api/log/move", { ids: [bens.id, annas.id], day: "2026-11-18", meal: "dinner", copy });
      expect(res.status).toBe(404);
    }
    expect((await b.as("GET", `/api/day/${DAY}`)).body.entries).toEqual([bens]);
    expect((await b.as("GET", "/api/day/2026-11-18")).body.entries).toEqual([]);
    expect((await a.as("GET", `/api/day/${DAY}`)).body.entries).toEqual([annas]);
  });

  it("day view totals, per-meal totals, suggested calories and unknown counts", async () => {
    const empty = await getDay();
    expect(empty.meals.breakfast).toEqual({ calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, suggested: null });
    expect(empty.targets).toBeNull();
    expect(empty.totals.unknownCount).toEqual({});

    expect((await t.api("PUT", "/api/targets", steady)).status).toBe(200);
    const food = await bar(); // no fiber
    await log(food, { servingIndex: 1 }, DAY, "breakfast"); // 160 kcal, 4 g protein, 20 g carbs, 8 g fat
    await log(await myFood(), {}, DAY, "lunch"); // 160 kcal, 6 g protein, 4 g fiber
    expect((await t.api("POST", "/api/log", { day: DAY, meal: "supplements", water_ml: 473 })).status).toBe(200);

    const day = await getDay();
    expect(day.day).toBe(DAY);
    expect(day.totals).toMatchObject({ calories: 320, protein_g: 10, carbs_g: 50, fat_g: 10, fiber_g: 4, water_ml: 473 });
    // the bar lacks fiber; the water entry is never "unknown" for food nutrients
    expect(day.totals.unknownCount.fiber_g).toBe(1);
    expect(day.totals.unknownCount.protein_g).toBeUndefined();
    expect(day.totals.unknownCount.calories).toBeUndefined();
    expect(day.meals).toEqual({
      breakfast: { calories: 160, protein_g: 4, carbs_g: 20, fat_g: 8, fiber_g: 0, suggested: 392 },
      lunch: { calories: 160, protein_g: 6, carbs_g: 30, fat_g: 2, fiber_g: 4, suggested: 490 },
      dinner: { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, suggested: 686 },
      snacks: { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, suggested: 392 },
      supplements: { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, suggested: null },
    });
    expect(day.targets).toMatchObject({ calories: { min: 1810, max: 2110 } });
    expect(day.streak).toBe(1);
    expect((await t.api("GET", "/api/day/2026-02-30")).status).toBe(400);
  });

  it("exercise is shown as 0 and never changes targets", async () => {
    await t.api("PUT", "/api/targets", steady);
    const day = await getDay();
    expect(day.exercise).toEqual({ calories: 0 });
    expect(day.targets).toEqual((await t.api("GET", `/api/targets?day=${DAY}`)).body.targets);
    expect(day.targets.calories).toEqual(steady.calories);
  });

  it("water quick add", async () => {
    const res = await t.api("POST", "/api/log", { day: DAY, meal: "supplements", water_ml: 237 });
    expect(res.status).toBe(200);
    expect(res.body.entry).toEqual({
      id: expect.any(Number),
      day: DAY,
      meal: "supplements",
      name: "Water",
      brand: null,
      icon: "💧",
      servingIndex: 0,
      unit: "ml",
      quantity: 237,
      fraction: 1,
      servings: [{ label: "1 ml", ml: 1 }],
      nutrients: { water_ml: 237 },
      aiEstimated: false,
      source: "water",
      sourceRef: null,
    });
    // a water entry's amount can be changed like any other
    const more = await t.api("PATCH", `/api/log/${res.body.entry.id}`, { servingIndex: 0, unit: "ml", quantity: 473, fraction: 1 });
    expect(more.body.entry.nutrients).toEqual({ water_ml: 473 });
    expect((await getDay()).totals.water_ml).toBe(473);
    expect((await t.api("POST", "/api/log", { day: DAY, meal: "supplements", water_ml: 0 })).status).toBe(400);
    expect((await t.api("POST", "/api/log", { day: DAY, meal: "lunch", water_ml: 237 })).status).toBe(400);
  });

  it("ml on a mass-only food is 400 with a clear message", async () => {
    const food = await bar();
    const res = await log(food, { unit: "ml", quantity: 100 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Can't measure this food in ml" });
    expect((await log(food, { servingIndex: 5 })).status).toBe(400);
    expect((await getDay()).entries).toEqual([]);
  });

  it("recent and frequent foods", async () => {
    const cached = await bar();
    const mine = await myFood();
    const gone = await myFood({ ...toast, name: "Old toast" });
    await log(cached, { servingIndex: 1 }, "2026-08-01"); // over 60 days ago: recent, not frequent
    await log(gone, {}, "2026-11-10");
    await log(cached, { servingIndex: 1, fraction: 0.5 }, "2026-11-15");
    await log(cached, { unit: "g", servingIndex: 0, quantity: 30 }, "2026-11-16");
    await log(mine, { quantity: 2 }, "2026-11-16");
    await log(mine, { quantity: 1 }, "2026-11-17");
    await t.api("POST", "/api/log", { day: DAY, meal: "supplements", water_ml: 237 });
    expect((await t.api("DELETE", `/api/my-foods/${gone.id}`)).status).toBe(204); // archived: skipped

    const recent = (await t.api("GET", "/api/foods/recent")).body.foods;
    expect(recent.map((f: any) => `${f.kind}:${f.id}`)).toEqual([`user_food:${mine.id}`, `cache:${cached.id}`]);
    expect(recent[0]).toEqual({ ...mine, last: { servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 } });
    expect(recent[1]).toEqual({ ...cached, last: { servingIndex: 0, unit: "g", quantity: 30, fraction: 1 } });

    const frequent = (await t.api("GET", "/api/foods/frequent")).body.foods;
    // the bar 2 times and toast 2 times in the window; a tie goes to the one used last
    expect(frequent.map((f: any) => `${f.kind}:${f.id}`)).toEqual([`user_food:${mine.id}`, `cache:${cached.id}`]);
    await log(cached, { servingIndex: 1 }, "2026-11-17");
    const again = (await t.api("GET", "/api/foods/frequent")).body.foods;
    expect(again.map((f: any) => `${f.kind}:${f.id}`)).toEqual([`cache:${cached.id}`, `user_food:${mine.id}`]);
    expect(again[0].last).toEqual({ servingIndex: 1, unit: "serving", quantity: 1, fraction: 1 });
  });
});
