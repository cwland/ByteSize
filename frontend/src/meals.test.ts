import { describe, expect, it } from "vitest";
import { mealFor } from "./meals";

const windows = { breakfast: "10:30", lunch: "14:30", snacks: "17:00", dinner: "21:00" };

describe("mealFor", () => {
  it("picks the meal from the local time in the person's time zone", () => {
    // America/Denver is UTC-7 in November
    const at = (local: string) => new Date(`2026-11-17T${local}:00-07:00`);
    expect(mealFor("America/Denver", at("07:00"), windows)).toBe("breakfast");
    expect(mealFor("America/Denver", at("12:00"), windows)).toBe("lunch");
    expect(mealFor("America/Denver", at("15:30"), windows)).toBe("snacks");
    expect(mealFor("America/Denver", at("18:00"), windows)).toBe("dinner");
    expect(mealFor("America/Denver", at("22:30"), windows)).toBe("snacks");
  });

  it("midnight counts as early morning, not 24:00", () => {
    expect(mealFor("America/Denver", new Date("2026-11-17T00:10:00-07:00"), windows)).toBe("breakfast");
  });
});
