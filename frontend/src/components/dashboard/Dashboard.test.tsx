import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Dashboard from "./Dashboard";
import { SelectedDayProvider } from "../../selectedDay";
import TopBar from "../TopBar";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";
import { dayJson, settingsMe } from "../../test/fixtures";

const totals = { calories: 1138, protein_g: 97, fiber_g: 29, water_ml: 769, unknownCount: {} };

function show(day: object, over: Record<string, (b: any) => unknown> = {}) {
  const server = fakeServer({
    "GET /api/day/:date": () => day,
    "GET /api/settings/me": () => settingsMe,
    ...over,
  });
  renderWithSession(
    <SelectedDayProvider timeZone="America/Denver">
      <TopBar />
      <Dashboard />
    </SelectedDayProvider>,
  );
  return server;
}

describe("Dashboard", () => {
  afterEach(() => void vi.useRealTimers());

  it("dashboard shows budget, food, left and rings from the day", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-17T03:00:00Z")); // still Nov 16 in Denver
    const server = show(dayJson({ totals, streak: 3 }));
    const budget = await screen.findByRole("region", { name: "Budget" });
    expect(server.sent.some((s) => s.path === "/api/day/2026-11-16")).toBe(true);
    expect(within(budget).getByText("Budget: 1,810–2,110 cals")).toBeInTheDocument();
    expect(within(budget).getByTestId("food-calories")).toHaveTextContent("1,138");
    expect(within(budget).getByTestId("exercise-calories")).toHaveTextContent("0");
    const centre = within(budget).getByTestId("gauge-centre");
    expect(centre).toHaveTextContent("972");
    expect(centre).toHaveTextContent("left");
    expect(within(budget).getByText("672 to reach your range")).toBeInTheDocument();
    expect(screen.getByText("97 / 126 g")).toBeInTheDocument();
    expect(screen.getByText("29 / 25 g")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Fiber/ })).toHaveAttribute("data-full", "true");
    expect(screen.getByRole("img", { name: /Protein/ })).toHaveAttribute("data-full", "false");
    expect(screen.getByText("26 / 64 fl oz")).toBeInTheDocument();
    expect(screen.getByText("3-day streak")).toBeInTheDocument();
  });

  it("over the range shows amber over", async () => {
    show(dayJson({ totals: { ...totals, calories: 2300 } }));
    const centre = await screen.findByTestId("gauge-centre");
    expect(centre).toHaveTextContent("190");
    expect(centre).toHaveTextContent("over");
    expect(centre).toHaveAttribute("data-state", "over");
    expect(screen.queryByText(/to reach your range/)).not.toBeInTheDocument();
  });

  it("unknown fiber shows a question mark that explains itself", async () => {
    show(dayJson({ totals: { ...totals, unknownCount: { fiber_g: 2 } } }));
    await userEvent.setup().click(await screen.findByRole("button", { name: "Why is fiber uncertain?" }));
    expect(screen.getByText("2 foods missing fiber")).toBeInTheDocument();
  });

  it("unknown calories are flagged on the gauge, not silently counted as 0", async () => {
    show(dayJson({ totals: { ...totals, unknownCount: { calories: 1 } } }));
    await userEvent.setup().click(await screen.findByRole("button", { name: "Why are calories uncertain?" }));
    expect(screen.getByText("1 food missing calories")).toBeInTheDocument();
  });

  it("water button logs 8 fl oz (237 ml) for the selected day", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-17T03:00:00Z"));
    let water = 769;
    const server = show(dayJson({ totals }), {
      "GET /api/day/:date": () => dayJson({ totals: { ...totals, water_ml: water } }),
      "POST /api/log": (b) => {
        water += b.water_ml;
        return { entry: { id: 9 } };
      },
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Previous day" }));
    await user.click(await screen.findByRole("button", { name: "+8 oz" }));
    expect(server.writes()).toContainEqual(expect.objectContaining({ method: "POST", path: "/api/log", body: { day: "2026-11-15", meal: "supplements", water_ml: 237 } }));
    expect(await screen.findByText("34 / 64 fl oz")).toBeInTheDocument();
  });

  it("no targets → pick a plan button", async () => {
    show(dayJson({ totals, targets: null }));
    expect(await screen.findByText("Pick a plan to see your budget")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Pick a plan" }));
    expect(window.location.hash).toBe("#/goals/plan");
  });
});
