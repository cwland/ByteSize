import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PlanFlow from "./PlanFlow";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";
import { bodyA, plansA, plansNoSafe, steadyTargets } from "../../test/fixtures";

describe("plan flow", () => {
  it("body form sends a birthdate and the new activity level", async () => {
    const server = fakeServer({
      "GET /api/body": () => ({ body: null }),
      "PUT /api/body": (b) => ({ body: { ...b, needsReview: false } }),
      "GET /api/plans": () => plansA,
    });
    renderWithSession(<PlanFlow onDone={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("radio", { name: "Male" }));
    expect(screen.queryByLabelText("Birth year")).not.toBeInTheDocument();
    const birth = screen.getByLabelText("Birthdate");
    expect(birth).toHaveAttribute("type", "date");
    await user.type(birth, "1974-06-01");
    await user.type(screen.getByLabelText("Height (ft)"), "6");
    await user.type(screen.getByLabelText("Height (in)"), "0");
    await user.type(screen.getByLabelText("Current weight (lb)"), "226");
    await user.type(screen.getByLabelText("Goal weight (lb)"), "180");
    const activity = screen.getByRole("radiogroup", { name: "How active is your day, not counting workouts?" });
    expect(within(activity).getAllByRole("radio")).toHaveLength(4);
    expect(within(activity).getByRole("radio", { name: /Mostly sitting.*Desk job, little walking/ })).toBeInTheDocument();
    expect(within(activity).getByRole("radio", { name: /On your feet most of the day.*Retail, teaching, lots of walking/ })).toBeInTheDocument();
    expect(within(activity).getByRole("radio", { name: /Physical job.*Construction, warehouse, farm work/ })).toBeInTheDocument();
    await user.click(within(activity).getByRole("radio", { name: /On your feet some of the day.*Some walking, or a daily walk/ }));
    await user.click(screen.getByRole("switch", { name: "Are you taking a GLP-1 medicine?" }));
    await user.click(screen.getByRole("button", { name: "See my plans" }));

    await screen.findByRole("heading", { name: "Choose your plan" });
    const put = server.writes().find((w) => w.method === "PUT" && w.path === "/api/body")!;
    expect(put.body).toMatchObject({ sex: "male", birthDate: "1974-06-01", activity: "some", glp1: true });
    expect(put.body).not.toHaveProperty("birthYear");
    expect(put.body).not.toHaveProperty("needsReview");
    expect(put.body.heightCm).toBeCloseTo(182.88, 6);
    expect(put.body.weightKg).toBeCloseTo(102.512, 3);
  });

  it("plan cards show calorie, protein and fiber ranges and best-for", async () => {
    const onDone = vi.fn();
    const server = fakeServer({
      "GET /api/body": () => ({ body: bodyA }),
      "GET /api/plans": () => plansA,
      "POST /api/plans/select": () => ({ targets: steadyTargets }),
    });
    renderWithSession(<PlanFlow onDone={onDone} />);
    const steady = await screen.findByRole("group", { name: "Steady" });
    expect(within(steady).getByText("Recommended for you")).toBeInTheDocument();
    expect(within(steady).getByText("The sweet spot: sustainable loss, high energy, no muscle loss")).toBeInTheDocument();
    expect(within(steady).getByText("Eat 1,937–2,037 calories")).toBeInTheDocument();
    expect(within(steady).getByText("Protein 162–180 g")).toBeInTheDocument();
    expect(within(steady).getByText("Fiber 30–35 g")).toBeInTheDocument();
    expect(within(steady).getByText("Lose 1 lb per week")).toBeInTheDocument();
    expect(within(steady).getByText("About 46 weeks to reach your goal")).toBeInTheDocument();
    const vigorous = screen.getByRole("group", { name: "Vigorous" });
    expect(within(vigorous).getByText("Not recommended")).toBeInTheDocument();
    expect(within(vigorous).getByText("Eat 1,437–1,537 calories")).toBeInTheDocument();
    expect(within(vigorous).getByText("Fiber 25–30 g")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Accelerated" })).getByText("Lose 1½ lb per week")).toBeInTheDocument();
    const maintenance = screen.getByRole("group", { name: "Maintenance" });
    expect(within(maintenance).getByText("Eat 2,387–2,587 calories")).toBeInTheDocument();
    expect(within(maintenance).getByText("Hold your weight steady")).toBeInTheDocument();
    expect(within(maintenance).queryByText(/per week|weeks to reach|already at your goal/)).not.toBeInTheDocument();
    expect(screen.getByText(plansA.explanation)).toBeInTheDocument();

    await userEvent.setup().click(within(steady).getByRole("button", { name: "Select" }));
    expect(server.writes()).toContainEqual(expect.objectContaining({ method: "POST", path: "/api/plans/select", body: { plan: "steady" } }));
    expect(onDone).toHaveBeenCalledWith(steadyTargets);
  });

  it("carousel starts on the recommended card and dots move between cards", async () => {
    const scrollTo = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, writable: true, value: scrollTo });
    try {
      fakeServer({ "GET /api/body": () => ({ body: bodyA }), "GET /api/plans": () => plansA });
      renderWithSession(<PlanFlow onDone={vi.fn()} />);
      const card = (name: string) => screen.getByRole("group", { name });
      await screen.findByRole("group", { name: "Steady" });
      expect(card("Steady")).toHaveAttribute("data-current", "true");
      expect(screen.getByRole("button", { name: "Show Steady" })).toHaveAttribute("aria-current", "true");
      expect(scrollTo).toHaveBeenCalled();
      // No side arrows: swiping, the dots and the keyboard move between plans
      expect(screen.queryByRole("button", { name: "Next plan" })).not.toBeInTheDocument();

      const user = userEvent.setup();
      scrollTo.mockClear();
      await user.click(screen.getByRole("button", { name: "Show Accelerated" }));
      expect(card("Accelerated")).toHaveAttribute("data-current", "true");
      expect(card("Steady")).toHaveAttribute("data-current", "false");
      expect(screen.getByRole("button", { name: "Show Accelerated" })).toHaveAttribute("aria-current", "true");
      expect(screen.getByRole("button", { name: "Show Steady" })).not.toHaveAttribute("aria-current");
      expect(scrollTo).toHaveBeenCalled();

      screen.getByRole("region", { name: "Plans" }).focus();
      await user.keyboard("{ArrowRight}");
      expect(card("Vigorous")).toHaveAttribute("data-current", "true");
      await user.keyboard("{ArrowRight}");
      expect(card("Vigorous")).toHaveAttribute("data-current", "true");
      await user.keyboard("{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}");
      expect(card("Maintenance")).toHaveAttribute("data-current", "true");
    } finally {
      delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo;
    }
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
