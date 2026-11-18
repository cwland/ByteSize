// §21 Food lookups: local first, the lookup order, hours per source, the FatSecret plan, saved barcodes.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { setupTestApp, TEST_SECRET, type TestApp } from "./helpers.js";
import { asUser } from "./isolation.js";
import { OFF_PRODUCT, OFF_SEARCH, USDA, offProduct, usdaFood, usdaReply } from "./foodFakes.js";
import { FS_API, fsCalls, fsFood, fsHit, restaurantWeb, setRestaurantKeys, spoonCalls, spoonItem, quota, type RestaurantWeb } from "./restaurantFakes.js";
import { cleanupLookups } from "../src/lib/lookups.js";
import { buildApp } from "../src/app.js";

let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
beforeEach(async () => {
  await t.reset();
  await t.login(); // admin "cory"
});
afterAll(async () => t.close());

const H = 60 * 60 * 1000;
const START = new Date("2026-11-18T12:00:00Z");
const FS = { id: "fs-id", secret: "fs-secret" };
const CODE = "0012345678905"; // a UPC-A as EAN-13
const count = async (table: string) => Number((await t.db.execute<{ n: string }>(sql.raw(`select count(*) as n from ${table}`))).rows[0].n);
const scan = (code = CODE) => t.api("GET", `/api/foods/barcode/${code}`);
const search = (q: string) => t.api("GET", `/api/foods/search?q=${encodeURIComponent(q)}`);
const settings = (body: unknown) => t.api("PUT", "/api/admin/food-sources", body);
const later = (ms: number) => (t.clock.date = new Date(t.clock.date!.getTime() + ms));
const offCalls = () => t.foodWeb.calls.filter((c) => c.url.startsWith(OFF_PRODUCT) || c.url.startsWith(OFF_SEARCH));
const usdaCalls = () => t.foodWeb.calls.filter((c) => c.url.startsWith("https://api.nal.usda.gov/"));
const outside = () => t.foodWeb.calls.filter((c) => !c.url.includes("oauth.fatsecret.com")); // every data call (FatSecret tokens aside)

type Web = {
  off?: Record<string, ReturnType<typeof offProduct>>;
  offSearch?: (q: string) => unknown[];
  usda?: ReturnType<typeof usdaFood>[];
  usdaById?: Record<string, unknown>;
  fs?: RestaurantWeb;
};
/** One fake web for every source: OFF by barcode and search, USDA search and by id, FatSecret and Spoonacular. */
function web(w: Web) {
  restaurantWeb(t, w.fs ?? {});
  const rest = t.foodWeb.respond;
  t.foodWeb.respond = (url, call) => {
    if (url.startsWith(OFF_PRODUCT)) {
      const code = url.slice(OFF_PRODUCT.length).split(".json")[0];
      const p = w.off?.[code];
      return p ? { status: 200, json: { code, status: 1, product: p } } : { status: 404, json: { code, status: 0 } };
    }
    if (url.startsWith(OFF_SEARCH)) return { status: 200, json: { hits: w.offSearch ? w.offSearch(new URL(url).searchParams.get("q") ?? "") : [] } };
    if (url.startsWith(USDA)) {
      const foods = w.usda ?? [];
      const q: string = call.body?.query ?? "";
      // a barcode search finds the branded food with that UPC; a text search every food whose name has the words
      const hit = /^\d+$/.test(q) ? foods.filter((f) => f.gtinUpc && q.endsWith(f.gtinUpc)) : foods.filter((f) => f.description.toLowerCase().includes(q.toLowerCase().split(" ")[0]));
      return usdaReply(call, hit);
    }
    if (url.startsWith("https://api.nal.usda.gov/fdc/v1/food/")) {
      const id = new URL(url).pathname.split("/").pop()!;
      const f = w.usdaById?.[id];
      return f ? { status: 200, json: f } : { status: 404, json: {} };
    }
    return rest(url, call);
  };
}

const granola = offProduct(CODE, "Crunchy Granola", 450);
const fsGranola = fsFood(555, "Granola Bar", "Nature Valley", [{ serving_description: "1 bar", metric_serving_amount: "21.000", metric_serving_unit: "g", calories: "90", fat: "3.00", protein: "2.00", carbohydrate: "15.00" }]);
const fsFound = (id = 555) => ({ status: 200, json: { food_id: { value: String(id) } } });

describe("lookup settings: hours per source and the FatSecret plan (admin)", () => {
  it("start with each source's terms: OFF and USDA 9999 h, FatSecret 24 h, Spoonacular 1 h; FatSecret Basic", async () => {
    const r = await t.api("GET", "/api/admin/food-sources");
    expect(r.body.off.hours).toBe(9999);
    expect(r.body.usda.hours).toBe(9999);
    expect(r.body.fatsecret).toMatchObject({ hours: 24, plan: "basic", barcodeScopeMissing: false });
    expect(r.body.spoonacular.hours).toBe(1);
  });

  it("hours save as whole hours 1–9999 without touching keys or switches", async () => {
    await setRestaurantKeys(t, { fatsecret: FS });
    await settings({ enabled: { off: false } });
    const r = await settings({ hours: { off: 1, fatsecret: 12, spoonacular: 9999 } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ off: { enabled: false, hours: 1 }, usda: { hours: 9999 }, fatsecret: { hasKey: true, enabled: true, hours: 12 }, spoonacular: { hours: 9999 } });
    for (const bad of [0, 10000, 1.5, -3, "12", null]) {
      const res = await settings({ hours: { usda: bad } });
      expect(res.status, String(bad)).toBe(400);
    }
    expect((await settings({ hours: { culury: 5 } })).status).toBe(400);
    expect((await t.api("GET", "/api/admin/food-sources")).body.usda.hours).toBe(9999);
  });

  it("the FatSecret plan is Basic or Premier", async () => {
    expect((await settings({ fatsecretPlan: "premier" })).body.fatsecret.plan).toBe("premier");
    expect((await settings({ fatsecretPlan: "gold" })).status).toBe(400);
    expect((await settings({ fatsecretPlan: "basic" })).body.fatsecret.plan).toBe("basic");
  });

  it("members can't change hours or the plan", async () => {
    const sam = await t.createUser("sam");
    const as = asUser(t, sam.token);
    expect((await as("PUT", "/api/admin/food-sources", { hours: { off: 5 } })).status).toBe(403);
    expect((await as("PUT", "/api/admin/food-sources", { fatsecretPlan: "premier" })).status).toBe(403);
    expect((await t.api("GET", "/api/admin/food-sources")).body.off.hours).toBe(9999);
  });
});

describe("barcodes: saved copy first, then Open Food Facts → FatSecret (Premier) → USDA", () => {
  beforeEach(() => {
    t.clock.date = START;
  });

  it("Open Food Facts: a repeat scan within its hours calls nothing; after them, one call", async () => {
    await settings({ hours: { off: 2 } });
    web({ off: { [CODE]: granola } });
    const first = await scan();
    expect(first.body.food).toMatchObject({ name: "Crunchy Granola", source: "off", savedAt: null });
    expect(offCalls()).toHaveLength(1);
    later(2 * H - 1000);
    const again = await scan();
    expect(offCalls()).toHaveLength(1);
    expect(again.body.food).toMatchObject({ id: first.body.food.id, savedAt: START.toISOString() });
    later(2000);
    const fresh = await scan();
    expect(offCalls()).toHaveLength(2);
    expect(fresh.body.food.savedAt).toBeNull();
  });

  it("USDA: a repeat scan within its hours calls nothing; after them, one call", async () => {
    await settings({ usdaApiKey: "usda-key", enabled: { off: false }, hours: { usda: 3 } });
    web({ usda: [usdaFood(77, "Greek yogurt", 59, "012345678905")] });
    expect((await scan()).body.food).toMatchObject({ name: "Greek yogurt", source: "usda" });
    expect(outside()).toHaveLength(1);
    later(3 * H - 1000);
    expect((await scan()).body.food.name).toBe("Greek yogurt");
    expect(outside()).toHaveLength(1);
    later(2000);
    await scan();
    expect(outside()).toHaveLength(2);
  });

  it("the order: OFF first; FatSecret (Premier) before USDA; the first hit wins", async () => {
    await setRestaurantKeys(t, { fatsecret: FS });
    await settings({ usdaApiKey: "usda-key", fatsecretPlan: "premier" });
    web({ usda: [usdaFood(77, "USDA granola", 400, "012345678905")], fs: { fsBarcode: () => fsFound(), fsGet: () => ({ status: 200, json: { food: fsGranola } }) } });
    const r = await scan();
    expect(r.body.food).toMatchObject({ name: "Granola Bar", brand: "Nature Valley", source: "fatsecret", barcode: CODE });
    const order = outside().map((c) => (c.url === FS_API ? new URLSearchParams(String(c.body)).get("method") : new URL(c.url).hostname));
    expect(order).toEqual(["world.openfoodfacts.org", "food.find_id_for_barcode", "food.get.v2"]);
    expect(new URLSearchParams(String(fsCalls(t, "food.find_id_for_barcode")[0].body)).get("barcode")).toBe(CODE);
    // FatSecret doesn't know it: USDA is next
    await t.db.execute(sql`delete from food_cache`);
    await t.db.execute(sql`delete from fatsecret_barcodes`);
    t.foodWeb.calls.length = 0;
    web({ usda: [usdaFood(77, "USDA granola", 400, "012345678905")] });
    const u = await scan();
    expect(u.body.food).toMatchObject({ name: "USDA granola", source: "usda" });
    expect(fsCalls(t, "food.find_id_for_barcode")).toHaveLength(1);
    expect(usdaCalls()).toHaveLength(1);
  });

  it("Basic never asks FatSecret about barcodes", async () => {
    await setRestaurantKeys(t, { fatsecret: FS });
    await settings({ usdaApiKey: "usda-key" });
    web({ usda: [usdaFood(77, "USDA granola", 400, "012345678905")], fs: { fsBarcode: () => fsFound() } });
    expect((await scan()).body.food.source).toBe("usda");
    expect(fsCalls(t)).toEqual([]);
  });

  it("Premier without the barcode scope: says so once, then skips FatSecret for barcodes", async () => {
    await setRestaurantKeys(t, { fatsecret: FS });
    await settings({ usdaApiKey: "usda-key", fatsecretPlan: "premier" });
    web({ usda: [usdaFood(77, "USDA granola", 400, "012345678905")], fs: { fsBarcode: () => ({ status: 200, json: { error: { code: 14, message: "Missing scope" } } }) } });
    const r = await scan();
    expect(r.body.food.source).toBe("usda"); // skipped, not an error
    expect(r.body.errors).toEqual([]);
    expect(fsCalls(t, "food.find_id_for_barcode")).toHaveLength(2); // once more with a token asking for the barcode scope
    expect((await t.api("GET", "/api/admin/food-sources")).body.fatsecret.barcodeScopeMissing).toBe(true);
    await scan("0000000000017");
    expect(fsCalls(t)).toHaveLength(2); // not asked again
    // Choosing the plan again (e.g. after adding the scope) tries again
    expect((await settings({ fatsecretPlan: "premier" })).body.fatsecret.barcodeScopeMissing).toBe(false);
  });

  it("FatSecret: the barcode → food id link is kept for good; after cleanup a re-scan is one call (food.get)", async () => {
    await setRestaurantKeys(t, { fatsecret: FS });
    await settings({ enabled: { off: false }, fatsecretPlan: "premier" });
    web({ fs: { fsBarcode: () => fsFound(), fsGet: () => ({ status: 200, json: { food: fsGranola } }) } });
    await scan();
    expect(fsCalls(t)).toHaveLength(2);
    later(24 * H - 1000);
    expect((await scan()).body.food.name).toBe("Granola Bar");
    expect(fsCalls(t)).toHaveLength(2); // within 24 h: nothing
    later(H + 2000); // past its 24 h, and an hour after it was last scanned
    await cleanupLookups(t.app);
    expect(await count("food_cache")).toBe(0);
    expect((await t.db.execute(sql`select barcode, food_id from fatsecret_barcodes`)).rows).toEqual([{ barcode: CODE, food_id: "555" }]);
    t.foodWeb.calls.length = 0;
    const again = await scan();
    expect(again.body.food).toMatchObject({ name: "Granola Bar", barcode: CODE, savedAt: null });
    expect(fsCalls(t).map((c) => new URLSearchParams(String(c.body)).get("method"))).toEqual(["food.get.v2"]);
    expect(outside()).toHaveLength(1);
  });

  it("sources switched off are skipped", async () => {
    await setRestaurantKeys(t, { fatsecret: FS });
    await settings({ usdaApiKey: "usda-key", fatsecretPlan: "premier", enabled: { off: false, fatsecret: false, usda: false } });
    web({ off: { [CODE]: granola }, fs: { fsBarcode: () => fsFound() } });
    const r = await scan();
    expect(r.body).toMatchObject({ food: null, errors: [] });
    expect(t.foodWeb.calls).toEqual([]);
  });
});

describe("typed search: kept answers per source, grouped My foods, Basic, FatSecret, USDA branded, Open Food Facts", () => {
  beforeEach(() => {
    t.clock.date = START;
  });

  const fsSearchHits = () => ({ status: 200, json: { foods: { food: [fsHit(31, "Granola Clusters", "Bear Naked", 140, "1/4 cup"), { ...fsHit(32, "Granola", null, 471, "100g") }] } } });
  async function allSources() {
    await setRestaurantKeys(t, { fatsecret: FS });
    await settings({ usdaApiKey: "usda-key" });
    web({
      offSearch: () => [offProduct("3000000000002", "Granola honey", 460)],
      usda: [usdaFood(9, "Granola, homemade", 489), usdaFood(8, "Granola crunch", 420, "036632035676")],
      fs: { fsSearch: fsSearchHits },
    });
    await t.api("POST", "/api/my-foods", { name: "Granola bowl", servings: [{ label: "1 bowl", grams: 250 }], nutrients: { calories: 300 } });
  }

  it("groups in the spec's order, FatSecret using foods.search with its nutrition summary", async () => {
    await allSources();
    const r = await search("granola");
    expect(r.body.errors).toEqual([]);
    expect(r.body.groups.map((g: any) => [g.source, g.label, g.foods.map((f: any) => f.name)])).toEqual([
      ["mine", "My foods", ["Granola bowl"]],
      ["basic", "Basic foods", ["Granola, homemade"]],
      ["fatsecret", "FatSecret", ["Granola Clusters", "Granola"]],
      ["usda", "USDA branded", ["Granola crunch"]],
      ["off", "Open Food Facts", ["Granola honey"]],
    ]);
    const [clusters, plain] = r.body.groups[2].foods;
    expect(clusters).toMatchObject({ kind: "cache", source: "fatsecret", brand: "Bear Naked", servings: [{ label: "1/4 cup" }], nutrients: { calories: 140, fat_g: 20, carbs_g: 50, protein_g: 30 }, savedAt: null });
    expect(plain.servings[0]).toMatchObject({ label: "100 g", grams: 100 });
    expect(fsCalls(t, "foods.search")).toHaveLength(1);
  });

  it("the same search again within each source's hours calls nothing; after FatSecret's 24 h only FatSecret is asked", async () => {
    await allSources();
    const first = await search("granola");
    const calls = outside().length;
    expect(calls).toBe(4); // OFF, USDA basic + branded, FatSecret
    later(23 * H);
    const again = await search("  GRANOLA ");
    expect(outside()).toHaveLength(calls);
    const names = (b: any) => b.groups.map((g: any) => [g.source, g.foods.map((f: any) => f.name)]);
    expect(names(again.body)).toEqual(names(first.body));
    expect(again.body.groups[2].foods[0].savedAt).toBe(START.toISOString());
    later(2 * H);
    await search("granola");
    expect(outside().slice(calls).map((c) => (c.url === FS_API ? "fatsecret" : c.url))).toEqual(["fatsecret"]);
  });

  it("FatSecret switched off or without a key: no FatSecret group, no call, no error", async () => {
    await allSources();
    await settings({ enabled: { fatsecret: false } });
    const r = await search("granola");
    expect(r.body.groups.map((g: any) => g.source)).not.toContain("fatsecret");
    expect(r.body.errors).toEqual([]);
    expect(fsCalls(t)).toEqual([]);
  });

  it("a FatSecret summary never replaces a full food already kept", async () => {
    await allSources();
    web({ fs: { fsSearch: fsSearchHits, fsGet: () => ({ status: 200, json: { food: fsFood(31, "Granola Clusters", "Bear Naked", [{ serving_description: "1/4 cup", metric_serving_amount: "30", metric_serving_unit: "g", calories: "140", sodium: "75" }]) } }) } });
    const item = await t.api("POST", "/api/restaurants/item", { source: "fatsecret", sourceId: "31" });
    expect(item.body.food.nutrients.sodium_mg).toBe(75);
    const r = await search("granola");
    const kept = r.body.groups.find((g: any) => g.source === "fatsecret").foods.find((f: any) => f.name === "Granola Clusters");
    expect(kept.nutrients.sodium_mg).toBe(75);
    expect(kept.servings[0]).toMatchObject({ grams: 30 });
  });
});

describe("restaurants: saved copy → FatSecret → Spoonacular, each kept for its hours", () => {
  beforeEach(() => {
    t.clock.date = START;
  });
  const rsearch = (q: string) => t.api("GET", `/api/restaurants/search?q=${encodeURIComponent(q)}`);
  const bowl = spoonItem(1001, "Chicken Burrito Bowl", "Chipotle", 655);

  it("FatSecret is asked first; Spoonacular only when FatSecret finds nothing", async () => {
    await setRestaurantKeys(t, { spoonacular: "spoon-key", fatsecret: FS });
    web({ fs: { fsSearch: () => ({ status: 200, json: { foods: { food: fsHit(7, "Baconator", "Wendy's", 950) } } }), spoonSearch: () => ({ status: 200, json: { menuItems: [bowl] }, headers: quota(40) }) } });
    const r = await rsearch("baconator");
    expect(r.body.items.map((i: any) => i.source)).toEqual(["fatsecret"]);
    expect(spoonCalls(t)).toEqual([]);
    web({ fs: { spoonSearch: () => ({ status: 200, json: { menuItems: [bowl] }, headers: quota(40) }) } });
    const s = await rsearch("chipotle bowl");
    expect(s.body.items.map((i: any) => i.source)).toEqual(["spoonacular"]);
    expect(fsCalls(t, "foods.search")).toHaveLength(2);
  });

  it("FatSecret search answers are kept 24 h; Spoonacular's 1 h by default", async () => {
    await setRestaurantKeys(t, { spoonacular: "spoon-key", fatsecret: FS });
    web({ fs: { fsSearch: (q) => (q === "baconator" ? { status: 200, json: { foods: { food: fsHit(7, "Baconator", "Wendy's", 950) } } } : { status: 200, json: { foods: {} } }), spoonSearch: () => ({ status: 200, json: { menuItems: [bowl] }, headers: quota(40) }) } });
    await rsearch("baconator");
    await rsearch("chipotle bowl");
    expect([fsCalls(t, "foods.search").length, spoonCalls(t).length]).toEqual([2, 1]);
    later(H - 1000);
    expect((await rsearch("baconator")).body.items[0].name).toBe("Baconator");
    expect((await rsearch("chipotle bowl")).body.items[0].name).toBe("Chicken Burrito Bowl");
    expect([fsCalls(t, "foods.search").length, spoonCalls(t).length]).toEqual([2, 1]);
    later(2000); // past Spoonacular's hour: FatSecret's empty answer is still kept, Spoonacular is asked again
    await rsearch("chipotle bowl");
    expect([fsCalls(t, "foods.search").length, spoonCalls(t).length]).toEqual([2, 2]);
    later(23 * H);
    await rsearch("baconator");
    expect(fsCalls(t, "foods.search")).toHaveLength(3);
  });

  it("an item opened again within its source's hours calls nothing; after them, one call", async () => {
    await setRestaurantKeys(t, { spoonacular: "spoon-key", fatsecret: FS });
    web({ fs: { spoonItem: (id) => ({ status: 200, json: spoonItem(Number(id), "Bowl", "Chipotle", 655), headers: quota(30) }), fsGet: () => ({ status: 200, json: { food: fsGranola } }) } });
    const open = (source: string, sourceId: string) => t.api("POST", "/api/restaurants/item", { source, sourceId });
    expect((await open("spoonacular", "1001")).body.food.savedAt).toBeNull();
    await open("fatsecret", "555");
    later(H - 1000);
    expect((await open("spoonacular", "1001")).body.food.savedAt).toBe(START.toISOString());
    await open("fatsecret", "555");
    expect([spoonCalls(t).length, fsCalls(t, "food.get.v2").length]).toEqual([1, 1]);
    later(2000);
    await open("spoonacular", "1001");
    await open("fatsecret", "555");
    expect([spoonCalls(t).length, fsCalls(t, "food.get.v2").length]).toEqual([2, 1]);
    later(24 * H);
    await open("fatsecret", "555");
    expect(fsCalls(t, "food.get.v2")).toHaveLength(2);
  });

  it("an item past its hours is still served from its kept copy when the source fails", async () => {
    await setRestaurantKeys(t, { fatsecret: FS });
    web({ fs: { fsGet: () => ({ status: 200, json: { food: fsGranola } }) } });
    const first = (await t.api("POST", "/api/restaurants/item", { source: "fatsecret", sourceId: "555" })).body.food;
    later(25 * H);
    t.foodWeb.down = true;
    const r = await t.api("POST", "/api/restaurants/item", { source: "fatsecret", sourceId: "555" });
    expect(r.status).toBe(200);
    expect(r.body.food).toMatchObject({ id: first.id, savedAt: START.toISOString() });
  });

  it("sources switched off are skipped", async () => {
    await setRestaurantKeys(t, { spoonacular: "spoon-key", fatsecret: FS });
    await settings({ enabled: { fatsecret: false } });
    web({ fs: { fsSearch: () => ({ status: 200, json: { foods: { food: fsHit(7, "Baconator", "Wendy's", 950) } } }), spoonSearch: () => ({ status: 200, json: { menuItems: [bowl] }, headers: quota(40) }) } });
    const r = await rsearch("baconator");
    expect(r.body.items.map((i: any) => i.source)).toEqual(["spoonacular"]);
    expect(r.body.errors).toEqual([]);
    expect(fsCalls(t)).toEqual([]);
  });
});

describe("cleanup: old kept answers go, items in use stay", () => {
  it("deletes foods and searches older than their source's hours, except foods in use", async () => {
    const now = START;
    const ago = (h: number) => new Date(now.getTime() - h * H - 1000).toISOString();
    const userId = (await t.db.execute<{ id: number }>(sql`select id from users where username = 'cory'`)).rows[0].id;
    const row = async (source: string, id: string, fetched: string) =>
      (await t.db.execute<{ id: number }>(sql`insert into food_cache (source, source_id, barcode, name, servings, nutrients, fetched_at) values (${source}, ${id}, ${id.padStart(13, "0")}, ${source + " " + id}, '[]', '{}', ${fetched}) returning id`)).rows[0].id;
    const offOld = await row("off", "1", ago(9999));
    const offNew = await row("off", "2", ago(9000));
    const usdaOld = await row("usda", "3", ago(9999));
    const fsOld = await row("fatsecret", "4", ago(24));
    const fsNew = await row("fatsecret", "5", ago(23));
    const spoonOld = await row("spoonacular", "6", ago(1));
    const spoonStarred = await row("spoonacular", "7", ago(1));
    const fsInRecipe = await row("fatsecret", "8", ago(24));
    const offOverridden = await row("off", "9", ago(9999));
    const fsLogged = await row("fatsecret", "10", ago(24));
    await t.db.execute(sql`insert into restaurant_favourites (user_id, cache_id, chain) values (${userId}, ${spoonStarred}, 'Chipotle')`);
    const [recipe] = (await t.db.execute<{ id: number }>(sql`insert into user_foods (user_id, kind, name, servings, nutrients) values (${userId}, 'recipe', 'R', '[]', '{}') returning id`)).rows;
    await t.db.execute(sql`insert into recipe_items (recipe_id, position, food_kind, food_id, unit, quantity, snapshot) values (${recipe.id}, 0, 'cache', ${fsInRecipe}, 'serving', 1, '{}')`);
    await t.db.execute(sql`insert into user_foods (user_id, kind, name, base_cache_id, servings, nutrients) values (${userId}, 'override', 'O', ${offOverridden}, '[]', '{}')`);
    await t.db.execute(sql`insert into log_entries (user_id, day, meal, name, icon, source, source_ref, unit, quantity, per_serving, servings, nutrients) values (${userId}, '2026-11-17', 'lunch', 'x', 'x', 'cache', ${"cache:" + fsLogged}, 'serving', 1, '{}', '[]', '{}')`);
    await t.db.execute(sql`insert into fatsecret_barcodes (barcode, food_id) values ('0000000000004', '4')`);
    await t.db.execute(sql`insert into food_searches (source, query, results, fetched_at) values ('off', 'old', '[]', ${ago(9999)}), ('off', 'new', '[]', ${ago(1)}), ('fatsecret', 'old', '[]', ${ago(24)}), ('usda', 'new', '[]', ${ago(24)})`);
    await t.db.execute(sql`insert into restaurant_searches (source, query, results, fetched_at) values ('spoonacular', 'old', '[]', ${ago(1)}), ('fatsecret', 'new', '[]', ${ago(23)}), ('fatsecret', 'old', '[]', ${ago(24)})`);
    t.clock.date = now;
    await cleanupLookups(t.app);
    const left = (await t.db.execute<{ id: number }>(sql`select id from food_cache order by id`)).rows.map((r) => r.id);
    expect(left).toEqual([offNew, fsNew, spoonStarred, fsInRecipe, offOverridden, fsLogged]);
    for (const gone of [offOld, usdaOld, fsOld, spoonOld]) expect(left).not.toContain(gone);
    expect((await t.db.execute(sql`select source, query from food_searches order by source, query`)).rows).toEqual([{ source: "off", query: "new" }, { source: "usda", query: "new" }]);
    expect((await t.db.execute(sql`select source, query from restaurant_searches order by source, query`)).rows).toEqual([{ source: "fatsecret", query: "new" }]);
    expect(await count("fatsecret_barcodes")).toBe(1); // kept for good
    const log = (await t.db.execute<{ category: string; source: string }>(sql`select category, source from app_log`)).rows;
    expect(log).toContainEqual({ category: "schedule", source: "Lookup cleanup" });
  });

  it("follows the hours the admin set", async () => {
    await settings({ hours: { off: 5 } });
    await t.db.execute(sql`insert into food_cache (source, source_id, name, servings, nutrients, fetched_at) values ('off', '1', 'Old', '[]', '{}', ${new Date(START.getTime() - 6 * H).toISOString()})`);
    t.clock.date = START;
    await cleanupLookups(t.app);
    expect(await count("food_cache")).toBe(0);
  });
});

describe("Check for changes: refresh one kept item from its source", () => {
  beforeEach(() => {
    t.clock.date = START;
  });
  const check = (cacheId: number, as: (m: string, u: string, b?: unknown) => Promise<{ status: number; body: any }> = t.api) => as("POST", "/api/foods/refresh", { cacheId });

  it("calls the source once and says Up to date, or Updated with the new copy", async () => {
    web({ off: { [CODE]: granola } });
    const id = (await scan()).body.food.id;
    later(H);
    const same = await check(id);
    expect(same.status).toBe(200);
    expect(same.body).toMatchObject({ result: "up_to_date", food: { id, savedAt: null } });
    expect(offCalls()).toHaveLength(2);
    web({ off: { [CODE]: offProduct(CODE, "Crunchy Granola", 470) } });
    const changed = await check(id);
    expect(changed.body).toMatchObject({ result: "updated", food: { id, nutrients: { calories: 470 } } });
    expect(offCalls()).toHaveLength(3);
    const [row] = (await t.db.execute<{ fetched_at: Date }>(sql`select fetched_at from food_cache where id = ${id}`)).rows;
    expect(new Date(row.fetched_at).toISOString()).toBe(START.toISOString().replace("12:00", "13:00"));
  });

  it("works for USDA, FatSecret (keeping the barcode) and Spoonacular items", async () => {
    await setRestaurantKeys(t, { spoonacular: "spoon-key", fatsecret: FS });
    await settings({ usdaApiKey: "usda-key", enabled: { off: false } });
    web({
      usda: [usdaFood(77, "Greek yogurt", 59, "012345678905")],
      usdaById: { "77": { ...usdaFood(77, "Greek yogurt", 61, "012345678905") } },
      fs: { fsGet: () => ({ status: 200, json: { food: fsGranola } }), spoonItem: (id) => ({ status: 200, json: spoonItem(Number(id), "Bowl", "Chipotle", 655) }) },
    });
    const yogurt = (await scan()).body.food;
    expect(yogurt.source).toBe("usda");
    expect((await check(yogurt.id)).body).toMatchObject({ result: "updated", food: { nutrients: { calories: 61 } } });
    expect(usdaCalls().at(-1)!.url).toContain("/fdc/v1/food/77");
    const fsRow = (await t.api("POST", "/api/restaurants/item", { source: "fatsecret", sourceId: "555" })).body.food;
    await t.db.execute(sql`update food_cache set barcode = ${CODE.replace("5", "6")} where id = ${fsRow.id}`);
    const fsr = await check(fsRow.id);
    expect(fsr.body.result).toBe("up_to_date");
    expect(fsr.body.food.barcode).toBe(CODE.replace("5", "6"));
    const bowl = (await t.api("POST", "/api/restaurants/item", { source: "spoonacular", sourceId: "1001" })).body.food;
    later(H + 1000); // Spoonacular's copy is checked only after its hours
    expect((await check(bowl.id)).body.result).toBe("up_to_date");
  });

  it("any signed-in person may check; a source switched off says so; unknown or own foods are 404", async () => {
    web({ off: { [CODE]: granola } });
    const id = (await scan()).body.food.id;
    const sam = await t.createUser("sam");
    const as = asUser(t, sam.token);
    expect((await check(id, as)).body.result).toBe("up_to_date");
    await settings({ enabled: { off: false } });
    const off = await check(id, as);
    expect(off.status).toBe(400);
    expect(off.body.error).toMatch(/Turn on Open Food Facts/);
    expect((await check(999999, as)).status).toBe(404);
    t.setToken("");
    expect((await check(id)).status).toBe(401);
  });

  it("is rate-limited per person", async () => {
    web({ off: { [CODE]: granola } });
    const id = (await scan()).body.food.id;
    const sam = await t.createUser("sam");
    const app2 = buildApp({ db: t.db, jwtSecret: TEST_SECRET, rateLimit: { max: 100, windowMs: 60_000 }, dataDir: t.app.dataDir, foodFetch: t.app.foodFetch });
    await app2.ready();
    const post = (token: string) => app2.inject({ method: "POST", url: "/api/foods/refresh", payload: { cacheId: id }, headers: { authorization: `Bearer ${token}` } });
    try {
      for (let i = 0; i < 10; i++) expect((await post(t.getToken())).statusCode).toBe(200);
      expect((await post(t.getToken())).statusCode).toBe(429);
      expect((await post(sam.token)).statusCode).toBe(200);
    } finally {
      await app2.close();
    }
  });
});

describe("Saved barcodes (admin)", () => {
  const list = (qs = "") => t.api("GET", `/api/admin/saved-barcodes${qs}`);
  async function many(n: number) {
    for (let i = 0; i < n; i++) {
      const code = String(4000000000000 + i * 10);
      await t.db.execute(sql`insert into food_cache (source, source_id, barcode, name, brand, servings, nutrients, fetched_at) values ('off', ${code}, ${code}, ${"Snack " + i}, 'Acme', '[]', '{}', ${new Date(START.getTime() - i * 60_000).toISOString()})`);
    }
  }

  it("lists every kept barcode with its source, saved time and when it goes (or kept — in use), 50 a page", async () => {
    t.clock.date = START;
    await many(55);
    await t.db.execute(sql`insert into food_cache (source, source_id, name, servings, nutrients) values ('spoonacular', '9', 'No barcode', '[]', '{}')`);
    const first = await list();
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ total: 55, page: 1, pageSize: 50 });
    expect(first.body.items).toHaveLength(50);
    expect(first.body.items[0]).toEqual({
      cacheId: expect.any(Number),
      barcode: "4000000000000",
      name: "Snack 0",
      brand: "Acme",
      source: "off",
      savedAt: START.toISOString(),
      deletesAt: new Date(START.getTime() + 9999 * H).toISOString(),
      inUse: false,
    });
    expect((await list("?page=2")).body.items.map((i: any) => i.name)).toEqual(["Snack 50", "Snack 51", "Snack 52", "Snack 53", "Snack 54"]);
    expect((await list("?q=snack%2053")).body).toMatchObject({ total: 1, items: [{ name: "Snack 53" }] });
    expect((await list("?q=4000000000530")).body).toMatchObject({ total: 1, items: [{ name: "Snack 53" }] });
    // In use: an override based on it
    const userId = (await t.db.execute<{ id: number }>(sql`select id from users where username = 'cory'`)).rows[0].id;
    await t.db.execute(sql`insert into user_foods (user_id, kind, name, base_cache_id, servings, nutrients) values (${userId}, 'override', 'O', ${first.body.items[0].cacheId}, '[]', '{}')`);
    expect((await list("?q=snack%200")).body.items[0]).toMatchObject({ inUse: true, deletesAt: null });
  });

  it("refresh and delete one; delete all not in use; in-use rows stay", async () => {
    t.clock.date = START;
    web({ off: { [CODE]: offProduct(CODE, "Crunchy Granola v2", 455) } });
    await many(3);
    await t.db.execute(sql`insert into food_cache (source, source_id, barcode, name, servings, nutrients) values ('off', ${CODE}, ${CODE}, 'Crunchy Granola', '[]', '{}')`);
    const items = (await list()).body.items;
    const granolaRow = items.find((i: any) => i.barcode === CODE);
    const r = await t.api("POST", `/api/admin/saved-barcodes/${granolaRow.cacheId}/refresh`);
    expect(r.body).toMatchObject({ result: "updated", food: { name: "Crunchy Granola v2" } });
    const snack0 = items.find((i: any) => i.name === "Snack 0");
    expect((await t.api("DELETE", `/api/admin/saved-barcodes/${snack0.cacheId}`)).status).toBe(200);
    expect((await list()).body.total).toBe(3);
    const userId = (await t.db.execute<{ id: number }>(sql`select id from users where username = 'cory'`)).rows[0].id;
    const snack1 = items.find((i: any) => i.name === "Snack 1");
    await t.db.execute(sql`insert into user_foods (user_id, kind, name, base_cache_id, servings, nutrients) values (${userId}, 'override', 'O', ${snack1.cacheId}, '[]', '{}')`);
    expect((await t.api("DELETE", `/api/admin/saved-barcodes/${snack1.cacheId}`)).status).toBe(409);
    const all = await t.api("POST", "/api/admin/saved-barcodes/delete-unused");
    expect(all.body).toEqual({ deleted: 2 });
    expect((await list()).body.items.map((i: any) => i.name)).toEqual(["Snack 1"]);
    expect((await t.api("DELETE", "/api/admin/saved-barcodes/999999")).status).toBe(404);
  });

  it("is admin-only", async () => {
    await many(1);
    const id = (await list()).body.items[0].cacheId;
    const sam = await t.createUser("sam");
    const as = asUser(t, sam.token);
    expect((await as("GET", "/api/admin/saved-barcodes")).status).toBe(403);
    expect((await as("POST", `/api/admin/saved-barcodes/${id}/refresh`)).status).toBe(403);
    expect((await as("DELETE", `/api/admin/saved-barcodes/${id}`)).status).toBe(403);
    expect((await as("POST", "/api/admin/saved-barcodes/delete-unused")).status).toBe(403);
    expect(await count("food_cache")).toBe(1);
  });

  it("kept foods are shared: a member sees the same saved copy the admin scanned", async () => {
    t.clock.date = START;
    web({ off: { [CODE]: granola } });
    const admin = (await scan()).body.food;
    const sam = await t.createUser("sam");
    const mine = (await asUser(t, sam.token)("GET", `/api/foods/barcode/${CODE}`)).body.food;
    expect(mine).toMatchObject({ id: admin.id, savedAt: START.toISOString() });
    expect(offCalls()).toHaveLength(1);
  });
});

describe("fix round 1", () => {
  beforeEach(() => {
    t.clock.date = START;
  });
  const fsFull = fsFood(31, "Granola Clusters", "Bear Naked", [{ serving_description: "1/4 cup", metric_serving_amount: "30.000", metric_serving_unit: "g", calories: "140", fat: "6.00", carbohydrate: "20.00", protein: "3.00", fiber: "2.0" }]);
  const fsSearchOne = () => ({ status: 200, json: { foods: { food: [fsHit(31, "Granola Clusters", "Bear Naked", 140, "1/4 cup")] } } });
  const logIt = (id: number) => t.api("POST", "/api/log", { day: "2026-11-18", meal: "snacks", food: { kind: "cache", id }, unit: "serving", quantity: 1 });

  it("an item opened near the end of its hours isn't cleaned up before it is tracked", async () => {
    await setRestaurantKeys(t, { spoonacular: "spoon-key" });
    web({ fs: { spoonItem: (id) => ({ status: 200, json: spoonItem(Number(id), "Bowl", "Chipotle", 655), headers: quota(30) }) } });
    const open = (sourceId = "1001") => t.api("POST", "/api/restaurants/item", { source: "spoonacular", sourceId });
    const id = (await open()).body.food.id;
    const other = (await open("1002")).body.food.id; // opened once, never again
    later(59 * 60_000);
    const again = await open();
    expect(again.body.food.savedAt).toBe(START.toISOString()); // "Saved copy from" still reads the fetch time
    later(2 * 60_000);
    await cleanupLookups(t.app);
    const left = (await t.db.execute<{ id: number }>(sql`select id from food_cache`)).rows.map((r) => r.id);
    expect(left).toEqual([id]); // the other went an hour after its last use
    expect(left).not.toContain(other);
    expect((await logIt(id)).status).toBe(200);
  });

  it("a kept food found by search or barcode counts as used too", async () => {
    web({ off: { [CODE]: granola } });
    const id = (await scan()).body.food.id;
    later(10000 * H);
    await settings({ enabled: { off: false } }); // the kept copy is old: served as it is, and used now
    expect((await scan()).body.food.id).toBe(id);
    await cleanupLookups(t.app);
    expect(await count("food_cache")).toBe(1);
  });

  it("a FatSecret search row is fetched whole when tracked (quick add) or opened", async () => {
    await setRestaurantKeys(t, { fatsecret: FS });
    web({ fs: { fsSearch: fsSearchOne, fsGet: () => ({ status: 200, json: { food: fsFull } }) } });
    const row = (await search("granola")).body.groups.find((g: any) => g.source === "fatsecret").foods[0];
    expect(row.nutrients.fiber_g).toBeUndefined();
    const logged = await logIt(row.id);
    expect(logged.status).toBe(200);
    expect(logged.body.entry.nutrients).toMatchObject({ calories: 140, fiber_g: 2 });
    expect(logged.body.entry.servings[0]).toMatchObject({ label: "1/4 cup", grams: 30 });
    expect(fsCalls(t, "food.get.v2")).toHaveLength(1);
    const opened = await t.api("GET", `/api/foods/cache/${row.id}`);
    expect(opened.body.food).toMatchObject({ id: row.id, nutrients: { fiber_g: 2 } });
    expect(fsCalls(t, "food.get.v2")).toHaveLength(1); // already whole
  });

  it("opening a FatSecret search row fetches it whole (one call), marked as a summary until then", async () => {
    await setRestaurantKeys(t, { fatsecret: FS });
    web({ fs: { fsSearch: fsSearchOne, fsGet: () => ({ status: 200, json: { food: fsFull } }) } });
    const row = (await search("granola")).body.groups.find((g: any) => g.source === "fatsecret").foods[0];
    expect(row.summary).toBe(true);
    const opened = await t.api("GET", `/api/foods/cache/${row.id}`);
    expect(opened.body.food).toMatchObject({ id: row.id, summary: false, nutrients: { fiber_g: 2 }, servings: [{ grams: 30 }], savedAt: null });
    expect((await t.api("GET", "/api/foods/cache/999999")).status).toBe(404);
  });

  it("barcodes go to FatSecret as 13 digits; longer codes are skipped", async () => {
    await setRestaurantKeys(t, { fatsecret: FS });
    await settings({ enabled: { off: false }, fatsecretPlan: "premier" });
    web({ fs: { fsBarcode: () => ({ status: 200, json: { food_id: { value: "0" } } }) } });
    await scan("96385074"); // EAN-8
    expect(new URLSearchParams(String(fsCalls(t, "food.find_id_for_barcode")[0].body)).get("barcode")).toBe("0000096385074");
    await scan("12345678901231"); // a GTIN-14 case code
    expect(fsCalls(t, "food.find_id_for_barcode")).toHaveLength(1);
  });

  it("FatSecret error 14 outside barcodes is a plain source error", async () => {
    await setRestaurantKeys(t, { fatsecret: FS });
    web({ fs: { fsSearch: () => ({ status: 200, json: { error: { code: 14, message: "Missing scope" } } }) } });
    const r = await search("granola");
    const err = r.body.errors.find((e: any) => e.source === "fatsecret");
    expect(err.message).toBe("FatSecret answered with an error (code 14)");
    expect((await t.api("GET", "/api/admin/food-sources")).body.fatsecret.barcodeScopeMissing).toBe(false);
  });

  it("a missing scope on a barcode asks once for a token with the barcode scope and tries again", async () => {
    await setRestaurantKeys(t, { fatsecret: FS });
    await settings({ enabled: { off: false }, fatsecretPlan: "premier" });
    web({
      fs: {
        fsToken: (call) => ({ status: 200, json: { access_token: String(call.body).includes("scope=") ? "scoped" : "plain", expires_in: 86400 } }),
        fsBarcode: (_code, call) => (call.headers.authorization === "Bearer scoped" ? fsFound() : { status: 200, json: { error: { code: 14, message: "Missing scope" } } }),
        fsGet: () => ({ status: 200, json: { food: fsGranola } }),
      },
    });
    const r = await scan();
    expect(r.body.food).toMatchObject({ name: "Granola Bar", source: "fatsecret" });
    const scoped = t.foodWeb.calls.filter((c) => c.url.includes("oauth.fatsecret.com") && String(c.body).includes("scope="));
    expect(scoped).toHaveLength(1);
    expect(new URLSearchParams(String(scoped[0].body)).get("scope")).toBe("basic premier barcode");
    expect((await t.api("GET", "/api/admin/food-sources")).body.fatsecret.barcodeScopeMissing).toBe(false);
  });

  it("a typed search is capped at 100 characters, for the kept answer and the outside call", async () => {
    web({ offSearch: () => [] });
    const long = "granola ".repeat(25).trim(); // 199 characters
    expect((await search(long)).status).toBe(200);
    const q = new URL(t.foodWeb.calls.find((c) => c.url.startsWith(OFF_SEARCH))!.url).searchParams.get("q")!;
    expect(q.length).toBe(100);
    const [kept] = (await t.db.execute<{ query: string }>(sql`select query from food_searches`)).rows;
    expect(kept.query.length).toBe(100);
  });

  it("Check for changes on a Spoonacular item waits for its hours (members can't spend the points)", async () => {
    await setRestaurantKeys(t, { spoonacular: "spoon-key" });
    web({ fs: { spoonItem: (id) => ({ status: 200, json: spoonItem(Number(id), "Bowl", "Chipotle", 655), headers: quota(30) }) } });
    const id = (await t.api("POST", "/api/restaurants/item", { source: "spoonacular", sourceId: "1001" })).body.food.id;
    later(30 * 60_000);
    const early = await t.api("POST", "/api/foods/refresh", { cacheId: id });
    expect(early.status).toBe(409);
    expect(early.body.error).toMatch(/^This copy is already up to date — Spoonacular lets ByteSize check again after /);
    expect(spoonCalls(t)).toHaveLength(1);
    later(31 * 60_000);
    expect((await t.api("POST", "/api/foods/refresh", { cacheId: id })).body.result).toBe("up_to_date");
    expect(spoonCalls(t)).toHaveLength(2);
  });

  it("every column a backup counts as using a kept food is also in use for the cleanup", async () => {
    const { CACHE_REFERENCES } = await import("../src/lib/backup.js");
    const { IN_USE_REFS } = await import("../src/lib/lookups.js");
    for (const ref of CACHE_REFERENCES) expect(IN_USE_REFS, ref).toContain(ref);
  });
});

describe("fix round 2: the scoped barcode token", () => {
  beforeEach(() => {
    t.clock.date = START;
  });
  const tokenCallsOf = () => t.foodWeb.calls.filter((c) => c.url.includes("oauth.fatsecret.com"));
  const scopeOf = (c: { body: any }) => new URLSearchParams(String(c.body)).get("scope");
  const flag = async () => (await t.api("GET", "/api/admin/food-sources")).body.fatsecret.barcodeScopeMissing;
  /** Plain tokens lack the barcode scope (14); scoped tokens are numbered; expired: the scoped tokens FatSecret now calls expired (13). */
  async function premier(expired: Set<string> = new Set()) {
    await setRestaurantKeys(t, { fatsecret: FS });
    await settings({ enabled: { off: false }, fatsecretPlan: "premier" });
    let n = 0;
    web({
      fs: {
        fsToken: (call) => ({ status: 200, json: { access_token: scopeOf(call) ? `scoped-${++n}` : "plain", expires_in: 86400 } }),
        fsBarcode: (_code, call) => {
          const bearer = call.headers.authorization.slice(7);
          if (bearer === "plain") return { status: 200, json: { error: { code: 14, message: "Missing scope" } } };
          if (expired.has(bearer)) return { status: 200, json: { error: { code: 13, message: "Invalid access token" } } };
          return fsFound();
        },
        fsGet: () => ({ status: 200, json: { food: fsGranola } }),
      },
    });
  }

  it("a scoped token already kept is used directly: no new token, no plain try", async () => {
    await premier();
    await scan();
    const tokens = tokenCallsOf().length;
    const finds = fsCalls(t, "food.find_id_for_barcode").length;
    expect((await scan("0000000000017")).body.food.source).toBe("fatsecret");
    expect(tokenCallsOf()).toHaveLength(tokens);
    expect(fsCalls(t, "food.find_id_for_barcode")).toHaveLength(finds + 1);
    expect(fsCalls(t, "food.find_id_for_barcode").at(-1)!.headers.authorization).toBe("Bearer scoped-1");
  });

  it("a kept scoped token FatSecret calls expired (13) is renewed once WITH the barcode scope", async () => {
    const expired = new Set<string>();
    await premier(expired);
    await scan();
    expired.add("scoped-1");
    const r = await scan("0000000000017");
    expect(r.body.food).toMatchObject({ source: "fatsecret" });
    const renewal = tokenCallsOf().at(-1)!;
    expect(scopeOf(renewal)).toBe("basic premier barcode");
    expect(await flag()).toBe(false);
  });

  it("a scoped token past its life is asked for again with the barcode scope", async () => {
    await premier();
    await scan();
    later(25 * H);
    const finds = fsCalls(t, "food.find_id_for_barcode").length;
    expect((await scan("0000000000017")).body.food.source).toBe("fatsecret");
    // the barcode call: one try, with the scoped token renewed with its scope (the plain one renews for food.get)
    expect(fsCalls(t, "food.find_id_for_barcode").slice(finds).map((c) => c.headers.authorization)).toEqual(["Bearer scoped-2"]);
    expect(tokenCallsOf().filter((c) => scopeOf(c)).map(scopeOf)).toEqual(["basic premier barcode", "basic premier barcode"]);
    expect(await flag()).toBe(false);
  });

  it("a scoped token request that fails (down) is an ordinary failure, not a missing scope", async () => {
    await setRestaurantKeys(t, { fatsecret: FS });
    await settings({ enabled: { off: false }, fatsecretPlan: "premier" });
    web({
      fs: {
        fsToken: (call) => (scopeOf(call) ? { status: 503, json: {} } : { status: 200, json: { access_token: "plain", expires_in: 86400 } }),
        fsBarcode: () => ({ status: 200, json: { error: { code: 14, message: "Missing scope" } } }),
      },
    });
    const r = await scan();
    expect(r.body.errors).toEqual([{ source: "fatsecret", message: "FatSecret answered with an error (503)" }]);
    expect(await flag()).toBe(false);
  });

  it("a scoped token FatSecret refuses (400) means no barcode access: the flag", async () => {
    await setRestaurantKeys(t, { fatsecret: FS });
    await settings({ enabled: { off: false }, fatsecretPlan: "premier" });
    web({
      fs: {
        fsToken: (call) => (scopeOf(call) ? { status: 400, json: { error: "invalid_scope" } } : { status: 200, json: { access_token: "plain", expires_in: 86400 } }),
        fsBarcode: () => ({ status: 200, json: { error: { code: 14, message: "Missing scope" } } }),
      },
    });
    const r = await scan();
    expect(r.body.errors).toEqual([]);
    expect(await flag()).toBe(true);
  });

  it("tracking a FatSecret summary that can't be fetched whole logs why, without secrets", async () => {
    await setRestaurantKeys(t, { fatsecret: FS });
    web({ fs: { fsSearch: () => ({ status: 200, json: { foods: { food: [fsHit(31, "Granola Clusters", "Bear Naked", 140, "1/4 cup")] } } }), fsGet: () => ({ status: 500, json: {} }) } });
    const row = (await search("granola")).body.groups.find((g: any) => g.source === "fatsecret").foods[0];
    const logged = await t.api("POST", "/api/log", { day: "2026-11-18", meal: "snacks", food: { kind: "cache", id: row.id }, unit: "serving", quantity: 1 });
    expect(logged.status).toBe(200);
    expect(logged.body.entry.nutrients).toMatchObject({ calories: 140 });
    const log = (await t.db.execute<{ category: string; source: string; event: string; detail: string }>(sql`select category, source, event, detail from app_log`)).rows;
    const line = log.find((l) => l.event === "FatSecret whole food fetch failed");
    expect(line).toMatchObject({ category: "food", source: "FatSecret" });
    expect(line!.detail).toMatch(/error \(500\)/);
    expect(JSON.stringify(log)).not.toMatch(/fs-secret|fs-id/);
  });
});
