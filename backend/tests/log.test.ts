import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { setupTestApp, type TestApp } from "./helpers.js";
import { twoUsers } from "./isolation.js";
import { offKnows, offProduct } from "./foodFakes.js";
import { logEntries, userFoods } from "../src/db/schema.js";

let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
beforeEach(async () => {
  await t.reset();
  await t.login(); // admin "alex", America/Denver
  t.clock.date = new Date("2026-11-17T19:00:00Z"); // noon in Denver
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
      imageUrl: null,
      servingIndex: 1,
      unit: "serving",
      quantity: 1,
      fraction: 0.5,
      servings: food.servings,
      nutrients: { calories: 80, protein_g: 2, carbs_g: 10, fat_g: 4 },
      aiEstimated: false,
      source: "cache",
      sourceRef: `cache:${food.id}`,
      treat: false,
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
    // the snapshot as logged: its own serving plus "1 slice" worked out from "2 slices" (L1)
    expect(patched.body.entry).toMatchObject({ name: "Toast", servings: [...toast.servings, { label: "1 slice", grams: 30, derived: true }], nutrients: toast.nutrients });
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

  it("an entry keeps the food's photo, so the log shows what search showed (copies keep it too)", async () => {
    offKnows(t, { "0099999999999": offProduct("0099999999999", "Banana", 89, { categories_tags: ["en:plant-based-foods-and-beverages"], image_front_small_url: "https://images.example/banana.jpg" }) });
    const food = (await t.api("GET", "/api/foods/barcode/0099999999999")).body.food;
    expect(food.imageUrl).toBe("https://images.example/banana.jpg");
    const entry = (await log(food)).body.entry;
    expect(entry.imageUrl).toBe("https://images.example/banana.jpg");
    expect(entry.icon).toBe("🍌");
    const copied = await t.api("POST", "/api/log/move", { ids: [entry.id], day: "2026-11-18", meal: "lunch", copy: true });
    expect(copied.body.entries[0].imageUrl).toBe("https://images.example/banana.jpg");
    expect((await getDay()).entries[0].imageUrl).toBe("https://images.example/banana.jpg");
  });

  it("an entry logged before the name picked the icon (stored 🥤 for a banana) shows the name's icon now", async () => {
    offKnows(t, { "0099999999999": offProduct("0099999999999", "Banana", 89, { categories_tags: ["en:plant-based-foods-and-beverages"] }) });
    const food = (await t.api("GET", "/api/foods/barcode/0099999999999")).body.food;
    const banana = (await log(food)).body.entry;
    const odd = (await log({ ...food, id: food.id }, {}, DAY, "lunch")).body.entry; // another meal: the same food in one meal combines
    // As saved back then: the category's drink cup; and a name no rule knows keeps what was stored
    await t.db.update(logEntries).set({ icon: "🥤" }).where(eq(logEntries.id, banana.id));
    await t.db.update(logEntries).set({ icon: "🫙", name: "Mystery thing" }).where(eq(logEntries.id, odd.id));
    const entries = (await getDay()).entries;
    expect(entries.find((e: any) => e.id === banana.id).icon).toBe("🍌");
    expect(entries.find((e: any) => e.id === odd.id).icon).toBe("🫙");
    expect((await t.api("GET", "/api/foods/recent")).body.foods.map((f: any) => f.icon)).not.toContain("🥤");
  });

  it("move and copy entries to another day and meal", async () => {
    const food = await myFood();
    const a = (await log(food)).body.entry;
    const b = (await log(food, { quantity: 2 }, DAY, "lunch")).body.entry;

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
      imageUrl: null,
      servingIndex: 0,
      unit: "ml",
      quantity: 237,
      fraction: 1,
      servings: [{ label: "1 ml", ml: 1 }],
      nutrients: { water_ml: 237 },
      aiEstimated: false,
      source: "water",
      sourceRef: null,
      treat: false,
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
    expect(await t.api("DELETE", `/api/my-foods/${gone.id}`)).toMatchObject({ status: 200, body: { archived: true } }); // archived: skipped

    const recent = (await t.api("GET", "/api/foods/recent")).body.foods;
    expect(recent.map((f: any) => `${f.kind}:${f.id}`)).toEqual([`user_food:${mine.id}`, `cache:${cached.id}`]);
    expect(recent[0]).toEqual({ ...mine, last: { servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 } });
    // read back later, the scanned food is a kept copy (it has a saved date)
    expect(recent[1]).toEqual({ ...cached, savedAt: expect.any(String), last: { servingIndex: 0, unit: "g", quantity: 30, fraction: 1 } });

    const frequent = (await t.api("GET", "/api/foods/frequent")).body.foods;
    // the bar 2 times and toast 2 times in the window; a tie goes to the one used last
    expect(frequent.map((f: any) => `${f.kind}:${f.id}`)).toEqual([`user_food:${mine.id}`, `cache:${cached.id}`]);
    await log(cached, { servingIndex: 1 }, "2026-11-17");
    const again = (await t.api("GET", "/api/foods/frequent")).body.foods;
    expect(again.map((f: any) => `${f.kind}:${f.id}`)).toEqual([`cache:${cached.id}`, `user_food:${mine.id}`]);
    expect(again[0].last).toEqual({ servingIndex: 1, unit: "serving", quantity: 1, fraction: 1 });
  });

  it("recent and frequent show my correction instead of the database version", async () => {
    const cached = await bar();
    await log(cached, { servingIndex: 1 }, "2026-11-15");
    await log(cached, { servingIndex: 1 }, "2026-11-16");
    const fixed = (await t.api("POST", "/api/my-foods/override", { cacheId: cached.id, name: cached.name, brand: cached.brand, servings: cached.servings, nutrients: { ...cached.nutrients, calories: 999 } })).body.food;
    await log(fixed, { servingIndex: 1 }, "2026-11-17");
    for (const path of ["/api/foods/recent", "/api/foods/frequent"]) {
      const foods = (await t.api("GET", path)).body.foods;
      expect(foods.map((f: any) => `${f.kind}:${f.id}`), path).toEqual([`user_food:${fixed.id}`]);
      expect(foods[0].nutrients.calories, path).toBe(999);
    }
  });

  it("an older entry of the database version still resolves to my correction", async () => {
    const cached = await bar();
    await log(cached, { servingIndex: 1, fraction: 0.5 }, "2026-11-16");
    const fixed = (await t.api("POST", "/api/my-foods/override", { cacheId: cached.id, name: cached.name, brand: cached.brand, servings: cached.servings, nutrients: { ...cached.nutrients, calories: 999 } })).body.food;
    const recent = (await t.api("GET", "/api/foods/recent")).body.foods;
    expect(recent).toEqual([{ ...fixed, last: { servingIndex: 1, unit: "serving", quantity: 1, fraction: 0.5 } }]);
  });

  it("logs 1 cup of a drink known only in grams (≈ 2.366 × 100 g) and snapshots the approximate servings", async () => {
    const fairlife = JSON.parse(readFileSync(new URL("./fixtures/off-product-fairlife.json", import.meta.url), "utf8")).product;
    offKnows(t, { "0811620021470": fairlife });
    const food = (await t.api("GET", "/api/foods/barcode/0811620021470")).body.food;
    const res = await log(food, { unit: "cup", quantity: 1 });
    expect(res.status).toBe(200);
    // 236.588 ml ÷ 100 ml = 2.366: 50 kcal × 2.366 = 118, 5.4 g × 2.366 = 12.8, sat fat 1.25 × 2.366 = 3.0
    expect(res.body.entry.nutrients).toEqual({ calories: 118, protein_g: 12.8, carbs_g: 5.9, fat_g: 4.5, saturated_fat_g: 3, sugar_g: 5.9, sodium_mg: 118.3 });
    expect(res.body.entry.servings).toEqual([
      { label: "100 g", grams: 100, ml: 100, approx: true },
      { label: "1 cup", grams: 240, ml: 240, approx: true },
    ]);
    // Editing the entry re-reads the snapshot: 4 fl oz
    const patched = await t.api("PATCH", `/api/log/${res.body.entry.id}`, { unit: "fl_oz", quantity: 4 });
    expect(patched.body.entry.nutrients.calories).toBe(59);
  });

  it("recent and frequent for one meal only list foods logged at that meal", async () => {
    const cached = await bar();
    const mine = await myFood();
    await log(cached, { servingIndex: 1 }, "2026-11-15", "snacks");
    await log(mine, { quantity: 2 }, "2026-11-16", "breakfast");
    await log(cached, { servingIndex: 1, fraction: 0.5 }, "2026-11-17", "snacks");
    await log(mine, { quantity: 1 }, "2026-11-17", "lunch"); // newest toast, but at lunch

    const ids = (foods: any[]) => foods.map((f: any) => `${f.kind}:${f.id}`);
    const breakfast = (await t.api("GET", "/api/foods/recent?meal=breakfast")).body.foods;
    expect(ids(breakfast)).toEqual([`user_food:${mine.id}`]);
    expect(breakfast[0].last).toEqual({ servingIndex: 0, unit: "serving", quantity: 2, fraction: 1 }); // the breakfast portion
    expect(ids((await t.api("GET", "/api/foods/recent?meal=snacks")).body.foods)).toEqual([`cache:${cached.id}`]);
    expect((await t.api("GET", "/api/foods/recent?meal=dinner")).body.foods).toEqual([]);
    expect(ids((await t.api("GET", "/api/foods/recent")).body.foods)).toEqual([`user_food:${mine.id}`, `cache:${cached.id}`]);

    const freqSnacks = (await t.api("GET", "/api/foods/frequent?meal=snacks")).body.foods;
    expect(ids(freqSnacks)).toEqual([`cache:${cached.id}`]);
    expect(freqSnacks[0].last).toEqual({ servingIndex: 1, unit: "serving", quantity: 1, fraction: 0.5 });
    expect(ids((await t.api("GET", "/api/foods/frequent?meal=lunch")).body.foods)).toEqual([`user_food:${mine.id}`]);

    for (const path of ["/api/foods/recent?meal=brunch", "/api/foods/frequent?meal=", "/api/foods/recent?meal=Breakfast"]) {
      const bad = await t.api("GET", path);
      expect(bad.status, path).toBe(400);
    }
  });
});

describe("logged days", () => {
  it("logged days lists only days with food, not water-only days", async () => {
    const food = await myFood();
    await log(food, {}, "2026-11-16");
    await log(food, {}, "2026-11-16", "lunch"); // two entries, one day
    await log(food, {}, "2026-11-12");
    await t.api("POST", "/api/log", { day: "2026-11-14", meal: "supplements", water_ml: 237 }); // water only
    await t.api("POST", "/api/log", { day: "2026-11-12", meal: "supplements", water_ml: 237 });
    await log(food, {}, "2026-11-30"); // outside the range
    const res = await t.api("GET", "/api/days/logged?from=2026-11-10&to=2026-11-17");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ days: ["2026-11-12", "2026-11-16"] });
    // the ends of the range count
    expect((await t.api("GET", "/api/days/logged?from=2026-11-16&to=2026-11-16")).body).toEqual({ days: ["2026-11-16"] });
  });

  it("logged days range over 62 days is 400", async () => {
    expect((await t.api("GET", "/api/days/logged?from=2026-09-17&to=2026-11-17")).status).toBe(200); // 62 days counting both ends
    const tooLong = await t.api("GET", "/api/days/logged?from=2026-09-16&to=2026-11-17");
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.error).toBe("Choose up to 62 days");
    const backwards = await t.api("GET", "/api/days/logged?from=2026-11-17&to=2026-11-16");
    expect(backwards.status).toBe(400);
    expect(backwards.body.error).toBe("Choose up to 62 days");
    expect((await t.api("GET", "/api/days/logged?from=2026-11-17")).status).toBe(400);
    expect((await t.api("GET", "/api/days/logged?from=nope&to=2026-11-17")).status).toBe(400);
  });
});
