import { describe, expect, it } from "vitest";
import { defaultPortion } from "./FoodDetail";

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
