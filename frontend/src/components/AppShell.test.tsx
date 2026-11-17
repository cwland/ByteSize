import { afterEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AppShell from "./AppShell";
import { fakeServer } from "../test/fakeServer";
import { renderWithSession } from "../test/renderWithSession";
import { bodyA, plansA, restaurantRoutes, settingsMe, steadyTargets } from "../test/fixtures";

describe("AppShell week strip", () => {
  afterEach(() => void vi.useRealTimers());

  it("starts on today in the user's time zone and picks other days from the strip", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-17T03:00:00Z")); // still Mon, Nov 16 in Boise
    fakeServer({});
    renderWithSession(<AppShell />, { timezone: "America/Boise" });
    const week = screen.getByRole("group", { name: "Week of Nov 15" });
    expect(within(week).getByRole("button", { name: "Mon 16" })).toHaveAttribute("aria-pressed", "true");
    expect(within(week).getByRole("button", { name: "Mon 16" })).toHaveAttribute("aria-current", "date");
    const user = userEvent.setup();
    await user.click(within(week).getByRole("button", { name: "Sun 15" }));
    expect(within(week).getByRole("button", { name: "Sun 15" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Next week" }));
    await user.click(within(screen.getByRole("group", { name: "Week of Nov 22" })).getByRole("button", { name: "Tue 24" }));
    expect(within(screen.getByRole("group", { name: "Week of Nov 22" })).getByRole("button", { name: "Tue 24" })).toHaveAttribute("aria-pressed", "true");
    expect(within(week).getByRole("button", { name: "Sun 15" })).toHaveAttribute("aria-pressed", "false");
    // The old ‹ date › switcher is gone
    expect(screen.queryByRole("button", { name: "Go to today" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Previous day" })).not.toBeInTheDocument();
  });

  it("leaving to Settings and coming back to Log selects today", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-17T19:00:00Z")); // Tue, Nov 17 in Boise
    window.location.hash = "#/log";
    fakeServer({ "GET /api/settings/me": () => ({ ...settingsMe, weekStart: 0 }) });
    renderWithSession(<AppShell />, { timezone: "America/Boise" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Wed 18" }));
    expect(screen.getByRole("button", { name: "Wed 18" })).toHaveAttribute("aria-pressed", "true");
    act(() => {
      window.location.hash = "#/settings";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    // Settings has no week strip
    expect(screen.queryByRole("group", { name: "Days" })).not.toBeInTheDocument();
    act(() => {
      window.location.hash = "#/log";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Tue 17" })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByRole("button", { name: "Wed 18" })).toHaveAttribute("aria-pressed", "false");
  });
});

describe("AppShell first run", () => {
  it("with no targets yet shows the plan flow before the tabs", async () => {
    fakeServer({
      "GET /api/targets": () => ({ targets: null }),
      "GET /api/body": () => ({ body: null }),
    });
    renderWithSession(<AppShell />);
    expect(await screen.findByRole("heading", { name: "Tell us about yourself" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Main" })).not.toBeInTheDocument();
  });
});

describe("AppShell details review", () => {
  it("details needing review are asked for before plans, and saving continues to the plans", async () => {
    // A body saved before birthdates and the new activity levels (migrated: Jan 1 of the birth year, "moderate" → "most")
    let body: Record<string, unknown> = { ...bodyA, birthDate: "1974-01-01", activity: "most", needsReview: true };
    const server = fakeServer({
      "GET /api/targets": () => ({ targets: steadyTargets }),
      "GET /api/body": () => ({ body }),
      "PUT /api/body": (b) => {
        body = { ...b, needsReview: false };
        return { body };
      },
      "GET /api/plans": () => (body.needsReview ? { status: 409, json: { error: "Check your details first" } } : plansA),
    });
    renderWithSession(<AppShell />);
    expect(await screen.findByText("We've updated a couple of questions — check your details")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Tell us about yourself" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Main" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Birthdate")).toHaveValue("1974-01-01");
    expect(screen.getByRole("radio", { name: /On your feet most of the day/ })).toHaveAttribute("aria-checked", "true");
    expect(server.sent.some((s) => s.path === "/api/plans")).toBe(false);

    const user = userEvent.setup();
    const birth = screen.getByLabelText("Birthdate");
    await user.clear(birth);
    await user.type(birth, "1974-06-01");
    await user.click(screen.getByRole("radio", { name: /On your feet some of the day/ }));
    await user.click(screen.getByRole("button", { name: "See my plans" }));

    expect(await screen.findByRole("heading", { name: "Choose your plan" })).toBeInTheDocument();
    expect(screen.queryByText("We've updated a couple of questions — check your details")).not.toBeInTheDocument();
    expect(server.writes().find((w) => w.path === "/api/body")!.body).toMatchObject({ birthDate: "1974-06-01", activity: "some" });
    await user.click(screen.getByRole("button", { name: "Not now" }));
    expect(await screen.findByRole("navigation", { name: "Main" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Tell us about yourself" })).not.toBeInTheDocument();
  });

  it("the review can be put off with Not now", async () => {
    fakeServer({
      "GET /api/targets": () => ({ targets: steadyTargets }),
      "GET /api/body": () => ({ body: { ...bodyA, needsReview: true } }),
    });
    renderWithSession(<AppShell />);
    await screen.findByText("We've updated a couple of questions — check your details");
    await userEvent.setup().click(screen.getByRole("button", { name: "Not now" }));
    expect(await screen.findByRole("navigation", { name: "Main" })).toBeInTheDocument();
  });
});

describe("AppShell log button", () => {
  afterEach(() => void vi.useRealTimers());

  it("the floating + opens Add food for the meal of the moment on the selected day", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-16T19:00:00Z")); // noon in Boise → lunch
    fakeServer({ "GET /api/foods/recent": () => ({ foods: [] }), "GET /api/foods/frequent": () => ({ foods: [] }), ...restaurantRoutes });
    renderWithSession(<AppShell />, { timezone: "America/Boise" });
    await userEvent.setup().click(screen.getByRole("button", { name: "Log food" }));
    expect(await screen.findByRole("dialog", { name: "Add food to Lunch" })).toBeInTheDocument();
  });
});

describe("AppShell My Foods", () => {
  afterEach(() => {
    window.location.hash = "";
  });

  it("#/log/my-foods shows My Foods (no week strip), and Back returns to the Log", async () => {
    window.location.hash = "#/log/my-foods?from=/log";
    fakeServer({ "GET /api/my-foods": () => ({ foods: [] }) });
    renderWithSession(<AppShell />, { timezone: "America/Boise" });
    expect(await screen.findByRole("heading", { level: 1, name: "My Foods" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /^Week of/ })).not.toBeInTheDocument();
    // The Log tab stays the current one
    expect(within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "Log" })).toHaveAttribute("aria-current", "page");
    await userEvent.setup().click(screen.getByRole("link", { name: "‹ Back" }));
    await waitFor(() => expect(window.location.hash).toBe("#/log"));
    expect(await screen.findByRole("heading", { level: 1, name: "Log" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "My Foods" })).not.toBeInTheDocument();
  });
});
