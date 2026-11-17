import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PlanFlow from "./PlanFlow";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";
import { bodyA, plansA, plansNoSafe, steadyTargets } from "../../test/fixtures";

describe("plan flow", () => {
  it("body form sends metric values", async () => {
    const server = fakeServer({
      "GET /api/body": () => ({ body: null }),
      "PUT /api/body": (b) => ({ body: b }),
      "GET /api/plans": () => plansA,
    });
    renderWithSession(<PlanFlow onDone={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("radio", { name: "Male" }));
    await user.type(screen.getByLabelText("Birth year"), "1986");
    await user.type(screen.getByLabelText("Height (ft)"), "5");
    await user.type(screen.getByLabelText("Height (in)"), "10");
    await user.type(screen.getByLabelText("Current weight (lb)"), "250");
    await user.type(screen.getByLabelText("Goal weight (lb)"), "180");
    await user.click(screen.getByRole("radio", { name: /Sedentary/ }));
    await user.click(screen.getByRole("switch", { name: "Are you taking a GLP-1 medicine?" }));
    await user.click(screen.getByRole("button", { name: "See my plans" }));

    await screen.findByRole("heading", { name: "Choose your plan" });
    const put = server.writes().find((w) => w.method === "PUT" && w.path === "/api/body")!;
    expect(put.body).toMatchObject({ sex: "male", birthYear: 1986, activity: "sedentary", glp1: true });
    expect(put.body.heightCm).toBeCloseTo(177.8, 6);
    expect(put.body.weightKg).toBeCloseTo(113.398, 3);
    expect(put.body.goalWeightKg).toBeCloseTo(81.647, 3);
  });

  it("plan picker opens on the recommended plan and selecting it saves", async () => {
    const onDone = vi.fn();
    const server = fakeServer({
      "GET /api/body": () => ({ body: bodyA }),
      "GET /api/plans": () => plansA,
      "POST /api/plans/select": () => ({ targets: steadyTargets }),
    });
    renderWithSession(<PlanFlow onDone={onDone} />);
    const steady = await screen.findByRole("group", { name: "Steady" });
    expect(within(steady).getByText("Recommended for you")).toBeInTheDocument();
    expect(within(steady).getByText("Eat 1,960 calories per day")).toBeInTheDocument();
    expect(within(steady).getByText("Lose 1 lb per week")).toBeInTheDocument();
    expect(within(steady).getByText("About 70 weeks to reach goal")).toBeInTheDocument();
    expect(steady).toHaveAttribute("data-current", "true");
    expect(within(screen.getByRole("group", { name: "Vigorous" })).getByText("Not recommended")).toBeInTheDocument();
    expect(screen.getByText(plansA.explanation)).toBeInTheDocument();

    await userEvent.setup().click(within(steady).getByRole("button", { name: "Select" }));
    expect(server.writes()).toContainEqual(expect.objectContaining({ method: "POST", path: "/api/plans/select", body: { plan: "steady" } }));
    expect(onDone).toHaveBeenCalledWith(steadyTargets);
  });

  it("no safe plan shows the care-team message and own-targets button", async () => {
    const server = fakeServer({
      "GET /api/body": () => ({ body: bodyA }),
      "GET /api/plans": () => plansNoSafe,
      "PUT /api/targets": (b) => ({ targets: { ...b, plan: null, effectiveFrom: "2026-11-16" } }),
    });
    const onDone = vi.fn();
    renderWithSession(<PlanFlow onDone={onDone} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/set your targets with your care team/i);
    expect(screen.queryByText("Recommended for you")).not.toBeInTheDocument();
    expect(screen.getAllByText("Not recommended")).toHaveLength(4);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Set my own targets" }));
    expect(screen.getByRole("heading", { name: "Your targets" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Calories min"), "1400");
    await user.type(screen.getByLabelText("Calories max"), "1600");
    await user.click(screen.getByRole("button", { name: "Save targets" }));
    const put = server.writes().find((w) => w.path === "/api/targets")!;
    expect(put.body.calories).toEqual({ min: 1400, max: 1600 });
    expect(onDone).toHaveBeenCalled();
  });
});
