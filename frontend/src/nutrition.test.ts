import { describe, expect, it } from "vitest";
import { amountFactor, scaleNutrients } from "./nutrition";

const bar = [
  { label: "100 g", grams: 100 },
  { label: "1 bar", grams: 40 },
];
const milk = [{ label: "1 cup", ml: 236.5882365, grams: 244 }];

describe("client portion math (same as the API's amountFactor)", () => {
  it("measures servings and units in base servings", () => {
    expect(amountFactor(bar, 1, "serving", 2)).toBeCloseTo(0.8, 9);
    expect(amountFactor(bar, 0, "g", 50)).toBeCloseTo(0.5, 9);
    expect(amountFactor(bar, 0, "oz", 1)).toBeCloseTo(0.2834952, 6);
    expect(() => amountFactor(bar, 0, "ml", 10)).toThrow("Can't measure this food in ml");
    expect(amountFactor(milk, 0, "fl_oz", 8)).toBeCloseTo(1, 6);
    expect(amountFactor(milk, 0, "g", 122)).toBeCloseTo(0.5, 9);
    expect(amountFactor(milk, 0, "tbsp", 2)).toBeCloseTo(0.125, 9);
  });

  it("scales known nutrients only and rounds like the API", () => {
    expect(scaleNutrients({ calories: 250, protein_g: 20, sodium_mg: 330 }, 0.5)).toEqual({ calories: 125, protein_g: 10, sodium_mg: 165 });
  });
});
