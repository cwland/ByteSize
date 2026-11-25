import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";
import { twoUsers } from "./isolation.js";
import { foodCache } from "../src/db/schema.js";
import { brandKey, isChain } from "../src/lib/restaurantBrands.js";

// Restaurant tags (2026-11-25 design §3): a food or entry whose brand is a restaurant carries `restaurant: true` —
// from the built-in chain list, the person's own marks (which win), or a Spoonacular menu item.
let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
beforeEach(async () => {
  await t.reset();
  await t.login();
});
afterAll(async () => t.close());

const DAY = "2026-11-25";
const cached = async (name: string, brand: string | null, source = "usda") =>
  ({ ...(await t.db.insert(foodCache).values({ source, sourceId: `${source}-${name}-${brand}`, name, brand, servings: [{ label: "1 serving", grams: 100 }], nutrients: { calories: 300 } }).returning())[0], kind: "cache" });
const logFood = async (food: { kind: string; id: number }) =>
  (await t.api("POST", "/api/log", { day: DAY, meal: "dinner", food: { kind: food.kind, id: food.id }, servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 })).body.entry;
const dayEntries = async (as = t.api) => (await as("GET", `/api/day/${DAY}`)).body.entries as { name: string; brand: string | null; restaurant: boolean }[];
const flagOf = (entries: { name: string; restaurant: boolean }[], name: string) => entries.find((e) => e.name === name)?.restaurant;

describe("brand keys", () => {
  it("ignore case, apostrophes, punctuation, '&' and a leading 'The'", () => {
    expect(brandKey("P.F. Chang's")).toBe("pf changs");
    expect(brandKey("McDonald’s")).toBe("mcdonalds");
    expect(brandKey("  PANDA   EXPRESS ")).toBe("panda express");
    expect(brandKey("Chick-fil-A")).toBe("chick fil a");
    expect(brandKey("Ruby Tuesday & Co")).toBe("ruby tuesday and co");
    expect(brandKey("The Cheesecake Factory")).toBe("cheesecake factory");
  });

  it("the built-in list knows the big chains, and a chain name followed by more words", () => {
    for (const b of ["Panda Express", "McDonald's", "Chick-fil-A", "Chipotle Mexican Grill", "Taco Bell", "P.F. Chang's", "The Cheesecake Factory", "Starbucks Coffee"]) {
      expect(isChain(brandKey(b)), b).toBe(true);
    }
    for (const b of ["Daisy", "fairlife", "Trader Joe's", "Kirkland Signature", "Great Value", "Subwayz"]) {
      expect(isChain(brandKey(b)), b).toBe(false);
    }
  });
});

describe("restaurant flag", () => {
  it("log entries from a chain carry restaurant: true; grocery brands and no brand don't", async () => {
    await logFood(await cached("Kung Pao Chicken", "Panda Express"));
    await logFood(await cached("Light Sour Cream", "Daisy"));
    await logFood(await cached("Cucumber Salad", null));
    const entries = await dayEntries();
    expect(flagOf(entries, "Kung Pao Chicken")).toBe(true);
    expect(flagOf(entries, "Light Sour Cream")).toBe(false);
    expect(flagOf(entries, "Cucumber Salad")).toBe(false);
  });

  it("a Spoonacular menu item is a restaurant whatever its brand", async () => {
    await logFood(await cached("Smash Burger", "Joe's Diner", "spoonacular"));
    expect(flagOf(await dayEntries(), "Smash Burger")).toBe(true);
  });

  it("the person's mark beats the list, both ways, and removing it goes back to the list", async () => {
    await logFood(await cached("Smash Burger", "Joe's Diner"));
    await logFood(await cached("Frozen Potstickers", "P.F. Chang's"));
    expect(flagOf(await dayEntries(), "Smash Burger")).toBe(false);

    const put = await t.api("PUT", "/api/restaurant-brands", { brand: "Joe's Diner", restaurant: true });
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ brand: "Joe's Diner", key: "joes diner", restaurant: true });
    await t.api("PUT", "/api/restaurant-brands", { brand: "P.F. Chang's", restaurant: false });
    let entries = await dayEntries();
    expect(flagOf(entries, "Smash Burger")).toBe(true);
    expect(flagOf(entries, "Frozen Potstickers")).toBe(false);

    expect((await t.api("DELETE", "/api/restaurant-brands/pf%20changs")).status).toBe(200);
    entries = await dayEntries();
    expect(flagOf(entries, "Frozen Potstickers")).toBe(true);
  });

  it("food results (search, recent) carry the flag too", async () => {
    const chicken = await cached("Kung Pao Chicken", "Panda Express");
    await cached("Kung Pao Bowl", "Trader Joe's");
    await logFood(chicken);
    const recent = (await t.api("GET", "/api/foods/recent")).body.foods as { name: string; restaurant: boolean }[];
    expect(flagOf(recent, "Kung Pao Chicken")).toBe(true);
    const groups = (await t.api("GET", "/api/foods/search?q=kung%20pao")).body.groups as { foods: { name: string; restaurant: boolean }[] }[];
    const found = groups.flatMap((g) => g.foods);
    expect(flagOf(found, "Kung Pao Chicken")).toBe(true);
    expect(flagOf(found, "Kung Pao Bowl")).toBe(false);
  });

  it("a mark needs a brand", async () => {
    expect((await t.api("PUT", "/api/restaurant-brands", { brand: "  ", restaurant: true })).status).toBe(400);
  });

  it("one person's marks never change another's view", async () => {
    const { a, b } = await twoUsers(t);
    const burger = await cached("Smash Burger", "Joe's Diner");
    for (const as of [a.as, b.as]) {
      await as("POST", "/api/log", { day: DAY, meal: "dinner", food: { kind: "cache", id: burger.id }, servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 });
    }
    await a.as("PUT", "/api/restaurant-brands", { brand: "Joe's Diner", restaurant: true });
    expect(flagOf(await dayEntries(a.as), "Smash Burger")).toBe(true);
    expect(flagOf(await dayEntries(b.as), "Smash Burger")).toBe(false);
    expect((await b.as("DELETE", "/api/restaurant-brands/joes%20diner")).status).toBe(200); // nothing of b's to remove
    expect(flagOf(await dayEntries(a.as), "Smash Burger")).toBe(true);
  });
});
