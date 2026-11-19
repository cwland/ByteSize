import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AppShell from "./AppShell";
import { fakeServer } from "../test/fakeServer";
import { renderWithSession } from "../test/renderWithSession";
import { wideScreen } from "../test/wide";
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
  vi.setSystemTime(new Date("2026-11-16T19:00:00Z")); // noon on Mon, Nov 16 in Denver → lunch
});
afterEach(() => void vi.useRealTimers());

// An iPad turned, a window dragged across 1024 px: what's open and typed stays
describe("Crossing 1024 px", () => {
  it("keeps the + sheet open with what was typed, widening and narrowing", async () => {
    const size = wideScreen(false);
    fakeServer(routes);
    renderWithSession(<AppShell />, { timezone: "America/Denver" });
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

  it("keeps the Dashboard's Add food (the Food widget) open with what was typed", async () => {
    const size = wideScreen();
    fakeServer(routes);
    renderWithSession(<AppShell />, { timezone: "America/Denver" });
    const user = userEvent.setup();
    await user.click(within(await screen.findByRole("region", { name: "Lunch" })).getByRole("button", { name: "Add Food" }));
    await user.type(await screen.findByRole("searchbox", { name: "Search foods" }), "pear");
    size.set(false);
    expect(screen.getByRole("dialog", { name: "Add food to Lunch" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search foods" })).toHaveValue("pear");
  });

  it("keeps the Food widget's Add Food sheet open with what was typed, from a phone", async () => {
    const size = wideScreen(false);
    fakeServer(routes);
    renderWithSession(<AppShell />, { timezone: "America/Denver" });
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
    renderWithSession(<AppShell />, { timezone: "America/Denver" });
    const user = userEvent.setup();
    const name = await screen.findByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Alex L");
    size.set(false);
    expect(screen.getByLabelText("Name")).toHaveValue("Alex L");
    size.set(true);
    expect(screen.getByLabelText("Name")).toHaveValue("Alex L");
  });
});

describe("Document order", () => {
  it("on phones the page comes before the bottom tab bar (tab and screen-reader order)", () => {
    fakeServer(routes);
    renderWithSession(<AppShell />, { timezone: "America/Denver" });
    const main = screen.getByRole("main");
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(main.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("on wide screens the rail is drawn first", () => {
    wideScreen();
    fakeServer(routes);
    renderWithSession(<AppShell />, { timezone: "America/Denver" });
    expect(screen.getByRole("navigation", { name: "Main" })).toHaveClass("order-first");
  });
});
