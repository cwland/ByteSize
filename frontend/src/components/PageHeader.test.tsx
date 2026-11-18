import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { DayHeader } from "./PageHeader";
import { SelectedDayProvider } from "../selectedDay";
import { fakeServer } from "../test/fakeServer";
import { renderWithSession } from "../test/renderWithSession";
import { wideScreen } from "../test/wide";
import { settingsMe } from "../test/fixtures";
import { forgetSettings, useSettingsMe } from "../day";

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
  function paint(server: Parameters<typeof fakeServer>[0], userId = 1) {
    wideScreen();
    fakeServer(server);
    renderWithSession(
      <SelectedDayProvider timeZone="America/Boise">
        <DayHeader />
        <Look />
      </SelectedDayProvider>,
      { timezone: "America/Boise", id: userId },
    );
  }

  it("shows the format remembered on this device before the settings load, not the default first", () => {
    localStorage.setItem("bytesize-look:1", JSON.stringify({ dateFormat: "iso", weekStart: 1 }));
    paint({ "GET /api/settings/me": () => new Promise(() => {}) }); // the server hasn't answered yet
    expect(screen.getByRole("heading", { level: 1, name: "2026-11-18" })).toBeInTheDocument();
    expect(screen.getByLabelText("Look")).toHaveTextContent("iso 1"); // week start too
  });

  it("the settings confirm it when they load, and are remembered for the next time", async () => {
    localStorage.setItem("bytesize-look:1", JSON.stringify({ dateFormat: "iso", weekStart: 1 }));
    paint({ "GET /api/settings/me": () => ({ ...settingsMe, dateFormat: "dmy-slash", weekStart: 6 }) });
    expect(await screen.findByRole("heading", { level: 1, name: "18/11/2026" })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("bytesize-look:1")!)).toEqual({ dateFormat: "dmy-slash", weekStart: 6 });
  });

  it("something unreadable remembered is ignored", () => {
    localStorage.setItem("bytesize-look:1", "{not json");
    paint({ "GET /api/settings/me": () => new Promise(() => {}) });
    expect(screen.getByRole("heading", { level: 1, name: "Wednesday, Nov 18" })).toBeInTheDocument();
  });

  it("remembered values of the wrong kind are ignored", () => {
    localStorage.setItem("bytesize-look:1", JSON.stringify({ dateFormat: 5, weekStart: 9 }));
    paint({ "GET /api/settings/me": () => new Promise(() => {}) });
    expect(screen.getByLabelText("Look")).toHaveTextContent("weekday-long-month-short 0");
  });
  it("is kept per person: someone else on this device starts from the default, not the last person's look", () => {
    localStorage.setItem("bytesize-look:1", JSON.stringify({ dateFormat: "iso", weekStart: 1 }));
    paint({ "GET /api/settings/me": () => new Promise(() => {}) }, 2);
    expect(screen.getByRole("heading", { level: 1, name: "Wednesday, Nov 18" })).toBeInTheDocument();
    expect(screen.getByLabelText("Look")).toHaveTextContent("weekday-long-month-short 0");
  });

  it("switching person in the same tab doesn't carry the last person's settings over", async () => {
    paint({ "GET /api/settings/me": () => ({ ...settingsMe, dateFormat: "iso", weekStart: 1 }) }, 1);
    expect(await screen.findByRole("heading", { level: 1, name: "2026-11-18" })).toBeInTheDocument();
    cleanup();
    paint({ "GET /api/settings/me": () => new Promise(() => {}) }, 2);
    expect(screen.getByRole("heading", { level: 1, name: "Wednesday, Nov 18" })).toBeInTheDocument();
  });

  it("signing out forgets this person's look on this device", async () => {
    paint({ "GET /api/settings/me": () => ({ ...settingsMe, dateFormat: "iso", weekStart: 1 }) }, 1);
    expect(await screen.findByRole("heading", { level: 1, name: "2026-11-18" })).toBeInTheDocument();
    expect(localStorage.getItem("bytesize-look:1")).not.toBeNull();
    forgetSettings(1);
    expect(localStorage.getItem("bytesize-look:1")).toBeNull();
    cleanup();
    paint({ "GET /api/settings/me": () => new Promise(() => {}) }, 1);
    expect(screen.getByRole("heading", { level: 1, name: "Wednesday, Nov 18" })).toBeInTheDocument();
  });
});
