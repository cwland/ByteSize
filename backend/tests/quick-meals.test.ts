import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { setupTestApp, type TestApp } from "./helpers.js";
import { offKnows, offProduct } from "./foodFakes.js";
import { logEntries, userFoods } from "../src/db/schema.js";

let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
beforeEach(async () => {
  await t.reset();
  await t.login(); // admin "cory", America/Boise
  t.clock.date = new Date("2026-11-17T19:00:00Z"); // noon in Boise
});
afterAll(async () => t.close());

const DAY = "2026-11-17";
const toast = { name: "Toast", servings: [{ label: "1 slice", grams: 30 }], nutrients: { calories: 80, protein_g: 3, carbs_g: 15, fiber_g: 2 } };
const egg = { name: "Egg", servings: [{ label: "1 large", grams: 50 }], nutrients: { calories: 70, protein_g: 6, fat_g: 5 } };
const mine = async (f: object) => (await t.api("POST", "/api/my-foods", f)).body.food;
const item = (food: { kind: string; id: number }, portion: Record<string, unknown> = {}) => ({ food: { kind: food.kind, id: food.id }, servingIndex: 0, unit: "serving", quantity: 1, fraction: 1, ...portion });
async function cachedBar() {
  offKnows(t, { "0012345678905": offProduct("0012345678905", "Crunchy bar", 400) });
  return (await t.api("GET", "/api/foods/barcode/0012345678905")).body.food; // 400 kcal / 100 g, a 40 g bar
}

/** Breakfast: 2 slices of toast, 2 eggs, half a cereal bar. */
async function breakfast() {
  const tst = await mine(toast);
  const e = await mine(egg);
  const bar = await cachedBar();
  const r = await t.api("POST", "/api/my-foods/meals", { name: "Usual breakfast", items: [item(tst, { quantity: 2 }), item(e, { quantity: 2 }), item(bar, { servingIndex: 1, fraction: 0.5 })] });
  expect(r.status).toBe(200);
  return { tst, e, bar, meal: r.body.food };
}
const logMeal = (body: Record<string, unknown>) => t.api("POST", "/api/log/meal", { day: DAY, meal: "breakfast", ...body });
const getDay = async (day = DAY) => (await t.api("GET", `/api/day/${day}`)).body;

describe("quick meals", () => {
  it("a quick meal is '1 meal' with its items' totals; unknown stays unknown", async () => {
    const { meal, bar } = await breakfast();
    expect(meal).toMatchObject({
      kind: "user_food",
      foodKind: "quick_meal",
      name: "Usual breakfast",
      servings: [{ label: "1 meal" }],
    });
    // toast 160 kcal 6 g protein, eggs 140 / 12, half a bar 80 / 2; carbs, fat and fiber are unknown on one item or more
    expect(meal.nutrients).toEqual({ calories: 380, protein_g: 20 });
    expect(meal.items.map((i: any) => [i.name, i.quantity, i.nutrients.calories])).toEqual([
      ["Toast", 2, 160],
      ["Egg", 2, 140],
      ["Crunchy bar", 1, 80],
    ]);
    expect(meal.items[2]).toMatchObject({ food: { kind: "cache", id: bar.id }, servingIndex: 1, fraction: 0.5, available: true });
  });

  it("a quick meal can't contain another quick meal, but may contain a recipe", async () => {
    const { meal, tst } = await breakfast();
    const r = await t.api("POST", "/api/my-foods/meals", { name: "Big", items: [item(meal)] });
    expect(r).toMatchObject({ status: 400, body: { error: "A quick meal can't contain another quick meal" } });
    const recipe = (await t.api("POST", "/api/my-foods/recipes", { name: "French toast", items: [item(tst, { quantity: 4 })], servings: 2 })).body.food;
    const ok = await t.api("PUT", `/api/my-foods/meals/${meal.id}`, { name: "Brunch", items: [item(recipe)] });
    expect(ok.status).toBe(200);
    expect(ok.body.food).toMatchObject({ id: meal.id, name: "Brunch", nutrients: { calories: 160, protein_g: 6, carbs_g: 30, fiber_g: 4 } });
    expect((await t.api("PUT", `/api/my-foods/meals/${recipe.id}`, { name: "x", items: [item(tst)] })).status).toBe(404);
  });

  it("logging a meal makes one adjustable entry per item, marked with the meal", async () => {
    const { meal, tst, e, bar } = await breakfast();
    const r = await logMeal({ foodId: meal.id });
    expect(r.status).toBe(200);
    expect(r.body.entries.map((x: any) => [x.name, x.sourceRef, x.quantity, x.nutrients.calories])).toEqual([
      ["Toast", `user_food:${tst.id}`, 2, 160],
      ["Egg", `user_food:${e.id}`, 2, 140],
      ["Crunchy bar", `cache:${bar.id}`, 1, 80],
    ]);
    expect(r.body.entries[2]).toMatchObject({ servingIndex: 1, fraction: 0.5, meal: "breakfast", day: DAY, servings: bar.servings });
    const rows = await t.db.select().from(logEntries);
    expect(rows.map((x) => x.groupRef)).toEqual([`quick:${meal.id}`, `quick:${meal.id}`, `quick:${meal.id}`]);
    // each entry is its own: edit one
    const p = await t.api("PATCH", `/api/log/${r.body.entries[0].id}`, { quantity: 1 });
    expect(p.body.entry.nutrients.calories).toBe(80);
    expect((await getDay()).entries).toHaveLength(3);
    // logging counts as using the meal
    const [m] = await t.db.select().from(userFoods).where(eq(userFoods.id, meal.id));
    expect(m.useCount).toBe(1);
  });

  it("items adjusted before logging change only that log", async () => {
    const { meal, tst, e } = await breakfast();
    const r = await logMeal({ foodId: meal.id, items: [item(tst, { quantity: 1 }), item(e, { quantity: 3 })] });
    expect(r.status).toBe(200);
    expect(r.body.entries.map((x: any) => [x.name, x.nutrients.calories])).toEqual([
      ["Toast", 80],
      ["Egg", 210],
    ]);
    expect((await t.api("GET", `/api/my-foods/${meal.id}`)).body.food.items).toHaveLength(3);
    const bad = await logMeal({ foodId: meal.id, items: [item(tst, { unit: "ml", quantity: 5 })] });
    expect(bad).toMatchObject({ status: 400, body: { error: "Choose an amount this food can be measured in" } });
    expect((await logMeal({ foodId: meal.id, items: [] })).status).toBe(400);
  });

  it("an item whose food was archived or deleted still logs from its snapshot", async () => {
    const { meal, tst, e } = await breakfast();
    await logMeal({ foodId: meal.id }); // used: archived, not deleted
    expect(await t.api("DELETE", `/api/my-foods/${tst.id}`)).toMatchObject({ status: 200, body: { archived: true } });
    await t.db.delete(userFoods).where(eq(userFoods.id, e.id)); // gone altogether
    const r = await logMeal({ foodId: meal.id, day: "2026-11-18" });
    expect(r.status).toBe(200);
    expect(r.body.entries.map((x: any) => [x.name, x.sourceRef, x.nutrients])).toEqual([
      ["Toast", `user_food:${tst.id}`, { calories: 160, protein_g: 6, carbs_g: 30, fiber_g: 4 }],
      ["Egg", `user_food:${e.id}`, { calories: 140, protein_g: 12, fat_g: 10 }],
      ["Crunchy bar", expect.any(String), { calories: 80, protein_g: 2, carbs_g: 10, fat_g: 4 }],
    ]);
    // ...and stays adjustable (its servings came along)
    const p = await t.api("PATCH", `/api/log/${r.body.entries[1].id}`, { unit: "g", quantity: 25 });
    expect(p.body.entry.nutrients).toEqual({ calories: 35, protein_g: 3, fat_g: 2.5 });
    // Adjusted items may still name the archived food, from the meal's own snapshot
    const adj = await logMeal({ foodId: meal.id, items: [item(tst, { quantity: 3 })] });
    expect(adj.body.entries.map((x: any) => x.nutrients.calories)).toEqual([240]);
  });

  it("only the caller's own active quick meal can be logged", async () => {
    const { meal, tst } = await breakfast();
    expect((await logMeal({ foodId: tst.id })).status).toBe(404);
    expect((await logMeal({ foodId: 99999 })).status).toBe(404);
    await t.api("DELETE", `/api/my-foods/${meal.id}`);
    expect((await logMeal({ foodId: meal.id })).status).toBe(404);
  });

  it("without a meal it goes to the meal for the time of day", async () => {
    const { meal } = await breakfast();
    const r = await t.api("POST", "/api/log/meal", { foodId: meal.id });
    expect(r.status).toBe(200);
    expect(r.body.entries[0]).toMatchObject({ day: DAY, meal: "lunch" });
  });

  it("Recently tracked shows the quick meal once, not its items for that use; frequent counts uses", async () => {
    const { meal, tst, e } = await breakfast();
    await t.api("POST", "/api/log", { day: "2026-11-16", meal: "breakfast", food: { kind: "user_food", id: e.id }, servingIndex: 0, unit: "serving", quantity: 3, fraction: 1 });
    await logMeal({ foodId: meal.id, day: "2026-11-16" });
    await logMeal({ foodId: meal.id });
    const recent = (await t.api("GET", "/api/foods/recent")).body.foods;
    expect(recent.map((f: any) => `${f.foodKind}:${f.id}`)).toEqual([`quick_meal:${meal.id}`, `custom:${e.id}`]);
    const { items: _items, notes: _n, recipeServings: _r, servingGrams: _g, ...plain } = meal;
    expect(recent[0]).toEqual({ ...plain, last: { servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 } });
    expect(recent[1].last.quantity).toBe(3);
    expect((await t.api("GET", "/api/foods/recent?meal=breakfast")).body.foods.map((f: any) => f.id)).toEqual([meal.id, e.id]);
    expect((await t.api("GET", "/api/foods/recent?meal=lunch")).body.foods).toEqual([]);

    // Frequent: the meal was used twice (6 entries), the egg once on its own
    await t.api("POST", "/api/log", { day: DAY, meal: "lunch", food: { kind: "user_food", id: tst.id }, servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 });
    await t.api("POST", "/api/log", { day: DAY, meal: "lunch", food: { kind: "user_food", id: tst.id }, servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 });
    await t.api("POST", "/api/log", { day: DAY, meal: "lunch", food: { kind: "user_food", id: tst.id }, servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 });
    const frequent = (await t.api("GET", "/api/foods/frequent")).body.foods;
    expect(frequent.map((f: any) => f.id)).toEqual([tst.id, meal.id, e.id]);

    // An archived quick meal drops out of recents
    await t.api("DELETE", `/api/my-foods/${meal.id}`);
    expect((await t.api("GET", "/api/foods/recent")).body.foods.map((f: any) => f.id)).toEqual([tst.id, e.id]);
  });

  it("copying a meal's entries (Same as yesterday) copies items, so recents show the items", async () => {
    const { meal, tst, e, bar } = await breakfast();
    const r = await logMeal({ foodId: meal.id, day: "2026-11-16" });
    const ids = r.body.entries.map((x: any) => x.id);
    const moved = await t.api("POST", "/api/log/move", { ids, day: DAY, meal: "breakfast", copy: true });
    expect(moved.status).toBe(200);
    const copies = await t.db.select().from(logEntries).where(eq(logEntries.day, DAY));
    expect(copies.map((c) => c.groupRef)).toEqual([null, null, null]);
    const recent = (await t.api("GET", "/api/foods/recent")).body.foods.map((f: any) => `${f.kind}:${f.id}`);
    expect(recent).toEqual(expect.arrayContaining([`user_food:${tst.id}`, `user_food:${e.id}`, `cache:${bar.id}`]));
    expect(recent).toHaveLength(4); // the three items (the copy) and the meal (yesterday's use)
  });
});

describe("save as a meal", () => {
  it("copies each entry's food and portion; leaves out water and vanished foods, by name", async () => {
    const tst = await mine(toast);
    const e = await mine(egg);
    const bar = await cachedBar();
    const gone = await mine({ ...toast, name: "Bagel" });
    const log = (food: any, portion: Record<string, unknown>) =>
      t.api("POST", "/api/log", { day: DAY, meal: "breakfast", food: { kind: food.kind, id: food.id }, servingIndex: 0, unit: "serving", quantity: 1, fraction: 1, ...portion });
    const a = (await log(tst, { quantity: 2 })).body.entry;
    const b = (await log(e, { unit: "g", quantity: 75 })).body.entry;
    const c = (await log(bar, { servingIndex: 1, fraction: 0.5 })).body.entry;
    const g = (await log(gone, {})).body.entry;
    const w = (await t.api("POST", "/api/log", { day: DAY, meal: "supplements", water_ml: 500 })).body.entry;
    await t.api("DELETE", `/api/my-foods/${gone.id}`); // logged: archived, can't be found

    const r = await t.api("POST", "/api/my-foods/meals/from-entries", { name: "Monday breakfast", ids: [a.id, b.id, w.id, c.id, g.id] });
    expect(r.status).toBe(200);
    expect(r.body.leftOut).toEqual(["Water", "Bagel"]);
    expect(r.body.food).toMatchObject({ foodKind: "quick_meal", name: "Monday breakfast", servings: [{ label: "1 meal" }] });
    expect(r.body.food.items.map((i: any) => [i.food, i.servingIndex, i.unit, i.quantity, i.fraction])).toEqual([
      [{ kind: "user_food", id: tst.id }, 0, "serving", 2, 1],
      [{ kind: "user_food", id: e.id }, 0, "g", 75, 1],
      [{ kind: "cache", id: bar.id }, 1, "serving", 1, 0.5],
    ]);
    // The saved meal's items equal what was logged
    expect(r.body.food.items.map((i: any) => i.nutrients)).toEqual([a.nutrients, b.nutrients, c.nutrients]);
    expect(r.body.food.nutrients.calories).toBe(a.nutrients.calories + b.nutrients.calories + c.nutrients.calories);
  });

  it("nothing left to save, or an entry that isn't yours, is an error", async () => {
    const w = (await t.api("POST", "/api/log", { day: DAY, meal: "supplements", water_ml: 500 })).body.entry;
    const r = await t.api("POST", "/api/my-foods/meals/from-entries", { name: "Water", ids: [w.id] });
    expect(r).toMatchObject({ status: 400, body: { error: "Nothing here can be saved as a meal" } });
    expect((await t.api("POST", "/api/my-foods/meals/from-entries", { name: "x", ids: [w.id, 99999] })).status).toBe(404);
    expect((await t.api("POST", "/api/my-foods/meals/from-entries", { name: "x", ids: [] })).status).toBe(400);
    expect((await t.db.execute(sql`select count(*)::int as n from user_foods`)).rows[0]).toEqual({ n: 0 });
  });
});

describe("quick meals are logged only through /api/log/meal", () => {
  it("POST /api/log refuses a quick meal (it would be one opaque entry)", async () => {
    const { meal } = await breakfast();
    const r = await t.api("POST", "/api/log", { day: DAY, meal: "breakfast", food: { kind: "user_food", id: meal.id }, servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 });
    expect(r).toMatchObject({ status: 400, body: { error: "Log a quick meal with its own items" } });
    expect((await getDay()).entries).toEqual([]);
    // a recipe is still logged as one food
    const tst = await mine({ ...toast, name: "Rye" });
    const recipe = (await t.api("POST", "/api/my-foods/recipes", { name: "Toast stack", items: [item(tst, { quantity: 2 })], servings: 1 })).body.food;
    expect((await t.api("POST", "/api/log", { day: DAY, meal: "breakfast", food: { kind: "user_food", id: recipe.id }, servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 })).status).toBe(200);
  });

  it("save as a meal leaves out an entry its food can no longer measure", async () => {
    const tst = await mine(toast);
    const e = await mine(egg);
    const log = (food: any, portion: Record<string, unknown>) =>
      t.api("POST", "/api/log", { day: DAY, meal: "breakfast", food: { kind: food.kind, id: food.id }, servingIndex: 0, unit: "serving", quantity: 1, fraction: 1, ...portion });
    const a = (await log(tst, { unit: "g", quantity: 60 })).body.entry;
    const b = (await log(e, {})).body.entry;
    await t.api("PATCH", `/api/my-foods/${tst.id}`, { servings: [{ label: "1 slice" }] }); // no weight any more
    const r = await t.api("POST", "/api/my-foods/meals/from-entries", { name: "x", ids: [a.id, b.id] });
    expect(r.status).toBe(200);
    expect(r.body.leftOut).toEqual(["Toast"]);
    expect(r.body.food.items.map((i: any) => i.name)).toEqual(["Egg"]);
  });
});
