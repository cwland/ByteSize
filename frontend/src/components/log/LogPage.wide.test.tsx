import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import LogPage from "./LogPage";
import { SelectedDayProvider } from "../../selectedDay";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";
import { wideScreen } from "../../test/wide";
import { culuryOff, dayJson, entryJson, mealTotals, settingsMe } from "../../test/fixtures";

const toast = entryJson(); // 160 cal, 6 g protein, 30 g carbs, 2 g fat, 4 g fiber
const bar = entryJson({ id: 2, name: "Peanut butter bar", nutrients: { calories: 127, protein_g: 10, carbs_g: 1, fat_g: 22 } }); // no fiber
const water = entryJson({ id: 3, meal: "supplements", name: "Water", source: "water", sourceRef: null, nutrients: { water_ml: 473 } });
// As GET /api/day sends them: sums with unknown as 0, and how many foods lack each nutrient (water isn't a food)
const unknownCount = { fiber_g: 1, saturated_fat_g: 2, sugar_g: 2, added_sugar_g: 2, sugar_alcohol_g: 2, sodium_mg: 2, potassium_mg: 2, magnesium_mg: 2, water_ml: 2 };
const totals = { calories: 287, protein_g: 16, carbs_g: 31, fat_g: 24, fiber_g: 4, saturated_fat_g: 0, sugar_g: 0, added_sugar_g: 0, sugar_alcohol_g: 0, sodium_mg: 0, potassium_mg: 0, magnesium_mg: 0, water_ml: 473, unknownCount };
const day = dayJson({
  entries: [toast, bar, water],
  totals,
  meals: {
    breakfast: mealTotals(287, { protein_g: 16, carbs_g: 31, fat_g: 24, fiber_g: 4 }),
    lunch: mealTotals(0, { suggested: 490 }),
    dinner: mealTotals(0, { suggested: 686 }),
    snacks: mealTotals(0, { suggested: 392 }),
    supplements: mealTotals(0),
  },
});

function show(d: object = day) {
  wideScreen();
  fakeServer({ ...culuryOff, "GET /api/day/:date": () => d, "GET /api/settings/me": () => settingsMe, "GET /api/days/logged": () => ({ days: [] }) });
  renderWithSession(
    <SelectedDayProvider timeZone="America/Boise">
      <LogPage />
    </SelectedDayProvider>,
  );
}

const row = (table: HTMLElement, name: string) => {
  const r = within(table).getByRole("rowheader", { name }).closest("tr")!;
  return within(r).getAllByRole("cell").map((c) => c.textContent);
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T19:00:00Z"));
});
afterEach(() => void vi.useRealTimers());

describe("Log on a wide screen", () => {
  it("has a header with the title, the week strip and a My foods link", async () => {
    show();
    expect(screen.getByRole("heading", { level: 1, name: "Log" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Days" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "My foods" })).toHaveAttribute("href", "#/log/my-foods?from=/log");
    expect(await screen.findByRole("region", { name: "Breakfast" })).toBeInTheDocument();
  });

  it("Day totals: eaten against the target range, — with no target, blank when unknown, a note when partly unknown", async () => {
    show();
    const table = await screen.findByRole("table", { name: "Day totals" });
    expect(within(table).getAllByRole("columnheader").map((c) => c.textContent)).toEqual(["Nutrient", "Eaten", "Target"]);
    expect(within(table).getAllByRole("rowheader").map((c) => c.textContent)).toEqual(["Calories", "Protein", "Carbs", "Fat", "Fiber", "Sugar", "Sodium", "Water"]);
    expect(row(table, "Calories")).toEqual(["287", "1,810–2,110"]);
    expect(row(table, "Protein")).toEqual(["16 g", "126–180 g"]);
    expect(row(table, "Carbs")).toEqual(["31 g", "—"]);
    expect(row(table, "Fat")).toEqual(["24 g", "—"]);
    // The bar doesn't know its fiber: the known 4 g, marked as not the whole story
    expect(row(table, "Fiber")).toEqual(["4 g+ some unknown", "25–38 g"]);
    // Neither food knows sugar or sodium: blank, never 0
    expect(row(table, "Sugar")).toEqual(["", "—"]);
    expect(row(table, "Sodium")).toEqual(["", "—"]);
    expect(row(table, "Water")).toEqual(["16 fl oz", "64–128 fl oz"]);
  });

  it("with no plan every target is —", async () => {
    show({ ...day, targets: null });
    const table = await screen.findByRole("table", { name: "Day totals" });
    expect(row(table, "Calories")).toEqual(["287", "—"]);
    expect(row(table, "Water")).toEqual(["16 fl oz", "—"]);
  });

  it("an empty day totals 0", async () => {
    const zero = Object.fromEntries(Object.keys(totals).filter((k) => k !== "unknownCount").map((k) => [k, 0]));
    show({ ...day, entries: [], totals: { ...zero, unknownCount: {} } });
    const table = await screen.findByRole("table", { name: "Day totals" });
    expect(row(table, "Calories")).toEqual(["0", "1,810–2,110"]);
    expect(row(table, "Sodium")).toEqual(["0 mg", "—"]);
  });

  it("takes the numbers from the day's totals as the server sums them", async () => {
    show({ ...day, totals: { ...totals, calories: 300, protein_g: 16.4, unknownCount: { ...unknownCount, fiber_g: 0, sugar_g: 1 } } });
    const table = await screen.findByRole("table", { name: "Day totals" });
    expect(row(table, "Calories")).toEqual(["300", "1,810–2,110"]);
    expect(row(table, "Protein")).toEqual(["16 g", "126–180 g"]);
    expect(row(table, "Fiber")).toEqual(["4 g", "25–38 g"]);
    expect(row(table, "Sugar")).toEqual(["0 g+ some unknown", "—"]);
  });

  it("meal cards sit in a grid, supplements and water full width", async () => {
    show();
    const grid = await screen.findByTestId("meal-grid");
    expect(grid).toHaveClass("xl:grid-cols-2");
    expect(within(grid).getByRole("region", { name: "Supplements & water" }).parentElement).toHaveClass("xl:col-span-2");
  });
});
