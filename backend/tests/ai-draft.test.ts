import { describe, expect, it } from "vitest";
import { aiDraft } from "../src/lib/foods.js";

// An AI answer becomes a draft food. A detail the person never typed (a long serving name) mustn't throw the
// whole estimate away: Cory's Describe of a breakfast sandwich failed on a 62-character serving label.
const sandwich = {
  name: "2 eggs with 1 tbsp low-calorie mayo on a low-calorie English muffin",
  brand: null,
  category: "Breakfast sandwich (homemade)",
  servings: [{ label: "1 sandwich (2 eggs, 1 tbsp light mayo, 1 light English muffin)", grams: 171 }],
  nutrients: { calories: 268, protein_g: 18, fiber_g: 2, carbs_g: 22, fat_g: 13, saturated_fat_g: 3.7, sugar_g: 2.5, added_sugar_g: 1, sodium_mg: 460, potassium_mg: 250, magnesium_mg: 33, water_ml: 140 },
  assumed: false,
};

describe("AI serving labels", () => {
  it("a serving label over 60 characters is shortened at a word, not rejected", () => {
    const draft = aiDraft(sandwich);
    expect(draft).not.toBeNull();
    const label = draft!.servings[0].label;
    expect(label.length).toBeLessThanOrEqual(60);
    expect(label).toBe("1 sandwich (2 eggs, 1 tbsp light mayo, 1 light English…");
    expect(draft!.servings[0].grams).toBe(171);
    expect(draft!.nutrients.calories).toBe(268);
  });

  it("a label of 60 characters or fewer is kept as is", () => {
    const draft = aiDraft({ ...sandwich, servings: [{ label: "1 sandwich", grams: 171 }] });
    expect(draft!.servings[0].label).toBe("1 sandwich");
  });

  it("one long word is cut at 59 characters plus the ellipsis", () => {
    const draft = aiDraft({ ...sandwich, servings: [{ label: "x".repeat(80), grams: 10 }] });
    expect(draft!.servings[0].label).toBe(`${"x".repeat(59)}…`);
  });

  it("a blank label is still refused", () => {
    expect(aiDraft({ ...sandwich, servings: [{ label: "   ", grams: 10 }] })).toBeNull();
  });
});
