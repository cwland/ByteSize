import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LogPage from "./LogPage";
import { SelectedDayProvider } from "../../selectedDay";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";
import { barFood, dayJson, settingsMe } from "../../test/fixtures";

const myShake = { ...barFood, kind: "user_food", id: 5, name: "Peanut protein shake", brand: null, icon: "🥤", barcode: null, source: "mine" };
const usdaPeanuts = { ...barFood, id: 77, name: "Peanuts, raw", brand: null, icon: "🥜", barcode: null, source: "usda", servings: [{ label: "100 g", grams: 100 }] };
const search = {
  groups: [
    { source: "mine", label: "My foods", foods: [myShake] },
    { source: "off", label: "Open Food Facts", foods: [barFood] },
    { source: "usda", label: "USDA", foods: [usdaPeanuts] },
  ],
  errors: [],
};

function open(routes: Record<string, (b: any, path: string) => unknown> = {}) {
  const server = fakeServer({
    "GET /api/day/:date": () => dayJson(),
    "GET /api/settings/me": () => settingsMe,
    "GET /api/foods/recent": () => ({ foods: [] }),
    "GET /api/foods/frequent": () => ({ foods: [] }),
    "GET /api/foods/search": () => search,
    ...routes,
  });
  renderWithSession(
    <SelectedDayProvider timeZone="America/Boise">
      <LogPage />
    </SelectedDayProvider>,
  );
  return server;
}

async function openSnacks(user: ReturnType<typeof userEvent.setup>) {
  const snacks = await screen.findByRole("region", { name: "Snacks" });
  await user.click(within(snacks).getByRole("button", { name: "Add Food" }));
  return screen.getByRole("dialog", { name: "Add food to Snacks" });
}


// "Today" is pinned: noon on Mon, Nov 16 in Boise (the fixtures' day), whatever the real date is
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T19:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("Add food", () => {
  it("add food: search groups appear in order and logging a result sends the right body", async () => {
    const server = open({ "POST /api/log": (b) => ({ entry: { id: 3, ...b } }) });
    const user = userEvent.setup();
    const sheet = await openSnacks(user);
    const box = within(sheet).getByRole("searchbox", { name: "Search foods" });
    expect(box).toHaveFocus();
    await user.type(box, "peanut");
    await within(sheet).findByRole("heading", { name: "USDA" });
    const headings = within(sheet).getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(["My foods", "Open Food Facts", "USDA"]);
    expect(server.sent.filter((s) => s.path.startsWith("/api/foods/search"))).toHaveLength(1); // debounced
    expect(server.sent.find((s) => s.path.startsWith("/api/foods/search"))!.path).toBe("/api/foods/search?q=peanut");

    await user.click(within(sheet).getByRole("button", { name: /^Peanut butter bar/ }));
    await user.selectOptions(within(sheet).getByRole("combobox", { name: "Serving" }), "1 bar");
    await user.click(within(sheet).getByRole("radio", { name: "½" }));
    expect(within(sheet).getByTestId("portion-preview")).toHaveTextContent("90 cal");
    expect(within(sheet).getByTestId("portion-preview")).toHaveTextContent("4 g protein");
    await user.click(within(sheet).getByRole("button", { name: "Log" }));
    const logged = server.writes().find((w) => w.path === "/api/log")!;
    expect(logged.body).toEqual({ day: "2026-11-16", meal: "snacks", food: { kind: "cache", id: 42 }, servingIndex: 1, unit: "serving", quantity: 1, fraction: 0.5 });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a refused portion shows the server's message in the sheet", async () => {
    open({ "POST /api/log": () => ({ status: 400, json: { error: "Can't measure this food in ml" } }) });
    const user = userEvent.setup();
    const sheet = await openSnacks(user);
    await user.type(within(sheet).getByRole("searchbox", { name: "Search foods" }), "peanut");
    await user.click(await within(sheet).findByRole("button", { name: /^Peanut butter bar/ }));
    await user.click(within(sheet).getByRole("button", { name: "Log" }));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent("Can't measure this food in ml");
  });

  it("typed barcode not found offers create with the barcode filled in", async () => {
    const server = open({ "GET /api/foods/barcode/:code": () => ({ code: "0012345678905", food: null }) });
    const user = userEvent.setup();
    const sheet = await openSnacks(user);
    await user.type(within(sheet).getByRole("searchbox", { name: "Search foods" }), "0-12345 67890 5");
    await user.click(await within(sheet).findByRole("button", { name: "Not found — create it" }));
    expect(server.sent.some((s) => s.path === "/api/foods/barcode/012345678905")).toBe(true);
    expect(server.sent.some((s) => s.path.startsWith("/api/foods/search"))).toBe(false);
    expect(within(sheet).getByRole("heading", { name: "New food" })).toBeInTheDocument();
    expect(within(sheet).getByLabelText("Barcode")).toHaveValue("0012345678905");
  });

  it("edit on a database food saves an override", async () => {
    const server = open({ "POST /api/my-foods/override": (b) => ({ food: { ...barFood, ...b, kind: "user_food", id: 9, override: true } }) });
    const user = userEvent.setup();
    const sheet = await openSnacks(user);
    await user.type(within(sheet).getByRole("searchbox", { name: "Search foods" }), "peanut");
    await user.click(await within(sheet).findByRole("button", { name: "Edit Peanut butter bar" }));
    expect(within(sheet).getByRole("heading", { name: "Correct this food" })).toBeInTheDocument();
    const cal = within(sheet).getByLabelText("Calories");
    await user.clear(cal);
    await user.type(cal, "400");
    await user.click(within(sheet).getByRole("button", { name: "Save food" }));
    const sent = server.writes().find((w) => w.path === "/api/my-foods/override")!;
    expect(sent.body).toMatchObject({ cacheId: 42, name: "Peanut butter bar", servings: barFood.servings, nutrients: { ...barFood.nutrients, calories: 400 } });
    // then straight on to logging the corrected food
    expect(await within(sheet).findByRole("button", { name: "Log" })).toBeInTheDocument();
  });

  it("describe it creates a draft flagged AI-estimated", async () => {
    const draft = {
      name: "Banana",
      brand: null,
      icon: "🍌",
      barcode: null,
      servings: [{ label: "1 large", grams: 136 }],
      nutrients: { calories: 121, protein_g: 1.5, fiber_g: 3.5, carbs_g: 31 },
      aiFields: ["calories", "protein_g", "fiber_g", "carbs_g"],
      imageUrl: null,
      override: false,
      source: "ai",
      category: "bananas",
    };
    const server = open({
      "POST /api/ai/estimate": () => ({ food: draft }),
      "POST /api/my-foods": (b) => ({ food: { ...draft, ...b, kind: "user_food", id: 11, source: "mine" } }),
    });
    const user = userEvent.setup();
    const sheet = await openSnacks(user);
    await user.click(within(sheet).getByRole("button", { name: "Describe it" }));
    await user.type(within(sheet).getByRole("textbox", { name: "Describe the food" }), "a large banana");
    await user.click(within(sheet).getByRole("button", { name: "Estimate" }));
    expect(server.writes()).toContainEqual(expect.objectContaining({ path: "/api/ai/estimate", body: { text: "a large banana" } }));
    expect(await within(sheet).findByRole("heading", { name: "New food" })).toBeInTheDocument();
    expect(within(sheet).getByLabelText("Name")).toHaveValue("Banana");
    expect(within(sheet).getAllByText("AI estimate")).toHaveLength(4);
    const protein = within(sheet).getByLabelText("Protein (g)");
    await user.clear(protein);
    await user.type(protein, "2"); // checked by hand: no longer a guess
    await user.click(within(sheet).getByRole("button", { name: "Save food" }));
    const saved = server.writes().find((w) => w.method === "POST" && w.path === "/api/my-foods")!;
    expect(saved.body).toMatchObject({ name: "Banana", category: "bananas", nutrients: { calories: 121, protein_g: 2, fiber_g: 3.5, carbs_g: 31 } });
    expect([...saved.body.aiFields].sort()).toEqual(["calories", "carbs_g", "fiber_g"]);
  });
});
