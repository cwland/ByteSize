import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { DayHeader } from "./PageHeader";
import { SelectedDayProvider } from "../selectedDay";
import { fakeServer } from "../test/fakeServer";
import { renderWithSession } from "../test/renderWithSession";
import { wideScreen } from "../test/wide";
import { settingsMe } from "../test/fixtures";
import { useSettingsMe } from "../day";

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

describe("the chosen look from the first paint (§37)", () => {
  function Look() {
    const s = useSettingsMe();
    return <output aria-label="Look">{`${s.dateFormat} ${s.weekStart}`}</output>;
  }
  function paint(server: Parameters<typeof fakeServer>[0]) {
    wideScreen();
    fakeServer(server);
    renderWithSession(
      <SelectedDayProvider timeZone="America/Boise">
        <DayHeader />
        <Look />
      </SelectedDayProvider>,
      { timezone: "America/Boise" },
    );
  }

  it("shows the format remembered on this device before the settings load, not the default first", () => {
    localStorage.setItem("bytesize-look", JSON.stringify({ dateFormat: "iso", weekStart: 1 }));
    paint({ "GET /api/settings/me": () => new Promise(() => {}) }); // the server hasn't answered yet
    expect(screen.getByRole("heading", { level: 1, name: "2026-11-18" })).toBeInTheDocument();
    expect(screen.getByLabelText("Look")).toHaveTextContent("iso 1"); // week start too
  });

  it("the settings confirm it when they load, and are remembered for the next time", async () => {
    localStorage.setItem("bytesize-look", JSON.stringify({ dateFormat: "iso", weekStart: 1 }));
    paint({ "GET /api/settings/me": () => ({ ...settingsMe, dateFormat: "dmy-slash", weekStart: 6 }) });
    expect(await screen.findByRole("heading", { level: 1, name: "18/11/2026" })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("bytesize-look")!)).toEqual({ dateFormat: "dmy-slash", weekStart: 6 });
  });

  it("something unreadable remembered is ignored", () => {
    localStorage.setItem("bytesize-look", "{not json");
    paint({ "GET /api/settings/me": () => new Promise(() => {}) });
    expect(screen.getByRole("heading", { level: 1, name: "Wednesday, Nov 18" })).toBeInTheDocument();
  });

  it("remembered values of the wrong kind are ignored", () => {
    localStorage.setItem("bytesize-look", JSON.stringify({ dateFormat: 5, weekStart: 9 }));
    paint({ "GET /api/settings/me": () => new Promise(() => {}) });
    expect(screen.getByLabelText("Look")).toHaveTextContent("weekday-long-month-short 0");
  });
});
