import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GoalsPage from "./GoalsPage";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";
import { bodyA, plansA, steadyTargets } from "../../test/fixtures";

describe("Goals", () => {
  it("Goals shows targets and saves edits", async () => {
    const server = fakeServer({
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
    const server = fakeServer({ "GET /api/targets": () => ({ targets: null }) });
    renderWithSession(<GoalsPage />);
    expect(await screen.findByRole("button", { name: "Pick a plan" })).toBeInTheDocument();
    expect(server.sent.find((s) => s.path.startsWith("/api/targets"))!.path).toMatch(/^\/api\/targets\?day=\d{4}-\d{2}-\d{2}$/);
  });

  it("Goals has Edit my details", async () => {
    const server = fakeServer({
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

  it("Goals shows weekly trends, badges and vacation mode", async () => {
    fakeServer({
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
});
