import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { DayHeader } from "./PageHeader";
import { SelectedDayProvider } from "../selectedDay";
import { fakeServer } from "../test/fakeServer";
import { renderWithSession } from "../test/renderWithSession";
import { wideScreen } from "../test/wide";
import { settingsMe } from "../test/fixtures";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-18T19:00:00Z")); // Wednesday noon in Boise
});
afterEach(() => void vi.useRealTimers());

function show(dateFormat?: string) {
  wideScreen();
  fakeServer({ "GET /api/settings/me": () => (dateFormat ? { ...settingsMe, dateFormat } : settingsMe) });
  renderWithSession(
    <SelectedDayProvider timeZone="America/Boise">
      <DayHeader />
    </SelectedDayProvider>,
    { timezone: "America/Boise" },
  );
}

describe("DayHeader's date (§33)", () => {
  it("is 'Wednesday, Nov 18' for everyone until they choose", async () => {
    show();
    expect(await screen.findByRole("heading", { level: 1, name: "Wednesday, Nov 18" })).toBeInTheDocument();
  });

  it("an unknown saved format falls back to today's look", async () => {
    show("wd-never");
    expect(await screen.findByRole("heading", { level: 1, name: "Wednesday, Nov 18" })).toBeInTheDocument(); // junk: the default look
  });

  it.each([["iso", "2026-11-18"], ["dmy-slash", "18/11/2026"], ["weekday-short-day-month-short", "Wed 18 Nov"]])("%s", async (key, text) => {
    show(key);
    expect(await screen.findByRole("heading", { level: 1, name: text })).toBeInTheDocument();
  });
});
