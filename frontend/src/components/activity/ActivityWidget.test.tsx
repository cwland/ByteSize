import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ActivityWidget from "./ActivityWidget";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";
import { activityJson, dayJson, workoutJson } from "../../test/fixtures";

// §40b: the viewed day's steps and workouts, + Steps and + Workout. Today is Nov 16 in Boise.
const TODAY = "2026-11-16";
const frozen = () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T19:00:00Z"));
};

function show(activity: object, routes: Record<string, (b: any) => unknown> = {}, day = TODAY, over: Record<string, unknown> = {}) {
  const server = fakeServer({ "GET /api/activity/:day": () => activity, ...routes });
  renderWithSession(<ActivityWidget day={day} data={dayJson({ day, activity, ...over }) as any} />);
  return server;
}

describe("Activity widget", () => {
  afterEach(() => void vi.useRealTimers());

  it("shows the day's steps (and where they came from) and its workouts with minutes and calories", async () => {
    frozen();
    show(activityJson({ steps: 8123, stepsSource: "health", workouts: [workoutJson({ type: "run", minutes: 25, calories: 280 }), workoutJson({ id: 2, type: "strength", minutes: 40, calories: null })], earned: 280 }));
    const card = screen.getByRole("region", { name: "Activity" });
    expect(within(card).getByTestId("steps")).toHaveTextContent("8,123");
    expect(within(card).getByText("steps · from Health")).toBeInTheDocument();
    const list = within(card).getByRole("list", { name: "Workouts" });
    const items = within(list).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Run");
    expect(items[0]).toHaveTextContent("25 min · 280 cals");
    expect(items[1]).toHaveTextContent("Strength");
    expect(items[1]).toHaveTextContent("40 min · 0 cals"); // not given: 0 (§31)
  });

  it("with nothing yet: says so, with + Steps and + Workout", async () => {
    frozen();
    show(activityJson());
    const card = screen.getByRole("region", { name: "Activity" });
    expect(within(card).getByText("No steps yet")).toBeInTheDocument();
    expect(within(card).getByText("No workouts yet")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "+ Steps" })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "+ Workout" })).toBeInTheDocument();
    expect(within(card).queryByRole("progressbar")).not.toBeInTheDocument(); // no step goal
  });

  it("a step goal shows a small bar toward it", async () => {
    frozen();
    show(activityJson({ steps: 6000, stepGoal: 8000 }));
    const bar = screen.getByRole("progressbar", { name: "Steps toward your goal" });
    expect(bar).toHaveAttribute("aria-valuenow", "6000");
    expect(bar).toHaveAttribute("aria-valuemax", "8000");
    expect(screen.getByText("of 8,000")).toBeInTheDocument();
  });

  it("+ Steps sets the day's total", async () => {
    frozen();
    const server = show(activityJson({ typedSteps: 4000, steps: 4000, stepsSource: "manual" }), { "PUT /api/steps/:day": () => ({ day: TODAY, steps: 6500, stepsSource: "manual" }) });
    await userEvent.click(screen.getByRole("button", { name: "+ Steps" }));
    const sheet = screen.getByRole("dialog", { name: "Steps" });
    const input = within(sheet).getByLabelText("Steps for the day");
    expect(input).toHaveValue(4000);
    await userEvent.clear(input);
    await userEvent.type(input, "6500");
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    expect(server.writes()).toEqual([expect.objectContaining({ method: "PUT", path: `/api/steps/${TODAY}`, body: { steps: 6500 } })]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Health's steps say so in the sheet; typed steps can be deleted", async () => {
    frozen();
    const server = show(activityJson({ steps: 9000, stepsSource: "health", typedSteps: 3000 }), { "DELETE /api/steps/:day": () => ({ status: 204 }) });
    await userEvent.click(screen.getByRole("button", { name: "Steps: 9,000. Change" }));
    const sheet = screen.getByRole("dialog", { name: "Steps" });
    expect(within(sheet).getByText("Your phone sent 9,000 steps for this day. That number is used while it's there.")).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: "Delete typed steps" }));
    expect(server.writes()).toEqual([expect.objectContaining({ method: "DELETE", path: `/api/steps/${TODAY}` })]);
  });

  it("+ Workout: type, minutes, Estimate from type × minutes × weight, note; saves it", async () => {
    frozen();
    const server = show(activityJson(), {
      "GET /api/workouts/estimate": () => ({ calories: 245, met: 9.8, weightKg: 100 }),
      "POST /api/workouts": (b) => ({ workout: workoutJson({ ...b, id: 9 }) }),
    });
    await userEvent.click(screen.getByRole("button", { name: "+ Workout" }));
    const sheet = screen.getByRole("dialog", { name: "Workout" });
    await userEvent.selectOptions(within(sheet).getByLabelText("Type"), "run");
    await userEvent.clear(within(sheet).getByLabelText("Minutes"));
    await userEvent.type(within(sheet).getByLabelText("Minutes"), "15");
    await userEvent.click(within(sheet).getByRole("button", { name: "Estimate" }));
    expect(server.sent.find((s) => s.path.startsWith("/api/workouts/estimate"))!.path).toBe("/api/workouts/estimate?type=run&minutes=15");
    expect(await within(sheet).findByDisplayValue("245")).toBeInTheDocument();
    expect(within(sheet).getByText("About 245 calories for 15 minutes at your weight.")).toBeInTheDocument();
    await userEvent.type(within(sheet).getByLabelText("Note (optional)"), "Intervals");
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    expect(server.writes()).toEqual([expect.objectContaining({ method: "POST", path: "/api/workouts", body: { day: TODAY, type: "run", minutes: 15, calories: 245, note: "Intervals" } })]);
  });

  it("Estimate without a weight says what to do", async () => {
    frozen();
    show(activityJson(), { "GET /api/workouts/estimate": () => ({ status: 409, json: { error: "Add your weight first, then Estimate can work it out" } }) });
    await userEvent.click(screen.getByRole("button", { name: "+ Workout" }));
    await userEvent.click(screen.getByRole("button", { name: "Estimate" }));
    expect(await screen.findByText("Add your weight first, then Estimate can work it out")).toBeInTheDocument();
  });

  it("calories are optional: left empty they're sent as unknown", async () => {
    frozen();
    const server = show(activityJson(), { "POST /api/workouts": (b) => ({ workout: workoutJson(b) }) });
    await userEvent.click(screen.getByRole("button", { name: "+ Workout" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save" }));
    expect(server.writes()[0].body).toEqual({ day: TODAY, type: "walk", minutes: 30, calories: null, note: null });
  });

  it("tap a workout to edit or delete it", async () => {
    frozen();
    const w = workoutJson({ id: 5, type: "yoga", minutes: 20, calories: 60, note: "Morning" });
    const server = show(activityJson({ workouts: [w], earned: 60 }), {
      "PATCH /api/workouts/:id": (b) => ({ workout: { ...w, ...b } }),
      "DELETE /api/workouts/:id": () => ({ status: 204 }),
    });
    await userEvent.click(screen.getByRole("button", { name: "Yoga, 20 min. Edit" }));
    let sheet = screen.getByRole("dialog", { name: "Workout" });
    expect(within(sheet).getByLabelText("Note (optional)")).toHaveValue("Morning");
    await userEvent.clear(within(sheet).getByLabelText("Minutes"));
    await userEvent.type(within(sheet).getByLabelText("Minutes"), "25");
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    expect(server.writes()[0]).toMatchObject({ method: "PATCH", path: "/api/workouts/5", body: { type: "yoga", minutes: 25, calories: 60, note: "Morning" } });
    await userEvent.click(screen.getByRole("button", { name: "Yoga, 20 min. Edit" }));
    sheet = screen.getByRole("dialog", { name: "Workout" });
    await userEvent.click(within(sheet).getByRole("button", { name: "Delete" }));
    expect(server.writes()[1]).toMatchObject({ method: "DELETE", path: "/api/workouts/5" });
  });

  it("future days: nothing to add yet", async () => {
    frozen();
    show(activityJson({ day: "2026-11-18" }), {}, "2026-11-18");
    expect(screen.queryByRole("button", { name: "+ Steps" })).not.toBeInTheDocument();
    expect(screen.getByText("Activity can be added for today or earlier days.")).toBeInTheDocument();
  });

  it("without the day's data (the Goals page) it loads the day itself", async () => {
    frozen();
    fakeServer({ "GET /api/activity/:day": () => activityJson({ steps: 1234, stepsSource: "manual" }) });
    renderWithSession(<ActivityWidget day={TODAY} data={null} />);
    expect(await screen.findByTestId("steps")).toHaveTextContent("1,234");
  });
});
