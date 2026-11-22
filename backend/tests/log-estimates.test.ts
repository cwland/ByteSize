import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";

// Logging what the AI estimated (a plate photo, "2 eggs and toast"): each item becomes its own entry,
// marked AI-estimated, without saving a food to My Foods.
let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
beforeEach(async () => {
  await t.reset();
  await t.login();
});
afterAll(async () => t.close());

const egg = { name: "Egg, large", icon: "🥚", servings: [{ label: "1 large egg", grams: 50 }], nutrients: { calories: 78, protein_g: 6.3 }, servingIndex: 0, quantity: 2 };
const toast = { name: "Toast", brand: null, servings: [{ label: "1 slice", grams: 30 }], nutrients: { calories: 80, carbs_g: 15 }, servingIndex: 0, quantity: 1, fraction: 0.5 };
const log = (body: unknown) => t.api("POST", "/api/log/estimates", body);

describe("log AI-estimated foods", () => {
  it("each item is its own AI-estimated entry, with nutrients for the amount", async () => {
    const r = await log({ day: "2026-11-19", meal: "breakfast", items: [egg, toast] });
    expect(r.status).toBe(200);
    expect(r.body.entries).toHaveLength(2);
    expect(r.body.entries[0]).toMatchObject({ name: "Egg, large", meal: "breakfast", day: "2026-11-19", quantity: 2, aiEstimated: true, source: "ai", sourceRef: null, nutrients: { calories: 156, protein_g: 12.6 } });
    expect(r.body.entries[1]).toMatchObject({ name: "Toast", fraction: 0.5, aiEstimated: true, nutrients: { calories: 40, carbs_g: 7.5 } });
    const day = (await t.api("GET", "/api/day/2026-11-19")).body;
    expect(day.entries.map((e: { name: string }) => e.name)).toEqual(expect.arrayContaining(["Egg, large", "Toast"]));
    expect((await t.api("GET", "/api/my-foods")).body.foods ?? []).toEqual([]);
  });

  it("day and meal default like any log", async () => {
    const r = await log({ items: [egg] });
    expect(r.status).toBe(200);
    expect(r.body.entries[0].day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.body.entries[0].meal).toMatch(/breakfast|lunch|dinner|snacks/);
  });

  it("an amount of 0 is refused with the usual words", async () => {
    const r = await log({ items: [{ ...egg, quantity: 0 }] });
    expect(r.status).toBe(400);
    expect(r.body.details[0]).toEqual({ path: "items.0.quantity", message: "Enter an amount above 0" }); // the app shows the first detail
  });

  it("at most 12 items, and at least one", async () => {
    expect((await log({ items: Array.from({ length: 13 }, () => egg) })).status).toBe(400);
    expect((await log({ items: [] })).status).toBe(400);
  });

  it("a serving that isn't there is refused", async () => {
    expect((await log({ items: [{ ...egg, servingIndex: 3 }] })).status).toBe(400);
  });
});

// Describe's "One meal": the foods become one entry whose nutrients are the sum of each food's amount
describe("log AI-estimated foods as one meal", () => {
  const mayo = { name: "Mayonnaise, light", servings: [{ label: "1 tbsp", grams: 15 }], nutrients: { calories: 35, fat_g: 3.5 }, servingIndex: 0, quantity: 1 };

  it("one entry named for the meal, nutrients summed from each food's amount, grams summed", async () => {
    const r = await log({ day: "2026-11-19", meal: "breakfast", items: [egg, toast, mayo], combine: { name: "Breakfast sandwich" } });
    expect(r.status).toBe(200);
    expect(r.body.entries).toHaveLength(1);
    const e = r.body.entries[0];
    // egg 2 × 78 = 156, toast ½ × 80 = 40, mayo 35 → 231 kcal; grams 2 × 50 + ½ × 30 + 15 = 130
    expect(e).toMatchObject({ name: "Breakfast sandwich", meal: "breakfast", quantity: 1, fraction: 1, servingIndex: 0, aiEstimated: true, source: "ai", sourceRef: null });
    expect(e.servings).toEqual([{ label: "1 Breakfast sandwich", grams: 130 }]);
    expect(e.nutrients).toEqual({ calories: 231, protein_g: 12.6, carbs_g: 7.5, fat_g: 3.5 });
    expect((await t.api("GET", "/api/my-foods")).body.foods).toEqual([]); // not saved unless asked
  });

  it("grams are left out when a food has none (a drink in ml)", async () => {
    const coffee = { name: "Coffee", servings: [{ label: "1 cup", ml: 240 }], nutrients: { calories: 2 }, servingIndex: 0, quantity: 1 };
    const r = await log({ items: [egg, coffee], combine: { name: "Eggs and coffee" } });
    expect(r.body.entries[0].servings).toEqual([{ label: "1 Eggs and coffee" }]);
    expect(r.body.entries[0].nutrients.calories).toBe(158);
  });

  it("a long meal name is shortened for the serving label, kept whole as the name", async () => {
    const name = "Two fried eggs with light mayonnaise on a light English muffin";
    const r = await log({ items: [egg, mayo], combine: { name } });
    expect(r.body.entries[0].name).toBe(name);
    expect(r.body.entries[0].servings[0].label.length).toBeLessThanOrEqual(60);
  });

  it("Save to My foods: one custom food with the ingredients in its notes, and the entry logged from it", async () => {
    const r = await log({ day: "2026-11-19", meal: "breakfast", items: [egg, toast, mayo], combine: { name: "Breakfast sandwich", save: true } });
    expect(r.status).toBe(200);
    const mine = (await t.api("GET", "/api/my-foods")).body.foods;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ name: "Breakfast sandwich", servings: [{ label: "1 Breakfast sandwich", grams: 130 }], nutrients: { calories: 231, protein_g: 12.6 } });
    const food = (await t.api("GET", `/api/my-foods/${mine[0].id}`)).body.food;
    expect(food.notes).toBe("Made with: 2 × 1 large egg Egg, large · ½ × 1 slice Toast · 1 tbsp Mayonnaise, light");
    expect(r.body.entries[0]).toMatchObject({ name: "Breakfast sandwich", source: "user_food", sourceRef: `user_food:${mine[0].id}`, nutrients: { calories: 231 } });
  });

  it("a meal name is needed", async () => {
    expect((await log({ items: [egg, toast], combine: { name: "  " } })).status).toBe(400);
  });
});
