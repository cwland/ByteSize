import { describe, expect, it } from "vitest";
import { canMeasure } from "../src/lib/recipes.js";

const food = (servings: unknown) => ({ servings }) as any;

describe("canMeasure", () => {
  it("is false only for an amount the food can't be measured in", () => {
    expect(canMeasure(food([{ label: "1 slice", grams: 30 }]), { servingIndex: 0, unit: "g", quantity: 60, fraction: 1 })).toBe(true);
    expect(canMeasure(food([{ label: "1 slice" }]), { servingIndex: 0, unit: "g", quantity: 60, fraction: 1 })).toBe(false);
    expect(canMeasure(food([{ label: "1 slice" }]), { servingIndex: 4, unit: "serving", quantity: 1, fraction: 1 })).toBe(false);
  });

  it("doesn't hide any other error", () => {
    expect(() => canMeasure(food(null), { servingIndex: 0, unit: "g", quantity: 60, fraction: 1 })).toThrow(TypeError);
  });
});
