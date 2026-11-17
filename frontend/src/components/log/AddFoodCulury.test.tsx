import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LogPage from "./LogPage";
import { SelectedDayProvider } from "../../selectedDay";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";
import { barFood, culuryChili, culuryOff, culuryOn, culuryPlan, dayJson, settingsMe } from "../../test/fixtures";

// Add food with Culury linked (§14 A): the Meal plan button, Culury recipes in search, tracking them
const taco = { ...culuryChili, id: 90, name: "Taco soup", icon: "🍽️", servings: [{ label: "1 serving" }], nutrients: {} };
// A fresh fake Culury recipe store per test: GET /api/culury/recipes/:id
const makeRecipes = (): Record<string, unknown> => ({
  "812": { food: culuryChili, hasNutrition: true, outdated: false },
  "90": { food: taco, hasNutrition: false, outdated: false },
});
const twoServings = { servingIndex: 0, unit: "serving", quantity: 2, fraction: 1 };

function open(routes: Record<string, (b: any, path: string) => unknown> = {}, recipes = makeRecipes()) {
  const server = fakeServer({
    "GET /api/day/:date": () => dayJson(),
    "GET /api/settings/me": () => settingsMe,
    "GET /api/foods/recent": () => ({ foods: [] }),
    "GET /api/foods/search": () => ({ groups: [{ source: "off", label: "Open Food Facts", foods: [barFood] }], errors: [] }),
    ...culuryOn,
    "GET /api/culury/plan": () => culuryPlan,
    "GET /api/culury/recipes/:id": (_b, path) => recipes[path.split("/").pop()!] ?? { status: 404, json: { error: "Culury didn't find that recipe" } },
    "POST /api/log": (b) => ({ entry: { id: 3, ...b } }),
    ...routes,
  });
  renderWithSession(
    <SelectedDayProvider timeZone="America/Boise">
      <LogPage />
    </SelectedDayProvider>,
  );
  return server;
}

async function openDinner(user: ReturnType<typeof userEvent.setup>) {
  const card = await screen.findByRole("region", { name: "Dinner" });
  await user.click(within(card).getByRole("button", { name: "Add Food" }));
  return screen.getByRole("dialog", { name: "Add food to Dinner" });
}
const logged = (server: ReturnType<typeof fakeServer>) => server.writes().find((w) => w.path === "/api/log")!.body;

// "Today" is pinned: noon on Mon, Nov 16 in Boise (the fixtures' day)
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T19:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("Add food with Culury", () => {
  it("no Meal plan button when Culury isn't linked", async () => {
    open(culuryOff);
    const user = userEvent.setup();
    const sheet = await openDinner(user);
    expect(within(sheet).getByRole("button", { name: /Describe it/ })).toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: /Meal plan/ })).toBeNull();
  });

  it("Meal plan: asks for this day and meal; picking a recipe opens Track food at 1 serving and logs it as culury", async () => {
    const server = open();
    const user = userEvent.setup();
    const sheet = await openDinner(user);
    await user.click(await within(sheet).findByRole("button", { name: /Meal plan/ }));
    expect(within(sheet).getByRole("heading", { name: "Meal plan" })).toBeInTheDocument();
    await within(sheet).findByRole("region", { name: "Wed, Nov 18" });
    expect(server.sent.some((s) => s.path === "/api/culury/plan?day=2026-11-16&meal=dinner")).toBe(true);
    expect(within(sheet).getByRole("region", { name: "Today · Mon, Nov 16" })).toHaveTextContent("Overnight oats");

    await user.click(within(sheet).getByRole("button", { name: /Chili con carne/ }));
    expect(await within(sheet).findByRole("heading", { name: "Track food" })).toBeInTheDocument();
    expect(server.sent.some((s) => s.path === "/api/culury/recipes/812")).toBe(true);
    expect(within(sheet).getByRole("button", { name: /^Serving/ })).toHaveTextContent(/^Serving1 serving$/);
    expect(within(sheet).queryByText(/may be out of date/)).toBeNull();
    // grams are offered: the serving has a weight
    await user.click(within(sheet).getByRole("button", { name: /^Serving/ }));
    const units = within(within(sheet).getByRole("combobox", { name: "Unit" })).getAllByRole("option").map((o) => o.textContent);
    expect(units).toContain("g");
    await user.click(within(sheet).getByRole("button", { name: "Track" }));
    expect(logged(server)).toEqual({ day: "2026-11-16", meal: "dinner", food: { kind: "culury", id: 812 }, servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("back from a recipe opened in the plan returns to the plan", async () => {
    open();
    const user = userEvent.setup();
    const sheet = await openDinner(user);
    await user.click(await within(sheet).findByRole("button", { name: /Meal plan/ }));
    await user.click(await within(sheet).findByRole("button", { name: /Chili con carne/ }));
    await within(sheet).findByRole("heading", { name: "Track food" });
    await user.click(within(sheet).getByRole("button", { name: "‹ Back" }));
    expect(within(sheet).getByRole("heading", { name: "Meal plan" })).toBeInTheDocument();
  });

  it("a recipe without nutrition: no grams, Estimate with AI fills it in, and it logs flagged with the estimate", async () => {
    const server = open({
      "POST /api/ai/estimate": () => ({
        food: { name: "Taco soup", brand: null, icon: "🍲", barcode: null, category: "soups", servings: [{ label: "1 bowl", grams: 400 }], nutrients: { calories: 310, protein_g: 18, fiber_g: 7 }, aiFields: ["calories", "protein_g", "fiber_g"], imageUrl: null, override: false, source: "ai" },
      }),
    });
    const user = userEvent.setup();
    const sheet = await openDinner(user);
    await user.click(await within(sheet).findByRole("button", { name: /Meal plan/ }));
    await user.click(await within(sheet).findByRole("button", { name: /Taco soup/ }));
    expect(await within(sheet).findByText(/Culury has no nutrition for this recipe/)).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: /^Serving/ }));
    const units = within(within(sheet).getByRole("combobox", { name: "Unit" })).getAllByRole("option").map((o) => o.textContent);
    expect(units).toEqual(["1 serving"]); // no grams without a serving weight

    await user.click(within(sheet).getByRole("button", { name: "Estimate with AI" }));
    expect(server.writes().find((w) => w.path === "/api/ai/estimate")!.body).toEqual({ text: "1 serving of Taco soup" });
    expect(await within(sheet).findByText("AI estimate")).toBeInTheDocument();
    const summary = within(sheet).getByRole("region", { name: "Summary" });
    expect(within(summary).getByText("Calories").parentElement).toHaveTextContent("310");
    expect(within(sheet).queryByRole("button", { name: "Estimate with AI" })).toBeNull();
    await user.click(within(sheet).getByRole("button", { name: "Track" }));
    expect(logged(server)).toEqual({
      day: "2026-11-16",
      meal: "dinner",
      food: { kind: "culury", id: 90 },
      servingIndex: 0,
      unit: "serving",
      quantity: 1,
      fraction: 1,
      nutrients: { calories: 310, protein_g: 18, fiber_g: 7 },
    });
  });

  it("an estimate for a weighed serving is scaled to that weight", async () => {
    const recipes = { ...makeRecipes(), "91": { food: { ...taco, id: 91, name: "Lentil curry", servings: [{ label: "1 serving", grams: 200 }] }, hasNutrition: false, outdated: false } };
    const server = open({
      "GET /api/culury/plan": () => ({ linked: true, days: [{ day: "2026-11-16", items: [{ slot: "dinner", title: "Lentil curry", recipeId: 91, servings: 1, note: null }] }], errors: [] }),
      "POST /api/ai/estimate": () => ({
        food: { name: "Lentil curry", brand: null, icon: "🍛", barcode: null, category: "", servings: [{ label: "1 cup", grams: 400 }], nutrients: { calories: 400, protein_g: 20 }, aiFields: ["calories", "protein_g"], imageUrl: null, override: false, source: "ai" },
      }),
    }, recipes);
    const user = userEvent.setup();
    const sheet = await openDinner(user);
    await user.click(await within(sheet).findByRole("button", { name: /Meal plan/ }));
    await user.click(await within(sheet).findByRole("button", { name: /Lentil curry/ }));
    await user.click(await within(sheet).findByRole("button", { name: "Estimate with AI" }));
    expect(server.writes().find((w) => w.path === "/api/ai/estimate")!.body).toEqual({ text: "1 serving of Lentil curry (200 g)" });
    await within(sheet).findByText("AI estimate");
    await user.click(within(sheet).getByRole("button", { name: "Track" }));
    expect(logged(server).nutrients).toEqual({ calories: 200, protein_g: 10 });
  });

  it("a recipe without nutrition can still be tracked as is (unknown stays unknown)", async () => {
    const server = open();
    const user = userEvent.setup();
    const sheet = await openDinner(user);
    await user.click(await within(sheet).findByRole("button", { name: /Meal plan/ }));
    await user.click(await within(sheet).findByRole("button", { name: /Taco soup/ }));
    await within(sheet).findByText(/Culury has no nutrition for this recipe/);
    expect(within(within(sheet).getByRole("region", { name: "Summary" }).querySelector("p")!).getByText("?")).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "Track" }));
    expect(logged(server)).not.toHaveProperty("nutrients");
  });

  it("Culury's nutrition marked outdated shows a small note", async () => {
    open({}, { ...makeRecipes(), "812": { food: culuryChili, hasNutrition: true, outdated: true } });
    const user = userEvent.setup();
    const sheet = await openDinner(user);
    await user.click(await within(sheet).findByRole("button", { name: /Meal plan/ }));
    await user.click(await within(sheet).findByRole("button", { name: /Chili con carne/ }));
    expect(await within(sheet).findByText(/may be out of date/)).toBeInTheDocument();
  });

  it("search: Culury recipes carry a Culury tag and open through Culury", async () => {
    const server = open({
      "GET /api/foods/search": () => ({
        groups: [
          { source: "culury", label: "Culury", foods: [culuryChili] },
          { source: "off", label: "Open Food Facts", foods: [barFood] },
        ],
        errors: [],
      }),
    });
    const user = userEvent.setup();
    const sheet = await openDinner(user);
    await user.type(within(sheet).getByRole("searchbox", { name: "Search foods" }), "chili");
    const row = await within(sheet).findByRole("button", { name: /^Chili con carne/ });
    expect(within(row).getByText("Culury")).toBeInTheDocument();
    expect(within(row).queryByText("Recipe")).toBeNull();
    await user.click(row);
    expect(await within(sheet).findByRole("heading", { name: "Track food" })).toBeInTheDocument();
    expect(server.sent.some((s) => s.path === "/api/culury/recipes/812")).toBe(true);
    await user.click(within(sheet).getByRole("button", { name: "‹ Back" }));
    expect(within(sheet).getByRole("searchbox", { name: "Search foods" })).toBeInTheDocument();
  });

  it("Culury down: the plan and search say so, and the rest of the sheet still logs", async () => {
    const down = [{ source: "culury", message: "Couldn't reach Culury" }];
    const server = open({
      "GET /api/culury/plan": () => ({ linked: true, days: [], errors: down }),
      "GET /api/foods/search": () => ({ groups: [{ source: "off", label: "Open Food Facts", foods: [barFood] }], errors: down }),
    });
    const user = userEvent.setup();
    const sheet = await openDinner(user);
    await user.click(await within(sheet).findByRole("button", { name: /Meal plan/ }));
    expect(await within(sheet).findByText("Couldn't reach Culury")).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "‹ Back" }));
    await user.type(within(sheet).getByRole("searchbox", { name: "Search foods" }), "peanut");
    expect(await within(sheet).findByText("Couldn't reach Culury")).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: /^Peanut butter bar/ }));
    await user.click(within(sheet).getByRole("button", { name: "Track" }));
    expect(logged(server)).toMatchObject({ food: { kind: "cache", id: 42 } });
  });

  it("a Culury recipe from search that won't open says why and stays on the results", async () => {
    open({
      "GET /api/foods/search": () => ({ groups: [{ source: "culury", label: "Culury", foods: [culuryChili] }], errors: [] }),
      "GET /api/culury/recipes/:id": () => ({ status: 502, json: { error: "Couldn't reach Culury" } }),
    });
    const user = userEvent.setup();
    const sheet = await openDinner(user);
    await user.type(within(sheet).getByRole("searchbox", { name: "Search foods" }), "chili");
    await user.click(await within(sheet).findByRole("button", { name: /^Chili con carne/ }));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent("Couldn't reach Culury");
    expect(within(sheet).getByRole("button", { name: /^Chili con carne/ })).toBeInTheDocument();
  });

  it("Recently tracked: a Culury recipe opens at its last portion", async () => {
    const server = open({ "GET /api/foods/recent": () => ({ foods: [{ ...culuryChili, last: twoServings }] }) });
    const user = userEvent.setup();
    const sheet = await openDinner(user);
    await user.click(await within(sheet).findByRole("button", { name: /^Chili con carne/ }));
    expect(await within(sheet).findByRole("heading", { name: "Track food" })).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: /^Serving/ })).toHaveTextContent("2 servings");
    expect(within(sheet).queryByText(/Culury is unavailable/)).toBeNull();
    await user.click(within(sheet).getByRole("button", { name: "Track" }));
    expect(logged(server)).toMatchObject({ food: { kind: "culury", id: 812 }, quantity: 2 });
  });

  it("Recently tracked with Culury down: Track food from the last logged version", async () => {
    const server = open({
      "GET /api/foods/recent": () => ({ foods: [{ ...culuryChili, last: twoServings }] }),
      "GET /api/culury/recipes/:id": () => ({ status: 502, json: { error: "Couldn't reach Culury" } }),
    });
    const user = userEvent.setup();
    const sheet = await openDinner(user);
    await user.click(await within(sheet).findByRole("button", { name: /^Chili con carne/ }));
    expect(await within(sheet).findByText("Culury is unavailable — using the last logged version")).toBeInTheDocument();
    expect(within(sheet).getByRole("heading", { name: "Track food" })).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: /^Serving/ })).toHaveTextContent("2 servings");
    expect(within(sheet).queryByRole("button", { name: "Estimate with AI" })).toBeNull();
    await user.click(within(sheet).getByRole("button", { name: "Track" }));
    expect(logged(server)).toEqual({ day: "2026-11-16", meal: "dinner", food: { kind: "culury", id: 812 }, servingIndex: 0, unit: "serving", quantity: 2, fraction: 1 });
  });

  it("Recently tracked, recipe gone from Culury (404): says so, no fallback", async () => {
    open({
      "GET /api/foods/recent": () => ({ foods: [{ ...culuryChili, last: twoServings }] }),
      "GET /api/culury/recipes/:id": () => ({ status: 404, json: { error: "Culury didn't find that recipe" } }),
    });
    const user = userEvent.setup();
    const sheet = await openDinner(user);
    await user.click(await within(sheet).findByRole("button", { name: /^Chili con carne/ }));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent("Culury didn't find that recipe");
    expect(within(sheet).queryByRole("heading", { name: "Track food" })).toBeNull();
  });

  it("from search, a Culury recipe starts at 1 serving even when Recently tracked has another portion", async () => {
    open({
      "GET /api/foods/recent": () => ({ foods: [{ ...culuryChili, last: twoServings }] }),
      "GET /api/foods/search": () => ({ groups: [{ source: "culury", label: "Culury", foods: [culuryChili] }], errors: [] }),
    });
    const user = userEvent.setup();
    const sheet = await openDinner(user);
    await within(sheet).findByRole("heading", { name: "Recently tracked" });
    await user.type(within(sheet).getByRole("searchbox", { name: "Search foods" }), "chili");
    await within(sheet).findByRole("heading", { name: "Culury" });
    await user.click(within(sheet).getByRole("button", { name: /^Chili con carne/ }));
    await within(sheet).findByRole("heading", { name: "Track food" });
    expect(within(sheet).getByRole("button", { name: /^Serving/ })).toHaveTextContent(/^Serving1 serving$/);
  });

  it("quick add on a Culury row with nutrition logs it", async () => {
    const server = open({ "GET /api/foods/search": () => ({ groups: [{ source: "culury", label: "Culury", foods: [culuryChili] }], errors: [] }) });
    const user = userEvent.setup();
    const sheet = await openDinner(user);
    await user.type(within(sheet).getByRole("searchbox", { name: "Search foods" }), "chili");
    await user.click(await within(sheet).findByRole("button", { name: "Quick add Chili con carne" }));
    expect(logged(server)).toMatchObject({ food: { kind: "culury", id: 812 }, quantity: 1 });
  });

  it("quick add on a Culury search row without nutrition opens it instead, offering Estimate with AI", async () => {
    const server = open({ "GET /api/foods/search": () => ({ groups: [{ source: "culury", label: "Culury", foods: [taco] }], errors: [] }) });
    const user = userEvent.setup();
    const sheet = await openDinner(user);
    await user.type(within(sheet).getByRole("searchbox", { name: "Search foods" }), "taco");
    await user.click(await within(sheet).findByRole("button", { name: "Quick add Taco soup" }));
    expect(await within(sheet).findByRole("button", { name: "Estimate with AI" })).toBeInTheDocument();
    expect(server.writes().filter((w) => w.path === "/api/log")).toEqual([]);
  });

  it("quick add on a Recently tracked Culury row without nutrition opens it at its last portion", async () => {
    const server = open({ "GET /api/foods/recent": () => ({ foods: [{ ...taco, last: twoServings }] }) });
    const user = userEvent.setup();
    const sheet = await openDinner(user);
    await user.click(await within(sheet).findByRole("button", { name: "Quick add Taco soup" }));
    expect(await within(sheet).findByRole("button", { name: "Estimate with AI" })).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: /^Serving/ })).toHaveTextContent("2 servings");
    expect(server.writes().filter((w) => w.path === "/api/log")).toEqual([]);
  });

  it("opening shows on the row (disabled), and a late answer after moving on is ignored", async () => {
    let answer!: (v: unknown) => void;
    open({
      "GET /api/foods/search": () => ({ groups: [{ source: "culury", label: "Culury", foods: [culuryChili] }], errors: [] }),
      "GET /api/culury/recipes/:id": () => new Promise((r) => (answer = r)),
    });
    const user = userEvent.setup();
    const sheet = await openDinner(user);
    await user.type(within(sheet).getByRole("searchbox", { name: "Search foods" }), "chili");
    await user.click(await within(sheet).findByRole("button", { name: /^Chili con carne/ }));
    const opening = within(sheet).getByRole("button", { name: /^Chili con carne/ });
    expect(opening).toBeDisabled();
    expect(opening).toHaveTextContent("Opening…");
    await user.click(within(sheet).getByRole("button", { name: /Describe it/ }));
    answer({ food: culuryChili, hasNutrition: true, outdated: false });
    await new Promise((r) => setTimeout(r, 50));
    expect(within(sheet).getByRole("heading", { name: "Describe it" })).toBeInTheDocument();
    expect(within(sheet).queryByRole("heading", { name: "Track food" })).toBeNull();
  });

  it("a plan item shows Opening… while it loads; going back meanwhile ignores the answer", async () => {
    let answer!: (v: unknown) => void;
    open({ "GET /api/culury/recipes/:id": () => new Promise((r) => (answer = r)) });
    const user = userEvent.setup();
    const sheet = await openDinner(user);
    await user.click(await within(sheet).findByRole("button", { name: /Meal plan/ }));
    await user.click(await within(sheet).findByRole("button", { name: /Chili con carne/ }));
    const item = within(sheet).getByRole("button", { name: /Chili con carne/ });
    expect(item).toBeDisabled();
    expect(item).toHaveTextContent("Opening…");
    await user.click(within(sheet).getByRole("button", { name: "‹ Back" }));
    answer({ food: culuryChili, hasNutrition: true, outdated: false });
    await new Promise((r) => setTimeout(r, 50));
    expect(within(sheet).getByRole("searchbox", { name: "Search foods" })).toBeInTheDocument();
    expect(within(sheet).queryByRole("heading", { name: "Track food" })).toBeNull();
  });
});
