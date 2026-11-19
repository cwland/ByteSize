import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WorkoutCaloriesSetting from "./WorkoutCaloriesSetting";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";

// Goals › Your plan › Workout calories (§40b)
const show = (settings: object, routes: Record<string, (b: any) => unknown> = {}) => {
  const server = fakeServer({ "GET /api/workout-calories": () => ({ settings, effectiveFrom: null }), ...routes });
  renderWithSession(<WorkoutCaloriesSetting />);
  return server;
};

describe("Workout calories setting", () => {
  it("says how workout calories count now", async () => {
    show({ mode: "show", countPct: 50, weeklyCap: 1000 });
    const box = await screen.findByRole("group", { name: "Workout calories" });
    expect(within(box).getByText("Just show them")).toBeInTheDocument();
  });

  it("names the count and the cap", async () => {
    show({ mode: "bank", countPct: 75, weeklyCap: 1500 });
    expect(await screen.findByText("Weekly bank: 75% of what you earn, up to 1,500 a week")).toBeInTheDocument();
  });

  it("Change: pick Weekly bank with a count and cap; it applies from today", async () => {
    const server = show({ mode: "show", countPct: 50, weeklyCap: 1000 }, { "PUT /api/workout-calories": (b) => ({ settings: b, effectiveFrom: "2026-11-18" }) });
    await userEvent.click(await screen.findByRole("button", { name: "Change workout calories" }));
    const box = screen.getByRole("group", { name: "Workout calories" });
    expect(within(box).getByText("Changes apply from today. Past days keep what they had.")).toBeInTheDocument();
    expect(within(box).queryByLabelText("Weekly cap")).not.toBeInTheDocument();
    await userEvent.click(within(box).getByRole("radio", { name: /Weekly bank/ }));
    await userEvent.selectOptions(within(box).getByLabelText("Count"), "100");
    await userEvent.clear(within(box).getByLabelText("Weekly cap"));
    await userEvent.type(within(box).getByLabelText("Weekly cap"), "800");
    await userEvent.click(within(box).getByRole("button", { name: "Save" }));
    expect(server.writes()).toEqual([expect.objectContaining({ method: "PUT", path: "/api/workout-calories", body: { mode: "bank", countPct: 100, weeklyCap: 800 } })]);
    expect(await screen.findByText("Weekly bank: 100% of what you earn, up to 800 a week")).toBeInTheDocument();
  });

  it("Add to that day: the count only", async () => {
    const server = show({ mode: "show", countPct: 50, weeklyCap: 1000 }, { "PUT /api/workout-calories": (b) => ({ settings: b, effectiveFrom: "2026-11-18" }) });
    await userEvent.click(await screen.findByRole("button", { name: "Change workout calories" }));
    await userEvent.click(screen.getByRole("radio", { name: /Add to that day/ }));
    expect(screen.queryByLabelText("Weekly cap")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(server.writes()[0].body).toEqual({ mode: "add", countPct: 50, weeklyCap: 1000 });
    expect(await screen.findByText("Add to that day: 50% of what you earn")).toBeInTheDocument();
  });

  it("a cap outside 0–5,000 can't be saved", async () => {
    show({ mode: "bank", countPct: 50, weeklyCap: 1000 });
    await userEvent.click(await screen.findByRole("button", { name: "Change workout calories" }));
    await userEvent.clear(screen.getByLabelText("Weekly cap"));
    await userEvent.type(screen.getByLabelText("Weekly cap"), "6000");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByText("Enter a cap from 0 to 5,000")).toBeInTheDocument();
  });

  it("not loaded (an error): shows nothing", async () => {
    fakeServer({});
    const { container } = renderWithSession(<WorkoutCaloriesSetting />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
  });
});
