import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import DayTotals from "./DayTotals";
import { dayJson, entryJson } from "../../test/fixtures";
import type { Day } from "../../types";

// The Day totals widget (the old Log page's card): eaten vs the day's target range. §31: a nutrient a food
// doesn't say adds as 0, and the number shows — no blanks, no "+ some unknown".
const toast = entryJson(); // 160 cal, 6 g protein, 30 g carbs, 2 g fat, 4 g fiber
const bar = entryJson({ id: 2, name: "Peanut butter bar", nutrients: { calories: 127, protein_g: 10, carbs_g: 1, fat_g: 22 } }); // no fiber
const water = entryJson({ id: 3, meal: "supplements", name: "Water", source: "water", sourceRef: null, nutrients: { water_ml: 473 } });
// As GET /api/day sends them: sums with missing as 0, and how many foods lack each nutrient (water isn't a food)
const unknownCount = { fiber_g: 1, saturated_fat_g: 2, sugar_g: 2, added_sugar_g: 2, sugar_alcohol_g: 2, sodium_mg: 2, potassium_mg: 2, magnesium_mg: 2, water_ml: 2 };
const totals = { calories: 287, protein_g: 16, carbs_g: 31, fat_g: 24, fiber_g: 4, saturated_fat_g: 0, sugar_g: 0, added_sugar_g: 0, sugar_alcohol_g: 0, sodium_mg: 0, potassium_mg: 0, magnesium_mg: 0, water_ml: 473, unknownCount };
const day = dayJson({ entries: [toast, bar, water], totals }) as unknown as Day;

const show = (d: Day = day) => render(<DayTotals day={d} units="imperial" />);
const row = (name: string) => {
  const r = within(screen.getByRole("table", { name: "Day totals" })).getByRole("rowheader", { name }).closest("tr")!;
  return within(r).getAllByRole("cell").map((c) => c.textContent);
};

describe("Day totals", () => {
  it("eaten against the target range; — only where there is no target; missing nutrients add as 0", () => {
    show();
    const table = screen.getByRole("table", { name: "Day totals" });
    expect(within(table).getAllByRole("columnheader").map((c) => c.textContent)).toEqual(["Nutrient", "Eaten", "Target"]);
    expect(within(table).getAllByRole("rowheader").map((c) => c.textContent)).toEqual(["Calories", "Protein", "Carbs", "Fat", "Fiber", "Sugar", "Sodium", "Water"]);
    expect(row("Calories")).toEqual(["287", "1,810–2,110"]);
    expect(row("Protein")).toEqual(["16 g", "126–180 g"]);
    expect(row("Carbs")).toEqual(["31 g", "—"]);
    // The bar doesn't say its fiber: it adds 0, so the toast's 4 g is the total
    expect(row("Fiber")).toEqual(["4 g", "25–38 g"]);
    // Neither food says its sugar or sodium: 0
    expect(row("Sugar")).toEqual(["0 g", "—"]);
    expect(row("Sodium")).toEqual(["0 mg", "—"]);
    expect(row("Water")).toEqual(["16 fl oz", "64–128 fl oz"]);
    expect(table).not.toHaveTextContent(/unknown/);
  });

  it("with no plan every target is —", () => {
    show({ ...day, targets: null });
    expect(row("Calories")).toEqual(["287", "—"]);
    expect(row("Water")).toEqual(["16 fl oz", "—"]);
  });
});

// §41: the plan in force that day, with a way to change it (the same plan picker as Goals › Change plan)
describe("Day totals: the plan", () => {
  it("names the plan, with a small Change plan button that opens the plan picker", async () => {
    window.location.hash = "#/";
    show();
    expect(screen.getByText("Plan: Steady")).toBeInTheDocument();
    const change = screen.getByRole("button", { name: "Change plan" });
    expect(change).toHaveAttribute("title", "Change plan");
    change.click();
    // The plan picker comes back to the Dashboard when done or cancelled
    expect(window.location.hash).toBe("#/goals/plan?from=%2F");
    window.location.hash = "";
  });

  it("on a past day the plan is named, but there's no change-plan button (plans only start today) (§46)", () => {
    render(<DayTotals day={day} units="imperial" isToday={false} />);
    expect(screen.getByText("Plan: Steady")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change plan" })).not.toBeInTheDocument();
  });

  it("targets set by hand are 'Your own targets'", () => {
    show({ ...day, targets: { ...day.targets!, plan: null } });
    expect(screen.getByText("Plan: Your own targets")).toBeInTheDocument();
  });

  it("no plan: Pick a plan opens the plan picker", () => {
    show({ ...day, targets: null });
    expect(screen.queryByText(/^Plan:/)).not.toBeInTheDocument();
    screen.getByRole("button", { name: "Pick a plan" }).click();
    expect(window.location.hash).toBe("#/goals/plan?from=%2F");
    window.location.hash = "";
  });
});
