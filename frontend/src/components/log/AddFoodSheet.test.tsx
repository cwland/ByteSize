import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LogPage from "./LogPage";
import { SelectedDayProvider } from "../../selectedDay";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";
import { barFood, culuryOff, dayJson, entryJson, settingsMe } from "../../test/fixtures";
import { breakfastDetail, breakfastMeal, chili } from "../../test/myFoodsFixtures";

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
    ...culuryOff,
    "GET /api/day/:date": () => dayJson(),
    "GET /api/settings/me": () => settingsMe,
    "GET /api/foods/recent": () => ({ foods: [] }),
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

async function openMeal(user: ReturnType<typeof userEvent.setup>, name: string) {
  const card = await screen.findByRole("region", { name });
  await user.click(within(card).getByRole("button", { name: "Add Food" }));
  return screen.getByRole("dialog", { name: `Add food to ${name}` });
}
const openSnacks = (user: ReturnType<typeof userEvent.setup>) => openMeal(user, "Snacks");

// The value next to a label inside a named section ("Summary" › "Calories")
const row = (sheet: HTMLElement, section: string, label: string) => within(within(sheet).getByRole("region", { name: section })).getByText(label, { exact: true }).parentElement!;
const recentPaths = (server: ReturnType<typeof fakeServer>) => server.sent.filter((s) => s.path.startsWith("/api/foods/recent")).map((s) => s.path);
const last = (servingIndex: number, unit = "serving", quantity = 1) => ({ servingIndex, unit, quantity, fraction: 1 });

// Fairlife from Open Food Facts: known only per 100 g; the API adds approximate volumes (1 g ≈ 1 ml)
const fairlife = {
  ...barFood,
  id: 50,
  name: "Fairlife 2% ultra-filtered milk",
  brand: "Fairlife",
  icon: "🥛",
  servings: [
    { label: "100 g", grams: 100, ml: 100, approx: true },
    { label: "1 cup", grams: 240, ml: 240, approx: true },
  ],
  nutrients: { calories: 50, protein_g: 7, fiber_g: 0, fat_g: 1.9, saturated_fat_g: 1.25, sodium_mg: 50, carbs_g: 2.5, sugar_g: 2.5 },
};


// "Today" is pinned: noon on Mon, Nov 16 in Boise (the fixtures' day), whatever the real date is
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T19:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("Add food", () => {
  it("add food: search groups appear in order and tracking a result sends the right body", async () => {
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
    expect(within(sheet).getByRole("heading", { name: "Track food" })).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: /^Serving/ }));
    await user.selectOptions(within(sheet).getByRole("combobox", { name: "Whole number" }), "0");
    await user.selectOptions(within(sheet).getByRole("combobox", { name: "Fraction" }), "½");
    expect(within(sheet).getByRole("button", { name: /^Serving/ })).toHaveTextContent("½ bar");
    expect(row(sheet, "Summary", "Calories")).toHaveTextContent("90");
    expect(row(sheet, "Summary", "Protein")).toHaveTextContent("4 g");
    await user.click(within(sheet).getByRole("button", { name: "Track" }));
    const logged = server.writes().find((w) => w.path === "/api/log")!;
    expect(logged.body).toEqual({ day: "2026-11-16", meal: "snacks", food: { kind: "cache", id: 42 }, servingIndex: 1, unit: "serving", quantity: 0.5, fraction: 1 });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Did you mean: a close spelling shows under few results, and tapping it searches for it", async () => {
    const bananas = { ...usdaPeanuts, id: 78, name: "Bananas, raw", icon: "🍌" };
    const server = open({
      "GET /api/foods/search": (_b, path) =>
        path.includes("q=bananna")
          ? { groups: [{ source: "cache", label: "Saved foods", foods: [bananas] }], errors: [], suggestion: "banana" }
          : { groups: [{ source: "basic", label: "Basic foods", foods: [bananas] }], errors: [] },
    });
    const user = userEvent.setup();
    const sheet = await openSnacks(user);
    const box = within(sheet).getByRole("searchbox", { name: "Search foods" });
    await user.type(box, "bananna");
    const foods = within(sheet).getByRole("region", { name: "Foods" });
    await user.click(await within(foods).findByRole("button", { name: "Did you mean banana?" }));
    expect(box).toHaveValue("banana");
    await within(sheet).findByRole("heading", { name: "Basic foods" });
    expect(server.sent.filter((s) => s.path.startsWith("/api/foods/search")).map((s) => s.path)).toEqual(["/api/foods/search?q=bananna", "/api/foods/search?q=banana"]);
    expect(within(sheet).queryByRole("button", { name: /Did you mean/ })).toBeNull();
  });

  it("only the food list scrolls: the meal, search box and buttons stay put", async () => {
    open();
    const user = userEvent.setup();
    const sheet = await openSnacks(user);
    await user.type(within(sheet).getByRole("searchbox", { name: "Search foods" }), "peanut");
    const usda = await within(sheet).findByRole("heading", { name: "USDA" });
    const list = within(sheet).getByRole("region", { name: "Foods" });
    expect(list).toContainElement(usda);
    expect(list).toHaveClass("overflow-y-auto");
    expect(list).not.toContainElement(within(sheet).getByRole("searchbox", { name: "Search foods" }));
    expect(list).not.toContainElement(within(sheet).getByRole("button", { name: /Create food/ }));
    expect(sheet).not.toHaveClass("overflow-y-auto"); // the window itself doesn't scroll
  });

  it("a refused portion shows the server's message in the sheet", async () => {
    open({ "POST /api/log": () => ({ status: 400, json: { error: "Can't measure this food in ml" } }) });
    const user = userEvent.setup();
    const sheet = await openSnacks(user);
    await user.type(within(sheet).getByRole("searchbox", { name: "Search foods" }), "peanut");
    await user.click(await within(sheet).findByRole("button", { name: /^Peanut butter bar/ }));
    await user.click(within(sheet).getByRole("button", { name: "Track" }));
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

  it("a barcode that couldn't be checked says so and offers to try again", async () => {
    let calls = 0;
    open({
      "GET /api/foods/barcode/:code": () => {
        calls++;
        return { code: "0012345678905", food: null, errors: [{ source: "off", message: "Open Food Facts didn't answer in time" }] };
      },
    });
    const user = userEvent.setup();
    const sheet = await openSnacks(user);
    await user.type(within(sheet).getByRole("searchbox", { name: "Search foods" }), "012345678905");
    expect(await within(sheet).findByText(/Couldn't check Open Food Facts/)).toBeInTheDocument();
    expect(within(sheet).queryByText(/Nothing has barcode/)).not.toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(calls).toBe(2));
    expect(within(sheet).getByRole("button", { name: "Create it anyway" })).toBeInTheDocument();
  });

  it("correcting a drink keeps its estimated volumes estimated (no made-up ml is saved)", async () => {
    const server = open({
      "GET /api/foods/search": () => ({ groups: [{ source: "off", label: "Open Food Facts", foods: [fairlife] }], errors: [] }),
      "POST /api/my-foods/override": (b) => ({ food: { ...fairlife, ...b, kind: "user_food", id: 9, override: true } }),
    });
    const user = userEvent.setup();
    const sheet = await openSnacks(user);
    await user.type(within(sheet).getByRole("searchbox", { name: "Search foods" }), "fairlife");
    await user.click(await within(sheet).findByRole("button", { name: /^Fairlife 2% ultra-filtered milk/ }));
    await user.click(within(sheet).getByRole("button", { name: "Edit food" }));
    await user.click(within(sheet).getByRole("button", { name: "Save food" }));
    const sent = server.writes().find((w) => w.path === "/api/my-foods/override")!;
    expect(sent.body.servings).toEqual([
      { label: "100 g", grams: 100 },
      { label: "1 cup", grams: 240 },
    ]);
  });

  it("edit on a database food saves an override", async () => {
    const server = open({ "POST /api/my-foods/override": (b) => ({ food: { ...barFood, ...b, kind: "user_food", id: 9, override: true } }) });
    const user = userEvent.setup();
    const sheet = await openSnacks(user);
    await user.type(within(sheet).getByRole("searchbox", { name: "Search foods" }), "peanut");
    await user.click(await within(sheet).findByRole("button", { name: /^Peanut butter bar/ }));
    await user.click(within(sheet).getByRole("button", { name: "Edit food" }));
    expect(within(sheet).getByRole("heading", { name: "Correct this food" })).toBeInTheDocument();
    const cal = within(sheet).getByLabelText("Calories");
    await user.clear(cal);
    await user.type(cal, "400");
    await user.click(within(sheet).getByRole("button", { name: "Save food" }));
    const sent = server.writes().find((w) => w.path === "/api/my-foods/override")!;
    expect(sent.body).toMatchObject({ cacheId: 42, name: "Peanut butter bar", servings: barFood.servings, nutrients: { ...barFood.nutrients, calories: 400 } });
    // then straight on to tracking the corrected food
    expect(await within(sheet).findByRole("button", { name: "Track" })).toBeInTheDocument();
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

describe("Add food, Weight Watchers style", () => {
  it("meal dropdown at the top changes the meal and reloads recents for it", async () => {
    const server = open({
      "GET /api/foods/recent": (_b, path) => ({ foods: path.endsWith("meal=lunch") ? [{ ...myShake, last: last(0) }] : [{ ...barFood, last: last(1) }] }),
    });
    const user = userEvent.setup();
    const sheet = await openSnacks(user);
    expect(within(sheet).getByText("Today, Nov 16")).toBeInTheDocument();
    expect(await within(sheet).findByRole("button", { name: /^Peanut butter bar/ })).toBeInTheDocument();
    expect(recentPaths(server)).toEqual(["/api/foods/recent?meal=snacks"]);

    await user.click(within(sheet).getByRole("button", { name: "Snacks" }));
    await user.click(within(sheet).getByRole("option", { name: "Lunch" }));
    expect(screen.getByRole("dialog", { name: "Add food to Lunch" })).toBe(sheet);
    expect(await within(sheet).findByRole("button", { name: /^Peanut protein shake/ })).toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: /^Peanut butter bar/ })).not.toBeInTheDocument();
    expect(recentPaths(server)).toEqual(["/api/foods/recent?meal=snacks", "/api/foods/recent?meal=lunch"]);
  });

  it("same as yesterday copies yesterday's breakfast into today with one tap", async () => {
    const toast = entryJson({ id: 7, day: "2026-11-15", name: "Toast" });
    const egg = entryJson({ id: 8, day: "2026-11-15", name: "Egg", icon: "🥚", nutrients: { calories: 70, protein_g: 6, fiber_g: 0 } });
    const soup = entryJson({ id: 9, day: "2026-11-15", meal: "lunch", name: "Soup" });
    const server = open({
      "GET /api/day/:date": (_b, path) => (path.endsWith("2026-11-15") ? dayJson({ day: "2026-11-15", entries: [toast, egg, soup] }) : dayJson()),
      "POST /api/log/move": () => ({ entries: [] }),
    });
    const user = userEvent.setup();
    const sheet = await openMeal(user, "Breakfast");
    const card = await within(sheet).findByRole("region", { name: "Same as yesterday?" });
    expect(within(card).getByText("Toast, Egg")).toBeInTheDocument();
    expect(within(card).getByText("230 cal")).toBeInTheDocument();
    expect(within(card).getByText("12 g protein")).toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "Quick add same as yesterday" }));
    expect(server.writes()).toContainEqual(expect.objectContaining({ path: "/api/log/move", body: { ids: [7, 8], day: "2026-11-16", meal: "breakfast", copy: true } }));
    expect(await within(card).findByRole("img", { name: "Added" })).toBeInTheDocument();
  });

  it("quick add logs the last portion and shows a check, then a plus again; two taps log twice", async () => {
    const server = open({
      "GET /api/foods/recent": () => ({ foods: [{ ...barFood, last: last(1) }] }),
      "POST /api/log": (b) => ({ entry: { id: 3, ...b } }),
    });
    const user = userEvent.setup();
    const sheet = await openSnacks(user);
    const recents = await within(sheet).findByRole("region", { name: "Recently tracked" });
    const item = within(recents).getByRole("listitem");
    expect(within(item).getByText("1 bar")).toBeInTheDocument();
    expect(within(item).getByText("180 cal")).toBeInTheDocument();
    expect(within(item).getByText("8 g protein")).toBeInTheDocument();
    expect(within(item).getByText("2 g fiber")).toBeInTheDocument();
    const plus = within(item).getByRole("button", { name: "Quick add Peanut butter bar" });
    await user.click(plus);
    await user.click(plus);
    const logs = server.writes().filter((w) => w.path === "/api/log");
    expect(logs).toHaveLength(2);
    for (const l of logs) expect(l.body).toEqual({ day: "2026-11-16", meal: "snacks", food: { kind: "cache", id: 42 }, servingIndex: 1, unit: "serving", quantity: 1, fraction: 1 });
    expect(await within(item).findByRole("img", { name: "Added" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Add food to Snacks" })).toBeInTheDocument(); // stays open for more
    await waitFor(() => expect(within(item).queryByRole("img", { name: "Added" })).not.toBeInTheDocument(), { timeout: 3000 });
    expect(within(item).getByRole("button", { name: "Quick add Peanut butter bar" })).toBeInTheDocument();
  });

  it("a failed quick add shows the error", async () => {
    open({
      "GET /api/foods/recent": () => ({ foods: [{ ...barFood, last: last(1) }] }),
      "POST /api/log": () => ({ status: 400, json: { error: "That food is gone" } }),
    });
    const user = userEvent.setup();
    const sheet = await openSnacks(user);
    await user.click(await within(sheet).findByRole("button", { name: "Quick add Peanut butter bar" }));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent("That food is gone");
    expect(within(sheet).queryByRole("img", { name: "Added" })).not.toBeInTheDocument();
  });

  it("search results have pills and quick add", async () => {
    const server = open({
      "GET /api/foods/recent": () => ({ foods: [{ ...myShake, last: last(0, "g", 30) }] }),
      "POST /api/log": (b) => ({ entry: { id: 3, ...b } }),
    });
    const user = userEvent.setup();
    const sheet = await openSnacks(user);
    await user.type(within(sheet).getByRole("searchbox", { name: "Search foods" }), "peanut");
    const off = (await within(sheet).findByRole("heading", { name: "Open Food Facts" })).closest("section")!;
    expect(within(off).getByText("1 bar")).toBeInTheDocument();
    expect(within(off).getByText("180 cal")).toBeInTheDocument();
    const mine = within(sheet).getByRole("heading", { name: "My foods" }).closest("section")!;
    expect(within(mine).getByText("30 g")).toBeInTheDocument(); // the last portion used
    expect(within(mine).getByText("135 cal")).toBeInTheDocument();
    const usda = within(sheet).getByRole("heading", { name: "USDA" }).closest("section")!;
    expect(within(usda).getByText("450 cal")).toBeInTheDocument();
    await user.click(within(off).getByRole("button", { name: "Quick add Peanut butter bar" }));
    expect(server.writes().find((w) => w.path === "/api/log")!.body).toEqual({ day: "2026-11-16", meal: "snacks", food: { kind: "cache", id: 42 }, servingIndex: 1, unit: "serving", quantity: 1, fraction: 1 });
    expect(await within(off).findByRole("img", { name: "Added" })).toBeInTheDocument();
  });

  it("Track food shows summary, insights and nutrition facts, and the amount picker changes the amount (1 ½ cup → POST quantity 1.5 unit cup)", async () => {
    const server = open({
      "GET /api/foods/search": () => ({ groups: [{ source: "off", label: "Open Food Facts", foods: [fairlife] }], errors: [] }),
      "POST /api/log": (b) => ({ entry: { id: 3, ...b } }),
    });
    const user = userEvent.setup();
    const sheet = await openSnacks(user);
    await user.type(within(sheet).getByRole("searchbox", { name: "Search foods" }), "fairlife");
    await user.click(await within(sheet).findByRole("button", { name: /^Fairlife 2% ultra-filtered milk/ }));
    expect(within(sheet).getByRole("heading", { name: "Track food" })).toBeInTheDocument();
    expect(within(sheet).getByText("Fairlife", { selector: "p" })).toBeInTheDocument();
    expect(row(sheet, "Summary", "Calories")).toHaveTextContent("120");
    expect(row(sheet, "Summary", "Protein")).toHaveTextContent("17 g");
    expect(row(sheet, "Summary", "Fiber")).toHaveTextContent("0 g");
    expect(within(sheet).getByRole("button", { name: /^Serving/ })).toHaveTextContent("1 cup");
    expect(within(within(sheet).getByRole("region", { name: "Nutritional insights" })).getByText("High in protein")).toBeInTheDocument();
    expect(row(sheet, "Nutrition facts", "Saturated fat")).toHaveTextContent("3 g");
    expect(row(sheet, "Nutrition facts", "Sodium")).toHaveTextContent("120 mg");
    expect(row(sheet, "Nutrition facts", "Added sugars")).toHaveTextContent("—"); // unknown, not 0

    await user.click(within(sheet).getByRole("button", { name: /^Serving/ }));
    const unit = within(sheet).getByRole("combobox", { name: "Unit" });
    expect(within(unit).getByRole("option", { name: "≈ cup" })).toBeInTheDocument();
    await user.selectOptions(unit, "≈ cup");
    await user.selectOptions(within(sheet).getByRole("combobox", { name: "Whole number" }), "1");
    await user.selectOptions(within(sheet).getByRole("combobox", { name: "Fraction" }), "½");
    expect(within(sheet).getByRole("button", { name: /^Serving/ })).toHaveTextContent("≈ 1½ cups");
    expect(row(sheet, "Summary", "Calories")).toHaveTextContent("177");
    await user.click(within(sheet).getByRole("button", { name: "Track" }));
    expect(server.writes().find((w) => w.path === "/api/log")!.body).toEqual({ day: "2026-11-16", meal: "snacks", food: { kind: "cache", id: 50 }, servingIndex: 0, unit: "cup", quantity: 1.5, fraction: 1 });
  });

  it("changing the unit keeps the number: 3 cups → tbsp is 3 tbsp, not 48", async () => {
    open({ "GET /api/foods/search": () => ({ groups: [{ source: "off", label: "Open Food Facts", foods: [fairlife] }], errors: [] }) });
    const user = userEvent.setup();
    const sheet = await openSnacks(user);
    await user.type(within(sheet).getByRole("searchbox", { name: "Search foods" }), "fairlife");
    await user.click(await within(sheet).findByRole("button", { name: /^Fairlife 2% ultra-filtered milk/ }));
    await user.click(within(sheet).getByRole("button", { name: /^Serving/ }));
    await user.selectOptions(within(sheet).getByRole("combobox", { name: "Unit" }), "≈ cup");
    await user.selectOptions(within(sheet).getByRole("combobox", { name: "Whole number" }), "3");
    await user.selectOptions(within(sheet).getByRole("combobox", { name: "Unit" }), "≈ tbsp");
    expect(within(sheet).getByRole("button", { name: /^Serving/ })).toHaveTextContent("≈ 3 tbsp");
    await user.selectOptions(within(sheet).getByRole("combobox", { name: "Unit" }), "g");
    expect(within(sheet).getByRole("button", { name: /^Serving/ })).toHaveTextContent("3 g");
  });
});

describe("Add food: recipes, quick meals and My Foods", () => {
  const recentMeal = { ...breakfastMeal, last: { servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 } };
  const withMine = { groups: [{ source: "mine", label: "My foods", foods: [chili, breakfastMeal, myShake] }], errors: [] };

  afterEach(() => {
    window.location.hash = "";
  });

  it("recipe and quick meal rows carry a Recipe or Meal tag; other foods don't", async () => {
    open({ "GET /api/foods/search": () => withMine });
    const user = userEvent.setup();
    const sheet = await openSnacks(user);
    await user.type(within(sheet).getByRole("searchbox", { name: "Search foods" }), "chi");
    const recipe = await within(sheet).findByRole("button", { name: /^Chili/ });
    expect(within(recipe).getByText("Recipe")).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: /^Usual breakfast/ })).toHaveTextContent("Meal");
    const plain = within(sheet).getByRole("button", { name: /^Peanut protein shake/ });
    expect(within(plain).queryByText("Recipe")).toBeNull();
    expect(within(plain).queryByText("Meal")).toBeNull();
  });

  it("a recipe opens at 1 serving with no Edit food (recipes have their own editor)", async () => {
    const server = open({ "GET /api/foods/search": () => withMine, "POST /api/log": (b) => ({ entry: { id: 3, ...b } }) });
    const user = userEvent.setup();
    const sheet = await openSnacks(user);
    await user.type(within(sheet).getByRole("searchbox", { name: "Search foods" }), "chi");
    await user.click(await within(sheet).findByRole("button", { name: /^Chili/ }));
    expect(within(sheet).getByRole("button", { name: /^Serving/ })).toHaveTextContent("1 serving (350 g)");
    expect(within(sheet).queryByRole("button", { name: "Edit food" })).toBeNull();
    await user.click(within(sheet).getByRole("button", { name: "Track" }));
    expect(server.writes().find((w) => w.path === "/api/log")!.body).toMatchObject({ food: { kind: "user_food", id: 30 }, servingIndex: 0, unit: "serving", quantity: 1 });
  });

  it("quick add of a meal logs it with POST /api/log/meal and shows a check", async () => {
    const server = open({
      "GET /api/foods/recent": () => ({ foods: [recentMeal] }),
      "POST /api/log/meal": () => ({ entries: [] }),
    });
    const user = userEvent.setup();
    const sheet = await openSnacks(user);
    const recent = within(sheet).getByRole("region", { name: "Foods" });
    const item = (await within(recent).findByRole("button", { name: /^Usual breakfast/ })).closest("li")!;
    expect(item).toHaveTextContent("1 meal");
    expect(item).toHaveTextContent("420 cal");
    await user.click(within(item).getByRole("button", { name: "Quick add Usual breakfast" }));
    expect(await within(item).findByRole("img", { name: "Added" })).toBeInTheDocument();
    expect(server.writes().map((w) => [w.path, w.body])).toEqual([["/api/log/meal", { day: "2026-11-16", meal: "snacks", foodId: 31 }]]);
  });

  it("tapping a meal opens its items to adjust; Track sends the adjusted items", async () => {
    const server = open({
      "GET /api/foods/recent": () => ({ foods: [recentMeal] }),
      "GET /api/my-foods/:id": () => ({ food: breakfastDetail }),
      "POST /api/log/meal": () => ({ entries: [] }),
    });
    const user = userEvent.setup();
    const sheet = await openSnacks(user);
    await user.click(await within(sheet).findByRole("button", { name: /^Usual breakfast/ }));
    expect(within(sheet).getByRole("heading", { name: "Track meal" })).toBeInTheDocument();
    const items = await within(sheet).findByRole("list", { name: "Foods in this meal" });
    expect(within(items).getAllByRole("listitem")).toHaveLength(2);
    expect(within(sheet).getByRole("region", { name: "Total" })).toHaveTextContent("325");
    await user.click(within(items).getByRole("button", { name: "1 cup" }));
    await user.selectOptions(within(items).getByRole("combobox", { name: "Fraction" }), "½");
    expect(within(sheet).getByRole("region", { name: "Total" })).toHaveTextContent("435"); // 330 + 105
    await user.click(within(sheet).getByRole("button", { name: "Track" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(server.writes().map((w) => [w.path, w.body])).toEqual([
      [
        "/api/log/meal",
        {
          day: "2026-11-16",
          meal: "snacks",
          foodId: 31,
          items: [
            { food: { kind: "cache", id: 20 }, servingIndex: 0, unit: "serving", quantity: 1.5, fraction: 1 },
            { food: { kind: "cache", id: 21 }, servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 },
          ],
        },
      ],
    ]);
  });

  it("My Foods link goes to My Foods, remembering the Log to come back to", async () => {
    window.location.hash = "#/log";
    open();
    const user = userEvent.setup();
    const sheet = await openSnacks(user);
    await user.click(within(sheet).getByRole("button", { name: "My Foods" }));
    expect(window.location.hash).toBe("#/log/my-foods?from=/log");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
