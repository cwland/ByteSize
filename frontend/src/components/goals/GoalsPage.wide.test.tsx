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

function show() {
  wideScreen();
  fakeServer({
    ...m3Routes,
    "GET /api/targets": () => ({ targets: steadyTargets }),
    "GET /api/weight": () => weightJson(),
    "GET /api/trends/weekly": () => ({ weeks }),
  });
  renderWithSession(<GoalsPage />);
}

describe("Goals on a wide screen", () => {
  it("has a page title, and the plan and weight cards side by side", async () => {
    show();
    expect(screen.getByRole("heading", { level: 1, name: "Goals" })).toBeInTheDocument();
    const pair = await screen.findByTestId("goals-top");
    expect(pair).toHaveClass("lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]");
    expect(within(pair).getByRole("region", { name: "Plan" })).toBeInTheDocument();
    expect(within(pair).getByRole("region", { name: "Weight" })).toBeInTheDocument();
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

  it("badges sit in a grid beside vacation mode and the GLP-1 link", async () => {
    show();
    const side = await screen.findByTestId("goals-bottom");
    expect(within(side).getByRole("region", { name: "Badges" })).toBeInTheDocument();
    expect(within(side).getByRole("region", { name: "Vacation mode" })).toBeInTheDocument();
    expect(within(side).getByRole("link", { name: "GLP-1 shots" })).toBeInTheDocument();
  });
});
