import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GoalsPage from "./GoalsPage";
import Dashboard from "../dashboard/Dashboard";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";
import { dayJson, goalJson, m3Routes, steadyTargets } from "../../test/fixtures";
import { wideScreen } from "../../test/wide";
import { SelectedDayProvider } from "../../selectedDay";

// §40c: goals on the Goals page (and the Dashboard): each active goal a widget of its own, the Goals list with
// + New goal, Past goals with ✓ / ✗; making, editing, ending and deleting a goal.

const workouts = goalJson({
  id: 9,
  type: "workouts",
  name: "Work out",
  target: 3,
  end: null,
  progress: { ...goalJson().progress, periods: [], current: { start: "2026-11-15", end: "2026-11-21", value: 1, target: 3, status: "open" }, hit: 0, done: 0, of: null, needed: null },
});
const met = goalJson({ id: 3, name: "October logging", start: "2026-10-01", end: "2026-10-31", frozen: true, progress: { ...goalJson().progress, state: "completed", current: null, hit: 5, done: 5, of: 5 } });
const missed = goalJson({
  id: 2,
  type: "weight_by_date",
  name: "Down to 200",
  target: 90.718474,
  period: "stretch",
  start: "2026-09-01",
  end: "2026-09-30",
  frozen: true,
  progress: { state: "missed", periods: [{ start: "2026-09-01", end: "2026-09-30", value: 91.5, target: 90.718474, status: "missed" }], current: null, hit: 0, done: 1, of: 1, needed: 1, startKg: 95, asOf: "2026-09-30" },
});

function goalsPage(goals: { active: unknown[]; past: unknown[] }, over: Record<string, (b: any, path: string) => unknown> = {}) {
  const server = fakeServer({ ...m3Routes, "GET /api/targets": () => ({ targets: steadyTargets }), "GET /api/goals": () => goals, ...over });
  renderWithSession(<GoalsPage />);
  return server;
}

describe("goals on the Goals page", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-18T19:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
    wideScreen(false);
  });

  it("each active goal is a widget: the ring for this week, the weeks so far, a bar per week, its dates", async () => {
    goalsPage({ active: [goalJson()], past: [] });
    const w = await screen.findByRole("region", { name: "Log most days" });
    expect(within(w).getByText("Log food 6 days a week")).toBeInTheDocument();
    expect(within(w).getByRole("img", { name: "4 of 6 days this week" })).toBeInTheDocument();
    expect(within(w).getByText("1 of 2 weeks hit")).toBeInTheDocument();
    expect(within(w).getByText("4 of 4 weeks needed")).toBeInTheDocument();
    expect(within(w).getByRole("img", { name: "Weeks: 1 hit, 1 missed, this one under way" })).toBeInTheDocument();
    expect(within(w).getByText("Nov 1 – Nov 28")).toBeInTheDocument();
  });

  it("a short first week is shown but not counted; a steps average says it's on days with steps", async () => {
    const short = { start: "2026-11-21", end: "2026-11-21", value: 0, target: 1, status: "unjudged" };
    const sat = goalJson({ start: "2026-11-21", progress: { ...goalJson().progress, periods: [short], current: short, hit: 0, done: 0, of: 1, needed: 1 } });
    const avg = goalJson({ id: 8, type: "steps", measure: "average", name: "Walk more", target: 8000, progress: { ...goalJson().progress, periods: [], current: { start: "2026-11-15", end: "2026-11-21", value: 7000, target: 8000, status: "open" } } });
    goalsPage({ active: [sat, avg], past: [] });
    expect(within(await screen.findByRole("region", { name: "Log most days" })).getByText("A short week: shown, not counted")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Walk more" })).getByText("Average on days with steps")).toBeInTheDocument();
  });

  it("with nothing saved, a goal's widget joins the shortest column of the default (phones: reading order)", async () => {
    wideScreen();
    goalsPage({ active: [goalJson()], past: [] });
    await screen.findByRole("region", { name: "Log most days" });
    const cols = within(screen.getByTestId("goals-columns")).getAllByTestId("widget-column");
    // Left: plan, goal date, goals, badges (4); right: weight, activity, trends, past goals (4): the left is first of equals
    expect(within(cols[0]).getByRole("region", { name: "Log most days" })).toBeInTheDocument();
  });

  it("a saved layout is shown as saved: a goal left off it stays off", async () => {
    goalsPage({ active: [goalJson(), workouts], past: [] }, { "GET /api/layouts/goals": () => ({ layout: { version: 1, columns: [["goal:9"], ["goals"], []] } }) });
    expect(await screen.findByRole("region", { name: "Work out" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Log most days" })).not.toBeInTheDocument();
    // ...but it's in the Goals list
    expect(within(screen.getByRole("region", { name: "Goals" })).getByText("Log most days")).toBeInTheDocument();
  });

  it("the Goals list shows each active goal with a line of progress; none yet says so", async () => {
    goalsPage({ active: [goalJson(), workouts], past: [] });
    const list = await screen.findByRole("region", { name: "Goals" });
    await within(list).findByText("Work out");
    expect(within(list).getByText("4 of 6 days this week")).toBeInTheDocument();
    expect(within(list).getByText("1 of 3 workouts this week")).toBeInTheDocument();
  });

  it("an empty Goals list says what goals can be", async () => {
    goalsPage({ active: [], past: [] });
    expect(await within(await screen.findByRole("region", { name: "Goals" })).findByText(/No goals yet/)).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Past goals" })).getByText("Goals you finish or end show here.")).toBeInTheDocument();
  });

  it("Past goals: newest first, ✓ completed or ✗ missed, with the dates and the final numbers; delete one", async () => {
    const ended = goalJson({ id: 1, name: "Gym", start: "2026-08-01", end: "2026-08-01", endedEarly: true, frozen: true, progress: { ...goalJson().progress, state: "ended", periods: [], current: null, hit: 0, done: 0, of: 0, needed: 0 } });
    const server = goalsPage({ active: [], past: [met, missed, ended] }, { "DELETE /api/goals/:id": () => ({ status: 204 }) });
    const past = await screen.findByRole("region", { name: "Past goals" });
    const items = await within(past).findAllByRole("listitem");
    expect(items.map((i) => i.getAttribute("aria-label"))).toEqual(["October logging", "Down to 200", "Gym"]);
    // Ended early with nothing to judge: neither ✓ nor ✗
    expect(within(items[2]).getByRole("img", { name: "Ended early" })).toBeInTheDocument();
    expect(within(items[2]).getByText("Ended early, before a full week")).toBeInTheDocument();
    expect(within(items[2]).getByText("Aug 1 – Aug 1")).toBeInTheDocument();
    expect(within(items[0]).getByRole("img", { name: "Completed" })).toBeInTheDocument();
    expect(within(items[0]).getByText("Completed · 5 of 5 weeks hit (4 needed)")).toBeInTheDocument();
    expect(within(items[0]).getByText("Oct 1 – Oct 31")).toBeInTheDocument();
    expect(within(items[1]).getByRole("img", { name: "Missed" })).toBeInTheDocument();
    expect(within(items[1]).getByText("Missed · ended at 201.7 lb · goal 200 lb")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(within(items[1]).getByRole("button", { name: "Delete Down to 200" }));
    await user.click(within(screen.getByRole("alertdialog", { name: "Delete this goal?" })).getByRole("button", { name: "Delete" }));
    expect(server.writes()).toEqual([expect.objectContaining({ method: "DELETE", path: "/api/goals/2" })]);
    // The page loads its goals again
    await waitFor(() => expect(server.sent.filter((s) => s.path === "/api/goals")).toHaveLength(2));
  });

  it("+ New goal: steps as an average a day, each week, ongoing — then the new goal's widget shows", async () => {
    let goals = { active: [] as unknown[], past: [] };
    const made = goalJson({ id: 12, type: "steps", measure: "average", name: "Steps", target: 8000, end: null, progress: { ...workouts.progress, current: { start: "2026-11-18", end: "2026-11-21", value: 6400, target: 8000, status: "open" } } });
    const server = goalsPage(goals, {
      "GET /api/goals": () => goals,
      "POST /api/goals": () => {
        goals = { active: [made], past: [] };
        return { goal: made, replaced: null };
      },
    });
    const user = userEvent.setup();
    await user.click(await within(await screen.findByRole("region", { name: "Goals" })).findByRole("button", { name: "New goal" }));
    const sheet = screen.getByRole("dialog", { name: "New goal" });
    await user.selectOptions(within(sheet).getByLabelText("Kind of goal"), "steps");
    await user.click(within(sheet).getByRole("radio", { name: "An average a day" }));
    expect(within(sheet).getByLabelText("Steps a day (average)")).toHaveValue(8000);
    expect(within(sheet).getByRole("checkbox", { name: "No end date (ongoing)" })).toBeChecked();
    expect(within(sheet).queryByLabelText("End")).not.toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "Add goal" }));
    expect(server.writes()).toEqual([expect.objectContaining({ method: "POST", path: "/api/goals", body: { type: "steps", target: 8000, period: "week", measure: "average", start: "2026-11-18", end: null } })]);
    expect(await screen.findByRole("region", { name: "Steps" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "New goal" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Steps" })).getByText("6,400 steps a day this week, of 8,000")).toBeInTheDocument();
  });

  it("a weight by a date runs over the whole stretch, needs an end, and is sent in kg", async () => {
    const server = goalsPage({ active: [], past: [] }, { "POST /api/goals": () => ({ status: 400, json: { error: "Choose an end date from today on" } }) });
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole("button", { name: "New goal" }))[0]);
    const sheet = screen.getByRole("dialog", { name: "New goal" });
    await user.selectOptions(within(sheet).getByLabelText("Kind of goal"), "weight_by_date");
    expect(within(sheet).queryByRole("radiogroup", { name: "How often" })).not.toBeInTheDocument();
    expect(within(sheet).queryByRole("checkbox", { name: "No end date (ongoing)" })).not.toBeInTheDocument();
    await user.type(within(sheet).getByLabelText("Goal weight (lb)"), "200");
    await user.clear(within(sheet).getByLabelText("End"));
    await user.type(within(sheet).getByLabelText("End"), "2027-01-31");
    await user.type(within(sheet).getByLabelText("Name (optional)"), "Down to 200");
    await user.click(within(sheet).getByRole("button", { name: "Add goal" }));
    const post = server.writes()[0];
    expect(post.body).toMatchObject({ type: "weight_by_date", period: "stretch", start: "2026-11-18", end: "2027-01-31", name: "Down to 200" });
    expect(post.body.target).toBeCloseTo(90.718, 3);
    // The server's words are shown, and the sheet stays open
    expect(await within(sheet).findByRole("alert")).toHaveTextContent("Choose an end date from today on");
  });

  it("a new goal of a kind already running says it replaces that one", async () => {
    goalsPage({ active: [workouts], past: [] });
    const user = userEvent.setup();
    await user.click(await within(await screen.findByRole("region", { name: "Goals" })).findByRole("button", { name: "New goal" }));
    const sheet = screen.getByRole("dialog", { name: "New goal" });
    expect(within(sheet).queryByText(/This replaces/)).not.toBeInTheDocument();
    await user.selectOptions(within(sheet).getByLabelText("Kind of goal"), "workouts");
    expect(within(sheet).getByText("This replaces your “Work out” goal: it ends today and moves to Past goals.")).toBeInTheDocument();
  });

  it("edit a goal: name, target, end date; End now and Delete ask first", async () => {
    const server = goalsPage(
      { active: [goalJson()], past: [] },
      { "PATCH /api/goals/:id": (b) => ({ goal: { ...goalJson(), ...b } }), "POST /api/goals/:id/end": () => ({ goal: goalJson({ endedEarly: true }) }), "DELETE /api/goals/:id": () => ({ status: 204 }) },
    );
    const user = userEvent.setup();
    const w = await screen.findByRole("region", { name: "Log most days" });
    await user.click(within(w).getByRole("button", { name: "Edit Log most days" }));
    let sheet = screen.getByRole("dialog", { name: "Edit goal" });
    expect(within(sheet).getByText("Logging days · Log food 6 days a week")).toBeInTheDocument();
    expect(within(sheet).queryByLabelText("Kind of goal")).not.toBeInTheDocument();
    expect(within(sheet).getByLabelText("Name (optional)")).toHaveValue("Log most days");
    await user.clear(within(sheet).getByLabelText("Days each week"));
    await user.type(within(sheet).getByLabelText("Days each week"), "5");
    await user.click(within(sheet).getByRole("checkbox", { name: "No end date (ongoing)" }));
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    expect(server.writes()[0]).toMatchObject({ method: "PATCH", path: "/api/goals/7", body: { target: 5, end: null, name: "Log most days" } });

    await user.click(within(await screen.findByRole("region", { name: "Log most days" })).getByRole("button", { name: "Edit Log most days" }));
    sheet = screen.getByRole("dialog", { name: "Edit goal" });
    await user.click(within(sheet).getByRole("button", { name: "End now" }));
    const confirm = screen.getByRole("alertdialog", { name: "End this goal today?" });
    await user.click(within(confirm).getByRole("button", { name: "End now" }));
    expect(server.writes()[1]).toMatchObject({ method: "POST", path: "/api/goals/7/end" });

    await user.click(within(await screen.findByRole("region", { name: "Log most days" })).getByRole("button", { name: "Edit Log most days" }));
    await user.click(within(screen.getByRole("dialog", { name: "Edit goal" })).getByRole("button", { name: "Delete goal" }));
    await user.click(within(screen.getByRole("alertdialog", { name: "Delete this goal?" })).getByRole("button", { name: "Delete" }));
    expect(server.writes()[2]).toMatchObject({ method: "DELETE", path: "/api/goals/7" });
  });

  it("a goal that hasn't started says when it starts, and offers Delete but not End now", async () => {
    goalsPage({ active: [goalJson({ start: "2026-12-01", end: null, progress: { ...goalJson().progress, state: "upcoming", periods: [], current: null, hit: 0, done: 0 } })], past: [] });
    const w = await screen.findByRole("region", { name: "Log most days" });
    expect(within(w).getByText("Starts Dec 1, ongoing")).toBeInTheDocument();
    await userEvent.setup().click(within(w).getByRole("button", { name: "Edit Log most days" }));
    const sheet = screen.getByRole("dialog", { name: "Edit goal" });
    expect(within(sheet).queryByRole("button", { name: "End now" })).not.toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Delete goal" })).toBeInTheDocument();
  });

  it("the Goals page has its own + New goal beside Edit page", async () => {
    goalsPage({ active: [], past: [] });
    await screen.findByText("Steady plan");
    const buttons = screen.getAllByRole("button", { name: "New goal" });
    expect(buttons.length).toBe(2); // the page's and the Goals widget's
    await userEvent.setup().click(buttons[0]);
    expect(screen.getByRole("dialog", { name: "New goal" })).toBeInTheDocument();
  });

  it("Edit page offers each active goal in Add widget once it's been taken off", async () => {
    goalsPage({ active: [goalJson()], past: [] }, { "PUT /api/layouts/goals": (b) => ({ layout: b }) });
    await screen.findByRole("region", { name: "Log most days" });
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit page" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Edit page" }));
    await user.click(screen.getByRole("button", { name: "Remove Log most days" }));
    await user.click(screen.getByRole("button", { name: "Add widget" }));
    const list = screen.getByRole("dialog", { name: "Add widget" });
    expect(within(list).getByText("Logging days goal: progress each week")).toBeInTheDocument();
    await user.click(within(list).getByRole("button", { name: "Add Log most days" }));
    expect(screen.getByRole("group", { name: "Log most days" })).toBeInTheDocument();
  });
});

describe("goals on the Dashboard", () => {
  afterEach(() => void vi.useRealTimers());

  it("a goal widget the person put on the Dashboard shows there; one no longer active doesn't", async () => {
    fakeServer({
      ...m3Routes,
      "GET /api/day/:date": () => dayJson(),
      "GET /api/goals": () => ({ active: [workouts], past: [] }),
      "GET /api/layouts/dashboard": () => ({ layout: { version: 1, columns: [["goal:9", "goal:7"], [], []] } }),
      "GET /api/settings/me": () => ({ mealWindows: { breakfast: "10:30", lunch: "14:30", snacks: "17:00", dinner: "21:00" }, waterButtonsMl: [237], weekStart: 0 }),
    });
    renderWithSession(
      <SelectedDayProvider timeZone="America/Boise">
        <Dashboard />
      </SelectedDayProvider>,
    );
    expect(await screen.findByRole("region", { name: "Work out" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Log most days" })).not.toBeInTheDocument();
  });
});
