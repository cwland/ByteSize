import { describe, expect, it } from "vitest";
import { defaultPortion, startingPortion } from "./FoodDetail";

const milkBase = { label: "100 g", grams: 100, ml: 100, approx: true as const };

describe("defaultPortion", () => {
  it("a drink whose serving is in grams starts in fl oz (imperial) or ml (metric), same amount", () => {
    const servings = [milkBase, { label: "240 g", grams: 240 }];
    expect(defaultPortion(servings, "imperial")).toEqual({ servingIndex: 0, unit: "fl_oz", quantity: 8, fraction: 1 });
    expect(defaultPortion(servings, "metric")).toEqual({ servingIndex: 0, unit: "ml", quantity: 240, fraction: 1 });
  });
  it("a drink known only per 100 g starts at a cup's worth: 8 fl oz or 240 ml", () => {
    expect(defaultPortion([milkBase], "imperial")).toEqual({ servingIndex: 0, unit: "fl_oz", quantity: 8, fraction: 1 });
    expect(defaultPortion([milkBase], "metric")).toEqual({ servingIndex: 0, unit: "ml", quantity: 240, fraction: 1 });
  });
  it("a drink whose own serving is already a volume keeps it", () => {
    expect(defaultPortion([milkBase, { label: "1 cup", grams: 240, ml: 240 }], "imperial")).toEqual({ servingIndex: 1, unit: "serving", quantity: 1, fraction: 1 });
  });
  it("solid foods keep their own serving", () => {
    expect(defaultPortion([{ label: "100 g", grams: 100 }, { label: "1 bar", grams: 40 }], "imperial")).toEqual({ servingIndex: 1, unit: "serving", quantity: 1, fraction: 1 });
  });
});

describe("startingPortion", () => {
  const shake = [{ label: "1 shake", grams: 400, ml: 400 }];
  it("a restaurant item starts at 1 × its whole item, even when its serving has ml (a drink)", () => {
    for (const source of ["spoonacular", "fatsecret"]) {
      expect(startingPortion({ servings: shake, source }, "imperial")).toEqual({ servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 });
      expect(startingPortion({ servings: [{ label: "100 g", grams: 100, ml: 100, approx: true }, { label: "1 coffee", grams: 350 }], source }, "metric")).toEqual({ servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 });
    }
  });
  it("other sources still start a drink at a cup's worth", () => {
    expect(startingPortion({ servings: shake, source: "usda" }, "imperial")).toEqual({ servingIndex: 0, unit: "fl_oz", quantity: 8, fraction: 1 });
  });
});
