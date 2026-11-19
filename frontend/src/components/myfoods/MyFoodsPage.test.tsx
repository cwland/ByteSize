import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MyFoodsPage from "./MyFoodsPage";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";
import { breakfastMeal, chili, chiliDetail, shake } from "../../test/myFoodsFixtures";

const listPaths = (server: ReturnType<typeof fakeServer>) => server.sent.filter((s) => s.method === "GET" && s.path.startsWith("/api/my-foods?")).map((s) => s.path);

function show(routes: Record<string, (b: any, path: string) => unknown> = {}) {
  const server = fakeServer({
    "GET /api/my-foods": () => ({ foods: [chili, breakfastMeal, shake] }),
    ...routes,
  });
  renderWithSession(<MyFoodsPage />);
  return server;
}

afterEach(() => {
  window.location.hash = "";
  localStorage.clear();
});

describe("My Foods", () => {
  it("lists every kind with Recipe and Meal tags; one request serves the type pills, sort and search", async () => {
    const server = show();
    expect(screen.getByRole("heading", { level: 1, name: "My Foods" })).toBeInTheDocument();
    const list = await screen.findByRole("list", { name: "My foods" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((r) => within(r).getAllByRole("button")[0].textContent)).toEqual([
      expect.stringMatching(/Chili.*Recipe/),
      expect.stringMatching(/Usual breakfast.*Meal/),
      expect.stringMatching(/Peanut protein shake/),
    ]);
    // A plain food has no tag
    expect(within(rows[2]).queryByText("Recipe")).toBeNull();
    expect(within(rows[2]).queryByText("Meal")).toBeNull();
    expect(listPaths(server)).toEqual(["/api/my-foods?kind=all&sort=recent"]);

    const user = userEvent.setup();
    // The type pills only filter what was fetched; they don't ask the server again
    await user.click(screen.getByRole("button", { name: /^Recipes/ }));
    expect(within(screen.getByRole("list", { name: "My foods" })).getAllByRole("listitem")).toHaveLength(1);
    await user.selectOptions(screen.getByRole("combobox", { name: "Sort" }), "Most used");
    await waitFor(() => expect(listPaths(server).at(-1)).toBe("/api/my-foods?kind=all&sort=used"));
    await user.selectOptions(screen.getByRole("combobox", { name: "Sort" }), "A–Z");
    await waitFor(() => expect(listPaths(server).at(-1)).toBe("/api/my-foods?kind=all&sort=az"));
    await user.type(screen.getByRole("searchbox", { name: "Search my foods" }), "chi");
    await waitFor(() => expect(listPaths(server).at(-1)).toBe("/api/my-foods?kind=all&sort=az&q=chi"));
  });

  it("the Sort dropdown offers Recent, Most used and A–Z", async () => {
    show();
    await screen.findByRole("list", { name: "My foods" });
    const sort = screen.getByRole("combobox", { name: "Sort" });
    expect(within(sort).getAllByRole("option").map((o) => o.textContent)).toEqual(["Recent", "Most used", "A–Z"]);
    expect(sort).toHaveValue("recent");
  });

  it("type pills show counts that follow the search; one is chosen at a time", async () => {
    show({
      "GET /api/my-foods": (_b, path) => {
        const q = new URL(path, "http://x").searchParams.get("q")?.toLowerCase() ?? "";
        return { foods: [chili, breakfastMeal, shake].filter((f) => f.name.toLowerCase().includes(q)) };
      },
    });
    const user = userEvent.setup();
    await screen.findByRole("list", { name: "My foods" });
    const group = screen.getByRole("group", { name: "Show" });
    const names = () => within(group).getAllByRole("button").map((b) => b.textContent);
    expect(names()).toEqual(["All 3", "Foods 1", "Recipes 1", "Meals 1"]);
    expect(screen.getByRole("button", { name: "All 3" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Meals 1" }));
    expect(screen.getByRole("button", { name: "Meals 1" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "All 3" })).toHaveAttribute("aria-pressed", "false");
    expect(within(screen.getByRole("list", { name: "My foods" })).getAllByRole("listitem")).toHaveLength(1);

    await user.type(screen.getByRole("searchbox", { name: "Search my foods" }), "chi");
    await waitFor(() => expect(names()).toEqual(["All 1", "Foods 0", "Recipes 1", "Meals 0"]));
    expect(screen.getByText("Nothing here matches.")).toBeInTheDocument(); // Meals is still the chosen pill
    await user.click(screen.getByRole("button", { name: "Recipes 1" }));
    expect(within(screen.getByRole("list", { name: "My foods" })).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getAllByRole("button", { pressed: true })).toHaveLength(1);
  });

  it("the search box has a clear button that empties it", async () => {
    const server = show();
    const user = userEvent.setup();
    await screen.findByRole("list", { name: "My foods" });
    const box = screen.getByRole("searchbox", { name: "Search my foods" });
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
    await user.type(box, "chi");
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(box).toHaveValue("");
    expect(box).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
    await waitFor(() => expect(listPaths(server).at(-1)).toBe("/api/my-foods?kind=all&sort=recent"));
  });

  it("a search uses the best-match order unless a sort is picked", async () => {
    const server = show();
    const user = userEvent.setup();
    await screen.findByRole("list", { name: "My foods" });
    await user.type(screen.getByRole("searchbox", { name: "Search my foods" }), "chi");
    await waitFor(() => expect(listPaths(server).at(-1)).toBe("/api/my-foods?kind=all&q=chi"));
    expect(screen.getByRole("combobox", { name: "Sort" })).toHaveDisplayValue("Best match");
    await user.selectOptions(screen.getByRole("combobox", { name: "Sort" }), "Most used");
    await waitFor(() => expect(listPaths(server).at(-1)).toBe("/api/my-foods?kind=all&sort=used&q=chi"));
    await user.clear(screen.getByRole("searchbox", { name: "Search my foods" }));
    await waitFor(() => expect(listPaths(server).at(-1)).toBe("/api/my-foods?kind=all&sort=used"));
  });

  it("the type and sort choices are remembered on this device", async () => {
    const first = show();
    const user = userEvent.setup();
    await screen.findByRole("list", { name: "My foods" });
    await user.click(screen.getByRole("button", { name: /^Recipes/ }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Sort" }), "A–Z");
    expect(first.sent.length).toBeGreaterThan(0);
    cleanup();
    show();
    await screen.findByRole("list", { name: "My foods" });
    expect(screen.getByRole("button", { name: /^Recipes/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("combobox", { name: "Sort" })).toHaveValue("az");
  });

  it("junk in the remembered choice is ignored", async () => {
    localStorage.setItem("bytesize.myFoods.1", "{not json");
    show();
    await screen.findByRole("list", { name: "My foods" });
    expect(screen.getByRole("button", { name: /^All/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("combobox", { name: "Sort" })).toHaveValue("recent");
  });

  it("on a narrow phone the controls wrap: pills first, Sort under them on the right", async () => {
    show();
    await screen.findByRole("list", { name: "My foods" });
    const row = screen.getByRole("group", { name: "Show" }).parentElement!;
    expect(row).toHaveClass("flex-wrap");
    expect(screen.getByRole("combobox", { name: "Sort" }).closest("label")).toHaveClass("ml-auto");
  });

  it("New food, New recipe and New quick meal open their editors", async () => {
    show();
    const user = userEvent.setup();
    await screen.findByRole("list", { name: "My foods" });
    await user.click(screen.getByRole("button", { name: "New recipe" }));
    expect(screen.getByRole("heading", { level: 1, name: "New recipe" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "‹ My Foods" }));
    await user.click(await screen.findByRole("button", { name: "New quick meal" }));
    expect(screen.getByRole("heading", { level: 1, name: "New quick meal" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "‹ My Foods" }));
    await user.click(await screen.findByRole("button", { name: "New food" }));
    expect(screen.getByRole("heading", { level: 1, name: "New food" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("");
  });

  it("tapping a recipe opens it in the recipe editor; a plain food in the food form", async () => {
    show({ "GET /api/my-foods/:id": () => ({ food: chiliDetail }) });
    const user = userEvent.setup();
    const list = await screen.findByRole("list", { name: "My foods" });
    await user.click(within(list).getByRole("button", { name: /^Chili/ }));
    expect(screen.getByRole("heading", { level: 1, name: "Edit recipe" })).toBeInTheDocument();
    expect(await screen.findByRole("textbox", { name: "Name" })).toHaveValue("Chili");
    await user.click(screen.getByRole("button", { name: "‹ My Foods" }));
    await user.click(within(await screen.findByRole("list", { name: "My foods" })).getByRole("button", { name: /^Peanut protein shake/ }));
    expect(screen.getByRole("heading", { level: 1, name: "Edit food" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Peanut protein shake");
  });

  it("delete: a food never logged is removed; one that's in use is hidden", async () => {
    let foods = [chili, breakfastMeal, shake];
    const server = show({
      "GET /api/my-foods": () => ({ foods }),
      "DELETE /api/my-foods/:id": (_b, path) => {
        foods = foods.filter((f) => !path.endsWith(`/${f.id}`));
        // The server's answer: { archived: false } when deleted, { archived: true } when hidden
        return { archived: !path.endsWith("/5") };
      },
    });
    const user = userEvent.setup();
    let list = await screen.findByRole("list", { name: "My foods" });
    await user.click(within(list).getByRole("button", { name: "Delete Peanut protein shake" }));
    const confirm = screen.getByRole("alertdialog", { name: "Delete Peanut protein shake?" });
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Removed");
    expect(server.writes().map((w) => `${w.method} ${w.path}`)).toEqual(["DELETE /api/my-foods/5"]);
    list = screen.getByRole("list", { name: "My foods" });
    await waitFor(() => expect(within(list).queryByRole("button", { name: /^Peanut protein shake/ })).toBeNull());

    await user.click(within(list).getByRole("button", { name: "Delete Chili" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Hidden (it's in use)"));
    await waitFor(() => expect(within(list).queryByRole("button", { name: /^Chili/ })).toBeNull());
  });

  it("Back returns where you came from: the Dashboard by default (there is no Log page)", async () => {
    show();
    expect(screen.getByRole("link", { name: "‹ Back" })).toHaveAttribute("href", "#/");
  });

  it("Back returns to the Dashboard when My Foods was opened from there", async () => {
    window.location.hash = "#/log/my-foods?from=/";
    show();
    expect(screen.getByRole("link", { name: "‹ Back" })).toHaveAttribute("href", "#/");
  });
});
