import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RecipeEditor from "./RecipeEditor";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";
import { beans, beef, breakfastMeal, chili, chiliDetail, sauce } from "../../test/myFoodsFixtures";

type User = ReturnType<typeof userEvent.setup>;

// The search returns whatever matches the query; a quick meal is in "My foods" but can't be an ingredient
const search = (_b: unknown, path: string) => {
  const q = decodeURIComponent(path.split("q=")[1] ?? "");
  const all = [beef, beans, sauce, breakfastMeal, chili];
  const hits = all.filter((f) => f.name.toLowerCase().includes(q.toLowerCase()));
  return {
    groups: [
      { source: "mine", label: "My foods", foods: hits.filter((f) => f.kind === "user_food") },
      { source: "usda", label: "USDA", foods: hits.filter((f) => f.kind === "cache") },
    ].filter((g) => g.foods.length),
    errors: [],
  };
};

// A value in the live totals ("Per serving" › "Calories")
const total = (label: string) => within(screen.getByRole("region", { name: "Per serving" })).getByText(label, { exact: true }).parentElement!;

// Add food through the ingredient search, at the amount the picker is set to
async function addIngredient(user: User, query: string, name: RegExp, amount?: { unit?: string; whole?: string }) {
  await user.click(screen.getByRole("button", { name: "Add ingredient" }));
  const sheet = screen.getByRole("dialog", { name: "Add ingredient" });
  await user.type(within(sheet).getByRole("searchbox", { name: "Search foods" }), query);
  await user.click(await within(sheet).findByRole("button", { name }));
  if (amount) {
    await user.click(within(sheet).getByRole("button", { name: /^Serving/ }));
    if (amount.unit) await user.selectOptions(within(sheet).getByRole("combobox", { name: "Unit" }), amount.unit);
    if (amount.whole) await user.selectOptions(within(sheet).getByRole("combobox", { name: "Whole number" }), amount.whole);
  }
  await user.click(within(sheet).getByRole("button", { name: "Add" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add ingredient" })).toBeNull());
}

describe("Recipe editor", () => {
  it("new recipe: ingredients from search, servings and weight, live per-serving totals, Save posts the body", async () => {
    const server = fakeServer({
      "GET /api/foods/search": search,
      "POST /api/my-foods/recipes": (b) => ({ food: { ...chiliDetail, name: b.name } }),
    });
    const done = vi.fn();
    renderWithSession(<RecipeEditor onDone={done} onBack={() => {}} />);
    const user = userEvent.setup();
    expect(screen.getByRole("heading", { level: 1, name: "New recipe" })).toBeInTheDocument();
    // Nothing yet: unknown, not 0
    expect(total("Calories")).toHaveTextContent("—");

    await user.type(screen.getByRole("textbox", { name: "Name" }), "Chili");
    await addIngredient(user, "beef", /^Ground beef/, { unit: "g", whole: "500" });
    expect(total("Calories")).toHaveTextContent("1,250");

    const servings = screen.getByRole("spinbutton", { name: "Number of servings" });
    await user.clear(servings);
    await user.type(servings, "6");
    expect(total("Calories")).toHaveTextContent("208");

    // The quick meal isn't offered as an ingredient; the recipe is
    await user.click(screen.getByRole("button", { name: "Add ingredient" }));
    const sheet = screen.getByRole("dialog", { name: "Add ingredient" });
    const box = within(sheet).getByRole("searchbox", { name: "Search foods" });
    await user.type(box, "usual");
    expect(await within(sheet).findByText(/No foods found/)).toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: /^Usual breakfast/ })).toBeNull();
    await user.clear(box);
    await user.type(box, "chili");
    expect(await within(sheet).findByRole("button", { name: /^Chili.*Recipe/ })).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "Close" }));

    // Beans start at their own serving, 1 cup (177 g): 225 cal, 11.3 g fiber
    await addIngredient(user, "beans", /^Kidney beans/);
    expect(total("Calories")).toHaveTextContent("246"); // (1250 + 225) / 6
    expect(total("Fiber")).toHaveTextContent("1.9 g");

    // Chili sauce has no fiber: the recipe's fiber becomes unknown
    await addIngredient(user, "sauce", /^Chili sauce/, { whole: "3" });
    expect(total("Calories")).toHaveTextContent("256"); // (1250 + 225 + 60) / 6
    expect(total("Fiber")).toHaveTextContent("—");

    const items = screen.getByRole("list", { name: "Ingredients" });
    expect(within(items).getAllByRole("listitem").map((li) => within(li).getByText(/^(Ground|Kidney|Chili)/).textContent)).toEqual(["Ground beef 85%", "Kidney beans", "Chili sauce"]);
    // An item's amount can be changed in place
    await user.click(within(items).getByRole("button", { name: "1 cup" }));
    await user.selectOptions(within(items).getByRole("combobox", { name: "Whole number" }), "2");
    expect(within(items).getByRole("button", { name: "2 cups" })).toBeInTheDocument();
    expect(total("Calories")).toHaveTextContent("293"); // (1250 + 450 + 60) / 6

    await user.type(screen.getByRole("spinbutton", { name: "Weight of one serving (g)" }), "350");
    await user.type(screen.getByRole("textbox", { name: "Notes" }), "Freezes well");
    await user.click(screen.getByRole("button", { name: "Save recipe" }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(server.writes().map((w) => [w.method, w.path, w.body])).toEqual([
      [
        "POST",
        "/api/my-foods/recipes",
        {
          name: "Chili",
          items: [
            { food: { kind: "cache", id: 10 }, servingIndex: 0, unit: "g", quantity: 500, fraction: 1 },
            { food: { kind: "cache", id: 11 }, servingIndex: 1, unit: "serving", quantity: 2, fraction: 1 },
            { food: { kind: "user_food", id: 12 }, servingIndex: 0, unit: "serving", quantity: 3, fraction: 1 },
          ],
          servings: 6,
          servingGrams: 350,
          notes: "Freezes well",
        },
      ],
    ]);
  });

  it("removing an ingredient, and saving with nothing in it says why", async () => {
    const server = fakeServer({ "GET /api/foods/search": search });
    renderWithSession(<RecipeEditor onDone={() => {}} onBack={() => {}} />);
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Beans");
    await addIngredient(user, "beans", /^Kidney beans/);
    await user.click(screen.getByRole("button", { name: "Remove Kidney beans" }));
    expect(screen.queryByRole("list", { name: "Ingredients" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Save recipe" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Add at least one ingredient");
    expect(server.writes()).toEqual([]);
  });

  it("edit: opens the saved recipe; Save puts it; Recalculate asks the server and shows the new numbers", async () => {
    const gone = { ...chiliDetail.items[1], available: false };
    const server = fakeServer({
      "GET /api/my-foods/:id": () => ({ food: { ...chiliDetail, items: [chiliDetail.items[0], gone] } }),
      "POST /api/my-foods/:id/recalculate": () => ({ food: { ...chiliDetail, items: [{ ...chiliDetail.items[0], perServing: { ...beef.nutrients, calories: 260 } }, gone] } }),
      "PUT /api/my-foods/recipes/:id": (b) => ({ food: { ...chiliDetail, ...b } }),
    });
    const done = vi.fn();
    renderWithSession(<RecipeEditor id={30} onDone={done} onBack={() => {}} />);
    const user = userEvent.setup();
    expect(screen.getByRole("heading", { level: 1, name: "Edit recipe" })).toBeInTheDocument();
    expect(await screen.findByRole("textbox", { name: "Name" })).toHaveValue("Chili");
    expect(screen.getByRole("spinbutton", { name: "Number of servings" })).toHaveValue(6);
    expect(screen.getByRole("spinbutton", { name: "Weight of one serving (g)" })).toHaveValue(350);
    expect(screen.getByRole("textbox", { name: "Notes" })).toHaveValue("Freezes well");
    expect(total("Calories")).toHaveTextContent("246");
    // A food that's gone uses its saved values, and says so
    const items = screen.getByRole("list", { name: "Ingredients" });
    expect(within(items).getAllByRole("listitem")[1]).toHaveTextContent("No longer in your foods — using its saved values");

    await user.click(screen.getByRole("button", { name: "Recalculate" }));
    await waitFor(() => expect(total("Calories")).toHaveTextContent("254")); // (1300 + 225) / 6
    expect(screen.getByRole("status")).toHaveTextContent("Recalculated");

    await user.click(screen.getByRole("button", { name: "Save recipe" }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    const put = server.writes().find((w) => w.method === "PUT")!;
    expect(put.path).toBe("/api/my-foods/recipes/30");
    expect(put.body).toEqual({
      name: "Chili",
      items: [
        { food: { kind: "cache", id: 10 }, servingIndex: 0, unit: "g", quantity: 500, fraction: 1 },
        { food: { kind: "cache", id: 11 }, servingIndex: 1, unit: "serving", quantity: 1, fraction: 1 },
      ],
      servings: 6,
      servingGrams: 350,
      notes: "Freezes well",
    });
    expect(server.writes().map((w) => `${w.method} ${w.path}`)).toEqual(["POST /api/my-foods/30/recalculate", "PUT /api/my-foods/recipes/30"]);
  });

  it("a new recipe has no Recalculate, and the server's message shows when Save fails", async () => {
    fakeServer({
      "GET /api/foods/search": search,
      "POST /api/my-foods/recipes": () => ({ status: 400, json: { error: "A recipe inside a recipe can't contain another recipe" } }),
    });
    renderWithSession(<RecipeEditor onDone={() => {}} onBack={() => {}} />);
    const user = userEvent.setup();
    expect(screen.queryByRole("button", { name: "Recalculate" })).toBeNull();
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Chili bowl");
    await addIngredient(user, "chili", /^Chili.*Recipe/);
    await user.click(screen.getByRole("button", { name: "Save recipe" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A recipe inside a recipe can't contain another recipe");
  });
});
