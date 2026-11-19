import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import GoalsPage from "./GoalsPage";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";
import { wideScreen } from "../../test/wide";
import { m3Routes, steadyTargets } from "../../test/fixtures";
import { weightJson } from "../../test/weightFixtures";

const empty = { calories: null, protein_g: null, fiber_g: null, water_ml: null };
const weeks = [
  {
    start: "2026-11-15",
    end: "2026-11-21",
    daysLogged: 6,
    avg: { calories: 1850, protein_g: 98.4, fiber_g: 31.2, water_ml: 2366 },
    status: { calories: "in", protein_g: "below", fiber_g: "in", water_ml: "above" },
    weightChangeKg: -0.635,
  },
  { start: "2026-11-08", end: "2026-11-14", daysLogged: 0, avg: empty, status: empty, weightChangeKg: null },
];

function show(over: Record<string, () => unknown> = {}) {
  wideScreen();
  fakeServer({
    ...m3Routes,
    "GET /api/targets": () => ({ targets: steadyTargets }),
    "GET /api/weight": () => weightJson(),
    "GET /api/trends/weekly": () => ({ weeks }),
    ...over,
  });
  renderWithSession(<GoalsPage />);
}

describe("Goals on a wide screen", () => {
  it("has a page title with Edit page, and two balanced columns: plan, goal date and badges; weight and trends", async () => {
    show();
    expect(screen.getByRole("heading", { level: 1, name: "Goals" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit page" })).toBeInTheDocument();
    const grid = await screen.findByTestId("goals-columns");
    expect(grid).toHaveClass("lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]");
    const [left, right] = within(grid).getAllByTestId("dashboard-column");
    expect(within(left).getByRole("region", { name: "Plan" })).toBeInTheDocument();
    expect(within(left).getByRole("region", { name: "Goal date" })).toBeInTheDocument();
    expect(within(right).getByRole("region", { name: "Weight" })).toBeInTheDocument();
    expect(within(right).getByRole("region", { name: "Weekly trends" })).toBeInTheDocument();
    expect(await within(left).findByRole("region", { name: "Badges" })).toBeInTheDocument();
  });

  it("three columns in use: equal columns, as on the Dashboard", async () => {
    show({ "GET /api/layouts/goals": () => ({ layout: { version: 1, columns: [["your-plan"], ["goal-date"], ["badges"]] } }) });
    await screen.findByRole("region", { name: "Goal date" });
    const grid = screen.getByTestId("goals-columns");
    expect(within(grid).getAllByTestId("dashboard-column")).toHaveLength(3);
    expect(grid).not.toHaveClass("lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]");
  });

  it("weekly trends are a table: a row a week, columns for each average, weight and days logged", async () => {
    show();
    const table = await screen.findByRole("table", { name: "Weekly trends" });
    expect(within(table).getAllByRole("columnheader").map((c) => c.textContent)).toEqual(["Week", "Calories / day", "Protein", "Fiber", "Water", "Weight", "Logged"]);
    const [, first, second] = within(table).getAllByRole("row");
    expect(within(first).getByRole("rowheader")).toHaveTextContent("Nov 15–21");
    const cells = within(first).getAllByRole("cell");
    expect(cells.map((c) => c.textContent)).toEqual(["1,850✓", "98 g↓", "31 g✓", "80 fl oz↑", "−1.4 lb", "6 days"]);
    expect(within(cells[1]).getByRole("img", { name: "below range" })).toBeInTheDocument();
    // An empty week: dashes, not zeros
    expect(within(second).getAllByRole("cell").map((c) => c.textContent)).toEqual(["—", "—", "—", "—", "—", "Nothing logged"]);
    // The phone list is gone
    expect(within(screen.getByRole("region", { name: "Weekly trends" })).queryByRole("listitem")).not.toBeInTheDocument();
  });
});
