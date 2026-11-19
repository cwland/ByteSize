import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TopBar from "./TopBar";
import { SelectedDayProvider, useSelectedDay } from "../selectedDay";
import { fakeServer } from "../test/fakeServer";
import { renderWithSession } from "../test/renderWithSession";
import { settingsMe } from "../test/fixtures";

function Shown() {
  return <output aria-label="Selected day">{useSelectedDay().day}</output>;
}

describe("phone header: tap the date for a calendar (§39)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-18T19:00:00Z"));
  });
  afterEach(() => void vi.useRealTimers());

  function show(days = true) {
    fakeServer({ "GET /api/settings/me": () => settingsMe, "GET /api/days/logged": () => ({ days: ["2026-11-12"] }) });
    renderWithSession(
      <SelectedDayProvider timeZone="America/Denver">
        <TopBar days={days} />
        <Shown />
      </SelectedDayProvider>,
      { timezone: "America/Denver" },
    );
  }

  it("the month in the header opens the calendar full width under it", async () => {
    show();
    await userEvent.click(screen.getByRole("button", { name: "Choose a day" }));
    const cal = await screen.findByRole("dialog", { name: "Choose a day" });
    expect(cal).toHaveAttribute("data-placement", "bar");
    await userEvent.click(within(cal).getByRole("button", { name: "Thursday, November 12, logged" }));
    expect(screen.getByLabelText("Selected day")).toHaveTextContent("2026-11-12");
    expect(screen.queryByRole("dialog", { name: "Choose a day" })).toBeNull();
  });

  it("is not there on pages without the week strip", () => {
    show(false);
    expect(screen.queryByRole("button", { name: "Choose a day" })).toBeNull();
  });
});
