import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DayPickerMenu from "./DayPicker";
import { SelectedDayProvider, useSelectedDay } from "../selectedDay";
import { notifyDayChanged } from "../day";
import { fakeServer } from "../test/fakeServer";
import { renderWithSession } from "../test/renderWithSession";
import { settingsMe } from "../test/fixtures";

function Shown() {
  return <output aria-label="Selected day">{useSelectedDay().day}</output>;
}
function GoTo({ day }: { day: string }) {
  const { select } = useSelectedDay();
  return <button onClick={() => select(day)}>go {day}</button>;
}

// Logged days answered per request, like the server: only days inside from..to
function show(opts: { weekStart?: number; logged?: string[]; placement?: "popover" | "bar" } = {}) {
  const { weekStart = 0, logged = [], placement = "popover" } = opts;
  const server = fakeServer({
    "GET /api/settings/me": () => ({ ...settingsMe, weekStart }),
    "GET /api/days/logged": (_b, path) => {
      const q = new URLSearchParams(path.split("?")[1]);
      return { days: logged.filter((d) => d >= q.get("from")! && d <= q.get("to")!) };
    },
  });
  renderWithSession(
    <SelectedDayProvider timeZone="America/Boise">
      <DayPickerMenu placement={placement}>Wednesday, Nov 18</DayPickerMenu>
      <Shown />
      <GoTo day="2026-10-05" />
    </SelectedDayProvider>,
    { timezone: "America/Boise" },
  );
  return server;
}

const trigger = () => screen.getByRole("button", { name: "Choose a day" });
const open = async () => {
  await userEvent.click(trigger());
  return screen.findByRole("dialog", { name: "Choose a day" });
};
const dayBtn = (cal: HTMLElement, label: RegExp | string) => within(cal).getByRole("button", { name: label });
const shown = () => screen.getByLabelText("Selected day").textContent;

describe("DayPicker (§39)", () => {
  // Noon on Wed, Nov 18 in Boise
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-18T19:00:00Z"));
  });
  afterEach(() => void vi.useRealTimers());

  it("is a button that opens a small calendar, and says so to assistive tech", async () => {
    show();
    expect(trigger()).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("dialog")).toBeNull();
    const cal = await open();
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(within(cal).getByText("November 2026")).toBeInTheDocument();
  });

  it("closes with the X, Escape, or tapping the date again, but not by clicking outside", async () => {
    show();
    let cal = await open();
    await userEvent.click(within(cal).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    cal = await open();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();

    await open();
    await userEvent.click(trigger());
    expect(screen.queryByRole("dialog")).toBeNull();

    await open();
    await userEvent.click(document.body);
    await userEvent.click(screen.getByLabelText("Selected day"));
    expect(screen.getByRole("dialog", { name: "Choose a day" })).toBeInTheDocument();
  });

  it("Escape closes it only from inside it: focus elsewhere on the page keeps it open (§46)", async () => {
    show();
    await open();
    screen.getByRole("button", { name: "go 2026-10-05" }).focus();
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Choose a day" })).toBeInTheDocument();
    // back inside: Escape closes it and focus returns to the date
    within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }).focus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  it("an Escape something else already handled doesn't close it (§46)", async () => {
    show();
    await open();
    const handled = (e: KeyboardEvent) => e.key === "Escape" && e.preventDefault();
    document.addEventListener("keydown", handled, true);
    try {
      await userEvent.keyboard("{Escape}"); // focus is on a day in the calendar
      expect(screen.getByRole("dialog", { name: "Choose a day" })).toBeInTheDocument();
    } finally {
      document.removeEventListener("keydown", handled, true);
    }
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("puts a dot under the days the server says have food, and tells screen readers", async () => {
    const server = show({ logged: ["2026-11-03", "2026-11-17"] });
    const cal = await open();
    await waitFor(() => expect(within(cal).getAllByTestId("logged-dot")).toHaveLength(2));
    expect(dayBtn(cal, "Tuesday, November 3, logged")).toBeInTheDocument();
    expect(dayBtn(cal, "Wednesday, November 4, not logged")).toBeInTheDocument();
    // the whole 6-week span the calendar shows, in one request
    expect(server.sent.filter((s) => s.path.startsWith("/api/days/logged")).map((s) => s.path)).toEqual(["/api/days/logged?from=2026-11-01&to=2026-12-12"]);
  });

  it("shows six rows of seven starting on the person's week start", async () => {
    show({ weekStart: 1 });
    const cal = await open();
    const heads = Array.from(cal.querySelectorAll("[data-weekday]")).map((e) => e.textContent);
    expect(heads).toEqual(["M", "T", "W", "T", "F", "S", "S"]);
    expect(within(cal).getAllByRole("row").filter((r) => r.querySelector("button[data-day]"))).toHaveLength(6);
    expect(cal.querySelectorAll("button[data-day]")).toHaveLength(42);
    expect(cal.querySelector("button[data-day]")).toHaveAttribute("data-day", "2026-10-26"); // Monday on or before Nov 1
  });

  it("starts weeks on Sunday by default", async () => {
    show();
    const cal = await open();
    expect(Array.from(cal.querySelectorAll("[data-weekday]")).map((e) => e.textContent)).toEqual(["S", "M", "T", "W", "T", "F", "S"]);
    expect(cal.querySelector("button[data-day]")).toHaveAttribute("data-day", "2026-11-01");
  });

  it("rings today, fills the viewed day, and focus starts on the viewed day", async () => {
    show();
    await userEvent.click(screen.getByText("go 2026-10-05"));
    const cal = await open();
    expect(within(cal).getByText("October 2026")).toBeInTheDocument(); // opens on the viewed day's month
    expect(dayBtn(cal, /^Monday, October 5/)).toHaveAttribute("aria-pressed", "true");
    expect(dayBtn(cal, /^Monday, October 5/)).toHaveFocus();
    expect(dayBtn(cal, /^Tuesday, October 6/)).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(within(cal).getByRole("button", { name: "Next month" }));
    expect(dayBtn(cal, /^Wednesday, November 18/)).toHaveAttribute("aria-current", "date");
    expect(dayBtn(cal, /^Wednesday, November 18/)).toHaveAttribute("aria-pressed", "false");
    expect(dayBtn(cal, /^Tuesday, November 17/)).not.toHaveAttribute("aria-current");
  });

  it("shows days after today dimmed and can't choose them", async () => {
    show();
    const cal = await open();
    const future = dayBtn(cal, /^Thursday, November 19/);
    expect(future).toBeDisabled();
    await userEvent.click(future);
    expect(shown()).toBe("2026-11-18");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(dayBtn(cal, /^Wednesday, November 18/)).toBeEnabled();
  });

  it("moves a month with ‹ ›, and can't go past the month of today", async () => {
    const server = show();
    const cal = await open();
    const next = within(cal).getByRole("button", { name: "Next month" });
    expect(next).toBeDisabled();
    await userEvent.click(within(cal).getByRole("button", { name: "Previous month" }));
    expect(within(cal).getByText("October 2026")).toBeInTheDocument();
    await waitFor(() => expect(server.sent.some((s) => s.path === "/api/days/logged?from=2026-09-27&to=2026-11-07")).toBe(true));
    expect(next).toBeEnabled();
    await userEvent.click(next);
    expect(within(cal).getByText("November 2026")).toBeInTheDocument();
  });

  it("Today chooses today and closes", async () => {
    show();
    await userEvent.click(screen.getByText("go 2026-10-05"));
    const cal = await open();
    await userEvent.click(within(cal).getByRole("button", { name: "Today" }));
    expect(shown()).toBe("2026-11-18");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("choosing a day changes the viewed day and closes, with focus back on the date", async () => {
    show();
    const cal = await open();
    await userEvent.click(dayBtn(cal, /^Tuesday, November 10/));
    expect(shown()).toBe("2026-11-10");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  it("a day from the month next door can be chosen too", async () => {
    show();
    await userEvent.click(screen.getByText("go 2026-10-05"));
    const cal = await open();
    await userEvent.click(dayBtn(cal, /^Sunday, September 27/)); // the first cell of October's grid
    expect(shown()).toBe("2026-09-27");
  });

  it("arrow keys move between days, Enter chooses", async () => {
    show();
    const cal = await open();
    expect(dayBtn(cal, /^Wednesday, November 18/)).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(dayBtn(cal, /^Tuesday, November 17/)).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}");
    expect(dayBtn(cal, /^Tuesday, November 10/)).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}{ArrowDown}");
    expect(dayBtn(cal, /^Wednesday, November 18/)).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}"); // tomorrow: not allowed, stays
    expect(dayBtn(cal, /^Wednesday, November 18/)).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}{Enter}");
    expect(shown()).toBe("2026-11-16");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("arrow keys carry on into the month before, and Page Up / Page Down change month", async () => {
    show();
    await userEvent.click(screen.getByText("go 2026-10-05"));
    const cal = await open();
    await userEvent.keyboard("{ArrowUp}"); // Sep 28
    expect(within(cal).getByText("September 2026")).toBeInTheDocument();
    expect(dayBtn(cal, /^Monday, September 28/)).toHaveFocus();
    await userEvent.keyboard("{PageDown}");
    expect(within(cal).getByText("October 2026")).toBeInTheDocument();
    expect(dayBtn(cal, /^Wednesday, October 28/)).toHaveFocus();
    await userEvent.keyboard("{PageUp}");
    expect(dayBtn(cal, /^Monday, September 28/)).toHaveFocus();
    await userEvent.keyboard("{PageDown}{PageDown}{PageDown}"); // never past today
    expect(within(cal).getByText("November 2026")).toBeInTheDocument();
    expect(dayBtn(cal, /^Wednesday, November 18/)).toHaveFocus();
  });

  it("asks again after the log changes, and not again for a month it already has", async () => {
    const server = show({ logged: ["2026-11-03"] });
    const cal = await open();
    await waitFor(() => expect(within(cal).getAllByTestId("logged-dot")).toHaveLength(1));
    const count = () => server.sent.filter((s) => s.path.startsWith("/api/days/logged")).length;
    expect(count()).toBe(1);
    await userEvent.click(within(cal).getByRole("button", { name: "Close" }));
    await open();
    expect(count()).toBe(1); // cached
    act(() => notifyDayChanged());
    await waitFor(() => expect(count()).toBe(2));
  });

  it("works as a full-width bar under the phone header too", async () => {
    show({ placement: "bar" });
    const cal = await open();
    expect(cal).toHaveAttribute("data-placement", "bar");
  });
});
