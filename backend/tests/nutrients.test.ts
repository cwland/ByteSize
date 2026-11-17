import { describe, expect, it } from "vitest";
import {
  NUTRIENT_KEYS,
  UnitError,
  amountFactor,
  scaleNutrients,
  sumNutrients,
  type Serving,
} from "../src/lib/nutrients.js";

const bar: Serving[] = [
  { label: "100 g", grams: 100 },
  { label: "1 bar", grams: 40 },
];
const cup: Serving[] = [{ label: "1 cup", ml: 236.5882365, grams: 244 }];

describe("NUTRIENT_KEYS", () => {
  it("lists the 12 nutrient keys", () => {
    expect(NUTRIENT_KEYS).toEqual([
      "calories", "protein_g", "fiber_g", "carbs_g", "fat_g", "sugar_g", "added_sugar_g",
      "sugar_alcohol_g", "sodium_mg", "potassium_mg", "magnesium_mg", "water_ml",
    ]);
  });
});

describe("amountFactor", () => {
  it("converts a second serving to base servings by grams", () => {
    expect(amountFactor(bar, 1, "serving", 2)).toBeCloseTo(0.8, 10);
  });
  it("converts grams", () => {
    expect(amountFactor(bar, 0, "g", 50)).toBeCloseTo(0.5, 10);
  });
  it("converts ounces", () => {
    expect(amountFactor(bar, 0, "oz", 1)).toBeCloseTo(0.2834952, 6);
  });
  it("refuses volume units for a mass-only food", () => {
    expect(() => amountFactor(bar, 0, "ml", 10)).toThrow(UnitError);
    expect(() => amountFactor(bar, 0, "ml", 10)).toThrow("Can't measure this food in ml");
  });
  it("converts fluid ounces when the base has ml", () => {
    expect(amountFactor(cup, 0, "fl_oz", 8)).toBeCloseTo(1.0, 6);
  });
  it("converts grams when the base has grams and ml", () => {
    expect(amountFactor(cup, 0, "g", 122)).toBeCloseTo(0.5, 10);
  });
  it("converts tablespoons", () => {
    expect(amountFactor(cup, 0, "tbsp", 2)).toBeCloseTo(0.125, 10);
  });
  it("uses quantity for the base serving with no size", () => {
    expect(amountFactor([{ label: "1 egg" }], 0, "serving", 3)).toBe(3);
  });
  it("refuses a non-base serving that can't be compared", () => {
    expect(() => amountFactor([{ label: "1 egg" }, { label: "1 large" }], 1, "serving", 1)).toThrow(UnitError);
    expect(() => amountFactor(bar, 5, "serving", 1)).toThrow(UnitError);
  });
});

describe("scaleNutrients", () => {
  it("scales known keys and leaves unknown keys absent", () => {
    const out = scaleNutrients({ calories: 250, protein_g: 20, sodium_mg: 330 }, 0.5);
    expect(out).toEqual({ calories: 125, protein_g: 10, sodium_mg: 165 });
    expect("fiber_g" in out).toBe(false);
  });
  it("rounds calories to whole and others to 1 decimal", () => {
    expect(scaleNutrients({ calories: 101, fat_g: 3.33 }, 1 / 3)).toEqual({ calories: 34, fat_g: 1.1 });
  });
});

describe("sumNutrients", () => {
  it("sums known values and counts unknowns per key", () => {
    const out = sumNutrients([{ calories: 100, fiber_g: 3 }, { calories: 50 }]);
    expect(out.calories).toBe(150);
    expect(out.fiber_g).toBe(3);
    expect(out.unknownCount.fiber_g).toBe(1);
    expect(out.unknownCount.protein_g).toBe(2);
    expect("calories" in out.unknownCount).toBe(false);
    for (const k of NUTRIENT_KEYS) {
      if (k !== "calories" && k !== "fiber_g") expect(out.unknownCount[k]).toBe(2);
    }
  });
});
