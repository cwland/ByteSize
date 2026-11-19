import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProfileSettings from "./ProfileSettings";
import { fakeServer, userJson } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";
import { settingsMe } from "../../test/fixtures";

describe("ProfileSettings week start", () => {
  it("shows the saved week start and saves a new one with the profile", async () => {
    const server = fakeServer({
      "GET /api/settings/me": () => ({ ...settingsMe, weekStart: 0 }),
      "PATCH /api/profile": (b) => ({ user: userJson(b) }),
      "PUT /api/settings/me": (b) => b,
    });
    renderWithSession(<ProfileSettings />);
    const select = screen.getByRole("combobox", { name: "Week starts on" });
    await waitFor(() => expect(select).toHaveValue("0"));
    expect(screen.getByRole("option", { name: "Sunday" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Saturday" })).toBeInTheDocument();
    const user = userEvent.setup();
    await user.selectOptions(select, "Monday");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(server.writes().find((w) => w.path === "/api/settings/me")).toMatchObject({
      method: "PUT",
      body: { mealWindows: settingsMe.mealWindows, waterButtonsMl: settingsMe.waterButtonsMl, weekStart: 1 },
    });
  });

  it("an unchanged week start isn't sent", async () => {
    const server = fakeServer({
      "GET /api/settings/me": () => ({ ...settingsMe, weekStart: 3 }),
      "PATCH /api/profile": (b) => ({ user: userJson(b) }),
      "PUT /api/settings/me": (b) => b,
    });
    renderWithSession(<ProfileSettings />);
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Week starts on" })).toHaveValue("3"));
    await userEvent.setup().click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(server.writes().some((w) => w.path === "/api/settings/me")).toBe(false);
  });
});

describe("ProfileSettings date format (§33)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-18T19:00:00Z")); // Wednesday noon in Denver
  });
  afterEach(() => void vi.useRealTimers());

  it("a dropdown beside the units previews today's date in each of the ten formats; today's look is the default", async () => {
    fakeServer({ "GET /api/settings/me": () => settingsMe, "PATCH /api/profile": (b) => ({ user: userJson(b) }) });
    renderWithSession(<ProfileSettings />, { timezone: "America/Denver" });
    const select = screen.getByRole("combobox", { name: "Date format" });
    await waitFor(() => expect(select).toHaveValue("weekday-long-month-short"));
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Wednesday, Nov 18", "Wed, Nov 18", "Wednesday, November 18", "11/18/2026", "Wednesday 18 Nov", "Wed 18 Nov", "Wednesday 18 November", "18/11/2026", "18.11.2026", "2026-11-18",
    ]);
  });

  it("saves the choice with the rest, and an unchanged one isn't sent", async () => {
    const server = fakeServer({ "GET /api/settings/me": () => settingsMe, "PATCH /api/profile": (b) => ({ user: userJson(b) }), "PUT /api/settings/me": (b) => b });
    renderWithSession(<ProfileSettings />, { timezone: "America/Denver" });
    const select = screen.getByRole("combobox", { name: "Date format" });
    await waitFor(() => expect(select).toHaveValue("weekday-long-month-short"));
    const user = userEvent.setup({ advanceTimers: () => {} });
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(server.writes().some((w) => w.path === "/api/settings/me")).toBe(false);
    await user.selectOptions(select, "dmy-dot");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(server.writes().find((w) => w.path === "/api/settings/me")).toMatchObject({ method: "PUT", body: { mealWindows: settingsMe.mealWindows, waterButtonsMl: settingsMe.waterButtonsMl, weekStart: 0, dateFormat: "dmy-dot" } }));
  });

  it("shows the saved choice", async () => {
    fakeServer({ "GET /api/settings/me": () => ({ ...settingsMe, dateFormat: "iso" }) });
    renderWithSession(<ProfileSettings />, { timezone: "America/Denver" });
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Date format" })).toHaveValue("iso"));
  });
});

describe("ProfileSettings vacation mode (§40a)", () => {
  it("Vacation mode lives here, after the profile and before the look of the app, and works as it did on Goals", async () => {
    fakeServer({
      "GET /api/settings/me": () => settingsMe,
      "GET /api/vacations": () => ({ vacations: [{ id: 7, from: "2026-12-20", to: "2027-01-02" }] }),
    });
    renderWithSession(<ProfileSettings />);
    const box = await screen.findByRole("region", { name: "Vacation mode" });
    expect(within(box).getByText("Days off don't break your streak")).toBeInTheDocument();
    expect(await within(box).findByText("Dec 20–Jan 2, 2027")).toBeInTheDocument();
    const profile = screen.getByRole("form", { name: "Profile" });
    const theme = screen.getByRole("radiogroup", { name: "Theme" });
    expect(profile.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(box.compareDocumentPosition(theme) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("ProfileSettings GLP-1 shots (§40a)", () => {
  it("with GLP-1 tracking on: a GLP-1 shots row opens the GLP-1 page, coming back to Settings", async () => {
    fakeServer({ "GET /api/settings/me": () => ({ ...settingsMe, glp1On: true }), "GET /api/vacations": () => ({ vacations: [] }) });
    renderWithSession(<ProfileSettings />);
    const box = await screen.findByRole("region", { name: "GLP-1" });
    expect(within(box).getByRole("link", { name: /GLP-1 shots/ })).toHaveAttribute("href", "#/glp1?from=/settings/profile");
  });

  it("with GLP-1 tracking off: no row", async () => {
    const server = fakeServer({ "GET /api/settings/me": () => ({ ...settingsMe, glp1On: false }), "GET /api/vacations": () => ({ vacations: [] }) });
    renderWithSession(<ProfileSettings />);
    await waitFor(() => expect(server.sent.some((x) => x.path === "/api/settings/me")).toBe(true));
    await screen.findByRole("region", { name: "Vacation mode" });
    expect(screen.queryByRole("region", { name: "GLP-1" })).not.toBeInTheDocument();
  });
});
