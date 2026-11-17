import { afterEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
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
});

describe("My Foods", () => {
  it("lists every kind with Recipe and Meal tags; chips, sort and search ask the server", async () => {
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
    expect(screen.getByRole("radio", { name: "All" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getAllByRole("radio").map((r) => r.textContent)).toEqual(["All", "Foods", "Recipes", "Meals", "Recent", "Most used", "A–Z"]);
    await user.click(screen.getByRole("radio", { name: "Recipes" }));
    await waitFor(() => expect(listPaths(server).at(-1)).toBe("/api/my-foods?kind=recipes&sort=recent"));
    await user.click(screen.getByRole("radio", { name: "Most used" }));
    await waitFor(() => expect(listPaths(server).at(-1)).toBe("/api/my-foods?kind=recipes&sort=used"));
    await user.click(screen.getByRole("radio", { name: "A–Z" }));
    await waitFor(() => expect(listPaths(server).at(-1)).toBe("/api/my-foods?kind=recipes&sort=az"));
    await user.click(screen.getByRole("radio", { name: "Meals" }));
    await user.type(screen.getByRole("searchbox", { name: "Search my foods" }), "chi");
    await waitFor(() => expect(listPaths(server).at(-1)).toBe("/api/my-foods?kind=meals&sort=az&q=chi"));
  });

  it("a search uses the best-match order unless a sort is picked", async () => {
    const server = show();
    const user = userEvent.setup();
    await screen.findByRole("list", { name: "My foods" });
    await user.type(screen.getByRole("searchbox", { name: "Search my foods" }), "chi");
    await waitFor(() => expect(listPaths(server).at(-1)).toBe("/api/my-foods?kind=all&q=chi"));
    expect(screen.getByRole("radio", { name: "Recent" })).toHaveAttribute("aria-checked", "false");
    await user.click(screen.getByRole("radio", { name: "Most used" }));
    await waitFor(() => expect(listPaths(server).at(-1)).toBe("/api/my-foods?kind=all&sort=used&q=chi"));
    await user.clear(screen.getByRole("searchbox", { name: "Search my foods" }));
    await waitFor(() => expect(listPaths(server).at(-1)).toBe("/api/my-foods?kind=all&sort=used"));
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

  it("Back returns where you came from: the Log by default", async () => {
    show();
    expect(screen.getByRole("link", { name: "‹ Back" })).toHaveAttribute("href", "#/log");
  });

  it("Back returns to the Dashboard when My Foods was opened from there", async () => {
    window.location.hash = "#/log/my-foods?from=/";
    show();
    expect(screen.getByRole("link", { name: "‹ Back" })).toHaveAttribute("href", "#/");
  });
});
