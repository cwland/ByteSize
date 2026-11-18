import { describe, expect, it } from "vitest";
import { formatAmount, splitWhole, unitChoices } from "./amounts";
import type { Serving } from "./types";

const bar: Serving[] = [
  { label: "100 g", grams: 100 },
  { label: "1 bar", grams: 40 },
];
const bread: Serving[] = [{ label: "1 slice (28 g)", grams: 28 }];
const toast: Serving[] = [{ label: "2 slices", grams: 60 }];
const milk: Serving[] = [
  { label: "1 cup", ml: 240 },
  { label: "1 bottle", ml: 340 },
];
// Fairlife known only by weight: the API marks its volumes approximate (1 g ≈ 1 ml)
const fairlife: Serving[] = [
  { label: "100 g", grams: 100, ml: 100, approx: true },
  { label: "1 cup", grams: 240, ml: 240, approx: true },
];
const cheese: Serving[] = [
  { label: "100 g", grams: 100 },
  { label: "1 slice (21 g)", grams: 21 },
];

describe("formatAmount", () => {
  it("puts the amount first with mixed fractions and plural nouns, never '1 × serving' or float noise", () => {
    expect(formatAmount(bar, 1, "serving", 1.5, 1)).toBe("1½ bars");
    expect(formatAmount(bar, 1, "serving", 1, 1)).toBe("1 bar");
    expect(formatAmount(bar, 1, "serving", 1, 0.5)).toBe("½ bar");
    expect(formatAmount(bar, 1, "serving", 1.4, 1)).toBe("1.4 bars");
    expect(formatAmount(bread, 0, "serving", 2, 1)).toBe("2 slices (56 g)");
    expect(formatAmount(bar, 0, "serving", 1.5, 1)).toBe("150 g");
    expect(formatAmount(toast, 0, "serving", 1, 1)).toBe("2 slices");
    expect(formatAmount(toast, 0, "serving", 1, 0.5)).toBe("1 slice");
    expect(formatAmount([{ label: "serving" }], 0, "serving", 1, 1)).toBe("1 serving");
    expect(formatAmount([{ label: "serving" }], 0, "serving", 2, 1)).toBe("2 servings");
    expect(formatAmount(bar, 0, "g", 33.300000004, 1)).toBe("33 g");
  });

  it("pluralises only the noun of a multi-word serving name (§28: '6 pitted prunes', not '6 pitteds prunes')", () => {
    const one = (label: string, q: number) => formatAmount([{ label, grams: 10 }], 0, "serving", q, 1);
    expect(one("pitted prunes", 6)).toBe("6 pitted prunes");
    expect(one("1 pitted prune", 6)).toBe("6 pitted prunes");
    expect(one("pitted prunes", 1)).toBe("1 pitted prune");
    expect(one("1 large egg", 2)).toBe("2 large eggs");
    expect(one("1 medium banana", 2)).toBe("2 medium bananas");
    expect(one("1 cup, chopped", 2)).toBe("2 cups, chopped");
    expect(one("1 slice, large", 3)).toBe("3 slices, large");
    expect(one("1 piece of bread", 2)).toBe("2 pieces of bread");
    expect(one("1 container (6 oz)", 2)).toBe("2 containers (12 oz)");
    expect(one("1 NLEA serving", 2)).toBe("2 NLEA servings");
    expect(one("1 fruit without skin and seeds", 2)).toBe("2 fruits without skin and seeds");
    expect(one("1 frozen waffle", 3)).toBe("3 frozen waffles");
    expect(one("1 peeled baby carrot", 5)).toBe("5 peeled baby carrots");
    expect(one("1 extra large egg", 2)).toBe("2 extra large eggs");
    expect(one("1 small", 2)).toBe("2 small"); // a size on its own stays as it is
  });

  it("writes units as people say them", () => {
    expect(formatAmount(milk, 0, "cup", 0.333, 1)).toBe("⅓ cup");
    expect(formatAmount(milk, 0, "cup", 1.5, 1)).toBe("1½ cups");
    expect(formatAmount(milk, 0, "fl_oz", 4, 1)).toBe("4 fl oz");
    expect(formatAmount(milk, 0, "tbsp", 2, 1)).toBe("2 tbsp");
    expect(formatAmount(milk, 0, "cup", 1, 0.5)).toBe("½ cup");
  });

  it("marks volumes of a drink known only by weight as approximate", () => {
    expect(formatAmount(fairlife, 0, "cup", 1, 1)).toBe("≈ 1 cup");
    expect(formatAmount(fairlife, 0, "fl_oz", 4, 1)).toBe("≈ 4 fl oz");
    expect(formatAmount(fairlife, 0, "g", 240, 1)).toBe("240 g");
    expect(formatAmount(fairlife, 1, "serving", 1, 1)).toBe("1 cup");
  });

  it("shows logged water in the person's units", () => {
    expect(formatAmount([], 0, "ml", 237, 1, "imperial")).toBe("8 fl oz");
    // the shape the server actually saves for water entries
    expect(formatAmount([{ label: "1 ml", ml: 1 }], 0, "ml", 237, 1, "imperial")).toBe("8 fl oz");
    expect(formatAmount([{ label: "1 ml", ml: 1 }], 0, "ml", 473, 1, "metric")).toBe("473 ml");
    expect(formatAmount([], 0, "ml", 237, 1, "metric")).toBe("237 ml");
  });
});

describe("splitWhole", () => {
  it("splits into a whole number and the nearest picker fraction", () => {
    expect(splitWhole(1.5)).toEqual({ whole: 1, fraction: 0.5 });
    expect(splitWhole(0.333)).toEqual({ whole: 0, fraction: 0.333 });
    expect(splitWhole(2.98)).toEqual({ whole: 3, fraction: 0 });
    expect(splitWhole(1.7)).toEqual({ whole: 1, fraction: 0.667 });
    expect(splitWhole(4)).toEqual({ whole: 4, fraction: 0 });
  });
});

describe("unitChoices", () => {
  it("offers the food's servings, then weights, then volumes", () => {
    expect(unitChoices(milk)).toEqual([
      { value: "s:0", label: "1 cup" },
      { value: "s:1", label: "1 bottle" },
      { value: "ml", label: "ml" },
      { value: "fl_oz", label: "fl oz" },
      { value: "cup", label: "cup" },
      { value: "tbsp", label: "tbsp" },
      { value: "tsp", label: "tsp" },
    ]);
  });

  it("a grams-only drink gets cups, ml and fl oz marked ≈; a solid food never gets cups", () => {
    const f = unitChoices(fairlife);
    expect(f).toContainEqual({ value: "cup", label: "≈ cup" });
    expect(f).toContainEqual({ value: "ml", label: "≈ ml" });
    expect(f).toContainEqual({ value: "fl_oz", label: "≈ fl oz" });
    expect(f.slice(0, 4).map((u) => u.value)).toEqual(["s:0", "s:1", "g", "oz"]);
    expect(unitChoices(cheese).map((u) => u.value)).toEqual(["s:0", "s:1", "g", "oz"]);
  });

  it("reads fractional serving labels like USDA's '2/3 cup'", () => {
    const cereal = [{ label: "100 g", grams: 100 }, { label: "2/3 cup", grams: 55 }];
    expect(formatAmount(cereal, 1, "serving", 1, 1)).toBe("⅔ cup");
    expect(formatAmount(cereal, 1, "serving", 1.5, 1)).toBe("1 cup");
    expect(formatAmount(cereal, 1, "serving", 1, 1 / 3)).not.toMatch(/\//);
    const nuts = [{ label: "100 g", grams: 100 }, { label: "1/4 cup", grams: 30 }];
    expect(formatAmount(nuts, 1, "serving", 2, 1)).toBe("½ cup");
  });
});
