import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Glp1Card from "./Glp1Card";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";
import { bodyA } from "../../test/fixtures";
import { glp1View, noGlp1 } from "../../test/glp1Fixtures";

function show(view: object, body: object | null = bodyA, over: Record<string, (b: any, p: string) => unknown> = {}) {
  const server = fakeServer({
    "GET /api/glp1": () => view,
    "GET /api/body": () => ({ body }),
    ...over,
  });
  renderWithSession(<Glp1Card />, { timezone: "America/Denver" });
  return server;
}

describe("Glp1Card", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-17T19:00:00Z")); // Tue, Nov 17 in Denver
    window.location.hash = "#/";
  });
  afterEach(() => void vi.useRealTimers());

  it("before the due day says when the next shot is", async () => {
    show(glp1View());
    const card = await screen.findByRole("region", { name: "GLP-1" });
    expect(within(card).getByText("Next shot Fri, Nov 20")).toBeInTheDocument();
  });

  it("on the due day says Injection day", async () => {
    show(glp1View({ status: "due", nextDue: "2026-11-17" }));
    expect(await screen.findByText("Injection day")).toBeInTheDocument();
  });

  it("after the due day says how late", async () => {
    show(glp1View({ status: "overdue", nextDue: "2026-11-15", overdueDays: 2 }));
    expect(await screen.findByText("Injection overdue by 2 days")).toBeInTheDocument();
  });

  it("one day late is singular", async () => {
    show(glp1View({ status: "overdue", nextDue: "2026-11-16", overdueDays: 1 }));
    expect(await screen.findByText("Injection overdue by 1 day")).toBeInTheDocument();
  });

  it("with GLP-1 in the body profile but no settings, invites setup and opens the page", async () => {
    show(noGlp1);
    const card = await screen.findByRole("region", { name: "GLP-1" });
    await userEvent.setup().click(within(card).getByRole("button", { name: "Set up your GLP-1" }));
    expect(window.location.hash).toBe("#/glp1");
  });

  it("is hidden with no settings when the body profile doesn't say GLP-1", async () => {
    const server = show(noGlp1, { ...bodyA, glp1: false });
    await waitFor(() => expect(server.sent.filter((s) => s.method === "GET")).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("region", { name: "GLP-1" })).not.toBeInTheDocument();
  });

  it("shows with settings even when the body profile doesn't say GLP-1", async () => {
    show(glp1View(), { ...bodyA, glp1: false });
    expect(await screen.findByText("Next shot Fri, Nov 20")).toBeInTheDocument();
  });

  it("Log shot opens the sheet with the suggested site chosen; saving sends PUT and updates the card", async () => {
    const server = show(glp1View({ status: "due", nextDue: "2026-11-17" }), bodyA, {
      "PUT /api/glp1/shots/:day": (b, p) =>
        glp1View({
          status: "upcoming",
          nextDue: "2026-11-24",
          lastShot: { day: p.split("/").pop(), medication: "Ozempic", doseMg: b.doseMg, site: b.site, note: null },
        }),
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Log shot" }));
    const sheet = screen.getByRole("dialog", { name: "Log shot" });
    expect(within(sheet).getByLabelText("Date")).toHaveValue("2026-11-17");
    expect(within(sheet).getByLabelText("Dose (mg)")).toHaveValue(1);
    expect(within(sheet).getByRole("radio", { name: "Thigh, left" })).toHaveAttribute("aria-checked", "true");
    expect(within(sheet).getByRole("radio", { name: "Belly, right" })).toHaveTextContent("Last used");
    await user.type(within(sheet).getByLabelText("Note"), "Left thigh, no bruise");
    await user.click(within(sheet).getByRole("button", { name: "Save shot" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const put = server.writes()[0];
    expect(put).toMatchObject({ method: "PUT", path: "/api/glp1/shots/2026-11-17", body: { site: "thigh_left", doseMg: 1, note: "Left thigh, no bruise" } });
    expect(screen.getByText("Next shot Tue, Nov 24")).toBeInTheDocument();
  });

  it("a changed date (a day with no shot), dose and site are what is sent", async () => {
    const server = show(glp1View(), bodyA, { "PUT /api/glp1/shots/:day": () => glp1View() });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Log shot" }));
    const sheet = screen.getByRole("dialog", { name: "Log shot" });
    const date = within(sheet).getByLabelText("Date");
    await user.clear(date);
    await user.type(date, "2026-11-15");
    // No shot on Nov 15: still a new shot with the current dose and the suggested site
    expect(screen.getByRole("dialog", { name: "Log shot" })).toBe(sheet);
    expect(within(sheet).getByLabelText("Dose (mg)")).toHaveValue(1);
    expect(within(sheet).getByRole("radio", { name: "Thigh, left" })).toHaveAttribute("aria-checked", "true");
    const dose = within(sheet).getByLabelText("Dose (mg)");
    await user.clear(dose);
    await user.type(dose, "1.7");
    await user.click(within(sheet).getByRole("radio", { name: "Arm, left" }));
    await user.click(within(sheet).getByRole("button", { name: "Save shot" }));
    await waitFor(() => expect(server.writes()).toHaveLength(1));
    expect(server.writes()[0]).toMatchObject({ path: "/api/glp1/shots/2026-11-15", body: { site: "arm_left", doseMg: 1.7, note: "" } });
  });

  it("choosing a day that already has a shot edits it: its dose, site and note are sent back unless changed", async () => {
    const server = show(glp1View(), bodyA, { "PUT /api/glp1/shots/:day": () => glp1View() });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Log shot" }));
    const date = within(screen.getByRole("dialog", { name: "Log shot" })).getByLabelText("Date");
    await user.clear(date);
    await user.type(date, "2026-11-06");
    const sheet = screen.getByRole("dialog", { name: "Edit shot" });
    expect(within(sheet).getByLabelText("Dose (mg)")).toHaveValue(0.5);
    expect(within(sheet).getByRole("radio", { name: "Belly, left" })).toHaveAttribute("aria-checked", "true");
    expect(within(sheet).getByLabelText("Note")).toHaveValue("Felt fine");
    await user.click(within(sheet).getByRole("button", { name: "Save shot" }));
    await waitFor(() => expect(server.writes()).toHaveLength(1));
    expect(server.writes()[0]).toMatchObject({ path: "/api/glp1/shots/2026-11-06", body: { site: "abdomen_left", doseMg: 0.5, note: "Felt fine" } });
  });

  it("moving off a day with a shot to one without goes back to a new shot", async () => {
    show(glp1View());
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Log shot" }));
    const date = screen.getByLabelText("Date");
    await user.clear(date);
    await user.type(date, "2026-11-06");
    expect(screen.getByRole("dialog", { name: "Edit shot" })).toBeInTheDocument();
    await user.clear(date);
    await user.type(date, "2026-11-16");
    const sheet = screen.getByRole("dialog", { name: "Log shot" });
    expect(within(sheet).getByLabelText("Dose (mg)")).toHaveValue(1);
    expect(within(sheet).getByRole("radio", { name: "Thigh, left" })).toHaveAttribute("aria-checked", "true");
    expect(within(sheet).getByLabelText("Note")).toHaveValue("");
  });

  it("shows the server's error and keeps the sheet open", async () => {
    show(glp1View(), bodyA, { "PUT /api/glp1/shots/:day": () => ({ status: 400, json: { error: "That day hasn't happened yet" } }) });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Log shot" }));
    await user.click(screen.getByRole("button", { name: "Save shot" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That day hasn't happened yet");
    expect(screen.getByRole("dialog", { name: "Log shot" })).toBeInTheDocument();
  });
});

describe("Dashboard GLP-1 card", () => {
  it("the Dashboard shows the GLP-1 card", async () => {
    const { default: Dashboard } = await import("../dashboard/Dashboard");
    const { SelectedDayProvider } = await import("../../selectedDay");
    const { dayJson, settingsMe } = await import("../../test/fixtures");
    fakeServer({
      "GET /api/day/:date": () => dayJson({}),
      "GET /api/settings/me": () => settingsMe,
      "GET /api/glp1": () => glp1View({ status: "due" }),
      "GET /api/body": () => ({ body: bodyA }),
    });
    renderWithSession(
      <SelectedDayProvider timeZone="America/Denver">
        <Dashboard />
      </SelectedDayProvider>,
    );
    expect(await screen.findByText("Injection day")).toBeInTheDocument();
  });
});
