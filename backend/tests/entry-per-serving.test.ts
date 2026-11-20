import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";

let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
beforeEach(async () => {
  await t.reset();
  await t.login();
  t.clock.date = new Date("2026-11-17T19:00:00Z");
});
afterAll(async () => t.close());

// The phone previews an edit from the entry; worked back from rounded calories it was wrong (1 g of 349 → "300").
it("an entry carries the food's per-serving nutrients, unrounded", async () => {
  const food = (await t.api("POST", "/api/my-foods", { name: "Rice", servings: [{ label: "100 g", grams: 100 }], nutrients: { calories: 349, protein_g: 7.1 } })).body.food;
  const res = await t.api("POST", "/api/log", { day: "2026-11-17", meal: "lunch", food: { kind: food.kind, id: food.id }, servingIndex: 0, unit: "g", quantity: 1, fraction: 1 });
  expect(res.status).toBe(200);
  const entry = (await t.api("GET", "/api/day/2026-11-17")).body.entries.find((e: { name: string }) => e.name === "Rice");
  expect(entry.nutrients.calories).toBe(3);
  expect(entry.perServing).toMatchObject({ calories: 349, protein_g: 7.1 });
});
