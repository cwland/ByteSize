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
  it("has one compact, centred header: the day above the week strip, a greeting with the streak under it", async () => {
    show();
    const header = screen.getByRole("banner", { name: "Day" });
    expect(header).toHaveClass("items-center", "text-center");
    const date = within(header).getByRole("heading", { level: 1, name: "Monday, Nov 16" });
    expect(date).toHaveClass("text-lg", "font-bold");
    const strip = within(header).getByRole("group", { name: "Days" });
    const greeting = await within(header).findByText("Good afternoon, Cory · 3-day streak");
    expect(greeting).toHaveClass("text-sm", "text-subtle");
    // in that order: day, strip, greeting
    expect(date.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(strip.compareDocumentPosition(greeting) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // smaller day buttons: about 40 px wide and 52 px tall
    expect(within(strip).getByRole("button", { name: "Mon 16" })).toHaveClass("w-10", "h-13");
  });

  it("the greeting uses the first name only, and leaves out the streak when there is none", async () => {
    wideScreen();
    fakeServer({ ...m3Routes, ...culuryOff, ...restaurantRoutes, "GET /api/day/:date": () => ({ ...day, streak: 0 }), "GET /api/settings/me": () => settingsMe, "GET /api/weight": () => weightJson(), "GET /api/foods/recent": () => ({ foods: [] }) });
    renderWithSession(
      <SelectedDayProvider timeZone="America/Boise">
        <Dashboard />
      </SelectedDayProvider>,
      { timezone: "America/Boise", displayName: "Cory Landers" },
    );
    expect(await screen.findByText("Good afternoon, Cory")).toBeInTheDocument();
  });

  it("lays out three columns: Today's food; the budget with water under it; Day totals, weight, GLP-1 and streak", async () => {
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

  it("Today's food lists the day's entries by meal with calories, and invites food under an empty meal", async () => {
    show();
    const food = await screen.findByRole("region", { name: "Today's food" });
    const breakfast = await within(food).findByRole("group", { name: "Breakfast" });
    expect(within(breakfast).getByText("160 cals")).toBeInTheDocument();
    expect(within(breakfast).getByRole("listitem")).toHaveTextContent(/Toast.*160/);
    const lunch = within(food).getByRole("group", { name: "Lunch" });
    expect(within(lunch).getByRole("listitem")).toHaveTextContent(/Peanut butter bar.*127/);
    const dinner = within(food).getByRole("group", { name: "Dinner" });
    expect(within(dinner).getByText("686 calories suggested")).toBeInTheDocument();
    expect(within(dinner).queryByRole("listitem")).not.toBeInTheDocument();
    // Unknown calories are blank, never "?" or 0
    const snack = within(within(food).getByRole("group", { name: "Snacks" })).getByRole("listitem");
    expect(snack).toHaveTextContent("Mystery snack");
    expect(snack).not.toHaveTextContent("?");
    expect(snack).not.toHaveTextContent(/\b0\b/);
    // Water isn't food: no Supplements group
    expect(within(food).queryByRole("group", { name: "Supplements & water" })).not.toBeInTheDocument();
    expect(within(food).getByRole("link", { name: "Open the log" })).toHaveAttribute("href", "#/log");

    await userEvent.setup().click(within(dinner).getByRole("button", { name: "Add food to Dinner" }));
    expect(await screen.findByRole("dialog", { name: "Add food to Dinner" })).toBeInTheDocument();
  });

  it("every meal has + Add food, after its last item when it has food", async () => {
    show();
    const food = await screen.findByRole("region", { name: "Today's food" });
    const lunch = await within(food).findByRole("group", { name: "Lunch" });
    const add = within(lunch).getByRole("button", { name: "Add food to Lunch" });
    expect(within(lunch).getByRole("listitem").compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const meal of ["Breakfast", "Dinner", "Snacks"]) expect(within(within(food).getByRole("group", { name: meal })).getByRole("button", { name: `Add food to ${meal}` })).toBeInTheDocument();
    await userEvent.setup().click(add);
    expect(await screen.findByRole("dialog", { name: "Add food to Lunch" })).toBeInTheDocument();
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
