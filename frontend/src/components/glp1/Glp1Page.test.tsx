import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Glp1Page from "./Glp1Page";
import AppShell from "../AppShell";
import { SelectedDayProvider } from "../../selectedDay";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";
import { bodyA, steadyTargets } from "../../test/fixtures";
import { afterEnough, afterNotEnough, glp1View, noGlp1 } from "../../test/glp1Fixtures";

function show(view: object, over: Record<string, (b: any, p: string) => unknown> = {}) {
  const server = fakeServer({
    "GET /api/glp1": () => view,
    "GET /api/glp1/after-injection": () => afterEnough,
    "GET /api/side-effects": () => ({ days: [] }),
    ...over,
  });
  renderWithSession(
    <SelectedDayProvider timeZone="America/Boise">
      <Glp1Page />
    </SelectedDayProvider>,
    { timezone: "America/Boise" },
  );
  return server;
}

describe("Glp1Page", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-17T19:00:00Z")); // Tue, Nov 17 in Boise
    window.location.hash = "#/glp1";
  });
  afterEach(() => void vi.useRealTimers());

  it("with no settings shows the setup form, and saving sends the settings", async () => {
    let view: object = noGlp1;
    const server = show(noGlp1, {
      "GET /api/glp1": () => view,
      "PUT /api/glp1/settings": (b) => (view = glp1View({ settings: b, shots: [], lastShot: null, doseHistory: [], nextDue: "2026-11-20", suggestedSite: "abdomen_left" })),
    });
    const setup = await screen.findByRole("region", { name: "Setup" });
    const user = userEvent.setup();
    await user.type(within(setup).getByLabelText("Medication"), "Zepbound");
    await user.type(within(setup).getByLabelText("Dose (mg)"), "2.5");
    await user.selectOptions(within(setup).getByLabelText("Injection day"), "Friday");
    await user.click(within(setup).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(server.writes()).toHaveLength(1));
    expect(server.writes()[0]).toMatchObject({ method: "PUT", path: "/api/glp1/settings", body: { medication: "Zepbound", doseMg: 2.5, injectionWeekday: 5 } });
    expect(await screen.findByText("Zepbound 2.5 mg, Fridays")).toBeInTheDocument();
    expect(screen.getByText("Next shot Fri")).toBeInTheDocument();
  });

  it("with settings shows them and Edit opens the form filled in", async () => {
    show(glp1View());
    const setup = await screen.findByRole("region", { name: "Setup" });
    expect(within(setup).getByText("Ozempic 1 mg, Fridays")).toBeInTheDocument();
    await userEvent.setup().click(within(setup).getByRole("button", { name: "Edit" }));
    const form = screen.getByRole("region", { name: "Setup" });
    expect(within(form).getByLabelText("Medication")).toHaveValue("Ozempic");
    expect(within(form).getByLabelText("Dose (mg)")).toHaveValue(1);
    expect(within(form).getByLabelText("Injection day")).toHaveValue("5");
  });

  it("Log shot is offered once set up and opens the shot sheet", async () => {
    show(glp1View());
    await userEvent.setup().click(await screen.findByRole("button", { name: "Log shot" }));
    expect(screen.getByRole("dialog", { name: "Log shot" })).toBeInTheDocument();
  });

  it("history lists shots newest first with date, dose and site, and calls out dose changes", async () => {
    show(glp1View());
    const history = await screen.findByRole("region", { name: "History" });
    const rows = within(history).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Fri, Nov 13");
    expect(rows[0]).toHaveTextContent("1 mg");
    expect(rows[0]).toHaveTextContent("Belly, right");
    expect(rows[0]).toHaveTextContent("Dose changed from 0.5 mg to 1 mg");
    expect(rows[1]).toHaveTextContent("Fri, Nov 6");
    expect(rows[1]).toHaveTextContent("0.5 mg");
    expect(rows[1]).toHaveTextContent("Belly, left");
    expect(rows[1]).toHaveTextContent("Felt fine");
    expect(rows[1]).toHaveTextContent("Started Ozempic 0.5 mg");
    expect(rows[1]).not.toHaveTextContent("Dose changed");
  });

  it("Edit on a history row opens the shot sheet for that day, filled in", async () => {
    const server = show(glp1View(), { "PUT /api/glp1/shots/:day": () => glp1View() });
    const user = userEvent.setup();
    const history = await screen.findByRole("region", { name: "History" });
    await user.click(within(history).getByRole("button", { name: "Edit shot on Fri, Nov 6" }));
    const sheet = screen.getByRole("dialog", { name: "Edit shot" });
    expect(within(sheet).getByLabelText("Date")).toHaveValue("2026-11-06");
    expect(within(sheet).getByLabelText("Dose (mg)")).toHaveValue(0.5);
    expect(within(sheet).getByRole("radio", { name: "Belly, left" })).toHaveAttribute("aria-checked", "true");
    expect(within(sheet).getByLabelText("Note")).toHaveValue("Felt fine");
    await user.click(within(sheet).getByRole("radio", { name: "Arm, left" }));
    await user.click(within(sheet).getByRole("button", { name: "Save shot" }));
    await waitFor(() => expect(server.writes()).toHaveLength(1));
    expect(server.writes()[0]).toMatchObject({ method: "PUT", path: "/api/glp1/shots/2026-11-06", body: { site: "arm_left", doseMg: 0.5, note: "Felt fine" } });
  });

  it("Delete on a history row asks first, deletes, then reloads the view from the server", async () => {
    let view = glp1View();
    const after = glp1View({
      settings: { medication: "Ozempic", doseMg: 0.5, injectionWeekday: 5 },
      lastShot: glp1View().shots[1],
      shots: [glp1View().shots[1]],
      doseHistory: [glp1View().doseHistory[0]],
      nextDue: "2026-11-13",
      status: "overdue",
      overdueDays: 4,
    });
    const server = show(view, {
      "GET /api/glp1": () => view,
      "DELETE /api/glp1/shots/:day": () => {
        view = after;
        return after;
      },
    });
    const user = userEvent.setup();
    const history = await screen.findByRole("region", { name: "History" });
    await user.click(within(history).getByRole("button", { name: "Delete shot on Fri, Nov 13" }));
    const confirm = screen.getByRole("alertdialog", { name: "Delete the shot on Fri, Nov 13?" });
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(server.writes()).toHaveLength(0);
    await user.click(within(history).getByRole("button", { name: "Delete shot on Fri, Nov 13" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(server.writes()).toHaveLength(1));
    expect(server.writes()[0]).toMatchObject({ method: "DELETE", path: "/api/glp1/shots/2026-11-13" });
    await waitFor(() => expect(within(screen.getByRole("region", { name: "History" })).getAllByRole("listitem")).toHaveLength(1));
    const gets = server.sent.filter((s) => s.method === "GET" && s.path === "/api/glp1");
    expect(gets).toHaveLength(2);
    expect(server.sent.indexOf(gets[1])).toBeGreaterThan(server.sent.indexOf(server.writes()[0]));
    expect(screen.getByText("Ozempic 0.5 mg, Fridays")).toBeInTheDocument();
    expect(screen.getByText("Injection overdue by 4 days")).toBeInTheDocument();
  });

  it("with no shots, history says so", async () => {
    show(glp1View({ shots: [], lastShot: null, doseHistory: [] }));
    const history = await screen.findByRole("region", { name: "History" });
    expect(within(history).getByText("No shots logged yet")).toBeInTheDocument();
  });

  it("How are you feeling? saves today's side effects with their levels and a note", async () => {
    const server = show(glp1View(), {
      "PUT /api/side-effects/:day": (b, p) => ({ sideEffect: { day: p.split("/").pop(), effects: b.effects, note: b.note } }),
    });
    const user = userEvent.setup();
    const feel = await screen.findByRole("region", { name: "How are you feeling?" });
    expect(server.sent.some((s) => s.path === "/api/side-effects?from=2026-11-17&to=2026-11-17")).toBe(true);
    await user.click(within(feel).getByRole("button", { name: "Check in" }));
    const sheet = screen.getByRole("dialog", { name: "How are you feeling?" });
    const effects = within(sheet).getAllByRole("radiogroup");
    expect(effects.map((g) => g.getAttribute("aria-label"))).toEqual(["Nausea", "Low appetite", "Fatigue", "Constipation", "Diarrhea", "Heartburn", "Headache"]);
    expect(within(effects[0]).getByRole("radio", { name: "Off" })).toHaveAttribute("aria-checked", "true");
    await user.click(within(within(sheet).getByRole("radiogroup", { name: "Nausea" })).getByRole("radio", { name: "Medium" }));
    await user.click(within(within(sheet).getByRole("radiogroup", { name: "Low appetite" })).getByRole("radio", { name: "Strong" }));
    await user.click(within(within(sheet).getByRole("radiogroup", { name: "Headache" })).getByRole("radio", { name: "Mild" }));
    await user.click(within(within(sheet).getByRole("radiogroup", { name: "Headache" })).getByRole("radio", { name: "Off" }));
    await user.type(within(sheet).getByLabelText("Note"), "Queasy after lunch");
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(server.writes()[0]).toMatchObject({
      method: "PUT",
      path: "/api/side-effects/2026-11-17",
      body: { effects: { nausea: 2, low_appetite: 3 }, note: "Queasy after lunch" },
    });
    expect(Object.keys(server.writes()[0].body.effects)).toEqual(["nausea", "low_appetite"]);
    expect(within(feel).getByText("Nausea: medium, Low appetite: strong")).toBeInTheDocument();
  });

  it("clearing a check-in (all Off, blank note) sends nothing felt and goes back to Check in", async () => {
    const server = show(glp1View(), {
      "GET /api/side-effects": () => ({ days: [{ day: "2026-11-17", effects: { fatigue: 1 }, note: "Tired" }] }),
      "PUT /api/side-effects/:day": () => ({ sideEffect: null }),
    });
    const user = userEvent.setup();
    const feel = await screen.findByRole("region", { name: "How are you feeling?" });
    await user.click(await within(feel).findByRole("button", { name: "Edit check-in" }));
    const sheet = screen.getByRole("dialog", { name: "How are you feeling?" });
    await user.click(within(within(sheet).getByRole("radiogroup", { name: "Fatigue" })).getByRole("radio", { name: "Off" }));
    await user.clear(within(sheet).getByLabelText("Note"));
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(server.writes()[0]).toMatchObject({ method: "PUT", path: "/api/side-effects/2026-11-17" });
    expect(server.writes()[0].body).toEqual({ effects: {}, note: "" });
    expect(within(feel).getByRole("button", { name: "Check in" })).toBeInTheDocument();
    expect(within(feel).getByText("No side effects noted")).toBeInTheDocument();
  });

  it("a day already checked in shows its effects and opens filled in", async () => {
    show(glp1View(), { "GET /api/side-effects": () => ({ days: [{ day: "2026-11-17", effects: { fatigue: 1 }, note: "Tired" }] }) });
    const feel = await screen.findByRole("region", { name: "How are you feeling?" });
    expect(await within(feel).findByText("Fatigue: mild")).toBeInTheDocument();
    await userEvent.setup().click(within(feel).getByRole("button", { name: "Edit check-in" }));
    const sheet = screen.getByRole("dialog", { name: "How are you feeling?" });
    expect(within(within(sheet).getByRole("radiogroup", { name: "Fatigue" })).getByRole("radio", { name: "Mild" })).toHaveAttribute("aria-checked", "true");
    expect(within(sheet).getByLabelText("Note")).toHaveValue("Tired");
  });

  it("after-injection shows calorie and protein bars by day since the shot when there are enough shots", async () => {
    show(glp1View());
    const after = await screen.findByRole("region", { name: "After your injection" });
    const cal = await within(after).findByRole("img", { name: /Average calories by day since your shot/ });
    expect(cal.querySelectorAll("[data-bar]")).toHaveLength(6); // day 3 has nothing logged: no bar, not a zero
    expect(within(after).getByRole("img", { name: /Average protein by day since your shot/ })).toBeInTheDocument();
    expect(cal.getAttribute("aria-label")).toContain("day 0 1,850");
    expect(cal.getAttribute("aria-label")).toContain("day 3 no food logged");
    expect(within(after).queryByText(/Log at least two shots/)).not.toBeInTheDocument();
  });

  it("after-injection shows a hint until there are two shots", async () => {
    show(glp1View(), { "GET /api/glp1/after-injection": () => afterNotEnough });
    const after = await screen.findByRole("region", { name: "After your injection" });
    expect(await within(after).findByText("Log at least two shots to see how your eating changes after an injection")).toBeInTheDocument();
    expect(within(after).queryByRole("img")).not.toBeInTheDocument();
  });

  it("after-injection says so when it can't load, instead of loading forever", async () => {
    show(glp1View(), { "GET /api/glp1/after-injection": () => ({ status: 500, json: { error: "Boom" } }) });
    const after = await screen.findByRole("region", { name: "After your injection" });
    expect(await within(after).findByText("Couldn't load this right now")).toBeInTheDocument();
    expect(within(after).queryByText("Loading…")).not.toBeInTheDocument();
  });

  it("Back returns to where it was opened from", async () => {
    window.location.hash = "#/glp1?from=/goals";
    show(glp1View());
    await userEvent.setup().click(await screen.findByRole("button", { name: "Back" }));
    expect(window.location.hash).toBe("#/goals");
  });
});

describe("#/glp1 route", () => {
  it("the app shows the GLP-1 page at #/glp1", async () => {
    window.location.hash = "#/glp1";
    fakeServer({
      "GET /api/targets": () => ({ targets: steadyTargets }),
      "GET /api/body": () => ({ body: bodyA }),
      "GET /api/glp1": () => glp1View(),
      "GET /api/glp1/after-injection": () => afterEnough,
      "GET /api/side-effects": () => ({ days: [] }),
    });
    renderWithSession(<AppShell />);
    expect(await screen.findByRole("heading", { level: 1, name: "GLP-1" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /Week of/ })).not.toBeInTheDocument();
    act(() => {
      window.location.hash = "#/";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await waitFor(() => expect(screen.queryByRole("heading", { level: 1, name: "GLP-1" })).not.toBeInTheDocument());
  });
});

describe("Goals link", () => {
  it("Goals links to the GLP-1 page, coming back to Goals", async () => {
    const { default: GoalsPage } = await import("../goals/GoalsPage");
    fakeServer({ "GET /api/targets": () => ({ targets: steadyTargets }) });
    renderWithSession(<GoalsPage />);
    expect(await screen.findByRole("link", { name: "GLP-1 shots" })).toHaveAttribute("href", "#/glp1?from=/goals");
  });
});
