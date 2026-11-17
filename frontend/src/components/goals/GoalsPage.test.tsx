import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GoalsPage from "./GoalsPage";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";
import { bodyA, m3Routes, plansA, steadyTargets } from "../../test/fixtures";
import { glp1View } from "../../test/glp1Fixtures";
import { weightJson } from "../../test/weightFixtures";

describe("Goals", () => {
  afterEach(() => void vi.useRealTimers());

  it("Goals shows targets and saves edits", async () => {
    const server = fakeServer({
      ...m3Routes,
      "GET /api/targets": () => ({ targets: steadyTargets }),
      "PUT /api/targets": (b) => ({ targets: { ...b, plan: null, effectiveFrom: "2026-11-16" } }),
    });
    renderWithSession(<GoalsPage />);
    expect(await screen.findByText("Steady plan")).toBeInTheDocument();
    expect(screen.getByText("1,810–2,110 cals")).toBeInTheDocument();
    expect(screen.getByText("126–180 g")).toBeInTheDocument();
    expect(screen.getByText("25–38 g")).toBeInTheDocument();
    expect(screen.getByText("64–128 fl oz")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change plan" })).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Edit targets" }));
    const max = screen.getByLabelText("Calories max");
    expect(max).toHaveValue(2110);
    await user.clear(max);
    await user.type(max, "2000");
    await user.clear(screen.getByLabelText("Water min (fl oz)"));
    await user.type(screen.getByLabelText("Water min (fl oz)"), "80");
    await user.click(screen.getByRole("button", { name: "Save targets" }));

    const put = server.writes().find((w) => w.method === "PUT" && w.path === "/api/targets")!;
    expect(put.body).toEqual({
      calories: { min: 1810, max: 2000 },
      protein_g: { min: 126, max: 180 },
      fiber_g: { min: 25, max: 38 },
      water_ml: { min: 2366, max: 3785 },
    });
    expect(await screen.findByText("Your own targets")).toBeInTheDocument();
    expect(screen.getByText("1,810–2,000 cals")).toBeInTheDocument();
  });

  it("asks for today's targets in the person's time zone", async () => {
    const server = fakeServer({ ...m3Routes, "GET /api/targets": () => ({ targets: null }) });
    renderWithSession(<GoalsPage />);
    expect(await screen.findByRole("button", { name: "Pick a plan" })).toBeInTheDocument();
    expect(server.sent.find((s) => s.path.startsWith("/api/targets"))!.path).toMatch(/^\/api\/targets\?day=\d{4}-\d{2}-\d{2}$/);
  });

  it("Goals has Edit my details", async () => {
    const server = fakeServer({
      ...m3Routes,
      "GET /api/targets": () => ({ targets: steadyTargets }),
      "GET /api/body": () => ({ body: bodyA }),
      "PUT /api/body": (b) => ({ body: { ...b, needsReview: false } }),
      "GET /api/plans": () => plansA,
    });
    renderWithSession(<GoalsPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Edit my details" }));
    expect(await screen.findByRole("heading", { name: "Tell us about yourself" })).toBeInTheDocument();
    expect(screen.getByLabelText("Birthdate")).toHaveValue("1974-06-01");
    expect(screen.getByRole("radio", { name: /On your feet some of the day/ })).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("button", { name: "See my plans" }));
    expect(await screen.findByRole("heading", { name: "Choose your plan" })).toBeInTheDocument();
    expect(server.writes().find((w) => w.path === "/api/body")!.body).toMatchObject({ birthDate: "1974-06-01", activity: "some" });
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByText("Steady plan")).toBeInTheDocument();
  });

  it("shows the weight section, whose re-plan hint opens the plan picker", async () => {
    fakeServer({
      ...m3Routes,
      "GET /api/targets": () => ({ targets: steadyTargets }),
      "GET /api/weight": () => weightJson({ replanHint: true }),
      "GET /api/body": () => ({ body: bodyA }),
      "GET /api/plans": () => plansA,
    });
    renderWithSession(<GoalsPage />);
    expect(await screen.findByText("Your weight has changed — check your plan")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Check your plan" }));
    expect(await screen.findByRole("heading", { name: "Choose your plan" })).toBeInTheDocument();
  });

  it("Goals shows weekly trends, badges and vacation mode", async () => {
    fakeServer({
      ...m3Routes,
      "GET /api/targets": () => ({ targets: steadyTargets }),
      "GET /api/trends/weekly": () => ({ weeks: [] }),
      "GET /api/badges": () => ({ badges: [{ id: "first_weigh_in", earnedOn: null, seen: false }], new: [] }),
      "GET /api/vacations": () => ({ vacations: [] }),
    });
    renderWithSession(<GoalsPage />);
    expect(await screen.findByRole("region", { name: "Weekly trends" })).toBeInTheDocument();
    expect(await screen.findByRole("listitem", { name: "First weigh-in" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Vacation mode" })).toBeInTheDocument();
  });

  it("marks each dose on the weight chart, the starting dose included, and says so in the chart's summary", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-17T20:00:00Z"));
    fakeServer({
      ...m3Routes,
      "GET /api/targets": () => ({ targets: steadyTargets }),
      "GET /api/weight": () => weightJson(),
      "GET /api/glp1": () => glp1View(), // 0.5 mg from Nov 6, 1 mg from Nov 13
    });
    renderWithSession(<GoalsPage />);
    const weight = await screen.findByRole("region", { name: "Weight" });
    await vi.waitFor(() => expect(within(weight).getAllByTestId("marker")).toHaveLength(2));
    expect(within(weight).getAllByTestId("marker").map((m) => m.textContent)).toEqual(["0.5 mg", "1 mg"]);
    expect(within(weight).getByRole("img").getAttribute("aria-label")).toMatch(/dose 0\.5 mg from Nov 6, dose 1 mg from Nov 13$/);
  });

  it("no GLP-1 set up (or /api/glp1 failing): no markers, nothing else breaks", async () => {
    fakeServer({ ...m3Routes, "GET /api/targets": () => ({ targets: steadyTargets }), "GET /api/weight": () => weightJson(), "GET /api/glp1": () => ({ status: 500, json: { error: "Down" } }) });
    renderWithSession(<GoalsPage />);
    const weight = await screen.findByRole("region", { name: "Weight" });
    expect(await within(weight).findByRole("img")).toBeInTheDocument();
    expect(within(weight).queryByTestId("marker")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("orders Goals: plan, weight, weekly trends, badges, vacation mode, then the GLP-1 link; no error notices by default", async () => {
    fakeServer({ ...m3Routes, "GET /api/targets": () => ({ targets: steadyTargets }) });
    renderWithSession(<GoalsPage />);
    await screen.findByText("Steady plan");
    await screen.findByRole("region", { name: "Badges" });
    const order = [
      screen.getByRole("region", { name: "Plan" }),
      screen.getByRole("region", { name: "Weight" }),
      screen.getByRole("region", { name: "Weekly trends" }),
      screen.getByRole("region", { name: "Badges" }),
      screen.getByRole("region", { name: "Vacation mode" }),
      screen.getByRole("link", { name: "GLP-1 shots" }),
    ];
    for (let i = 1; i < order.length; i++) expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("when weekly trends fail to load, the other sections still render", async () => {
    fakeServer({
      ...m3Routes,
      "GET /api/targets": () => ({ targets: steadyTargets }),
      "GET /api/weight": () => weightJson(),
      "GET /api/trends/weekly": () => ({ status: 500, json: { error: "Trends are down" } }),
      "GET /api/badges": () => ({ badges: [{ id: "first_weigh_in", earnedOn: "2026-10-20", seen: true }], new: [] }),
    });
    renderWithSession(<GoalsPage />);
    const trends = await screen.findByRole("region", { name: "Weekly trends" });
    expect(await within(trends).findByRole("alert")).toHaveTextContent("Trends are down");
    expect(screen.getByText("Steady plan")).toBeInTheDocument();
    expect(await screen.findByTestId("weight-now")).toHaveTextContent("221.4 lb");
    expect(await screen.findByRole("listitem", { name: "First weigh-in" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Vacation mode" })).toBeInTheDocument();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });
});
