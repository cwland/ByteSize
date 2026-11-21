import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AppShell from "./AppShell";
import { fakeServer } from "../test/fakeServer";
import { renderWithSession } from "../test/renderWithSession";
import { wideScreen } from "../test/wide";
import { culuryOff, m3Routes, restaurantRoutes, settingsMe } from "../test/fixtures";
import { glp1View } from "../test/glp1Fixtures";

const routes = {
  ...m3Routes,
  ...culuryOff,
  ...restaurantRoutes,
  "GET /api/settings/me": () => settingsMe,
  "GET /api/foods/recent": () => ({ foods: [] }),
  "GET /api/foods/frequent": () => ({ foods: [] }),
  "GET /api/my-foods": () => ({ foods: [] }),
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T19:00:00Z")); // noon in Boise → lunch
});
afterEach(() => void vi.useRealTimers());

describe("AppShell on a wide screen", () => {
  it("has a side rail with the pages, My foods, Settings and the account, and no bottom tab bar or top bar", () => {
    wideScreen();
    fakeServer(routes);
    renderWithSession(<AppShell />, { timezone: "America/Boise" });
    const navs = screen.getAllByRole("navigation", { name: "Main" });
    expect(navs).toHaveLength(1);
    const rail = navs[0];
    expect(within(rail).getAllByRole("link").map((a) => a.getAttribute("aria-label") ?? a.textContent)).toEqual(["ByteSize home", "Dashboard", "Goals", "Insights", "My foods", "Settings"]);
    expect(within(rail).getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
    expect(within(rail).getByRole("link", { name: "Settings" })).toHaveAttribute("href", "#/settings");
    // No + in the rail (food is added from the Food widget): its only buttons are the account menu and the version (W2)
    expect(within(rail).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Account menu", expect.stringMatching(/^What's new in v/)]);
    // The phone top bar's avatar link is gone (the rail has the account)
    expect(screen.queryByRole("link", { name: "Open settings" })).not.toBeInTheDocument();
  });

  it("the phone bottom bar's + still opens Add food for the meal of the moment", async () => {
    wideScreen(false);
    fakeServer(routes);
    renderWithSession(<AppShell />, { timezone: "America/Boise" });
    await userEvent.setup().click(within(screen.getByRole("navigation", { name: "Main" })).getByRole("button", { name: "Log food" }));
    expect(await screen.findByRole("dialog", { name: "Add food to Lunch" })).toBeInTheDocument();
  });

  it("GLP-1 is a rail item for people with GLP-1 tracking on (it left the Goals page, §40a), current on the GLP-1 page", async () => {
    window.location.hash = "#/glp1";
    wideScreen();
    fakeServer({ ...routes, "GET /api/glp1": () => glp1View(), "GET /api/settings/me": () => ({ ...settingsMe, glp1On: true }) });
    renderWithSession(<AppShell />, { timezone: "America/Boise" });
    const rail = screen.getByRole("navigation", { name: "Main" });
    const item = await within(rail).findByRole("link", { name: "GLP-1" });
    expect(item).toHaveAttribute("href", "#/glp1");
    expect(item).toHaveAttribute("aria-current", "page");
    expect(within(rail).getAllByRole("link").map((a) => a.getAttribute("aria-label") ?? a.textContent)).toEqual(["ByteSize home", "Dashboard", "Goals", "Insights", "GLP-1", "My foods", "Settings"]);
    expect(within(rail).getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current");
    window.location.hash = "";
  });

  it("the settings say whether GLP-1 is on (set up, or the body profile says so: the server's rule, §46)", async () => {
    wideScreen();
    fakeServer({ ...routes, "GET /api/settings/me": () => ({ ...settingsMe, glp1On: true }) });
    renderWithSession(<AppShell />, { timezone: "America/Boise" });
    expect(await within(screen.getByRole("navigation", { name: "Main" })).findByRole("link", { name: "GLP-1" })).toBeInTheDocument();
  });

  it("My foods is its own rail item, current on My foods", async () => {
    window.location.hash = "#/log/my-foods?from=/";
    wideScreen();
    fakeServer(routes);
    renderWithSession(<AppShell />, { timezone: "America/Boise" });
    const rail = screen.getByRole("navigation", { name: "Main" });
    expect(within(rail).getByRole("link", { name: "My foods" })).toHaveAttribute("aria-current", "page");
    expect(within(rail).getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current");
  });

  it("narrowing the window brings back the bottom tab bar and top bar", () => {
    const screenSize = wideScreen();
    fakeServer(routes);
    renderWithSession(<AppShell />, { timezone: "America/Boise" });
    expect(within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "My foods" })).toBeInTheDocument();
    screenSize.set(false);
    const bar = screen.getByRole("navigation", { name: "Main" });
    expect(within(bar).getByRole("button", { name: "Log food" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open settings" })).toBeInTheDocument();
  });

  it("phones (no matchMedia) keep the bottom tab bar", () => {
    fakeServer(routes);
    renderWithSession(<AppShell />, { timezone: "America/Boise" });
    const bar = screen.getByRole("navigation", { name: "Main" });
    expect(within(bar).getAllByRole("link").map((a) => a.textContent)).toEqual(["Dashboard", "Goals", "My foods", "Settings"]); // no Log page (§28)
    expect(within(bar).getByRole("button", { name: "Log food" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open settings" })).toBeInTheDocument();
  });
});
