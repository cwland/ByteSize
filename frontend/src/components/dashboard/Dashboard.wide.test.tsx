import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Dashboard from "./Dashboard";
import { SelectedDayProvider } from "../../selectedDay";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";
import { wideScreen } from "../../test/wide";
import { culuryOff, dayJson, entryJson, m3Routes, mealTotals, restaurantRoutes, settingsMe } from "../../test/fixtures";
import { glp1View } from "../../test/glp1Fixtures";
import { weightJson } from "../../test/weightFixtures";

const toast = entryJson();
const bar = entryJson({ id: 2, meal: "lunch", name: "Peanut butter bar", nutrients: { calories: 127, protein_g: 10 } });
const mystery = entryJson({ id: 4, meal: "snacks", name: "Mystery snack", nutrients: { protein_g: 2 } }); // calories unknown
const water = entryJson({ id: 3, meal: "supplements", name: "Water", sourceRef: null, source: "water", nutrients: { water_ml: 473 } });
const day = dayJson({
  entries: [toast, bar, water, mystery],
  totals: { calories: 287, protein_g: 16, water_ml: 473, unknownCount: {} },
  meals: {
    breakfast: mealTotals(160, { suggested: 392 }),
    lunch: mealTotals(127, { suggested: 490 }),
    dinner: mealTotals(0, { suggested: 686 }),
    snacks: mealTotals(0, { suggested: 392 }),
    supplements: mealTotals(0),
  },
  streak: 3,
});

function show(over: Record<string, (b: any, path: string) => unknown> = {}) {
  wideScreen();
  const server = fakeServer({
    ...m3Routes,
    ...culuryOff,
    ...restaurantRoutes,
    "GET /api/day/:date": () => day,
    "GET /api/settings/me": () => settingsMe,
    "GET /api/weight": () => weightJson(),
    "GET /api/foods/recent": () => ({ foods: [] }),
    "GET /api/ai/status": () => ({ photos: true }),
    ...over,
  });
  renderWithSession(
    <SelectedDayProvider timeZone="America/Boise">
      <Dashboard />
    </SelectedDayProvider>,
    { timezone: "America/Boise" },
  );
  return server;
}

// Noon on Mon, Nov 16 in Boise (the fixtures' day): lunch is the meal of the moment
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T19:00:00Z"));
});
afterEach(() => void vi.useRealTimers());

describe("Dashboard on a wide screen", () => {
  it("has one compact, centred header: the day above the week strip, no greeting line, and Edit dashboard", async () => {
    show();
    const header = screen.getByRole("banner", { name: "Day" });
    expect(header).toHaveClass("items-center", "text-center");
    const date = within(header).getByRole("heading", { level: 1, name: "Monday, Nov 16" });
    expect(date).toHaveClass("text-lg", "font-bold");
    const strip = within(header).getByRole("group", { name: "Days" });
    expect(date.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // smaller day buttons: about 40 px wide and 52 px tall
    expect(within(strip).getByRole("button", { name: "Mon 16" })).toHaveClass("w-10", "h-13");
    // §34: no "Good afternoon, Cory · 3-day streak" (the Streak widget shows the streak), and the widgets
    // sit the normal card gap (16 px) under the strip
    await screen.findByRole("region", { name: "Streak" });
    expect(screen.queryByText(/Good (morning|afternoon|evening)/)).not.toBeInTheDocument();
    expect(within(header).queryByText(/streak/)).not.toBeInTheDocument();
    expect(header.parentElement).toHaveClass("gap-4");
    expect(within(header).getByRole("button", { name: "Edit dashboard" })).toBeInTheDocument();
  });

  it("lays out three columns: the Food widget; the budget with water under it; Day totals, weight, GLP-1 and streak", async () => {
    show({ "GET /api/glp1": () => glp1View() });
    const columns = await screen.findAllByTestId("dashboard-column");
    expect(columns).toHaveLength(3);
    expect(within(columns[0]).getByRole("region", { name: "Today's food" })).toBeInTheDocument();
    const middle = [...columns[1].querySelectorAll("section")].map((s) => s.getAttribute("aria-label"));
    expect(middle).toEqual(["Budget", "Water"]);
    const right = within(columns[2]);
    expect(await right.findByRole("region", { name: "Day totals" })).toBe(columns[2].firstElementChild);
    expect(right.getByRole("region", { name: "Weight" })).toBeInTheDocument();
    expect(await right.findByRole("region", { name: "GLP-1" })).toBeInTheDocument();
    expect(await right.findByRole("region", { name: "Streak" })).toBeInTheDocument();
    // No quick buttons any more (Add food is in Today's food), and no phone Photo button
    for (const b of ["Search food", "Barcode photo", "Label photo", "Restaurants", "Photo"]) expect(screen.queryByRole("button", { name: b })).not.toBeInTheDocument();
  });

  it("Day totals: the Log's card for the selected day, from the day already loaded (no new request)", async () => {
    const server = show();
    const table = await screen.findByRole("table", { name: "Day totals" });
    expect(within(table).getByRole("rowheader", { name: "Calories" }).closest("tr")).toHaveTextContent("287");
    expect(within(table).getByRole("rowheader", { name: "Water" })).toBeInTheDocument();
    expect(server.sent.filter((s) => s.path.startsWith("/api/day/")).map((s) => s.path)).toEqual(["/api/day/2026-11-16"]);
  });

  it("the Food widget is the Log's meal view: meal cards with entries, pills and Add Food on every meal", async () => {
    show();
    const food = await screen.findByRole("region", { name: "Today's food" });
    const breakfast = await within(food).findByRole("region", { name: "Breakfast" });
    expect(within(breakfast).getByRole("heading", { name: "Breakfast: 160 cals" })).toBeInTheDocument();
    const toastRow = within(breakfast).getByRole("button", { name: /Toast/ });
    expect(within(toastRow).getByText("160 cal")).toBeInTheDocument();
    expect(within(within(food).getByRole("region", { name: "Dinner" })).getByText("686 calories suggested")).toBeInTheDocument();
    // Supplements & water is there too, as on the Log page
    expect(within(food).getByRole("region", { name: "Supplements & water" })).toBeInTheDocument();
    expect(within(food).queryByRole("link", { name: "Open the log" })).not.toBeInTheDocument();
    for (const meal of ["Breakfast", "Lunch", "Dinner", "Snacks"]) expect(within(within(food).getByRole("region", { name: meal })).getByRole("button", { name: "Add Food" })).toBeInTheDocument();
    await userEvent.setup().click(within(within(food).getByRole("region", { name: "Lunch" })).getByRole("button", { name: "Add Food" }));
    expect(await screen.findByRole("dialog", { name: "Add food to Lunch" })).toBeInTheDocument();
  });

  it("tapping an entry opens it for editing, as on the Log page", async () => {
    show();
    await userEvent.setup().click(await screen.findByRole("button", { name: /Peanut butter bar/ }));
    expect(await screen.findByRole("dialog", { name: "Edit portion" })).toBeInTheDocument();
  });

  it("the Weight card draws a small trend line of recent weigh-ins", async () => {
    const server = show();
    const card = await screen.findByRole("region", { name: "Weight" });
    const line = await within(card).findByRole("img", { name: "Weight trend, recent weigh-ins" });
    expect(line.querySelector("polyline")).toHaveClass("text-action");
    // Recent weigh-ins: the last 8 weeks
    expect(server.sent.some((s) => s.path === "/api/weight?from=2026-09-21&to=2026-11-16")).toBe(true);
  });
});
