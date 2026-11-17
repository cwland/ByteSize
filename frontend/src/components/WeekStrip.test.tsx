import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WeekStrip from "./WeekStrip";
import { SelectedDayProvider, useSelectedDay, weekOf } from "../selectedDay";
import { notifyDayChanged } from "../day";
import { fakeServer } from "../test/fakeServer";
import { renderWithSession } from "../test/renderWithSession";
import { settingsMe } from "../test/fixtures";

function Shown() {
  return <output aria-label="Selected day">{useSelectedDay().day}</output>;
}

// Logged days answered per request, like the server: only days inside from..to
function show(weekStart = 0, logged: string[] = []) {
  const server = fakeServer({
    "GET /api/settings/me": () => ({ ...settingsMe, weekStart }),
    "GET /api/days/logged": (_b, path) => {
      const q = new URLSearchParams(path.split("?")[1]);
      return { days: logged.filter((d) => d >= q.get("from")! && d <= q.get("to")!) };
    },
  });
  renderWithSession(
    <SelectedDayProvider timeZone="America/Boise">
      <WeekStrip />
      <Shown />
    </SelectedDayProvider>,
  );
  return server;
}

const strip = () => screen.getByRole("group", { name: "Days" });
const dayNames = (week: HTMLElement) => within(week).getAllByRole("button").map((b) => b.getAttribute("aria-label"));

describe("weekOf", () => {
  it("gives the 7 days from the most recent week start on or before the day", () => {
    expect(weekOf("2026-11-17", 0)).toEqual(["2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21"]);
    expect(weekOf("2026-11-17", 1)).toEqual(["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"]);
    expect(weekOf("2026-11-15", 0)[0]).toBe("2026-11-15"); // a week-start day starts its own week
    expect(weekOf("2026-11-15", 1)[0]).toBe("2026-11-09");
  });
});

describe("WeekStrip", () => {
  // Noon on Tue, Nov 17 in Boise
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-17T19:00:00Z"));
  });
  afterEach(() => void vi.useRealTimers());

  it("shows this week Sunday to Saturday with today selected and marked", async () => {
    show(0);
    const week = await screen.findByRole("group", { name: "Week of Nov 15" });
    expect(dayNames(week)).toEqual(["Sun 15", "Mon 16", "Tue 17", "Wed 18", "Thu 19", "Fri 20", "Sat 21"]);
    const tue = within(week).getByRole("button", { name: "Tue 17" });
    expect(tue).toHaveAttribute("aria-pressed", "true");
    expect(tue).toHaveAttribute("aria-current", "date");
    expect(within(week).getByRole("button", { name: "Mon 16" })).toHaveAttribute("aria-pressed", "false");
    expect(within(week).getByRole("button", { name: "Mon 16" })).not.toHaveAttribute("aria-current");
  });

  it("tapping a day selects it", async () => {
    show(0);
    const week = await screen.findByRole("group", { name: "Week of Nov 15" });
    await userEvent.setup().click(within(week).getByRole("button", { name: "Wed 18" }));
    expect(screen.getByLabelText("Selected day")).toHaveTextContent("2026-11-18");
    expect(within(week).getByRole("button", { name: "Wed 18" })).toHaveAttribute("aria-pressed", "true");
    expect(within(week).getByRole("button", { name: "Tue 17" })).toHaveAttribute("aria-pressed", "false");
  });

  it("Next week shows the following week and loads its dots", async () => {
    const server = show(0, ["2026-11-24"]);
    await screen.findByRole("group", { name: "Week of Nov 15" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Next week" }));
    expect(strip()).toHaveAttribute("data-visible-week", "2026-11-22");
    const next = screen.getByRole("group", { name: "Week of Nov 22" });
    await waitFor(() => expect(dayNames(next)).toEqual(["Sun 22", "Mon 23", "Tue 24, food logged", "Wed 25", "Thu 26", "Fri 27", "Sat 28"]));
    expect(server.sent.some((s) => s.path === "/api/days/logged?from=2026-11-22&to=2026-11-28")).toBe(true);
    // One more: the week after is loaded too (visible ±1)
    await user.click(screen.getByRole("button", { name: "Next week" }));
    expect(strip()).toHaveAttribute("data-visible-week", "2026-11-29");
    await waitFor(() => expect(server.sent.some((s) => s.path === "/api/days/logged?from=2026-12-06&to=2026-12-12")).toBe(true));
    // And back
    await user.click(screen.getByRole("button", { name: "Previous week" }));
    await user.click(screen.getByRole("button", { name: "Previous week" }));
    await user.click(screen.getByRole("button", { name: "Previous week" }));
    expect(strip()).toHaveAttribute("data-visible-week", "2026-11-08");
    expect(screen.getByRole("group", { name: "Week of Nov 8" })).toBeInTheDocument();
    // Paging doesn't change the selected day
    expect(screen.getByLabelText("Selected day")).toHaveTextContent("2026-11-17");
  });

  it("a day with food logged has a dot; days without have none", async () => {
    show(0, ["2026-11-16"]);
    const week = await screen.findByRole("group", { name: "Week of Nov 15" });
    expect(await within(week).findByRole("button", { name: "Mon 16, food logged" })).toBeInTheDocument();
    expect(within(week).getAllByTestId("logged-dot")).toHaveLength(1);
    expect(within(week).getByRole("button", { name: "Sun 15" })).toBeInTheDocument();
  });

  it("dots refresh when the log changes", async () => {
    const logged: string[] = [];
    show(0, logged);
    const week = await screen.findByRole("group", { name: "Week of Nov 15" });
    await waitFor(() => expect(within(week).getByRole("button", { name: "Tue 17" })).toBeInTheDocument());
    logged.push("2026-11-17");
    act(() => notifyDayChanged());
    expect(await within(week).findByRole("button", { name: "Tue 17, food logged" })).toBeInTheDocument();
  });

  it("a Monday week start shows Monday first with today in its column", async () => {
    show(1);
    const week = await screen.findByRole("group", { name: "Week of Nov 16" });
    expect(dayNames(week)).toEqual(["Mon 16", "Tue 17", "Wed 18", "Thu 19", "Fri 20", "Sat 21", "Sun 22"]);
    expect(within(week).getByRole("button", { name: "Tue 17" })).toHaveAttribute("aria-pressed", "true");
  });
});
