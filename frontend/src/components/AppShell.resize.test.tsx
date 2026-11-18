import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AppShell from "./AppShell";
import { fakeServer } from "../test/fakeServer";
import { renderWithSession } from "../test/renderWithSession";
import { wideScreen } from "../test/wide";
import { keepDayOnNextPage } from "../selectedDay";
import { culuryOff, dayJson, entryJson, m3Routes, restaurantRoutes, settingsMe, steadyTargets } from "../test/fixtures";

const routes = {
  ...m3Routes,
  ...culuryOff,
  ...restaurantRoutes,
  "GET /api/targets": () => ({ targets: steadyTargets }),
  "GET /api/settings/me": () => settingsMe,
  "GET /api/day/:date": (_b: unknown, path: string) => dayJson({ day: path.split("/").pop(), entries: [entryJson()] }),
  "GET /api/days/logged": () => ({ days: [] }),
  "GET /api/foods/recent": () => ({ foods: [] }),
  "GET /api/foods/frequent": () => ({ foods: [] }),
  "GET /api/foods/search": () => ({ groups: [], errors: [] }),
  "GET /api/my-foods": () => ({ foods: [] }),
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T19:00:00Z")); // noon on Mon, Nov 16 in Boise → lunch
});
afterEach(() => void vi.useRealTimers());

// An iPad turned, a window dragged across 1024 px: what's open and typed stays
describe("Crossing 1024 px", () => {
  it("keeps the + sheet open with what was typed, widening and narrowing", async () => {
    const size = wideScreen(false);
    fakeServer(routes);
    renderWithSession(<AppShell />, { timezone: "America/Boise" });
    const user = userEvent.setup();
    await user.click(within(screen.getByRole("navigation", { name: "Main" })).getByRole("button", { name: "Log food" }));
    await user.type(await screen.findByRole("searchbox", { name: "Search foods" }), "apple");
    size.set(true); // the rail has no +, but the sheet the bottom bar's + opened stays
    expect(screen.getByRole("dialog", { name: "Add food to Lunch" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search foods" })).toHaveValue("apple");
    size.set(false);
    expect(screen.getByRole("dialog", { name: "Add food to Lunch" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search foods" })).toHaveValue("apple");
  });

  it("keeps the Dashboard's Add food (Today's food) open with what was typed", async () => {
    const size = wideScreen();
    fakeServer(routes);
    renderWithSession(<AppShell />, { timezone: "America/Boise" });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Add food to Lunch" }));
    await user.type(await screen.findByRole("searchbox", { name: "Search foods" }), "pear");
    size.set(false);
    expect(screen.getByRole("dialog", { name: "Add food to Lunch" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search foods" })).toHaveValue("pear");
  });

  it("keeps the Log's Add Food sheet open with what was typed", async () => {
    window.location.hash = "#/log";
    const size = wideScreen(false);
    fakeServer(routes);
    renderWithSession(<AppShell />, { timezone: "America/Boise" });
    const user = userEvent.setup();
    const breakfast = await screen.findByRole("region", { name: "Breakfast" });
    await user.click(within(breakfast).getByRole("button", { name: "Add Food" }));
    await user.type(await screen.findByRole("searchbox", { name: "Search foods" }), "toast");
    size.set(true);
    expect(screen.getByRole("dialog", { name: "Add food to Breakfast" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search foods" })).toHaveValue("toast");
    size.set(false);
    expect(screen.getByRole("searchbox", { name: "Search foods" })).toHaveValue("toast");
  });

  it("keeps a half-filled Settings form", async () => {
    window.location.hash = "#/settings/profile";
    const size = wideScreen();
    fakeServer(routes);
    renderWithSession(<AppShell />, { timezone: "America/Boise" });
    const user = userEvent.setup();
    const name = await screen.findByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Cory L");
    size.set(false);
    expect(screen.getByLabelText("Name")).toHaveValue("Cory L");
    size.set(true);
    expect(screen.getByLabelText("Name")).toHaveValue("Cory L");
  });
});

describe("Open the log", () => {
  it("from the Dashboard keeps the day picked there", async () => {
    wideScreen();
    fakeServer(routes);
    renderWithSession(<AppShell />, { timezone: "America/Boise" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^Sun 15/ }));
    expect(screen.getByRole("button", { name: /^Sun 15/ })).toHaveAttribute("aria-pressed", "true");
    await user.click(await screen.findByRole("link", { name: "Open the log" }));
    act(() => void window.dispatchEvent(new HashChangeEvent("hashchange")));
    expect(await screen.findByRole("heading", { level: 1, name: "Log" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: /^Sun 15/ })).toHaveAttribute("aria-pressed", "true"));
    // The rail's Log still starts on today
    await user.click(within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "Dashboard" }));
    act(() => void window.dispatchEvent(new HashChangeEvent("hashchange")));
    await user.click(within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "Log" }));
    act(() => void window.dispatchEvent(new HashChangeEvent("hashchange")));
    await waitFor(() => expect(screen.getByRole("button", { name: /^Mon 16/ })).toHaveAttribute("aria-pressed", "true"));
  });
});

describe("The keep-day flag", () => {
  it("is used up by any page change: a click that didn't navigate doesn't keep an old day later", async () => {
    wideScreen();
    fakeServer(routes);
    renderWithSession(<AppShell />, { timezone: "America/Boise" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^Sun 15/ }));
    keepDayOnNextPage(); // e.g. a Cmd-click on "Open the log" that opened a new tab instead
    act(() => {
      window.location.hash = "#/goals";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    act(() => {
      window.location.hash = "#/";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await waitFor(() => expect(screen.getByRole("button", { name: /^Mon 16/ })).toHaveAttribute("aria-pressed", "true"));
  });
});

describe("Document order", () => {
  it("on phones the page comes before the bottom tab bar (tab and screen-reader order)", () => {
    fakeServer(routes);
    renderWithSession(<AppShell />, { timezone: "America/Boise" });
    const main = screen.getByRole("main");
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(main.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("on wide screens the rail is drawn first", () => {
    wideScreen();
    fakeServer(routes);
    renderWithSession(<AppShell />, { timezone: "America/Boise" });
    expect(screen.getByRole("navigation", { name: "Main" })).toHaveClass("order-first");
  });
});
