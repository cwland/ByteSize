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
  it("a drink whose only serving names an item starts at 1 of it, whatever the source", () => {
    for (const label of ["1 shake", "1 bottle (500 ml)", "1 can"]) {
      expect(defaultPortion([{ label, grams: 400, ml: 400 }], "imperial")).toEqual({ servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 });
      expect(defaultPortion([{ label, grams: 400, ml: 400 }], "metric")).toEqual({ servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 });
    }
  });
  it("a bare amount as the only serving ('100 ml', '240 ml', '8 fl oz') still falls back to a cup's worth", () => {
    for (const label of ["100 ml", "240 ml", "8 fl oz", "1 L"]) {
      expect(defaultPortion([{ label, grams: 100, ml: 100 }], "imperial")).toEqual({ servingIndex: 0, unit: "fl_oz", quantity: 8, fraction: 1 });
    }
    expect(defaultPortion([{ label: "100 ml", ml: 100 }], "metric")).toEqual({ servingIndex: 0, unit: "ml", quantity: 240, fraction: 1 });
  });
  it("kitchen measures ('1 cup', '2 tbsp', '1 tsp') aren't bare amounts: the only serving starts at 1 of it (§37)", () => {
    for (const label of ["1 cup", "2 tbsp", "1 tsp", "1/2 cup"]) {
      expect(defaultPortion([{ label, grams: 240, ml: 240 }], "imperial")).toEqual({ servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 });
      expect(defaultPortion([{ label, ml: 240 }], "metric")).toEqual({ servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 });
    }
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
  it("any source starts a drink whose one serving names an item at 1 of it (a corrected restaurant drink in My foods, a bottle from OFF)", () => {
    for (const source of ["usda", "off", undefined]) {
      expect(startingPortion({ servings: shake, source }, "imperial")).toEqual({ servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 });
    }
  });
  it("a drink known only per 100 ml still starts at a cup's worth", () => {
    expect(startingPortion({ servings: [{ label: "100 ml", grams: 100, ml: 100 }], source: "usda" }, "imperial")).toEqual({ servingIndex: 0, unit: "fl_oz", quantity: 8, fraction: 1 });
  });
});
