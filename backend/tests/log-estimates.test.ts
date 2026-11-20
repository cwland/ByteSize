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
