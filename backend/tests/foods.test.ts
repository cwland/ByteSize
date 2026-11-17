import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { setupTestApp, type TestApp } from "./helpers.js";
import { never, OFF_PRODUCT, OFF_SEARCH, offKnows, offProduct, USDA, usdaFood, usdaReply } from "./foodFakes.js";
import { cacheUpsert } from "../src/lib/foods.js";

let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
beforeEach(async () => {
  await t.reset();
  await t.login(); // admin "cory"
});
afterAll(async () => t.close());

const BAR = "0012345678905"; // EAN-13 form of UPC-A 012345678905
const barcode = (code: string) => t.api("GET", `/api/foods/barcode/${encodeURIComponent(code)}`);
const search = (q: string) => t.api("GET", `/api/foods/search?q=${encodeURIComponent(q)}`);
const foodLogs = async () => (await t.db.execute<{ user_id: number; event: string; source: string }>(sql`select user_id, event, source from app_log where category = 'food' order by id`)).rows;

describe("barcode lookup", () => {
  it("barcode: my override beats the cache, the cache beats the web", async () => {
    offKnows(t, { [BAR]: offProduct(BAR, "Crunchy bar", 400) });
    const first = await barcode("012345678905");
    expect(first.status).toBe(200);
    expect(first.body.code).toBe(BAR);
    expect(first.body.food).toMatchObject({
      kind: "cache",
      name: "Crunchy bar",
      brand: "Acme",
      barcode: BAR,
      source: "off",
      override: false,
      aiFields: [],
      icon: "🍿",
      servings: [{ label: "100 g", grams: 100 }, { label: "40 g", grams: 40 }],
      nutrients: { calories: 400, protein_g: 10, carbs_g: 50, fat_g: 20 },
    });
    expect(t.foodWeb.calls.map((c) => c.url.startsWith(OFF_PRODUCT + BAR))).toEqual([true]);

    // The web now says something else, but the cache answers first
    offKnows(t, { [BAR]: offProduct(BAR, "Crunchy bar NEW", 999) });
    expect((await barcode(BAR)).body.food).toMatchObject({ kind: "cache", id: first.body.food.id, name: "Crunchy bar" });

    // My correction wins over the cache
    const f = first.body.food;
    // The web app sends exactly these fields (blank brand as null, the whole nutrient set)
    const o = await t.api("POST", "/api/my-foods/override", { cacheId: f.id, name: f.name, brand: f.brand, servings: f.servings, nutrients: { ...f.nutrients, calories: 420 } });
    expect(o.status).toBe(200);
    expect(o.body.food).toMatchObject({ kind: "user_food", override: true, barcode: BAR, name: "Crunchy bar", source: "mine", nutrients: { calories: 420, protein_g: 10, carbs_g: 50, fat_g: 20 } });
    const after = await barcode(BAR);
    expect(after.body.food).toMatchObject({ kind: "user_food", id: o.body.food.id, override: true, nutrients: { calories: 420 } });
  });

  it("barcode variants hit the same food and override", async () => {
    offKnows(t, { [BAR]: offProduct(BAR, "Crunchy bar", 400) });
    const variants = ["012345678905", "0012345678905", "0 12345 67890 5", "0-12345-67890-5", "00012345678905"];
    const cacheIds = new Set<number>();
    for (const v of variants) {
      const r = await barcode(v);
      expect(r.body.code).toBe(BAR);
      cacheIds.add(r.body.food.id);
    }
    expect(cacheIds.size).toBe(1);
    expect(t.foodWeb.calls).toHaveLength(1); // one web lookup, then the cache

    const o = await t.api("POST", "/api/my-foods/override", { cacheId: [...cacheIds][0], name: "My crunchy bar" });
    for (const v of variants) expect((await barcode(v)).body.food).toMatchObject({ kind: "user_food", id: o.body.food.id, name: "My crunchy bar" });
    // Typing the code into search finds it too
    const s = await search("0 12345 67890 5");
    expect(s.body.groups).toEqual([{ source: "mine", label: "My foods", foods: [expect.objectContaining({ id: o.body.food.id })] }]);
    // A second correction of the same food updates the first (never a conflict)
    const again = await t.api("POST", "/api/my-foods/override", { cacheId: [...cacheIds][0], name: "My crunchy bar", brand: null, servings: [{ label: "1 bar", grams: 40 }], nutrients: { calories: 380 } });
    expect(again.status).toBe(200);
    expect(again.body.food).toMatchObject({ id: o.body.food.id, brand: null, nutrients: { calories: 380 } });
    expect(again.body.food.nutrients).toEqual({ calories: 380 }); // the whole set replaces the old one
    // ...and a custom food can't take that barcode in any spelling
    const dup = await t.api("POST", "/api/my-foods", { name: "Bar", barcode: "0-12345-67890-5", servings: [{ label: "1 bar", grams: 40 }], nutrients: { calories: 1 } });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe("You already have a food with this barcode");
  });

  it("unknown barcode returns null without errors", async () => {
    offKnows(t, {});
    const r = await barcode("4006381333931");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ code: "4006381333931", food: null, errors: [] });
    expect(t.foodWeb.calls.map((c) => c.url.startsWith(OFF_PRODUCT))).toEqual([true]); // no USDA key: OFF only
    expect(await foodLogs()).toEqual([]);
    const bad = await barcode("12ab");
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("That doesn't look like a barcode");
  });

  it("a barcode that couldn't be checked says so instead of 'not found'", async () => {
    t.foodWeb.down = true;
    const r = await barcode("4006381333931");
    expect(r.status).toBe(200);
    expect(r.body.food).toBeNull();
    expect(r.body.errors).toEqual([{ source: "off", message: expect.stringMatching(/Open Food Facts/) }]);
  });

  it("falls through to USDA when it has a key", async () => {
    await t.api("PUT", "/api/admin/food-sources", { usdaApiKey: "usda-key" });
    offKnows(t, {});
    const offWeb = t.foodWeb.respond;
    t.foodWeb.respond = (url, init) => (url.startsWith(USDA) ? { status: 200, json: { foods: [usdaFood(77, "GREEK YOGURT", 53, "012345678905")] } } : offWeb(url, init));
    const r = await barcode(BAR);
    expect(r.body.food).toMatchObject({ kind: "cache", source: "usda", name: "GREEK YOGURT", barcode: BAR });
  });

  it("fresh cache doesn't call the web again", async () => {
    offKnows(t, { [BAR]: offProduct(BAR, "Crunchy bar", 400) });
    await barcode(BAR);
    await barcode(BAR);
    await barcode("012345678905");
    expect(t.foodWeb.calls).toHaveLength(1);
    // A month later it's looked up again (and refreshed)
    await t.db.execute(sql`update food_cache set fetched_at = now() - interval '31 days'`);
    offKnows(t, { [BAR]: offProduct(BAR, "Crunchy bar v2", 410) });
    const r = await barcode(BAR);
    expect(t.foodWeb.calls).toHaveLength(2);
    expect(r.body.food).toMatchObject({ name: "Crunchy bar v2", nutrients: { calories: 410 } });
    expect((await t.db.execute(sql`select count(*)::int as n from food_cache`)).rows[0]).toEqual({ n: 1 });
  });

  it("a stale cached food is still used when the web is down", async () => {
    offKnows(t, { [BAR]: offProduct(BAR, "Crunchy bar", 400) });
    const first = await barcode(BAR);
    await t.db.execute(sql`update food_cache set fetched_at = now() - interval '31 days'`);
    t.foodWeb.down = true;
    const r = await barcode(BAR);
    expect(r.status).toBe(200);
    expect(r.body.food).toMatchObject({ id: first.body.food.id, name: "Crunchy bar" });
  });
});

describe("search", () => {
  const custom = (name: string, extra: object = {}) =>
    t.api("POST", "/api/my-foods", { name, servings: [{ label: "1 bowl", grams: 250 }], nutrients: { calories: 300, protein_g: 20 }, ...extra });

  it("search returns my foods first, then basic foods, cache, OFF and USDA (branded)", async () => {
    await t.api("PUT", "/api/admin/food-sources", { usdaApiKey: "usda-key" });
    const mine = await custom("Greek yogurt bowl");
    // Something already in the cache (looked up by barcode earlier)
    offKnows(t, { "3000000000001": offProduct("3000000000001", "Greek yogurt plain", 60) });
    const cached = await barcode("3000000000001");
    t.foodWeb.calls.length = 0;
    t.foodWeb.respond = (url, call) => {
      if (url.startsWith(OFF_SEARCH)) return { status: 200, json: { hits: [offProduct("3000000000002", "Greek yogurt honey", 110), offProduct("3000000000003", "", 50)] } };
      if (url.startsWith(USDA)) return usdaReply(call, [usdaFood(99, "Yogurt, Greek, plain, nonfat", 59), usdaFood(98, "Greek yogurt, vanilla", 90, "036632035676")]);
      return { status: 404, json: {} };
    };
    const r = await search("  greek yogurt ");
    expect(r.status).toBe(200);
    expect(r.body.errors).toEqual([]);
    expect(r.body.groups.map((g: any) => [g.source, g.label, g.foods.map((f: any) => f.name)])).toEqual([
      ["mine", "My foods", ["Greek yogurt bowl"]],
      ["basic", "Basic foods", ["Yogurt, Greek, plain, nonfat"]],
      ["cache", "Saved foods", ["Greek yogurt plain"]],
      ["off", "Open Food Facts", ["Greek yogurt honey"]],
      ["usda", "USDA", ["Greek yogurt, vanilla"]],
    ]);
    const [m, basic, c, off, usda] = r.body.groups;
    expect(m.foods[0]).toMatchObject({ kind: "user_food", id: mine.body.food.id, source: "mine" });
    expect(basic.foods[0]).toMatchObject({ kind: "cache", source: "usda", id: expect.any(Number), icon: "🥛" });
    expect(c.foods[0]).toMatchObject({ kind: "cache", id: cached.body.food.id, source: "off" });
    expect(off.foods[0]).toMatchObject({ kind: "cache", source: "off", id: expect.any(Number) });
    expect(usda.foods[0]).toMatchObject({ kind: "cache", source: "usda", id: expect.any(Number), icon: "🥛" });
    expect(t.foodWeb.calls.find((c) => c.url.startsWith(OFF_SEARCH))!.url).toContain("q=greek%20yogurt");
    expect(t.foodWeb.calls.filter((c) => c.url.startsWith(USDA)).map((c) => [c.body.query, c.body.dataType])).toEqual([
      ["greek yogurt", ["Foundation", "SR Legacy"]],
      ["greek yogurt", ["Branded"]],
    ]);
    // What the sources found is now saved, so it can be logged by id
    expect((await t.db.execute(sql`select count(*)::int as n from food_cache`)).rows[0]).toEqual({ n: 4 });
    // Searching again shows them once, under Saved foods
    const again = await search("greek yogurt");
    const names = again.body.groups.flatMap((g: any) => g.foods.map((f: any) => f.name));
    expect(names.filter((n: string) => n === "Greek yogurt honey")).toHaveLength(1);
  });

  it("a hanging OFF and a failing USDA still return local results with errors", async () => {
    await t.api("PUT", "/api/admin/food-sources", { usdaApiKey: "usda-key" });
    await custom("Greek yogurt bowl");
    t.foodWeb.respond = (url) => (url.startsWith(OFF_SEARCH) ? never() : { status: 500, json: { error: "boom" } });
    const started = Date.now();
    const r = await search("greek yogurt");
    const elapsed = Date.now() - started;
    expect(r.status).toBe(200);
    expect(elapsed).toBeLessThan(3800);
    expect(r.body.groups.map((g: any) => g.source)).toEqual(["mine"]);
    expect(r.body.errors).toEqual([
      { source: "off", message: "Open Food Facts took too long to answer" },
      { source: "usda", message: "USDA answered with an error (500)" },
    ]);
    const [me] = (await t.db.execute<{ id: number }>(sql`select id from users where username = 'cory'`)).rows;
    const logs = await foodLogs();
    expect(logs).toHaveLength(2);
    expect(logs.every((l) => l.user_id === me.id)).toBe(true);
  }, 10000);

  it("no USDA key: no USDA group and no error", async () => {
    await custom("Greek yogurt bowl");
    t.foodWeb.respond = (url) => (url.startsWith(OFF_SEARCH) ? { status: 200, json: { hits: [offProduct("3000000000002", "Greek yogurt honey", 110)] } } : { status: 500, json: {} });
    const r = await search("greek yogurt");
    expect(r.body.groups.map((g: any) => g.source)).toEqual(["mine", "off"]);
    expect(r.body.errors).toEqual([]);
    expect(t.foodWeb.calls.some((c) => c.url.startsWith(USDA))).toBe(false);
  });

  it("search needs at least 2 characters", async () => {
    for (const q of ["a", "  b  ", ""]) {
      const r = await search(q);
      expect(r.status).toBe(400);
      expect(r.body.error).toBe("Type at least 2 characters");
    }
    expect((await t.api("GET", "/api/foods/search")).status).toBe(400);
    expect(t.foodWeb.calls).toEqual([]);
  });
});

describe("search forgives typos, puts basic foods first and suggests a spelling", () => {
  // A food already saved in the cache (as an earlier search or scan would have left it)
  const saved = (name: string, sourceId: string, source: "off" | "usda" = "usda") =>
    cacheUpsert(t.db, { source, sourceId, barcode: null, name, brand: null, category: null, servings: [{ label: "100 g", grams: 100 }], nutrients: { calories: 89 }, imageUrl: null, raw: null });
  const custom = (name: string) => t.api("POST", "/api/my-foods", { name, servings: [{ label: "1 bowl", grams: 250 }], nutrients: { calories: 300 } });
  const quietWeb = () => (t.foodWeb.respond = (url) => (url.startsWith(OFF_SEARCH) ? { status: 200, json: { hits: [] } } : { status: 200, json: { foods: [] } }));
  const shape = (body: any) => body.groups.map((g: any) => [g.source, g.foods.map((f: any) => f.name)]);

  it("a saved food is found with a typo, like my own foods", async () => {
    quietWeb();
    await saved("Bananas, raw", "1105314");
    await saved("Raw cashews", "2");
    const r = await search("bananna");
    expect(r.status).toBe(200);
    expect(shape(r.body)).toEqual([["cache", ["Bananas, raw"]]]);
  });

  it("USDA Foundation / SR Legacy hits come as Basic foods, before Saved foods and Open Food Facts", async () => {
    await t.api("PUT", "/api/admin/food-sources", { usdaApiKey: "usda-key" });
    await saved("Banana smoothie", "3000000000009", "off");
    t.foodWeb.respond = (url, call) => {
      if (url.startsWith(OFF_SEARCH)) return { status: 200, json: { hits: [offProduct("3000000000002", "Banana bread", 300)] } };
      if (url.startsWith(USDA)) return usdaReply(call, [usdaFood(1105314, "Bananas, raw", 89), usdaFood(7, "Banana chips", 520, "036632035676")]);
      return { status: 404, json: {} };
    };
    const r = await search("banana");
    expect(r.body.groups.map((g: any) => [g.source, g.label])).toEqual([
      ["basic", "Basic foods"],
      ["cache", "Saved foods"],
      ["off", "Open Food Facts"],
      ["usda", "USDA"],
    ]);
    expect(shape(r.body)).toEqual([
      ["basic", ["Bananas, raw"]],
      ["cache", ["Banana smoothie"]],
      ["off", ["Banana bread"]],
      ["usda", ["Banana chips"]],
    ]);
    expect(r.body.groups[0].foods[0]).toMatchObject({ kind: "cache", source: "usda" });
    // Saved like any outside food, and still a basic food on every later search (with a typo too)
    quietWeb();
    for (const q of ["banana", "bananna"]) {
      const later = await search(q);
      expect(later.body.groups.map((g: any) => g.source)).toEqual(["basic", "cache"]);
      expect(later.body.groups[0].foods.map((f: any) => f.name)).toEqual(["Bananas, raw"]);
      expect(later.body.groups[1].foods.map((f: any) => f.name)).not.toContain("Bananas, raw");
    }
  });

  it("USDA branded failing still shows the basic foods, with the USDA error", async () => {
    await t.api("PUT", "/api/admin/food-sources", { usdaApiKey: "usda-key" });
    t.foodWeb.respond = (url, call) => {
      if (url.startsWith(OFF_SEARCH)) return { status: 200, json: { hits: [] } };
      if (url.startsWith(USDA)) return call.body.dataType.includes("Branded") ? { status: 500, json: {} } : usdaReply(call, [usdaFood(1105314, "Bananas, raw", 89)]);
      return { status: 404, json: {} };
    };
    const r = await search("banana");
    expect(shape(r.body)).toEqual([["basic", ["Bananas, raw"]]]);
    expect(r.body.errors).toEqual([{ source: "usda", message: "USDA answered with an error (500)" }]);
    expect((await foodLogs()).map((l) => l.source)).toEqual(["USDA"]);
  });

  it("inside each group, names starting with the search come first", async () => {
    await t.api("PUT", "/api/admin/food-sources", { usdaApiKey: "usda-key" });
    await custom("Apple banana mix");
    await custom("Banana split");
    t.foodWeb.respond = (url, call) => {
      if (url.startsWith(OFF_SEARCH)) return { status: 200, json: { hits: [offProduct("3000000000002", "Dried banana slices", 300), offProduct("3000000000003", "Banana bread", 300)] } };
      if (url.startsWith(USDA)) return usdaReply(call, [usdaFood(1, "Plantain or banana, cooked", 120), usdaFood(2, "Bananas, raw", 89), usdaFood(3, "Organic banana chips", 520, "036632035676"), usdaFood(4, "Banana chips", 520, "036632035677")]);
      return { status: 404, json: {} };
    };
    expect(shape((await search("banana")).body)).toEqual([
      ["mine", ["Banana split", "Apple banana mix"]],
      ["basic", ["Bananas, raw", "Plantain or banana, cooked"]],
      ["off", ["Banana bread", "Dried banana slices"]],
      ["usda", ["Banana chips", "Organic banana chips"]],
    ]);
  });

  it("few results and a close saved spelling: Did you mean (the closest word, as typed: one banana)", async () => {
    quietWeb();
    await saved("Bananas, raw", "1105314");
    const r = await search("bananna");
    expect(r.body.suggestion).toBe("banana");
  });

  it("a suggestion is a word from saved names (a plain -s plural may lose its s): never an invented one", async () => {
    quietWeb();
    await saved("Sandwiches, turkey", "1105320");
    expect((await search("sandwhich")).body.suggestion).toBe("sandwiches");
  });

  it("my own foods' words count too", async () => {
    quietWeb();
    await custom("Blueberry muffin");
    expect((await search("bluebery")).body.suggestion).toBe("blueberry");
  });

  it("no Did you mean when the spelling is right, nothing is close, there are 3+ foods, or there are several words", async () => {
    quietWeb();
    await saved("Bananas, raw", "1105314");
    await saved("Pineapple, raw", "1105315");
    expect((await search("banana")).body).not.toHaveProperty("suggestion");
    expect((await search("bananas")).body).not.toHaveProperty("suggestion");
    expect((await search("Bananas")).body).not.toHaveProperty("suggestion");
    expect((await search("apple")).body).not.toHaveProperty("suggestion"); // spelled right, just inside "pineapple"
    expect((await search("xylophone")).body).not.toHaveProperty("suggestion");
    expect((await search("bananna split")).body).not.toHaveProperty("suggestion");
    // Only plural endings of the search itself: never a made-up singular ("cooky", "py")
    await saved("Cookies, chocolate chip", "1105316");
    await saved("Pies, apple", "1105317");
    await saved("Smoothies, berry", "1105318");
    await saved("Brownies", "1105319");
    for (const q of ["cookie", "pie", "smoothie", "brownie", "cooky"]) expect((await search(q)).body.suggestion, q).toBeUndefined();
    // 3 foods found: enough, no suggestion
    t.foodWeb.respond = (url) =>
      url.startsWith(OFF_SEARCH) ? { status: 200, json: { hits: [offProduct("3000000000002", "Bananna bread", 300), offProduct("3000000000003", "Bananna cake", 300)] } } : { status: 200, json: { foods: [] } };
    const r = await search("bananna");
    expect(r.body.groups.flatMap((g: any) => g.foods)).toHaveLength(3);
    expect(r.body).not.toHaveProperty("suggestion");
  });
});

describe("liquid measures", () => {
  const fairlife = JSON.parse(readFileSync(new URL("./fixtures/off-product-fairlife.json", import.meta.url), "utf8")).product;
  const FAIRLIFE = "0811620021470";
  const approxServings = [
    { label: "100 g", grams: 100, ml: 100, approx: true },
    { label: "1 cup", grams: 240, ml: 240, approx: true },
  ];

  it("barcode and search results for a grams-only drink carry approximate ml; cheese doesn't", async () => {
    const cheese = offProduct("0099999999993", "Mozzarella", 280, { categories_tags: ["en:cheeses"] });
    offKnows(t, { [FAIRLIFE]: fairlife });
    const hit = await barcode(FAIRLIFE);
    expect(hit.body.food).toMatchObject({ name: fairlife.product_name, servings: approxServings, nutrients: { saturated_fat_g: 1.25 } });
    // the cache keeps the source's servings; the ml is worked out when read
    const [row] = (await t.db.execute<{ servings: unknown }>(sql`select servings from food_cache where barcode = ${FAIRLIFE}`)).rows;
    expect(row.servings).toEqual([{ label: "100 g", grams: 100 }, { label: "1 cup", grams: 240 }]);

    const web = t.foodWeb.respond;
    t.foodWeb.respond = (url, init) => (url.startsWith(OFF_SEARCH) ? { status: 200, json: { hits: [fairlife, cheese] } } : web(url, init));
    const s = await search("fairlife mozzarella");
    const foods = s.body.groups.flatMap((g: any) => g.foods);
    expect(foods.find((f: any) => f.name === fairlife.product_name).servings).toEqual(approxServings);
    expect(foods.find((f: any) => f.name === "Mozzarella").servings).toEqual([{ label: "100 g", grams: 100 }, { label: "40 g", grams: 40 }]);
  });

  it("my own grams-only drink carries approximate ml, and saving it back keeps it grams-only", async () => {
    const made = await t.api("POST", "/api/my-foods", { name: "Homemade kefir", servings: [{ label: "1 glass", grams: 250 }], nutrients: { calories: 150 } });
    expect(made.body.food.servings).toEqual([{ label: "1 glass", grams: 250, ml: 250, approx: true }]);
    // The web app sends the servings back as it got them: the estimate isn't stored as a real volume
    const saved = await t.api("PATCH", `/api/my-foods/${made.body.food.id}`, { servings: made.body.food.servings });
    expect(saved.status).toBe(200);
    expect(saved.body.food.servings).toEqual([{ label: "1 glass", grams: 250, ml: 250, approx: true }]);
    const [row] = (await t.db.execute<{ servings: unknown }>(sql`select servings from user_foods where id = ${made.body.food.id}`)).rows;
    expect(row.servings).toEqual([{ label: "1 glass", grams: 250 }]);
  });
});
