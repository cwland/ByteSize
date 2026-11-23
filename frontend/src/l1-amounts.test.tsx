/// <reference types="node" /> // reads the server's shared amount cases from disk
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FRACTION_CHOICES, isBigAmount, splitWhole, unitChoices } from "./amounts";
import { amountFactor } from "./nutrition";
import FoodDetail, { defaultPortion, startingPortion } from "./components/log/FoodDetail";
import { wholeChoices } from "./components/log/AmountPicker";
import type { Serving, Unit } from "./types";

// L1 (SPEC-01 / SPEC-09): eighths, counted units from the server ("1 prune"), and a check before a big amount.

type Vector = { name: string; servings: Serving[]; servingIndex: number; unit: Unit; quantity: number; factor: number | null };
const vectors = JSON.parse(readFileSync(path.join(__dirname, "..", "..", "backend", "tests", "fixtures", "amount-vectors.json"), "utf8")) as Vector[];

describe("the web's amount math matches the server", () => {
  it.each(vectors.map((v) => [v.name, v] as const))("%s", (_, v) => {
    const run = () => amountFactor(v.servings, v.servingIndex, v.unit, v.quantity);
    if (v.factor === null) expect(run).toThrow();
    else expect(run()).toBeCloseTo(v.factor, 9);
  });
});

describe("fractions", () => {
  it("go in eighths, thirds included", () => {
    expect(FRACTION_CHOICES.map((f) => f.label)).toEqual(["—", "⅛", "¼", "⅓", "⅜", "½", "⅝", "⅔", "¾", "⅞"]);
    expect(splitWhole(2.375)).toEqual({ whole: 2, fraction: 0.375 });
    expect(splitWhole(1.7)).toEqual({ whole: 1, fraction: 0.667 });
  });
});

describe("the starting portion", () => {
  it("is the food's own serving, never a unit worked out from it", () => {
    expect(defaultPortion([{ label: "5 prunes", grams: 40 }, { label: "1 prune", grams: 8, derived: true }])).toMatchObject({ servingIndex: 0, unit: "serving", quantity: 1 });
    expect(defaultPortion([{ label: "100 g", grams: 100 }, { label: "1 bar", grams: 40 }, { label: "1 small", grams: 30, derived: true }])).toMatchObject({ servingIndex: 1 });
  });
});

describe("the server's starting amount", () => {
  const mix = { servings: [{ label: "100 g", grams: 100 }, { label: "2 Tbsp", grams: 12 }, { label: "1 tbsp", grams: 6, derived: true as const }], foodKind: "custom", source: "off" };
  it("a food starts where the server says: 2 | tbsp, not 1 × 2 Tbsp", () => {
    expect(startingPortion({ ...mix, start: { servingIndex: 2, unit: "serving", quantity: 2 } })).toEqual({ servingIndex: 2, unit: "serving", quantity: 2, fraction: 1 });
  });
  it("15 g starts at 15 g", () => {
    expect(startingPortion({ servings: [{ label: "100 g", grams: 100 }, { label: "15 g", grams: 15 }], foodKind: "custom", source: "off", start: { servingIndex: 0, unit: "g", quantity: 15 } })).toEqual({ servingIndex: 0, unit: "g", quantity: 15, fraction: 1 });
  });
  it("a FatSecret food with a spoon serving starts at its spoons too", () => {
    const fs = { servings: [{ label: "2.5 tbsp" }, { label: "1 tbsp", per: 0.4, derived: true as const }], foodKind: "custom", source: "fatsecret", start: { servingIndex: 1, unit: "serving" as Unit, quantity: 2.5 } };
    expect(startingPortion(fs)).toMatchObject({ servingIndex: 1, quantity: 2.5 });
  });
  it("one of a thing reads without the 1 (2 | tbsp, 6 | prune)", () => {
    expect(unitChoices(mix.servings).map((c) => c.label).slice(0, 3)).toEqual(["100 g", "2 Tbsp", "tbsp"]);
    expect(unitChoices([{ label: "1 SLICE (30 g)", grams: 30 }])[0].label).toBe("SLICE (30 g)");
  });
  it("a drink keeps its fl oz start, and a recipe its one serving", () => {
    const milk = { servings: [{ label: "100 ml", ml: 100, grams: 103 }, { label: "240 g", grams: 240 }], foodKind: "custom", source: "off", start: { servingIndex: 0, unit: "g" as Unit, quantity: 240 } };
    expect(startingPortion(milk)).toMatchObject({ unit: "fl_oz" });
    const recipe = { servings: [{ label: "1 serving (320 g)", grams: 320 }, { label: "100 g", grams: 100 }], foodKind: "recipe", source: "mine", start: { servingIndex: 0, unit: "serving" as Unit, quantity: 1 } };
    expect(startingPortion(recipe)).toEqual({ servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 });
  });
});

describe("the whole-number list", () => {
  it("grams and ml go through every number to 1,000 (144 g, not 125 then 150)", () => {
    expect(wholeChoices("g", 1)).toEqual(Array.from({ length: 1001 }, (_, i) => i));
    expect(wholeChoices("ml", 1)).toContain(144);
    expect(wholeChoices("serving", 1)).toEqual(Array.from({ length: 21 }, (_, i) => i));
  });
});

describe("big amounts", () => {
  const servings = [{ label: "1 medium", grams: 118 }];
  it("over 20 servings or 2,000 calories", () => {
    expect(isBigAmount(servings, { servingIndex: 0, unit: "serving", quantity: 21, fraction: 1 }, 2205)).toBe(true);
    expect(isBigAmount(servings, { servingIndex: 0, unit: "serving", quantity: 3, fraction: 1 }, 315)).toBe(false);
    expect(isBigAmount(servings, { servingIndex: 0, unit: "serving", quantity: 2, fraction: 1 }, 2100)).toBe(true);
    expect(isBigAmount(servings, { servingIndex: 0, unit: "g", quantity: 500, fraction: 1 }, 450)).toBe(false);
  });
});

describe("the food sheet", () => {
  const prunes = { name: "Prunes", icon: "🍇", servings: [{ label: "5 prunes", grams: 40 }, { label: "1 prune", grams: 8, derived: true as const }], nutrients: { calories: 150 } };
  const banana = { name: "Banana", icon: "🍌", servings: [{ label: "1 medium", grams: 118 }], nutrients: { calories: 105 } };

  it("logs 6 prunes from a 5-prune food", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => {});
    render(<FoodDetail food={prunes} initial={{ servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 }} submitLabel="Track" onSubmit={onSubmit} />);
    await user.click(screen.getByRole("button", { name: /Serving/ }));
    const unit = screen.getByRole("combobox", { name: "Unit" });
    expect(within(unit).getByRole("option", { name: "prune" })).toBeTruthy();
    await user.selectOptions(unit, "s:1");
    await user.selectOptions(screen.getByRole("combobox", { name: "Whole number" }), "6");
    expect(within(screen.getByRole("region", { name: "Summary" })).getByText("180")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Track" }));
    expect(onSubmit).toHaveBeenCalledWith({ servingIndex: 1, unit: "serving", quantity: 6, fraction: 1 }, false);
  });

  it("asks before a big amount", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => {});
    render(<FoodDetail food={banana} initial={{ servingIndex: 0, unit: "serving", quantity: 21, fraction: 1 }} submitLabel="Track" onSubmit={onSubmit} />);
    await user.click(screen.getByRole("button", { name: "Track" }));
    const ask = screen.getByRole("alertdialog");
    expect(within(ask).getByText("That's a lot — log 2,205 cal of Banana?")).toBeTruthy();
    await user.click(within(ask).getByRole("button", { name: "Change" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Track" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Log it" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("a normal amount logs straight away", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => {});
    render(<FoodDetail food={banana} initial={{ servingIndex: 0, unit: "serving", quantity: 2, fraction: 1 }} submitLabel="Track" onSubmit={onSubmit} />);
    await user.click(screen.getByRole("button", { name: "Track" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
