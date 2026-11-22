import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MealPlanView from "./MealPlanView";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";
import { culuryPlan } from "../../test/fixtures";

// "Today" is pinned: noon on Tue, Nov 17 in Denver
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-17T19:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("Meal plan view", () => {
  it("asks for the selected day and meal, and shows days as sections in the server's order", async () => {
    const server = fakeServer({ "GET /api/culury/plan": () => culuryPlan });
    renderWithSession(<MealPlanView day="2026-11-18" meal="dinner" onOpen={async () => {}} />);
    await screen.findByRole("heading", { name: "Wed, Nov 18" });
    expect(server.sent.map((s) => s.path)).toEqual(["/api/culury/plan?day=2026-11-18&meal=dinner"]);
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Wed, Nov 18", "Yesterday", "Today · Tue, Nov 17"]);
    const first = screen.getByRole("region", { name: "Wed, Nov 18" });
    const buttons = within(first).getAllByRole("button");
    expect(buttons[0]).toHaveTextContent("Dinner");
    expect(buttons[0]).toHaveTextContent("Chili con carne");
    expect(within(screen.getByRole("region", { name: "Today · Tue, Nov 17" })).getByRole("button")).toHaveTextContent("Second breakfast");
  });

  it("a note without a recipe is shown greyed but can't be tapped; a recipe opens by its id", async () => {
    fakeServer({ "GET /api/culury/plan": () => culuryPlan });
    const onOpen = vi.fn(async () => {});
    renderWithSession(<MealPlanView day="2026-11-18" meal="dinner" onOpen={onOpen} />);
    const first = await screen.findByRole("region", { name: "Wed, Nov 18" });
    expect(within(first).getAllByRole("button")).toHaveLength(1);
    const note = within(first).getByText("Leftovers").closest("li")!;
    expect(note).toHaveTextContent("Lunch");
    expect(note).toHaveClass("text-muted");
    expect(within(note).queryByRole("button")).toBeNull();
    await userEvent.click(within(first).getByRole("button", { name: /Chili con carne/ }));
    expect(onOpen).toHaveBeenCalledWith(812);
  });

  it("RecipeHub down: a plain message, nothing else", async () => {
    fakeServer({ "GET /api/culury/plan": () => ({ linked: true, days: [], errors: [{ source: "culury", message: "Couldn't reach RecipeHub" }] }) });
    renderWithSession(<MealPlanView day="2026-11-18" meal="dinner" onOpen={async () => {}} />);
    expect(await screen.findByText("Couldn't reach RecipeHub")).toBeInTheDocument();
    expect(screen.queryByText(/Nothing planned/)).toBeNull();
  });

  it("an empty plan says so", async () => {
    fakeServer({ "GET /api/culury/plan": () => ({ linked: true, days: [], errors: [] }) });
    renderWithSession(<MealPlanView day="2026-11-18" meal="dinner" onOpen={async () => {}} />);
    expect(await screen.findByText(/Nothing planned in RecipeHub/)).toBeInTheDocument();
  });

  it("a recipe that won't open says why, and the plan stays", async () => {
    fakeServer({ "GET /api/culury/plan": () => culuryPlan });
    renderWithSession(<MealPlanView day="2026-11-18" meal="dinner" onOpen={async () => Promise.reject(new Error("RecipeHub took too long to answer"))} />);
    await userEvent.click(await screen.findByRole("button", { name: /Chili con carne/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("RecipeHub took too long to answer");
    expect(screen.getByRole("button", { name: /Chili con carne/ })).toBeInTheDocument();
  });
});
