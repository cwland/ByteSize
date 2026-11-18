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
    // a measure or container word first takes the plural, whatever follows it (review, fix round 1)
    expect(one("1 cup sliced", 2)).toBe("2 cups sliced");
    expect(one("1 can soda", 2)).toBe("2 cans soda");
    expect(one("1 slice whole wheat bread", 2)).toBe("2 slices whole wheat bread");
    expect(one("1 link sausage", 2)).toBe("2 links sausage");
    expect(one("1 large", 2)).toBe("2 large");
    expect(one("1 medium egg", 2)).toBe("2 medium eggs");
    expect(one("1 tbsp", 2)).toBe("2 tbsp");
    expect(one("1 oz", 2)).toBe("2 oz");
    expect(formatAmount([{ label: "100 g", grams: 100 }], 0, "serving", 1.5, 1)).toBe("150 g");
    expect(one("2 cups sliced", 0.5)).toBe("1 cup sliced");
    expect(one("1 egg white", 2)).toBe("2 egg whites");
    expect(one("1 chocolate chip cookie", 3)).toBe("3 chocolate chip cookies");
  });

  it("compound names whose first word is a measure but isn't the counted thing pluralise the last word (§37)", () => {
    const one = (label: string, q: number) => formatAmount([{ label, grams: 10 }], 0, "serving", q, 1);
    expect(one("1 tortilla chip", 2)).toBe("2 tortilla chips");
    expect(one("1 cookie dough bite", 2)).toBe("2 cookie dough bites");
    expect(one("1 roll-up", 2)).toBe("2 roll-ups");
    expect(one("1 fruit roll-up", 3)).toBe("3 fruit roll-ups");
    expect(one("1 cracker crisp", 4)).toBe("4 cracker crisps");
    expect(one("1 bar bite", 2)).toBe("2 bar bites");
    expect(one("1 peanut butter cup", 2)).toBe("2 peanut butter cups");
    // ...back to one
    expect(one("10 tortilla chips", 0.1)).toBe("1 tortilla chip");
    expect(one("2 cookie dough bites", 0.5)).toBe("1 cookie dough bite");
    expect(one("2 roll-ups", 0.5)).toBe("1 roll-up");
    // the measure still counts when what follows it is what's in it
    expect(one("1 slice whole wheat bread", 2)).toBe("2 slices whole wheat bread");
    expect(one("1 link sausage", 2)).toBe("2 links sausage");
    expect(one("1 cup sliced", 2)).toBe("2 cups sliced");
    expect(one("1 tortilla", 2)).toBe("2 tortillas");
    expect(one("1 cookie", 2)).toBe("2 cookies");
  });

  it("a plural last word in a 1-or-less label is what's in the measure: the measure takes the count (review fix 1)", () => {
    const one = (label: string, q: number) => formatAmount([{ label, grams: 10 }], 0, "serving", q, 1);
    expect(one("1 cup chocolate chips", 2)).toBe("2 cups chocolate chips");
    expect(one("1/4 cup tortilla chips", 2)).toBe("½ cup tortilla chips");
    expect(one("2 cups chocolate chips", 0.5)).toBe("1 cup chocolate chips");
    expect(one("1 bag potato chips", 2)).toBe("2 bags potato chips");
    expect(one("1 package peanut butter cups", 2)).toBe("2 packages peanut butter cups");
    expect(one("1 cup rice crisps", 2)).toBe("2 cups rice crisps");
    // ...while a counted last word that agrees with the label's count still takes it
    expect(one("1 tortilla chip", 2)).toBe("2 tortilla chips");
    expect(one("10 tortilla chips", 0.1)).toBe("1 tortilla chip");
    expect(one("1 cookie dough bite", 2)).toBe("2 cookie dough bites");
    expect(one("6 pitted prunes", 1)).toBe("6 pitted prunes");
    expect(one("1 cup sliced", 2)).toBe("2 cups sliced");
    expect(one("1 slice whole wheat bread", 2)).toBe("2 slices whole wheat bread");
    expect(one("1 large", 2)).toBe("2 large");
    expect(one("1 medium egg", 2)).toBe("2 medium eggs");
    expect(one("1 tbsp", 2)).toBe("2 tbsp");
  });

  it("singularises -ies words to what they were: cookies → cookie, berries → berry (§37)", () => {
    const one = (label: string, q: number) => formatAmount([{ label, grams: 10 }], 0, "serving", q, 1);
    expect(one("2 cookies", 0.5)).toBe("1 cookie");
    expect(one("2 chocolate chip cookies", 0.5)).toBe("1 chocolate chip cookie");
    expect(one("2 brownies", 0.5)).toBe("1 brownie");
    expect(one("2 smoothies", 0.5)).toBe("1 smoothie");
    expect(one("2 pies", 0.5)).toBe("1 pie");
    expect(one("2 veggies", 0.5)).toBe("1 veggie");
    expect(one("2 strawberries", 0.5)).toBe("1 strawberry");
    expect(one("2 patties", 0.5)).toBe("1 patty");
    expect(one("2 candies", 0.5)).toBe("1 candy");
    expect(one("2 cookies, crumbled", 0.5)).toBe("1 cookie, crumbled");
    // and the other way stays right
    expect(one("1 cookie", 3)).toBe("3 cookies");
    expect(one("1 strawberry", 3)).toBe("3 strawberries");
    expect(one("1 brownie", 2)).toBe("2 brownies");
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
