import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestApp, type TestApp } from "./helpers.js";
import { foodCache, logEntries, targets, userBody, userFoods, userSettings, users } from "../src/db/schema.js";

let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
afterAll(async () => t.close());

describe("m2a schema", () => {
  it("user-owned food tables cascade with their user", async () => {
    const [u] = await t.db.insert(users).values({ username: "alex", passwordHash: "x" }).returning();
    await t.db.insert(userBody).values({ userId: u.id, sex: "male", birthYear: 1980, heightCm: 180, weightKg: 100, goalWeightKg: 85, activity: "light", glp1: true });
    const [s] = await t.db.insert(userSettings).values({ userId: u.id }).returning();
    expect(s.mealWindows).toEqual({ breakfast: "10:30", lunch: "14:30", snacks: "17:00", dinner: "21:00" });
    expect(s.waterButtonsMl).toEqual([237, 473]);
    await t.db.insert(targets).values({ userId: u.id, effectiveFrom: "2026-11-17", plan: "steady", caloriesMin: 1800, caloriesMax: 2000, proteinMin: 120, proteinMax: 160, fiberMin: 25, fiberMax: 35, waterMin: 2500, waterMax: 3500 });
    const [c] = await t.db
      .insert(foodCache)
      .values({ source: "off", sourceId: "012345678905", barcode: "0012345678905", name: "Oats", servings: [{ label: "1 cup", grams: 80 }], nutrients: { calories: 300 } })
      .returning();
    const [f] = await t.db
      .insert(userFoods)
      .values({ userId: u.id, kind: "override", name: "Oats", barcode: "0012345678905", baseCacheId: c.id, servings: [{ label: "1 cup", grams: 80 }], nutrients: { calories: 290 } })
      .returning();
    expect(f.aiFields).toEqual([]);
    expect(f.useCount).toBe(0);
    expect(f.archived).toBe(false);
    const [e] = await t.db
      .insert(logEntries)
      .values({ userId: u.id, day: "2026-11-17", meal: "breakfast", name: "Oats", icon: "🥣", source: "user_food", sourceRef: String(f.id), unit: "serving", quantity: 1, perServing: { calories: 290 }, servings: [{ label: "1 cup", grams: 80 }], nutrients: { calories: 290 }, aiEstimated: false })
      .returning();
    expect(e.servingIndex).toBe(0);
    expect(e.fraction).toBe(1);

    await t.db.delete(users).where(eq(users.id, u.id));

    expect(await t.db.select().from(userBody)).toHaveLength(0);
    expect(await t.db.select().from(userSettings)).toHaveLength(0);
    expect(await t.db.select().from(targets)).toHaveLength(0);
    expect(await t.db.select().from(userFoods)).toHaveLength(0);
    expect(await t.db.select().from(logEntries)).toHaveLength(0);
    expect(await t.db.select().from(foodCache)).toHaveLength(1);
  });
});
