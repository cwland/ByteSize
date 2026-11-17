import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AddFoodSheet from "./AddFoodSheet";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";
import { barFood, dayJson, restaurantRoutes } from "../../test/fixtures";

const USED_UP = "Today's restaurant lookups are used up. They reset at midnight UTC — or use Describe it.";
const both = { sources: ["spoonacular", "fatsecret"], lookupsLeft: 44 };
const hit = (over: Record<string, unknown>) => ({ source: "spoonacular", sourceId: "101", chain: "Chipotle", name: "Chicken Burrito Bowl", calories: 665, cacheId: null, imageUrl: null, ...over });
const results = {
  items: [
    hit({}),
    hit({ sourceId: "102", name: "Steak Burrito", calories: 945 }),
    hit({ source: "fatsecret", sourceId: "201", chain: "Qdoba", name: "Chicken Bowl", calories: null }),
  ],
  lookupsLeft: 40,
  errors: [],
};
// The bowl as POST /api/restaurants/item returns it: a cache food, brand = chain
const bowl = { ...barFood, id: 900, name: "Chicken Burrito Bowl", brand: "Chipotle", icon: "🌯", barcode: null, servings: [{ label: "1 item" }], nutrients: { calories: 665, protein_g: 52, fiber_g: 11 }, source: "spoonacular", foodKind: "custom" };
const panini = { ...bowl, id: 901, name: "Turkey Panini", brand: "Panera Bread", nutrients: { calories: 720 } };

function open(routes: Record<string, (b: any, path: string) => unknown> = {}, admin = true) {
  const server = fakeServer({
    "GET /api/day/:date": () => dayJson(),
    "GET /api/foods/recent": () => ({ foods: [] }),
    ...restaurantRoutes,
    "GET /api/restaurants/status": () => both,
    "GET /api/restaurants/search": () => results,
    ...routes,
  });
  const onClose = vi.fn();
  renderWithSession(<AddFoodSheet day="2026-11-16" meal="lunch" onClose={onClose} />, { isAdmin: admin });
  return { server, onClose };
}
const searches = (server: ReturnType<typeof fakeServer>) => server.sent.filter((s) => s.path.startsWith("/api/restaurants/search")).map((s) => s.path);
const items = (server: ReturnType<typeof fakeServer>) => server.sent.filter((s) => s.path === "/api/restaurants/item");

async function openRestaurants(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Restaurants" }));
  return screen.getByRole("dialog", { name: "Add food to Lunch" });
}
async function search(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(screen.getByRole("searchbox", { name: "Search restaurants" }), `${text}{Enter}`);
}

describe("Restaurants tab", () => {
  it("is hidden when no restaurant source is set up; an admin sees how to add one", async () => {
    const { server } = open({ "GET /api/restaurants/status": () => ({ sources: [], lookupsLeft: null }) });
    expect(await screen.findByText(/Add a restaurant data key in Settings › Food sources/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restaurants" })).not.toBeInTheDocument();
    expect(server.sent.some((s) => s.path.startsWith("/api/restaurants/search"))).toBe(false);
  });

  it("tells someone who can't add a key to ask an admin", async () => {
    open({ "GET /api/restaurants/status": () => ({ sources: [], lookupsLeft: null }) }, false);
    expect(await screen.findByText(/Ask an admin to add a restaurant data key/)).toBeInTheDocument();
    expect(screen.queryByText(/Settings › Food sources/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restaurants" })).not.toBeInTheDocument();
  });

  it("searches only after an 800 ms pause with at least 3 letters, or at once on Enter — never per keystroke", async () => {
    const { server } = open();
    const user = userEvent.setup();
    await openRestaurants(user);
    const box = screen.getByRole("searchbox", { name: "Search restaurants" });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const typeSlowly = async (text: string) => {
        for (let i = 1; i <= text.length; i++) {
          fireEvent.change(box, { target: { value: text.slice(0, i) } });
          await act(async () => void (await vi.advanceTimersByTimeAsync(300)));
        }
      };
      await typeSlowly("ch");
      await act(async () => void (await vi.advanceTimersByTimeAsync(2000)));
      expect(searches(server)).toEqual([]); // fewer than 3 letters
      await typeSlowly("chipotle");
      expect(searches(server)).toEqual([]); // still typing: no call per keystroke
      await act(async () => void (await vi.advanceTimersByTimeAsync(499)));
      expect(searches(server)).toEqual([]);
      await act(async () => void (await vi.advanceTimersByTimeAsync(1)));
      expect(searches(server)).toEqual(["/api/restaurants/search?q=chipotle"]);
      // Enter searches at once, and the pause after it doesn't search the same words again
      fireEvent.change(box, { target: { value: "chipotle bowl" } });
      fireEvent.submit(box);
      await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
      expect(searches(server)).toHaveLength(2);
      await act(async () => void (await vi.advanceTimersByTimeAsync(2000)));
      expect(searches(server)).toEqual(["/api/restaurants/search?q=chipotle", "/api/restaurants/search?q=chipotle%20bowl"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("groups results by chain with calories and a source label when both sources are set up", async () => {
    open();
    const user = userEvent.setup();
    const sheet = await openRestaurants(user);
    await search(user, "chicken bowl");
    const chipotle = await within(sheet).findByRole("region", { name: "Chipotle" });
    expect(within(chipotle).getByText("Chicken Burrito Bowl")).toBeInTheDocument();
    expect(within(chipotle).getByText("Steak Burrito")).toBeInTheDocument();
    expect(within(chipotle).getByText("665 cal")).toBeInTheDocument();
    expect(within(chipotle).getAllByText("Spoonacular")).toHaveLength(2);
    const qdoba = within(sheet).getByRole("region", { name: "Qdoba" });
    expect(within(qdoba).getByText("Chicken Bowl")).toBeInTheDocument();
    expect(within(qdoba).getByText("Calories unknown")).toBeInTheDocument();
    expect(within(qdoba).getByText("FatSecret")).toBeInTheDocument();
  });

  it("shows no source label when only one source is set up", async () => {
    open({ "GET /api/restaurants/status": () => ({ sources: ["spoonacular"], lookupsLeft: 44 }) });
    const user = userEvent.setup();
    const sheet = await openRestaurants(user);
    await search(user, "chicken bowl");
    await within(sheet).findByRole("region", { name: "Chipotle" });
    expect(within(sheet).queryByText("Spoonacular")).not.toBeInTheDocument();
    expect(within(sheet).queryByText("FatSecret")).not.toBeInTheDocument();
  });

  it("tapping a result fetches the item once and opens Track food, which logs it", async () => {
    const { server, onClose } = open({
      "POST /api/restaurants/item": () => ({ food: bowl, lookupsLeft: 39 }),
      "POST /api/log": (b) => ({ entry: { id: 3, ...b } }),
    });
    const user = userEvent.setup();
    const sheet = await openRestaurants(user);
    await search(user, "chicken bowl");
    await user.click(await within(sheet).findByRole("button", { name: /^Chicken Burrito Bowl/ }));
    expect(await screen.findByRole("heading", { name: "Track food" })).toBeInTheDocument();
    expect(items(server).map((s) => s.body)).toEqual([{ source: "spoonacular", sourceId: "101" }]);
    // Back to the results (still there) and open it again: no second fetch
    await user.click(screen.getByRole("button", { name: "‹ Back" }));
    await user.click(await screen.findByRole("button", { name: /^Chicken Burrito Bowl/ }));
    expect(await screen.findByRole("heading", { name: "Track food" })).toBeInTheDocument();
    expect(items(server)).toHaveLength(1);
    expect(searches(server)).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Track" }));
    expect(server.sent.find((s) => s.path === "/api/log")?.body).toMatchObject({ day: "2026-11-16", meal: "lunch", food: { kind: "cache", id: 900 } });
    expect(onClose).toHaveBeenCalled();
  });

  it("an item that can't be fetched says why", async () => {
    open({ "POST /api/restaurants/item": () => ({ status: 503, json: { error: "Spoonacular isn't answering right now" } }) });
    const user = userEvent.setup();
    const sheet = await openRestaurants(user);
    await search(user, "chicken bowl");
    await user.click(await within(sheet).findByRole("button", { name: /^Chicken Burrito Bowl/ }));
    expect(await within(sheet).findByText("Spoonacular isn't answering right now")).toBeInTheDocument();
  });

  it("stars and unstars items; favourites are grouped by chain", async () => {
    let favs: { chain: string; foods: unknown[] }[] = [{ chain: "Panera Bread", foods: [panini] }];
    const { server } = open({
      "GET /api/restaurants/favourites": () => ({ chains: favs }),
      "POST /api/restaurants/item": () => ({ food: bowl, lookupsLeft: 39 }),
      "POST /api/restaurants/favourites": () => {
        favs = [{ chain: "Chipotle", foods: [bowl] }, ...favs];
        return { chains: favs };
      },
      "DELETE /api/restaurants/favourites": () => {
        favs = favs.filter((c) => c.chain !== "Chipotle");
        return { chains: favs };
      },
    });
    const user = userEvent.setup();
    const sheet = await openRestaurants(user);
    const favourites = await within(sheet).findByRole("region", { name: "Favourites" });
    expect(within(favourites).getByRole("heading", { name: "Panera Bread" })).toBeInTheDocument();
    expect(within(favourites).getByText("720 cal")).toBeInTheDocument();

    await search(user, "chicken bowl");
    await user.click(await within(sheet).findByRole("button", { name: "Star Chicken Burrito Bowl" }));
    // Not opened yet: the item is fetched once to get its id, then starred
    expect(await within(sheet).findByRole("button", { name: "Unstar Chicken Burrito Bowl" })).toHaveAttribute("aria-pressed", "true");
    expect(items(server).map((s) => s.body)).toEqual([{ source: "spoonacular", sourceId: "101" }]);
    expect(server.sent.find((s) => s.method === "POST" && s.path === "/api/restaurants/favourites")?.body).toEqual({ cacheId: 900 });

    await user.clear(screen.getByRole("searchbox", { name: "Search restaurants" }));
    const after = await within(sheet).findByRole("region", { name: "Favourites" });
    expect(within(after).getByRole("heading", { name: "Chipotle" })).toBeInTheDocument();
    await user.click(within(after).getByRole("button", { name: "Unstar Chicken Burrito Bowl" }));
    expect(server.sent.find((s) => s.method === "DELETE")?.body).toEqual({ cacheId: 900 });
    await vi.waitFor(() => expect(within(sheet).queryByRole("heading", { name: "Chipotle" })).not.toBeInTheDocument());
    expect(items(server)).toHaveLength(1);
  });

  it("opening a favourite goes straight to Track food", async () => {
    const { server } = open({ "GET /api/restaurants/favourites": () => ({ chains: [{ chain: "Panera Bread", foods: [panini] }] }) });
    const user = userEvent.setup();
    const sheet = await openRestaurants(user);
    await user.click(await within(sheet).findByRole("button", { name: /^Turkey Panini/ }));
    expect(await screen.findByRole("heading", { name: "Track food" })).toBeInTheDocument();
    expect(items(server)).toHaveLength(0);
  });

  it("recent chains are chips that fill the search", async () => {
    const { server } = open({ "GET /api/restaurants/recent-chains": () => ({ chains: ["Chipotle", "Panera Bread"] }) });
    const user = userEvent.setup();
    const sheet = await openRestaurants(user);
    await user.click(await within(sheet).findByRole("button", { name: "Panera Bread" }));
    expect(screen.getByRole("searchbox", { name: "Search restaurants" })).toHaveValue("Panera Bread");
    await vi.waitFor(() => expect(searches(server)).toEqual(["/api/restaurants/search?q=Panera%20Bread"]));
  });

  it("shows about how many lookups are left today, updated by each answer", async () => {
    open();
    const user = userEvent.setup();
    const sheet = await openRestaurants(user);
    expect(await within(sheet).findByText("About 20 lookups left today")).toBeInTheDocument(); // 44 points / 2.2
    await search(user, "chicken bowl");
    expect(await within(sheet).findByText("About 18 lookups left today")).toBeInTheDocument(); // 40 points
  });

  it("shows no count when only FatSecret is in use, and its credit only", async () => {
    open({ "GET /api/restaurants/status": () => ({ sources: ["fatsecret"], lookupsLeft: null }) });
    const user = userEvent.setup();
    const sheet = await openRestaurants(user);
    expect(await within(sheet).findByRole("link", { name: "Powered by FatSecret" })).toBeInTheDocument();
    expect(within(sheet).queryByText(/lookups left/)).not.toBeInTheDocument();
    expect(within(sheet).queryByText("Restaurant data from spoonacular.com")).not.toBeInTheDocument();
  });

  it("credits every configured source", async () => {
    open();
    const user = userEvent.setup();
    const sheet = await openRestaurants(user);
    expect(await within(sheet).findByRole("link", { name: "Restaurant data from spoonacular.com" })).toHaveAttribute("href", "https://spoonacular.com/food-api");
    expect(within(sheet).getByRole("link", { name: "Powered by FatSecret" })).toHaveAttribute("href", "https://www.fatsecret.com");
  });

  it("when today's lookups are used up, says so and offers Describe it", async () => {
    open({
      "GET /api/restaurants/status": () => ({ sources: ["spoonacular"], lookupsLeft: 5 }),
      "GET /api/restaurants/search": () => ({ items: [], lookupsLeft: 0, errors: [{ source: "spoonacular", message: USED_UP }] }),
    });
    const user = userEvent.setup();
    const sheet = await openRestaurants(user);
    await search(user, "chicken bowl");
    expect(await within(sheet).findByText(USED_UP)).toBeInTheDocument();
    expect(within(sheet).queryByText(/lookups left/)).not.toBeInTheDocument();
    expect(within(sheet).queryByText(/No menu items found/)).not.toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "Describe it" }));
    expect(await screen.findByRole("textbox", { name: "Describe the food" })).toBeInTheDocument();
  });

  it("a source that failed is mentioned under the results", async () => {
    open({ "GET /api/restaurants/search": () => ({ ...results, errors: [{ source: "spoonacular", message: "Spoonacular isn't answering right now" }] }) });
    const user = userEvent.setup();
    const sheet = await openRestaurants(user);
    await search(user, "chicken bowl");
    expect(await within(sheet).findByText("Spoonacular isn't answering right now")).toBeInTheDocument();
    expect(within(sheet).getByRole("region", { name: "Chipotle" })).toBeInTheDocument();
  });

  it("keeps the search box and lookups line pinned outside the scrolling list", async () => {
    open({ "GET /api/restaurants/favourites": () => ({ chains: [{ chain: "Panera Bread", foods: [panini] }] }) });
    const user = userEvent.setup();
    const sheet = await openRestaurants(user);
    const list = within(sheet).getByRole("region", { name: "Restaurant results" });
    expect(await within(list).findByRole("region", { name: "Favourites" })).toBeInTheDocument();
    expect(within(list).queryByRole("searchbox", { name: "Search restaurants" })).not.toBeInTheDocument();
    expect(within(list).queryByText(/lookups left/)).not.toBeInTheDocument();
    expect(within(sheet).getByRole("searchbox", { name: "Search restaurants" })).toBeInTheDocument();
    expect(within(sheet).getByText("About 20 lookups left today")).toBeInTheDocument();
  });

  it("Back from Edit food on a restaurant item returns to Restaurants", async () => {
    open({ "POST /api/restaurants/item": () => ({ food: bowl, lookupsLeft: 39 }) });
    const user = userEvent.setup();
    const sheet = await openRestaurants(user);
    await search(user, "chicken bowl");
    await user.click(await within(sheet).findByRole("button", { name: /^Chicken Burrito Bowl/ }));
    await user.click(await screen.findByRole("button", { name: "Edit food" }));
    expect(await screen.findByRole("heading", { name: "Correct this food" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "‹ Back" }));
    expect(await screen.findByRole("heading", { name: "Restaurants" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Chipotle" })).toBeInTheDocument();
  });

  it("with both sources, Spoonacular used up but other results back: results and a small line, no banner", async () => {
    open({
      "GET /api/restaurants/search": () => ({ items: [results.items[2]], lookupsLeft: 0, errors: [{ source: "spoonacular", message: USED_UP }] }),
    });
    const user = userEvent.setup();
    const sheet = await openRestaurants(user);
    await search(user, "chicken bowl");
    expect(await within(sheet).findByRole("region", { name: "Qdoba" })).toBeInTheDocument();
    expect(within(sheet).getByText("Spoonacular's lookups are used up for today — showing other results")).toBeInTheDocument();
    expect(within(sheet).queryByText(USED_UP)).not.toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: "Describe it" })).not.toBeInTheDocument();
    expect(within(sheet).queryByText(/lookups left/)).not.toBeInTheDocument();
  });

  it("opens on the used-up banner when Spoonacular is the only source and has no points left", async () => {
    const { server } = open({ "GET /api/restaurants/status": () => ({ sources: ["spoonacular"], lookupsLeft: 0 }) });
    const user = userEvent.setup();
    const sheet = await openRestaurants(user);
    expect(within(sheet).getByText(USED_UP)).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Describe it" })).toBeInTheDocument();
    expect(searches(server)).toEqual([]);
  });

  it("keeps showing Searching… when an older search finishes before the newer one", async () => {
    const pending: Record<string, (v: unknown) => void> = {};
    open({ "GET /api/restaurants/search": (_b, path) => new Promise((res) => (pending[decodeURIComponent(path.split("q=")[1])] = () => res(results))) });
    const user = userEvent.setup();
    const sheet = await openRestaurants(user);
    await search(user, "chipotle");
    const box = screen.getByRole("searchbox", { name: "Search restaurants" });
    await user.clear(box);
    await user.type(box, "qdoba{Enter}");
    await vi.waitFor(() => expect(pending.qdoba).toBeDefined());
    await act(async () => pending.chipotle(null));
    expect(within(sheet).getByText("Searching…")).toBeInTheDocument();
    await act(async () => pending.qdoba(null));
    expect(await within(sheet).findByRole("region", { name: "Chipotle" })).toBeInTheDocument();
    expect(within(sheet).queryByText("Searching…")).not.toBeInTheDocument();
  });

  describe("no repeated calls", () => {
    async function withFakeTimers(routes: Record<string, (b: any, path: string) => unknown>, fn: (server: ReturnType<typeof fakeServer>, box: HTMLElement) => Promise<void>) {
      const { server } = open(routes);
      await openRestaurants(userEvent.setup());
      const box = screen.getByRole("searchbox", { name: "Search restaurants" });
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        await fn(server, box);
      } finally {
        vi.useRealTimers();
      }
    }
    const tick = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

    it("the pause search then Enter on the same words: one call", () =>
      withFakeTimers({}, async (server, box) => {
        fireEvent.change(box, { target: { value: "chipotle" } });
        await tick(800);
        expect(searches(server)).toHaveLength(1);
        fireEvent.submit(box);
        await tick(2000);
        expect(searches(server)).toHaveLength(1);
      }));

    it("a failed search isn't sent again by the pending pause; Enter retries it", () => {
      let n = 0;
      return withFakeTimers({ "GET /api/restaurants/search": () => (++n === 1 ? { status: 500, json: { error: "Something broke" } } : results) }, async (server, box) => {
        fireEvent.change(box, { target: { value: "chipotle" } });
        fireEvent.submit(box);
        await tick(0);
        expect(screen.getByText("Something broke")).toBeInTheDocument();
        await tick(2000);
        expect(searches(server)).toHaveLength(1);
        fireEvent.submit(box);
        await tick(0);
        expect(searches(server)).toHaveLength(2);
      });
    });

    it("a recent-chain chip searches once, not again after the pause", () =>
      withFakeTimers({ "GET /api/restaurants/recent-chains": () => ({ chains: ["Chipotle"] }) }, async (server) => {
        await tick(0);
        fireEvent.click(screen.getByRole("button", { name: "Chipotle" }));
        await tick(2000);
        expect(searches(server)).toEqual(["/api/restaurants/search?q=Chipotle"]);
      }));
  });

  it("a double tap on a result or its star sends each request once", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { server } = open({
      "POST /api/restaurants/item": async () => {
        await gate;
        return { food: bowl, lookupsLeft: 39 };
      },
      "POST /api/restaurants/favourites": () => ({ chains: [{ chain: "Chipotle", foods: [bowl] }] }),
    });
    const user = userEvent.setup();
    const sheet = await openRestaurants(user);
    await search(user, "chicken bowl");
    const star = await within(sheet).findByRole("button", { name: "Star Chicken Burrito Bowl" });
    await user.click(star);
    await user.click(star);
    await user.click(within(sheet).getByRole("button", { name: /^Chicken Burrito Bowl/ }));
    await user.click(within(sheet).getByRole("button", { name: /^Chicken Burrito Bowl/ }));
    await act(async () => release());
    expect(await screen.findByRole("heading", { name: "Track food" })).toBeInTheDocument();
    expect(items(server)).toHaveLength(1);
    expect(server.sent.filter((s) => s.method === "POST" && s.path === "/api/restaurants/favourites")).toHaveLength(1);
  });
});
