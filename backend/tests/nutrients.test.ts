import { describe, expect, it } from "vitest";
import {
  NUTRIENT_KEYS,
  UnitError,
  amountFactor,
  scaleNutrients,
  sumNutrients,
  withLiquidVolumes,
  type Serving,
} from "../src/lib/nutrients.js";

const bar: Serving[] = [
  { label: "100 g", grams: 100 },
  { label: "1 bar", grams: 40 },
];
const cup: Serving[] = [{ label: "1 cup", ml: 236.5882365, grams: 244 }];

describe("NUTRIENT_KEYS", () => {
  it("lists the 13 nutrient keys (saturated fat after fat)", () => {
    expect(NUTRIENT_KEYS).toEqual([
      "calories", "protein_g", "fiber_g", "carbs_g", "fat_g", "saturated_fat_g", "sugar_g", "added_sugar_g",
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

describe("withLiquidVolumes", () => {
  const fairlife: Serving[] = [
    { label: "100 g", grams: 100 },
    { label: "1 cup", grams: 240 },
  ];

  it("a drink known only in grams gets ml = grams, marked approximate", () => {
    expect(withLiquidVolumes(fairlife, "en:milks", "Fairlife 2% Reduced Fat Ultra-Filtered Milk")).toEqual([
      { label: "100 g", grams: 100, ml: 100, approx: true },
      { label: "1 cup", grams: 240, ml: 240, approx: true },
    ]);
    // the input isn't changed
    expect(fairlife).toEqual([{ label: "100 g", grams: 100 }, { label: "1 cup", grams: 240 }]);
  });

  it("matches by name when the category says nothing, and whole words only", () => {
    expect(withLiquidVolumes([{ label: "100 g", grams: 100 }], null, "Orange juice")[0]).toMatchObject({ ml: 100, approx: true });
    expect(withLiquidVolumes([{ label: "100 g", grams: 100 }], "en:beverages", "Cold brew")[0]).toMatchObject({ ml: 100, approx: true });
    expect(withLiquidVolumes([{ label: "100 g", grams: 100 }], null, "Chocolate milk")[0]).toMatchObject({ ml: 100, approx: true });
    expect(withLiquidVolumes([{ label: "100 g", grams: 100 }], null, "Teriyaki steak")).toEqual([{ label: "100 g", grams: 100 }]);
  });

  it("cheese and other solids stay grams-only (Review Focus 4)", () => {
    const cheese: Serving[] = [{ label: "100 g", grams: 100 }, { label: "1 slice", grams: 28 }];
    expect(withLiquidVolumes(cheese, "en:cheeses", "Whole milk mozzarella cheese")).toEqual(cheese);
    expect(withLiquidVolumes(cheese, null, "Cheese, cheddar")).toEqual(cheese);
    expect(withLiquidVolumes(cheese, "en:chocolates", "Milk chocolate")).toEqual(cheese);
    expect(withLiquidVolumes(cheese, "en:snacks", "Protein bar chocolate milk shake")).toEqual(cheese);
    expect(withLiquidVolumes(cheese, "Fruits and Fruit Juices", "Apples, fuji, with skin, raw")).toEqual(cheese);
    expect(withLiquidVolumes(cheese, "en:coffees", "Whole bean coffee")).toEqual(cheese);
    // powders and soft cheeses that mention a drink: 1 g ≈ 1 ml would badly over-count them
    expect(withLiquidVolumes(cheese, "en:beverages", "Hot chocolate drink mix")).toEqual(cheese);
    expect(withLiquidVolumes(cheese, null, "Whole milk ricotta")).toEqual(cheese);
    expect(withLiquidVolumes(cheese, null, "Instant oatmeal with milk")).toEqual(cheese);
    expect(withLiquidVolumes(cheese, null, "Iced tea mix")).toEqual(cheese);
  });

  it("a food with real ml is unchanged", () => {
    const cola: Serving[] = [{ label: "100 ml", ml: 100 }, { label: "330 ml", ml: 330 }];
    expect(withLiquidVolumes(cola, "en:sodas", "Cola")).toEqual(cola);
    const both: Serving[] = [{ label: "1 cup", grams: 244, ml: 236.6 }, { label: "1 glass", grams: 300 }];
    expect(withLiquidVolumes(both, "en:milks", "Milk")).toEqual(both);
  });

  it("only servings with grams get ml", () => {
    expect(withLiquidVolumes([{ label: "100 g", grams: 100 }, { label: "1 bottle" }], "en:juices", "Juice")).toEqual([
      { label: "100 g", grams: 100, ml: 100, approx: true },
      { label: "1 bottle" },
    ]);
  });

  it("amountFactor uses the approximate ml: 1 cup of Fairlife ≈ 2.366 × 100 g", () => {
    const s = withLiquidVolumes(fairlife, "en:milks", "Fairlife milk");
    expect(amountFactor(s, 0, "cup", 1)).toBeCloseTo(2.366, 3);
    expect(amountFactor(s, 0, "fl_oz", 4)).toBeCloseTo(1.183, 3);
    expect(amountFactor(s, 1, "serving", 1)).toBeCloseTo(2.4, 6);
    expect(amountFactor(s, 0, "g", 50)).toBeCloseTo(0.5, 6);
  });
});
