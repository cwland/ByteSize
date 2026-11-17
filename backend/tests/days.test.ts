import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";
import { addDays, MEAL_SPLIT, mealFor, streak } from "../src/lib/days.js";

const windows = { breakfast: "10:30", lunch: "14:30", snacks: "17:00", dinner: "21:00" };
const toast = { name: "Toast", servings: [{ label: "2 slices", grams: 60 }], nutrients: { calories: 160, fiber_g: 4 } };

describe("meal default and split (pure)", () => {
  it("mealFor picks the meal from the local Boise time", () => {
    // America/Boise is UTC-7 in November
    const at = (local: string) => new Date(`2026-11-17T${local}:00-07:00`);
    expect(mealFor("America/Boise", at("07:00"), windows)).toBe("breakfast");
    expect(mealFor("America/Boise", at("12:00"), windows)).toBe("lunch");
    expect(mealFor("America/Boise", at("15:30"), windows)).toBe("snacks");
    expect(mealFor("America/Boise", at("18:00"), windows)).toBe("dinner");
    expect(mealFor("America/Boise", at("22:30"), windows)).toBe("snacks");
    expect(mealFor("America/Boise", new Date("2026-11-17T00:10:00-07:00"), windows)).toBe("breakfast");
  });

  it("the suggested split adds up to the whole day", () => {
    expect(MEAL_SPLIT).toEqual({ breakfast: 0.2, lunch: 0.25, dinner: 0.35, snacks: 0.2, supplements: 0 });
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("days in the database", () => {
  let t: TestApp;
  let userId: number;
  let foodId: number;
  beforeAll(async () => (t = await setupTestApp()));
  beforeEach(async () => {
    await t.reset();
    userId = (await t.login()).id;
    foodId = (await t.api("POST", "/api/my-foods", toast)).body.food.id;
  });
  afterAll(async () => t.close());

  const logToast = (day: string) => t.api("POST", "/api/log", { day, meal: "breakfast", food: { kind: "user_food", id: foodId }, servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 });
  const logWater = (day: string) => t.api("POST", "/api/log", { day, meal: "supplements", water_ml: 237 });

  it("an entry at 11:30 pm Boise lands on that Boise day", async () => {
    t.clock.date = new Date("2026-11-18T06:30:00Z"); // 23:30 on Nov 17 in Boise
    const today = await t.api("GET", "/api/day/today");
    expect(today.status).toBe(200);
    expect(today.body.day).toBe("2026-11-17");
    const posted = await logToast(today.body.day);
    expect(posted.status).toBe(200);
    // Leaving day out uses the Boise day too, and the meal default from the Boise time
    const defaulted = await t.api("POST", "/api/log", { food: { kind: "user_food", id: foodId }, servingIndex: 0, unit: "serving", quantity: 1 });
    expect(defaulted.status).toBe(200);
    expect(defaulted.body.entry).toMatchObject({ day: "2026-11-17", meal: "snacks" });
    const day = await t.api("GET", "/api/day/2026-11-17");
    expect(day.body.entries.map((e: any) => e.id)).toEqual([posted.body.entry.id, defaulted.body.entry.id]);
    expect((await t.api("GET", "/api/day/2026-11-18")).body.entries).toEqual([]);
  });

  it("streak counts consecutive days with food ending today, or yesterday when today is empty", async () => {
    const today = "2026-11-17";
    expect(await streak(t.db, userId, today)).toBe(0); // none

    await logToast("2026-11-16");
    await logToast("2026-11-15");
    expect(await streak(t.db, userId, today)).toBe(2); // only yesterday and the day before

    await logToast(today);
    expect(await streak(t.db, userId, today)).toBe(3); // today + yesterday + the day before

    await logToast("2026-11-13"); // after a gap: not counted
    expect(await streak(t.db, userId, today)).toBe(3);
    expect(await streak(t.db, userId, "2026-11-19")).toBe(0); // gap of a whole day resets
  });

  it("today + yesterday is 2, and a water-only day doesn't count", async () => {
    await logToast("2026-11-17");
    await logToast("2026-11-16");
    expect(await streak(t.db, userId, "2026-11-17")).toBe(2);
    await logWater("2026-11-15");
    await logToast("2026-11-14");
    expect(await streak(t.db, userId, "2026-11-17")).toBe(2);
    await logWater("2026-11-18");
    expect(await streak(t.db, userId, "2026-11-18")).toBe(2); // today has only water: ends yesterday
  });

  it("the streak in the day view is the person's own", async () => {
    t.clock.date = new Date("2026-11-18T06:30:00Z");
    await logToast("2026-11-17");
    await logToast("2026-11-16");
    expect((await t.api("GET", "/api/day/2026-11-10")).body.streak).toBe(2);
  });
});
