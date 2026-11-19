import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { setupTestApp, type TestApp } from "./helpers.js";
import { asUser } from "./isolation.js";
import { cleanupLookups } from "../src/lib/lookups.js";
import { fsCalls, fsFood, fsHit, NO_KEY_MESSAGE, QUOTA_MESSAGE, quota, restaurantWeb, setRestaurantKeys, spoonCalls, spoonItem, tokenCalls } from "./restaurantFakes.js";

let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
beforeEach(async () => {
  await t.reset();
  await t.login(); // admin "alex"
});
afterAll(async () => t.close());

const FS = { id: "fs-id", secret: "fs-secret" };
const count = async (table: string) => Number((await t.db.execute<{ n: string }>(sql.raw(`select count(*) as n from ${table}`))).rows[0].n);
const search = (q: string) => t.api("GET", `/api/restaurants/search?q=${encodeURIComponent(q)}`);
const appLog = async () => (await t.db.execute<{ category: string; source: string; event: string; detail: string }>(sql`select category, source, event, detail from app_log order by id`)).rows;

const bowl = spoonItem(1001, "Chicken Burrito Bowl", "Chipotle", 655);
const burrito = fsFood(101, "Chicken Burrito", "Chipotle", [{ serving_description: "1 burrito", metric_serving_amount: "510.000", metric_serving_unit: "g", calories: "1070", fat: "41.00", protein: "52.00", carbohydrate: "120.00" }]);

describe("restaurant keys (admin)", () => {
  it("are saved encrypted, only reported as set, and can be removed", async () => {
    expect((await t.api("GET", "/api/admin/food-sources")).body).toEqual({ off: { enabled: true, hours: 9999 }, usda: { hasKey: false, enabled: false, hours: 9999 }, spoonacular: { hasKey: false, enabled: false, hours: 1 }, fatsecret: { hasKey: false, enabled: false, hours: 24, plan: "basic", barcodeScopeMissing: false } });
    await setRestaurantKeys(t, { spoonacular: " spoon-key ", fatsecret: FS });
    const got = await t.api("GET", "/api/admin/food-sources");
    expect(got.body).toEqual({ off: { enabled: true, hours: 9999 }, usda: { hasKey: false, enabled: false, hours: 9999 }, spoonacular: { hasKey: true, enabled: true, hours: 1 }, fatsecret: { hasKey: true, enabled: true, hours: 24, plan: "basic", barcodeScopeMissing: false } });
    const stored = JSON.stringify((await t.db.execute(sql`select value from app_settings`)).rows);
    for (const secret of ["spoon-key", "fs-secret", "fs-id"]) {
      expect(JSON.stringify(got.body)).not.toContain(secret);
      expect(stored).not.toContain(secret);
    }
    // Leaving a key out keeps it; the USDA key is untouched by restaurant keys
    await t.api("PUT", "/api/admin/food-sources", { usdaApiKey: "usda" });
    expect((await t.api("GET", "/api/admin/food-sources")).body).toEqual({ off: { enabled: true, hours: 9999 }, usda: { hasKey: true, enabled: true, hours: 9999 }, spoonacular: { hasKey: true, enabled: true, hours: 1 }, fatsecret: { hasKey: true, enabled: true, hours: 24, plan: "basic", barcodeScopeMissing: false } });
    await setRestaurantKeys(t, { spoonacular: null, fatsecret: null });
    expect((await t.api("GET", "/api/admin/food-sources")).body).toEqual({ off: { enabled: true, hours: 9999 }, usda: { hasKey: true, enabled: true, hours: 9999 }, spoonacular: { hasKey: false, enabled: false, hours: 1 }, fatsecret: { hasKey: false, enabled: false, hours: 24, plan: "basic", barcodeScopeMissing: false } });
  });

  it("a FatSecret client ID without a secret doesn't count as set", async () => {
    await t.api("PUT", "/api/admin/food-sources", { fatsecretClientId: "only-id" });
    expect((await t.api("GET", "/api/admin/food-sources")).body.fatsecret).toMatchObject({ hasKey: false, enabled: false });
    expect((await t.api("GET", "/api/restaurants/status")).body.sources).toEqual([]);
  });

  it("members can't set or test keys", async () => {
    const sam = await t.createUser("sam");
    const as = asUser(t, sam.token);
    expect((await as("PUT", "/api/admin/food-sources", { spoonacularApiKey: "evil" })).status).toBe(403);
    expect((await as("POST", "/api/admin/food-sources/test", { source: "spoonacular" })).status).toBe(403);
  });

  it("Test checks each source and reports a plain result, never the key", async () => {
    await setRestaurantKeys(t, { spoonacular: "spoon-key", fatsecret: FS });
    restaurantWeb(t, {
      spoonSearch: (_q, url) => ({ status: 200, json: { menuItems: [spoonItem(1, "Whopper", "Burger King", 670)] }, headers: quota(44.99) }),
      fsSearch: () => ({ status: 200, json: { foods: { food: fsHit(1, "Whopper", "Burger King", 670) } } }),
    });
    expect((await t.api("POST", "/api/admin/food-sources/test", { source: "spoonacular" })).body).toEqual({ ok: true, lookupsLeft: 44 });
    expect(new URL(spoonCalls(t)[0].url).searchParams.get("number")).toBe("1");
    expect((await t.api("POST", "/api/admin/food-sources/test", { source: "fatsecret" })).body).toEqual({ ok: true });
    // New FatSecret credentials get a new token (the old one isn't reused)
    await setRestaurantKeys(t, { fatsecret: { id: "fs-id", secret: "fs-secret-2" } });
    restaurantWeb(t, { spoonSearch: () => ({ status: 401, json: { message: "bad key spoon-key" } }), fsToken: () => ({ status: 401, json: { error: "invalid_client" } }) });
    const s = await t.api("POST", "/api/admin/food-sources/test", { source: "spoonacular" });
    expect(s.body.ok).toBe(false);
    expect(s.body.error).toMatch(/Spoonacular refused the key — check it in Settings › Integrations/);
    const f = await t.api("POST", "/api/admin/food-sources/test", { source: "fatsecret" });
    expect(f.body).toEqual({ ok: false, error: "FatSecret refused the client ID or secret — check them in Settings › Integrations" });
    expect(JSON.stringify([s.body, f.body])).not.toMatch(/spoon-key|fs-secret/);
    await setRestaurantKeys(t, { spoonacular: null });
    expect((await t.api("POST", "/api/admin/food-sources/test", { source: "spoonacular" })).body).toEqual({ ok: false, error: NO_KEY_MESSAGE });
  });
});

describe("restaurant search", () => {
  it("with no keys: no sources, and search says how to add one", async () => {
    expect((await t.api("GET", "/api/restaurants/status")).body).toEqual({ sources: [], lookupsLeft: null, turnedOff: false });
    const r = await search("chipotle");
    expect(r.status).toBe(400);
    expect(r.body.error).toBe(NO_KEY_MESSAGE);
    expect(t.foodWeb.calls).toEqual([]);
  });

  it("needs at least 3 letters and a signed-in person", async () => {
    await setRestaurantKeys(t, { spoonacular: "k" });
    const r = await search(" ab ");
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("Type at least 3 letters");
    t.setToken("");
    expect((await search("chipotle")).status).toBe(401);
  });

  it("Spoonacular results carry chain, name, calories and lookups left from the quota headers", async () => {
    await setRestaurantKeys(t, { spoonacular: "spoon-key", fatsecret: FS });
    restaurantWeb(t, { spoonSearch: () => ({ status: 200, json: { menuItems: [bowl, spoonItem(1002, "Steak Bowl", "Chipotle")] }, headers: quota(38.9) }) });
    const r = await search("chipotle bowl");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      items: [
        { source: "spoonacular", sourceId: "1001", chain: "Chipotle", name: "Chicken Burrito Bowl", calories: 655, cacheId: null, imageUrl: bowl.image },
        { source: "spoonacular", sourceId: "1002", chain: "Chipotle", name: "Steak Bowl", calories: null, cacheId: null, imageUrl: "https://img.spoonacular.com/menu-items/1002-312x231.png" },
      ],
      lookupsLeft: 38,
      errors: [],
    });
    expect(fsCalls(t, "foods.search")).toHaveLength(1); // FatSecret is asked first; it found nothing
    expect((await t.api("GET", "/api/restaurants/status")).body).toEqual({ sources: ["fatsecret", "spoonacular"], lookupsLeft: 38, turnedOff: false });
  });

  it("the same search within Spoonacular's hours (1 h by default) makes one outside call; after them it asks again", async () => {
    t.clock.date = new Date("2026-11-17T15:00:00Z");
    await setRestaurantKeys(t, { spoonacular: "spoon-key" });
    restaurantWeb(t, { spoonSearch: () => ({ status: 200, json: { menuItems: [bowl] }, headers: quota(40) }) });
    const first = await search("Chipotle bowl");
    t.clock.date = new Date("2026-11-17T15:59:00Z");
    const again = await search("  chipotle   BOWL ");
    expect(spoonCalls(t)).toHaveLength(1);
    expect(again.body.items).toEqual(first.body.items);
    expect(await count("food_cache")).toBe(0); // search results aren't foods yet
    t.clock.date = new Date("2026-11-17T16:00:01Z");
    await search("chipotle bowl");
    expect(spoonCalls(t)).toHaveLength(2);
    expect(await count("restaurant_searches")).toBe(1);
  });

  it("calls Spoonacular at most once a second (a server-side queue on the app clock)", async () => {
    t.clock.date = new Date("2026-11-17T15:00:00Z");
    await setRestaurantKeys(t, { spoonacular: "spoon-key" });
    const at: number[] = [];
    restaurantWeb(t, {
      spoonSearch: () => {
        at.push(t.clock.date!.getTime());
        return { status: 200, json: { menuItems: [bowl] }, headers: quota(40) };
      },
    });
    await Promise.all([search("chipotle"), search("taco bell"), search("wendys")]);
    expect(at).toHaveLength(3);
    expect(at[1] - at[0]).toBeGreaterThanOrEqual(1000);
    expect(at[2] - at[1]).toBeGreaterThanOrEqual(1000);
    expect(t.sleeps.every((ms) => ms > 0 && ms <= 1000)).toBe(true);
    t.sleeps.length = 0;
    t.clock.date = new Date(t.clock.date!.getTime() + 5000);
    await search("arbys");
    expect(t.sleeps).toEqual([]); // a quiet second: no wait
  });

  it("out of points (402): a clear message, and no more Spoonacular calls today", async () => {
    t.clock.date = new Date("2026-11-17T15:00:00Z");
    await setRestaurantKeys(t, { spoonacular: "spoon-key", fatsecret: FS });
    restaurantWeb(t, {
      spoonSearch: () => ({ status: 402, json: { status: "failure", code: 402, message: "Your daily points limit of 50 has been reached." } }),
      fsSearch: (q) => (q === "panda" ? { status: 200, json: { foods: { food: [fsHit(102, "Orange chicken", "Panda Express", 900)] } } } : { status: 200, json: { foods: {} } }),
    });
    const r = await search("chipotle");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ items: [], lookupsLeft: 0, errors: [{ source: "spoonacular", message: QUOTA_MESSAGE }] });
    const p = await search("panda"); // FatSecret (asked first) still answers
    expect(p.body.items.map((i: any) => [i.source, i.chain, i.name, i.calories])).toEqual([["fatsecret", "Panda Express", "Orange chicken", 900]]);
    await search("taco bell");
    expect(spoonCalls(t)).toHaveLength(1); // not asked again today
    expect(fsCalls(t, "foods.search")).toHaveLength(3);
    // FatSecret's answers are kept (24 h), never as foods
    expect(await count("food_cache")).toBe(0);
    expect(await count("restaurant_searches")).toBe(3);
    // A new UTC day: Spoonacular is asked again
    t.clock.date = new Date("2026-11-18T00:00:01Z");
    restaurantWeb(t, { spoonSearch: () => ({ status: 200, json: { menuItems: [bowl] }, headers: quota(48.9) }) });
    const next = await search("chipotle");
    expect(next.body.items[0].source).toBe("spoonacular");
    expect(next.body.lookupsLeft).toBe(48);
  });

  it("saving a different Spoonacular key clears the used-up state: the next search calls Spoonacular", async () => {
    t.clock.date = new Date("2026-11-17T15:00:00Z");
    await setRestaurantKeys(t, { spoonacular: "old-key" });
    restaurantWeb(t, { spoonSearch: () => ({ status: 402, json: {} }) });
    await search("chipotle");
    await search("panda");
    expect(spoonCalls(t)).toHaveLength(1); // blocked for the rest of the day
    restaurantWeb(t, { spoonSearch: () => ({ status: 200, json: { menuItems: [bowl] }, headers: quota(40) }) });
    await setRestaurantKeys(t, { spoonacular: "new-key" });
    const r = await search("panda");
    expect(spoonCalls(t)).toHaveLength(2);
    expect(r.body.errors).toEqual([]);
    expect(r.body.items).toHaveLength(1);
  });

  it("out of points without FatSecret: the message and no items, never a 500", async () => {
    await setRestaurantKeys(t, { spoonacular: "spoon-key" });
    restaurantWeb(t, { spoonSearch: () => ({ status: 402, json: {} }) });
    const r = await search("chipotle");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ items: [], lookupsLeft: 0, errors: [{ source: "spoonacular", message: QUOTA_MESSAGE }] });
  });

  it("a down or malformed source gives a plain message, falls back once, never retries, and is logged without keys", async () => {
    await setRestaurantKeys(t, { spoonacular: "spoon-key", fatsecret: FS });
    restaurantWeb(t, { spoonSearch: () => ({ status: 200, text: "<html>not json</html>" }), fsSearch: () => ({ status: 500, json: {} }) });
    const r = await search("chipotle");
    expect(r.status).toBe(200);
    expect(r.body.items).toEqual([]);
    expect(r.body.errors).toEqual([
      { source: "fatsecret", message: "FatSecret answered with an error (500)" },
      { source: "spoonacular", message: "Spoonacular sent something unexpected" },
    ]);
    expect(spoonCalls(t)).toHaveLength(1);
    expect(fsCalls(t, "foods.search")).toHaveLength(1);
    const log = await appLog();
    expect(log.map((l) => [l.category, l.source, l.event])).toEqual([
      ["food", "FatSecret", "FatSecret search failed"],
      ["food", "Spoonacular", "Spoonacular search failed"],
    ]);
    expect(JSON.stringify(log)).not.toMatch(/spoon-key|fs-secret|tok-/);
    // A failure isn't kept as an answer: the next search asks again
    t.foodWeb.down = true;
    const down = await search("chipotle");
    expect(down.body.errors).toEqual([
      { source: "fatsecret", message: "Couldn't reach FatSecret" },
      { source: "spoonacular", message: "Couldn't reach Spoonacular" },
    ]);
  });

  it("FatSecret finding nothing falls back to Spoonacular", async () => {
    await setRestaurantKeys(t, { spoonacular: "spoon-key", fatsecret: FS });
    restaurantWeb(t, { spoonSearch: () => ({ status: 200, json: { menuItems: [bowl] }, headers: quota(30) }) });
    const r = await search("chipotle bowl");
    expect(r.body).toEqual({ items: [{ source: "spoonacular", sourceId: "1001", chain: "Chipotle", name: "Chicken Burrito Bowl", calories: 655, cacheId: null, imageUrl: bowl.image }], lookupsLeft: 30, errors: [] });
    expect(fsCalls(t, "foods.search")).toHaveLength(1);
  });

  it("FatSecret alone: no lookup count; its answer kept (one call), never stored as a food", async () => {
    await setRestaurantKeys(t, { fatsecret: FS });
    restaurantWeb(t, { fsSearch: () => ({ status: 200, json: { foods: { food: fsHit(7, "Baconator", "Wendy's", 950) } } }) });
    expect((await t.api("GET", "/api/restaurants/status")).body).toEqual({ sources: ["fatsecret"], lookupsLeft: null, turnedOff: false });
    await search("baconator");
    const r = await search("baconator");
    expect(r.body.lookupsLeft).toBeNull();
    expect(r.body.items.map((i: any) => i.name)).toEqual(["Baconator"]);
    expect(fsCalls(t, "foods.search")).toHaveLength(1); // kept for FatSecret's hours (24 h)
    expect(tokenCalls(t)).toHaveLength(1);
    expect(spoonCalls(t)).toEqual([]);
    expect(await count("food_cache")).toBe(0);
    expect(await count("restaurant_searches")).toBe(1);
  });
});

describe("restaurant items", () => {
  it("a Spoonacular item's nutrition is fetched once, kept as a food (brand = chain) and shown as saved in search", async () => {
    await setRestaurantKeys(t, { spoonacular: "spoon-key" });
    restaurantWeb(t, {
      spoonSearch: () => ({ status: 200, json: { menuItems: [bowl] }, headers: quota(40) }),
      spoonItem: (id) => ({ status: 200, json: spoonItem(Number(id), "Chicken Burrito Bowl", "Chipotle", 655, { servings: { number: 1, size: 500, unit: "g" } }), headers: quota(39) }),
    });
    const s = await search("chipotle bowl");
    const one = await t.api("POST", "/api/restaurants/item", { source: "spoonacular", sourceId: "1001" });
    expect(one.status).toBe(200);
    expect(one.body.lookupsLeft).toBe(39);
    expect(one.body.food).toMatchObject({ kind: "cache", name: "Chicken Burrito Bowl", brand: "Chipotle", source: "spoonacular", servings: [{ label: "1 item", grams: 500 }], nutrients: { calories: 655, fat_g: 21, protein_g: 32, carbs_g: 40 } });
    const two = await t.api("POST", "/api/restaurants/item", { source: "spoonacular", sourceId: "1001" });
    expect(one.body.food.savedAt).toBeNull(); // fetched just now
    expect(two.body.food).toEqual({ ...one.body.food, savedAt: expect.any(String) }); // the kept copy
    expect(spoonCalls(t).filter((c) => !c.url.includes("/search"))).toHaveLength(1);
    // The cached search now points at the saved food (no new call)
    const again = await search("chipotle bowl");
    expect(again.body.items[0].cacheId).toBe(one.body.food.id);
    expect(s.body.items[0].cacheId).toBeNull();
    expect(spoonCalls(t)).toHaveLength(2);
    // And it can be logged like any food, snapshotting its nutrients
    const logged = await t.api("POST", "/api/log", { day: "2026-11-17", meal: "lunch", food: { kind: "cache", id: one.body.food.id }, unit: "serving", quantity: 1 });
    expect(logged.status).toBe(200);
    expect(logged.body.entry).toMatchObject({ name: "Chicken Burrito Bowl", brand: "Chipotle", nutrients: { calories: 655 } });
  });

  it("a FatSecret item is stored only when opened to log or star", async () => {
    await setRestaurantKeys(t, { fatsecret: FS });
    restaurantWeb(t, { fsSearch: () => ({ status: 200, json: { foods: { food: fsHit(101, "Chicken Burrito", "Chipotle", 1070) } } }), fsGet: () => ({ status: 200, json: { food: burrito } }) });
    await search("burrito");
    expect(await count("food_cache")).toBe(0);
    const r = await t.api("POST", "/api/restaurants/item", { source: "fatsecret", sourceId: "101" });
    expect(r.body).toMatchObject({ lookupsLeft: null, food: { kind: "cache", name: "Chicken Burrito", brand: "Chipotle", source: "fatsecret", servings: [{ label: "1 burrito", grams: 510 }], nutrients: { calories: 1070 } } });
    expect(await count("food_cache")).toBe(1);
    await t.api("POST", "/api/restaurants/item", { source: "fatsecret", sourceId: "101" });
    expect(fsCalls(t, "food.get.v2")).toHaveLength(1);
    expect((await search("burrito")).body.items[0].cacheId).toBe(r.body.food.id);
  });

  it("item failures are plain messages (quota, down, unknown source), never a 500", async () => {
    await setRestaurantKeys(t, { spoonacular: "spoon-key" });
    restaurantWeb(t, { spoonItem: () => ({ status: 402, json: {} }) });
    const q = await t.api("POST", "/api/restaurants/item", { source: "spoonacular", sourceId: "1001" });
    expect(q.status).toBe(503);
    expect(q.body.error).toBe(QUOTA_MESSAGE);
    await t.api("POST", "/api/restaurants/item", { source: "spoonacular", sourceId: "1002" });
    expect(spoonCalls(t)).toHaveLength(1); // out of points: not asked again
    const fs = await t.api("POST", "/api/restaurants/item", { source: "fatsecret", sourceId: "1" });
    expect(fs.status).toBe(400);
    expect(fs.body.error).toBe(NO_KEY_MESSAGE);
    expect((await t.api("POST", "/api/restaurants/item", { source: "spoonacular", sourceId: "../x" })).status).toBe(400);
    expect((await t.api("POST", "/api/restaurants/item", { source: "usda", sourceId: "1" })).status).toBe(400);
  });
});

describe("favourites and recent chains", () => {
  async function savedFoods() {
    await setRestaurantKeys(t, { spoonacular: "spoon-key" });
    restaurantWeb(t, {
      spoonItem: (id) =>
        id === "1" ? { status: 200, json: spoonItem(1, "Chicken Bowl", "Chipotle", 655) } : id === "2" ? { status: 200, json: spoonItem(2, "Baconator", "Wendy's", 950) } : { status: 200, json: spoonItem(3, "Steak Bowl", "Chipotle", 700) },
    });
    const ids: number[] = [];
    for (const id of ["1", "2", "3"]) ids.push((await t.api("POST", "/api/restaurants/item", { source: "spoonacular", sourceId: id })).body.food.id);
    return ids;
  }

  it("star, list grouped by chain, and unstar", async () => {
    const [bowlId, baconId, steakId] = await savedFoods();
    for (const id of [steakId, baconId, bowlId, bowlId]) expect((await t.api("POST", "/api/restaurants/favourites", { cacheId: id })).status).toBe(200);
    const list = (await t.api("GET", "/api/restaurants/favourites")).body;
    expect(list.chains.map((c: any) => [c.chain, c.foods.map((f: any) => f.name)])).toEqual([
      ["Chipotle", ["Chicken Bowl", "Steak Bowl"]],
      ["Wendy's", ["Baconator"]],
    ]);
    expect(list.chains[0].foods[0]).toMatchObject({ kind: "cache", id: bowlId, source: "spoonacular" });
    expect((await t.api("DELETE", "/api/restaurants/favourites", { cacheId: baconId })).status).toBe(200);
    expect((await t.api("GET", "/api/restaurants/favourites")).body.chains.map((c: any) => c.chain)).toEqual(["Chipotle"]);
  });

  it("only restaurant foods can be starred", async () => {
    const [cacheRow] = (await t.db.execute<{ id: number }>(sql`insert into food_cache (source, source_id, name, servings, nutrients) values ('off', '123', 'Granola', '[]', '{}') returning id`)).rows;
    expect((await t.api("POST", "/api/restaurants/favourites", { cacheId: cacheRow.id })).status).toBe(404);
    expect((await t.api("POST", "/api/restaurants/favourites", { cacheId: 999999 })).status).toBe(404);
  });

  it("recent chains come from the person's logged restaurant foods, newest first", async () => {
    const [bowlId, baconId] = await savedFoods();
    t.clock.date = new Date("2026-11-17T12:00:00Z");
    await t.api("POST", "/api/log", { day: "2026-11-17", meal: "lunch", food: { kind: "cache", id: bowlId }, unit: "serving", quantity: 1 });
    t.clock.date = new Date("2026-11-17T18:00:00Z");
    await t.api("POST", "/api/log", { day: "2026-11-17", meal: "dinner", food: { kind: "cache", id: baconId }, unit: "serving", quantity: 1 });
    expect((await t.api("GET", "/api/restaurants/recent-chains")).body).toEqual({ chains: ["Wendy's", "Chipotle"] });
  });
});

describe("restaurant fix round 1", () => {
  it("after a 402, searches already queued don't call Spoonacular", async () => {
    t.clock.date = new Date("2026-11-17T15:00:00Z");
    await setRestaurantKeys(t, { spoonacular: "spoon-key" });
    restaurantWeb(t, { spoonSearch: () => ({ status: 402, json: {} }) });
    const all = await Promise.all([search("chipotle"), search("taco bell"), search("wendys")]);
    expect(spoonCalls(t)).toHaveLength(1);
    for (const r of all) expect(r.body.errors).toEqual([{ source: "spoonacular", message: QUOTA_MESSAGE }]);
  });

  it("after a 402, item opens already queued don't call Spoonacular", async () => {
    t.clock.date = new Date("2026-11-17T15:00:00Z");
    await setRestaurantKeys(t, { spoonacular: "spoon-key" });
    restaurantWeb(t, { spoonItem: () => ({ status: 402, json: {} }) });
    const all = await Promise.all(["1", "2", "3"].map((id) => t.api("POST", "/api/restaurants/item", { source: "spoonacular", sourceId: id })));
    expect(spoonCalls(t)).toHaveLength(1);
    for (const r of all) expect(r).toMatchObject({ status: 503, body: { error: QUOTA_MESSAGE } });
  });

  it("two identical searches at once make one outside call", async () => {
    await setRestaurantKeys(t, { spoonacular: "spoon-key" });
    restaurantWeb(t, { spoonSearch: () => ({ status: 200, json: { menuItems: [bowl] }, headers: quota(40) }) });
    const [a, b] = await Promise.all([search("chipotle bowl"), search("Chipotle  bowl")]);
    expect(spoonCalls(t)).toHaveLength(1);
    expect(a.body.items).toEqual(b.body.items);
  });

  it("two opens of the same item at once make one call (both sources)", async () => {
    await setRestaurantKeys(t, { spoonacular: "spoon-key", fatsecret: FS });
    restaurantWeb(t, { spoonItem: (id) => ({ status: 200, json: spoonItem(Number(id), "Bowl", "Chipotle", 655) }), fsGet: () => ({ status: 200, json: { food: burrito } }) });
    const spoon = await Promise.all([1, 2].map(() => t.api("POST", "/api/restaurants/item", { source: "spoonacular", sourceId: "1001" })));
    const fs = await Promise.all([1, 2].map(() => t.api("POST", "/api/restaurants/item", { source: "fatsecret", sourceId: "101" })));
    expect(spoonCalls(t)).toHaveLength(1);
    expect(fsCalls(t, "food.get.v2")).toHaveLength(1);
    expect(spoon[0].body.food.id).toBe(spoon[1].body.food.id);
    expect(fs[0].body.food.id).toBe(fs[1].body.food.id);
    expect(await count("food_cache")).toBe(2);
  });

  it("search hits with a junk id are dropped", async () => {
    await setRestaurantKeys(t, { spoonacular: "spoon-key", fatsecret: FS });
    restaurantWeb(t, { spoonSearch: () => ({ status: 200, json: { menuItems: [bowl, { ...spoonItem(1, "Evil", "X", 1), id: "../../x" }] }, headers: quota(40) }) });
    const r = await search("chipotle");
    expect(r.body.items.map((i: any) => i.sourceId)).toEqual(["1001"]);
  });

  it("unstarring works with ?cacheId= and no body", async () => {
    await setRestaurantKeys(t, { spoonacular: "spoon-key" });
    restaurantWeb(t, { spoonItem: (id) => ({ status: 200, json: spoonItem(Number(id), "Bowl", "Chipotle", 655) }) });
    const id = (await t.api("POST", "/api/restaurants/item", { source: "spoonacular", sourceId: "1" })).body.food.id;
    await t.api("POST", "/api/restaurants/favourites", { cacheId: id });
    const res = await t.app.inject({ method: "DELETE", url: `/api/restaurants/favourites?cacheId=${id}`, headers: { authorization: `Bearer ${t.getToken()}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ chains: [] });
  });
});

describe("restaurant cleanup", () => {
  const day = 24 * 60 * 60 * 1000;
  async function fsRow(id: number, fetchedAt: Date) {
    const [row] = (await t.db.execute<{ id: number }>(sql`insert into food_cache (source, source_id, name, brand, servings, nutrients, fetched_at) values ('fatsecret', ${String(id)}, ${"Item " + id}, 'Chipotle', '[{"label":"1 item"}]', '{"calories":100}', ${fetchedAt.toISOString()}) returning id`)).rows;
    return row.id;
  }

  it("opening a FatSecret item past its hours fetches it again (one call), so cleanup keeps it another 24 h", async () => {
    await setRestaurantKeys(t, { fatsecret: FS });
    restaurantWeb(t, { fsGet: () => ({ status: 200, json: { food: burrito } }) });
    const now = new Date("2026-11-20T12:00:00Z");
    const id = await fsRow(101, new Date(now.getTime() - day - 60_000)); // fetched 24 h 1 m ago
    t.clock.date = now;
    const r = await t.api("POST", "/api/restaurants/item", { source: "fatsecret", sourceId: "101" });
    expect(r.body.food).toMatchObject({ id, name: "Chicken Burrito", savedAt: null });
    expect(fsCalls(t, "food.get.v2")).toHaveLength(1);
    t.clock.date = new Date(now.getTime() + 2 * 60_000);
    await cleanupLookups(t.app);
    expect(await count("food_cache")).toBe(1);
    expect((await t.api("POST", "/api/restaurants/item", { source: "fatsecret", sourceId: "101" })).status).toBe(200);
    expect(fsCalls(t, "food.get.v2")).toHaveLength(1);
  });

  it("removes old restaurant foods nobody starred, logged, used in a recipe or corrected; keeps the rest", async () => {
    const now = new Date("2026-11-20T12:00:00Z");
    const old = new Date(now.getTime() - day - 1000);
    const userId = (await t.db.execute<{ id: number }>(sql`select id from users where username = 'alex'`)).rows[0].id;
    const unused = await fsRow(1, old);
    const recent = await fsRow(2, new Date(now.getTime() - day + 60_000));
    const starred = await fsRow(3, old);
    const logged = await fsRow(4, old);
    const inRecipe = await fsRow(5, old);
    const overridden = await fsRow(6, old);
    await t.db.execute(sql`insert into food_cache (source, source_id, name, servings, nutrients, fetched_at) values ('spoonacular', '9', 'Spoon', '[]', '{}', ${old.toISOString()}), ('spoonacular', '10', 'Spoon new', '[]', '{}', ${new Date(now.getTime() - 30 * 60_000).toISOString()})`);
    await t.db.execute(sql`insert into restaurant_favourites (user_id, cache_id, chain) values (${userId}, ${starred}, 'Chipotle')`);
    await t.db.execute(sql`insert into log_entries (user_id, day, meal, name, icon, source, source_ref, unit, quantity, per_serving, servings, nutrients) values (${userId}, '2026-11-17', 'lunch', 'x', 'x', 'cache', ${"cache:" + logged}, 'serving', 1, '{}', '[]', '{}')`);
    const [recipe] = (await t.db.execute<{ id: number }>(sql`insert into user_foods (user_id, kind, name, servings, nutrients) values (${userId}, 'recipe', 'R', '[]', '{}') returning id`)).rows;
    await t.db.execute(sql`insert into recipe_items (recipe_id, position, food_kind, food_id, unit, quantity, snapshot) values (${recipe.id}, 0, 'cache', ${inRecipe}, 'serving', 1, '{}')`);
    await t.db.execute(sql`insert into user_foods (user_id, kind, name, base_cache_id, servings, nutrients) values (${userId}, 'override', 'O', ${overridden}, '[]', '{}')`);
    // searches: one stale, one fresh
    await t.db.execute(sql`insert into restaurant_searches (source, query, results, fetched_at) values ('spoonacular', 'stale', '[]', ${old.toISOString()}), ('spoonacular', 'fresh', '[]', ${now.toISOString()})`);
    t.clock.date = now;
    await cleanupLookups(t.app);
    const left = (await t.db.execute<{ id: number; source: string }>(sql`select id, source from food_cache order by id`)).rows;
    const fsLeft = left.filter((r) => r.source === "fatsecret").map((r) => r.id);
    expect(fsLeft).not.toContain(unused);
    expect(fsLeft).toEqual(expect.arrayContaining([recent, starred, logged, inRecipe, overridden]));
    expect(left.filter((r) => r.source === "spoonacular")).toHaveLength(1); // Spoonacular items: kept 1 h
    expect((await t.db.execute<{ query: string }>(sql`select query from restaurant_searches`)).rows.map((r) => r.query)).toEqual(["fresh"]);
    const log = await appLog();
    expect(log.some((l) => l.category === "schedule" && l.source === "Lookup cleanup")).toBe(true);
  });
});
