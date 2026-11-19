import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { widgetById, registryFor } from "./widgets";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";
import { dayJson, workoutCaloriesJson } from "../../test/fixtures";
import type { Day } from "../../types";

// §40b: workout calories on the Budget and Day totals widgets
const TODAY = "2026-11-16";
function show(id: string, day: Day, isToday = true) {
  fakeServer({});
  const W = widgetById(id)!.Component;
  renderWithSession(<W day={day.day} data={day} isToday={isToday} wide={false} />);
}
const bankDay = (bank: Record<string, unknown>, over: Record<string, unknown> = {}) =>
  dayJson({
    exercise: { calories: 320 },
    workoutCalories: workoutCaloriesJson({
      mode: "bank",
      earned: 320,
      bank: { weekStart: "2026-11-15", balance: 640, deposited: 800, spent: 160, weeklyCap: 1000, days: [{ day: "2026-11-15", deposit: 640, spent: 0 }, { day: TODAY, deposit: 160, spent: 160 }], thisDay: { overBy: 0, covered: 0, treatSpent: 0 }, ...bank },
      ...over,
    }),
  }) as unknown as Day;

describe("workout calories on the Budget and Day totals", () => {
  afterEach(() => void vi.useRealTimers());

  it("Just show them: 'Earned today: 320' on both; the range is the plan's", () => {
    const day = dayJson({ exercise: { calories: 320 }, workoutCalories: workoutCaloriesJson({ earned: 320 }) }) as unknown as Day;
    show("budget", day);
    const budget = screen.getByRole("region", { name: "Budget" });
    expect(within(budget).getByText("Earned today: 320")).toBeInTheDocument();
    expect(within(budget).getByTestId("exercise-calories")).toHaveTextContent("320");
    expect(within(budget).getByText("Earned")).toBeInTheDocument();
    expect(within(budget).getByText("Budget: 1,810–2,110 cals")).toBeInTheDocument();
  });

  it("another day says 'Earned' without 'today'; nothing earned: no line", () => {
    show("budget", dayJson({ exercise: { calories: 150 }, workoutCalories: workoutCaloriesJson({ earned: 150 }) }) as unknown as Day, false);
    expect(screen.getByText("Earned: 150")).toBeInTheDocument();
  });

  it("nothing earned: no Earned line", () => {
    show("budget", dayJson() as unknown as Day);
    expect(screen.queryByText(/Earned today/)).not.toBeInTheDocument();
  });

  it("Add to that day: says how much the range grew", () => {
    const day = dayJson({ targets: { ...dayJson().targets, calories: { min: 1970, max: 2270 } }, exercise: { calories: 320 }, workoutCalories: workoutCaloriesJson({ mode: "add", earned: 320, added: 160 }) }) as unknown as Day;
    show("budget", day);
    expect(screen.getByText("Earned today: 320 · 160 added to your range")).toBeInTheDocument();
    expect(screen.getByText("Budget: 1,970–2,270 cals")).toBeInTheDocument();
  });

  it("Weekly bank: 'Bank: 640 this week' with a small bar per day", () => {
    show("budget", bankDay({}));
    const bank = screen.getByRole("group", { name: "Bank" });
    expect(within(bank).getByText("Bank: 640 this week")).toBeInTheDocument();
    const bars = within(bank).getAllByRole("img");
    expect(bars.map((b) => b.getAttribute("aria-label"))).toEqual(["Sun: 640 in", "Mon: 160 in, 160 spent"]);
  });

  it("an over day covered by the bank says so; partly covered says how much", () => {
    show("budget", bankDay({ thisDay: { overBy: 250, covered: 250, treatSpent: 0 } }));
    expect(screen.getByText("Over by 250 — covered by your bank")).toBeInTheDocument();
  });

  it("the gauge shows a day the bank fully covered as covered, not over", () => {
    show("budget", { ...bankDay({ thisDay: { overBy: 250, covered: 250, treatSpent: 0 } }), totals: { calories: 2360, unknownCount: {} } } as unknown as Day);
    const centre = screen.getByTestId("gauge-centre");
    expect(centre).toHaveAttribute("data-state", "covered");
    expect(centre).toHaveTextContent("250");
    expect(centre).toHaveTextContent("covered by bank");
  });

  it("the gauge counts what the bank still didn't pay as over; a treat paid from the bank isn't counted against the range", () => {
    show("budget", { ...bankDay({ thisDay: { overBy: 250, covered: 100, treatSpent: 0 } }), totals: { calories: 2360, unknownCount: {} } } as unknown as Day);
    expect(screen.getByTestId("gauge-centre")).toHaveAttribute("data-state", "over");
    expect(screen.getByTestId("gauge-centre")).toHaveTextContent("150");
  });

  it("a treat paid from the bank leaves the rest of the range as it was", () => {
    show("budget", { ...bankDay({ thisDay: { overBy: 0, covered: 0, treatSpent: 300 } }), totals: { calories: 1900, unknownCount: {} } } as unknown as Day);
    expect(screen.getByTestId("gauge-centre")).toHaveAttribute("data-state", "left");
    expect(screen.getByTestId("gauge-centre")).toHaveTextContent("510"); // 2,110 − (1,900 − 300)
  });

  it("partly covered says how much the bank paid", () => {
    show("budget", bankDay({ thisDay: { overBy: 250, covered: 100, treatSpent: 0 } }));
    expect(screen.getByText("Over by 250 — your bank covered 100")).toBeInTheDocument();
  });

  it("treats paid from the bank show", () => {
    show("budget", bankDay({ thisDay: { overBy: 0, covered: 0, treatSpent: 300 } }));
    expect(screen.getByText("Treats: 300 from your bank")).toBeInTheDocument();
  });

  it("Day totals shows Earned today too", () => {
    show("day-totals", dayJson({ exercise: { calories: 320 }, workoutCalories: workoutCaloriesJson({ earned: 320 }) }) as unknown as Day);
    const totals = screen.getByRole("region", { name: "Day totals" });
    expect(within(totals).getByText("Earned today: 320")).toBeInTheDocument();
  });

  it("Activity is in both default layouts: the Dashboard's middle column under Water, Goals' right column under Weight", () => {
    const ids = (page: "dashboard" | "goals", col: number) => registryFor(page).filter((w) => w.column === col).map((w) => w.id);
    expect(ids("dashboard", 1)).toEqual(["budget", "water", "activity"]);
    expect(ids("goals", 1)).toEqual(["weight-chart", "activity", "weekly-trends", "past-goals"]);
  });
});
