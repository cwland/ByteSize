import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import Dashboard from "../dashboard/Dashboard";
import GoalsPage from "../goals/GoalsPage";
import { SelectedDayProvider } from "../../selectedDay";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";
import { wideScreen } from "../../test/wide";
import { activityJson, workoutCaloriesJson, culuryOff, dayJson, m3Routes, restaurantRoutes, settingsMe, steadyTargets, workoutJson } from "../../test/fixtures";
import { weightJson } from "../../test/weightFixtures";

// §40b: the Activity widget once added to a page, on phones and wide screens
const activity = activityJson({ steps: 7400, stepsSource: "health", workouts: [workoutJson({ type: "cycling", minutes: 40, calories: 350 })], earned: 350 });

function dashboard(wide: boolean) {
  if (wide) wideScreen();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T19:00:00Z"));
  const server = fakeServer({
    ...m3Routes,
    ...culuryOff,
    ...restaurantRoutes,
    "GET /api/layouts/dashboard": () => ({ layout: { version: 1, columns: [["food"], ["budget", "activity"], ["day-totals"]] } }),
    "GET /api/day/:date": () => dayJson({ activity, exercise: { calories: 350 }, workoutCalories: workoutCaloriesJson({ earned: 350 }) }),
    "GET /api/settings/me": () => settingsMe,
    "GET /api/weight": () => weightJson(),
    "GET /api/foods/recent": () => ({ foods: [] }),
  });
  renderWithSession(
    <SelectedDayProvider timeZone="America/Boise">
      <Dashboard />
    </SelectedDayProvider>,
    { timezone: "America/Boise" },
  );
  return server;
}

describe("Activity on the widget pages", () => {
  afterEach(() => void vi.useRealTimers());

  for (const wide of [false, true]) {
    it(`Dashboard (${wide ? "wide" : "phone"}): reads the day it already loaded, without asking again`, async () => {
      const server = dashboard(wide);
      const card = await screen.findByRole("region", { name: "Activity" });
      expect(within(card).getByTestId("steps")).toHaveTextContent("7,400");
      expect(within(card).getByRole("list", { name: "Workouts" })).toHaveTextContent("Cycling");
      expect(server.sent.some((s) => s.path.startsWith("/api/activity"))).toBe(false);
      expect(within(screen.getByRole("region", { name: "Budget" })).getByText("Earned today: 350")).toBeInTheDocument();
    });
  }

  it("Goals: loads today's activity itself", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-16T19:00:00Z"));
    const server = fakeServer({
      ...m3Routes,
      "GET /api/targets": () => ({ targets: steadyTargets }),
      "GET /api/layouts/goals": () => ({ layout: { version: 1, columns: [["your-plan", "activity"], [], []] } }),
      "GET /api/activity/:day": () => activity,
    });
    renderWithSession(<GoalsPage />, { timezone: "America/Boise" });
    const card = await screen.findByRole("region", { name: "Activity" });
    expect(await within(card).findByTestId("steps")).toHaveTextContent("7,400");
    expect(server.sent.find((s) => s.path.startsWith("/api/activity"))!.path).toBe("/api/activity/2026-11-16");
  });
});
