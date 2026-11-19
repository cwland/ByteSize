import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  fakeServer({ "GET /api/settings/me": () => (dateFormat ? { ...settingsMe, dateFormat } : settingsMe), "GET /api/days/logged": () => ({ days: ["2026-11-10"] }) });
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

describe("the remembered look after signing out (§46)", () => {
  function Look() {
    const s = useSettingsMe();
    return <output aria-label="Look">{`${s.dateFormat} ${s.weekStart}`}</output>;
  }
  const mount = (userId = 1) =>
    renderWithSession(<Look />, { timezone: "America/Boise", id: userId });

  it("settings still on their way when the person signs out aren't remembered when they arrive", async () => {
    let answer!: (v: unknown) => void;
    fakeServer({ "GET /api/settings/me": () => new Promise((res) => (answer = res)) });
    mount();
    await vi.waitFor(() => expect(answer).toBeTypeOf("function"));
    forgetSettings(1); // signed out while the request was out
    answer({ ...settingsMe, dateFormat: "iso", weekStart: 1 });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(localStorage.getItem("bytesize-look:1")).toBeNull();
    cleanup();
    fakeServer({ "GET /api/settings/me": () => new Promise(() => {}) });
    mount();
    expect(screen.getByLabelText("Look")).toHaveTextContent("weekday-long-month-short 0"); // nothing carried over in memory either
  });

  it("the old unkeyed bytesize-look is removed", () => {
    localStorage.setItem("bytesize-look", JSON.stringify({ dateFormat: "iso", weekStart: 1 }));
    fakeServer({ "GET /api/settings/me": () => new Promise(() => {}) });
    mount();
    expect(localStorage.getItem("bytesize-look")).toBeNull();
    expect(screen.getByLabelText("Look")).toHaveTextContent("weekday-long-month-short 0"); // and never read
  });
});

describe("tap the date for a calendar (§39)", () => {
  it("the calendar is beside the page's <h1>, not inside it (§46)", async () => {
    show();
    const h1 = await screen.findByRole("heading", { level: 1, name: "Wednesday, Nov 18" });
    await userEvent.click(screen.getByRole("button", { name: "Choose a day" }));
    const dialog = await screen.findByRole("dialog", { name: "Choose a day" });
    expect(h1.contains(dialog)).toBe(false);
    expect(dialog.parentElement).toBe(h1.parentElement);
    expect(within(h1).getByRole("button", { name: "Choose a day" })).toBeInTheDocument(); // the date itself stays the heading
  });

  it("the centred date is a button that opens the calendar under it; choosing a day changes the day shown", async () => {
    show();
    expect(await screen.findByRole("heading", { level: 1, name: "Wednesday, Nov 18" })).toBeInTheDocument(); // still the heading
    const button = screen.getByRole("button", { name: "Choose a day" });
    expect(button).toHaveTextContent("Wednesday, Nov 18");
    await userEvent.click(button);
    const cal = await screen.findByRole("dialog", { name: "Choose a day" });
    expect(cal).toHaveAttribute("data-placement", "popover");
    await userEvent.click(within(cal).getByRole("button", { name: "Tuesday, November 10, logged" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Tuesday, Nov 10" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Choose a day" })).toBeNull();
  });
});
