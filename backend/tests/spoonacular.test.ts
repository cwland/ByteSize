import { describe, expect, it } from "vitest";
import { spoonacular } from "../src/lib/restaurants/spoonacular.js";
import { SourceError } from "../src/lib/foodSources/types.js";
import { quota, SPOON, SPOON_SEARCH, spoonItem } from "./restaurantFakes.js";

type Reply = { status: number; json?: unknown; text?: string; headers?: Record<string, string> };
function fakeFetch(answer: (url: string) => Reply | Promise<Reply>) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    const r = await answer(url);
    return new Response(r.text ?? JSON.stringify(r.json), { status: r.status, headers: r.headers });
  }) as typeof fetch;
  return { fetchFn, calls };
}
const make = (f: ReturnType<typeof fakeFetch>, timeoutMs = 3000) => spoonacular({ fetch: f.fetchFn, apiKey: "spoon-key", timeoutMs });

describe("Spoonacular adapter", () => {
  it("searches menu items with the key in a header and maps chain, name, calories and image", async () => {
    const f = fakeFetch(() => ({
      status: 200,
      json: { menuItems: [spoonItem(424571, "Bacon King Burger", "Burger King", 1040), spoonItem(5, "Mystery", "Hooters")], totalMenuItems: 2, type: "menuItem", offset: 0, number: 10 },
      headers: quota(38.4, 11.6, 1.1),
    }));
    const r = await make(f).search("bacon king");
    expect(r.items).toEqual([
      { source: "spoonacular", sourceId: "424571", chain: "Burger King", name: "Bacon King Burger", calories: 1040, imageUrl: "https://img.spoonacular.com/menu-items/424571-312x231.png" },
      { source: "spoonacular", sourceId: "5", chain: "Hooters", name: "Mystery", calories: null, imageUrl: "https://img.spoonacular.com/menu-items/5-312x231.png" },
    ]);
    expect(r.quota).toEqual({ left: 38.4 });
    const url = new URL(f.calls[0].url);
    expect(url.origin + url.pathname).toBe(SPOON_SEARCH);
    expect(url.searchParams.get("query")).toBe("bacon king");
    expect(url.searchParams.get("number")).toBe("10");
    expect(url.searchParams.get("addMenuItemInformation")).toBe("true");
    expect(f.calls[0].url).not.toContain("spoon-key");
    expect(f.calls[0].headers["x-api-key"]).toBe("spoon-key");
  });

  it("maps an item's nutrients per item, with grams only when the serving is a weight", async () => {
    const extra = {
      nutrition: {
        nutrients: [
          { name: "Calories", amount: 1040, unit: "cal" },
          { name: "Fat", amount: 69, unit: "g" },
          { name: "Saturated Fat", amount: 25.5, unit: "g" },
          { name: "Protein", amount: 57, unit: "g" },
          { name: "Carbohydrates", amount: 48, unit: "g" },
          { name: "Sugar", amount: 9, unit: "g" },
          { name: "Fiber", amount: 2, unit: "g" },
          { name: "Sodium", amount: 2.15, unit: "g" },
          { name: "Cholesterol", amount: 200, unit: "mg" },
          { name: "Potassium", amount: 700, unit: "mg" },
        ],
      },
      servings: { number: 1, size: 290, unit: "g" },
    };
    const f = fakeFetch(() => ({ status: 200, json: spoonItem(424571, "Bacon King Burger", "Burger King", 1040, extra), headers: quota(37) }));
    const r = await make(f).item("424571");
    expect(f.calls[0].url).toBe(`${SPOON}/424571`);
    expect(r.quota).toEqual({ left: 37 });
    expect(r.food).toMatchObject({
      source: "spoonacular",
      sourceId: "424571",
      barcode: null,
      name: "Bacon King Burger",
      brand: "Burger King",
      servings: [{ label: "1 item", grams: 290 }],
      nutrients: { calories: 1040, fat_g: 69, saturated_fat_g: 25.5, protein_g: 57, carbs_g: 48, sugar_g: 9, fiber_g: 2, sodium_mg: 2150, potassium_mg: 700 },
      imageUrl: "https://img.spoonacular.com/menu-items/424571-312x231.png",
    });
    // Unknown stays unknown
    expect(r.food.nutrients.added_sugar_g).toBeUndefined();
  });

  it("keeps servings-only when the size isn't grams, and leaves out missing nutrients", async () => {
    const f = fakeFetch(() => ({ status: 200, json: spoonItem(7, "Burrito", "Chipotle", 1000, { servings: { number: 1, size: 2, unit: "oz" } }) }));
    const r = await make(f).item("7");
    expect(r.food.servings).toEqual([{ label: "1 item" }]);
    expect(r.food.nutrients).toEqual({ calories: 1000, fat_g: 21, protein_g: 32, carbs_g: 40 });
    expect(r.quota).toBeUndefined();
  });

  it("402 is a quota error, 401 a bad key, other failures 'down', and junk 'bad_data' — none echo the key", async () => {
    const cases: [Reply, string][] = [
      [{ status: 402, json: { status: "failure", message: "Your daily points limit of 50 has been reached." } }, "quota"],
      [{ status: 401, json: { status: "failure", message: "You are not authorized. spoon-key" } }, "bad_key"],
      [{ status: 429, json: {} }, "down"],
      [{ status: 500, json: {} }, "down"],
      [{ status: 200, text: "<html>oops</html>" }, "bad_data"],
      [{ status: 200, json: { results: [] } }, "bad_data"],
    ];
    for (const [reply, kind] of cases) {
      const f = fakeFetch(() => reply);
      const err = await make(f).search("taco").catch((e) => e);
      expect(err).toBeInstanceOf(SourceError);
      expect(err.kind).toBe(kind);
      expect(err.source).toBe("spoonacular");
      expect(err.message).not.toContain("spoon-key");
      expect(f.calls).toHaveLength(1); // never retried
    }
  });

  it("an unreachable or slow source is 'down'", async () => {
    const down = spoonacular({ fetch: (async () => { throw new TypeError("fetch failed"); }) as typeof fetch, apiKey: "k", timeoutMs: 3000 });
    expect(await down.search("taco").catch((e) => e.kind)).toBe("down");
    const slow = make(fakeFetch(() => new Promise<never>(() => {})), 20);
    const err = await slow.item("1").catch((e) => e);
    expect(err.kind).toBe("down");
    expect(err.message).toMatch(/took too long/);
  });

  it("drops hits whose id isn't a number and never builds an image address from one", async () => {
    const junk = { ...spoonItem(1, "Evil", "X", 1), id: "../../etc", image: undefined };
    const f = fakeFetch(() => ({ status: 200, json: { menuItems: [junk, spoonItem(2, "Fine", "Y", 5)] } }));
    const r = await make(f).search("abc");
    expect(r.items.map((i) => i.sourceId)).toEqual(["2"]);
    const item = fakeFetch(() => ({ status: 200, json: { ...spoonItem(3, "Odd", "Z", 1), id: "3abc", image: undefined } }));
    expect(await make(item).item("3").catch((e) => e.kind)).toBe("bad_data");
  });
});
