// §29 The per-person usage counter: where each count is made, and that counting never gets in the way.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestApp, type TestApp } from "./helpers.js";
import { OFF_PRODUCT, OFF_SEARCH, USDA, aiAnswers, aiSettings, offProduct, usdaFood, usdaReply } from "./foodFakes.js";
import { CULURY, culuryKnows, culuryRecipe } from "./culuryFakes.js";
import { restaurantWeb, setRestaurantKeys, spoonItem, fsFood, fsHit, quota } from "./restaurantFakes.js";
import { barcodePhoto, labelPhoto, photoUpload } from "./photoFakes.js";
import { appLog, foodCache, usageCounts, users } from "../src/db/schema.js";
import { countUsage, usageSettled } from "../src/lib/usage.js";

let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
beforeEach(async () => {
  await t.reset();
  await t.login(); // admin "alex"
  t.clock.date = new Date("2026-11-18T12:00:00Z");
});
afterAll(async () => t.close());

const CODE = "0012345678905";
const FS = { id: "fs-id", secret: "fs-secret" };
const H = 60 * 60 * 1000;
/** Everything counted for a person so far (after the counting that is still under way has finished). */
async function counts(userId = 1): Promise<Record<string, number>> {
  await usageSettled();
  const rows = await t.db.select().from(usageCounts).where(eq(usageCounts.userId, userId));
  return Object.fromEntries(rows.map((r) => [r.key, r.count]));
}
const scan = (code = CODE) => t.api("GET", `/api/foods/barcode/${code}`);
const search = (q: string) => t.api("GET", `/api/foods/search?q=${encodeURIComponent(q)}`);
const later = (ms: number) => (t.clock.date = new Date(t.clock.date!.getTime() + ms));

/** OFF knows one barcode; OFF and USDA searches answer with one food each. */
function web() {
  t.foodWeb.respond = (url, call) => {
    if (url.startsWith(OFF_PRODUCT)) {
      const code = url.slice(OFF_PRODUCT.length).split(".json")[0];
      return code === CODE ? { status: 200, json: { code, status: 1, product: offProduct(CODE, "Crunchy Granola", 450) } } : { status: 404, json: { code, status: 0 } };
    }
    if (url.startsWith(OFF_SEARCH)) return { status: 200, json: { hits: [offProduct("3000000000002", "Granola honey", 460)] } };
    if (url.startsWith(USDA)) return usdaReply(call, [usdaFood(9, "Granola, homemade", 489), usdaFood(8, "Granola crunch", 420, "036632035676")]);
    return { status: 404, json: {} };
  };
}

describe("counting where it happens", () => {
  it("a barcode scan counts a barcode and the one Open Food Facts call; the same scan again is a lookup saved", async () => {
    web();
    await scan();
    expect(await counts()).toEqual({ barcodes_scanned: 1, outside_off: 1 });
    await scan();
    expect(await counts()).toEqual({ barcodes_scanned: 2, outside_off: 1, lookups_saved: 1 });
  });

  it("a barcode typed into the search counts like a scan; one that isn't a barcode counts nothing", async () => {
    web();
    await search(CODE);
    expect(await counts()).toMatchObject({ barcodes_scanned: 1, outside_off: 1 });
    expect((await scan("123")).status).toBe(400);
    expect((await counts()).barcodes_scanned).toBe(1);
  });

  it("a barcode photo is a photo read and a barcode scan; a label photo is a photo read (and nothing else)", async () => {
    web();
    await t.api("PUT", "/api/settings/ai", { ...aiSettings, services: [{ ...aiSettings.services[0], photos: true }] });
    const { payload, headers } = photoUpload([await barcodePhoto(CODE)]);
    expect((await t.api("POST", "/api/photos/analyze", payload, headers)).body.barcode).toBe(CODE);
    expect(await counts()).toEqual({ photos_read: 1, barcodes_scanned: 1, outside_off: 1 });
    aiAnswers(t, { name: "Crackers", servings: [{ label: "2 crackers", grams: 30 }], nutrients: { calories: 140 } });
    const two = photoUpload([await labelPhoto(), await labelPhoto()], "label");
    await t.api("POST", "/api/photos/analyze", two.payload, two.headers);
    expect(await counts()).toEqual({ photos_read: 3, barcodes_scanned: 1, outside_off: 1 });
  });

  it("a typed search counts each source asked; the same search again is one lookup saved per source answered from the kept copy", async () => {
    await t.api("PUT", "/api/admin/food-sources", { usdaApiKey: "usda-key" });
    web();
    await search("granola");
    expect(await counts()).toEqual({ outside_off: 1, outside_usda: 1 });
    await search("granola");
    expect(await counts()).toEqual({ outside_off: 1, outside_usda: 1, lookups_saved: 2 });
  });

  it("FatSecret and Spoonacular: each restaurant search, item and kept answer", async () => {
    await setRestaurantKeys(t, { spoonacular: "spoon-key", fatsecret: FS });
    const bowl = spoonItem(1001, "Chicken Burrito Bowl", "Chipotle", 655);
    restaurantWeb(t, {
      fsSearch: (q) => (q === "baconator" ? { status: 200, json: { foods: { food: fsHit(7, "Baconator", "Wendy's", 950) } } } : { status: 200, json: { foods: {} } }),
      spoonSearch: () => ({ status: 200, json: { menuItems: [bowl] }, headers: quota(40) }),
      spoonItem: () => ({ status: 200, json: bowl, headers: quota(39) }),
    });
    await t.api("GET", "/api/restaurants/search?q=baconator");
    expect(await counts()).toEqual({ outside_fatsecret: 1 });
    await t.api("GET", "/api/restaurants/search?q=baconator");
    expect(await counts()).toEqual({ outside_fatsecret: 1, lookups_saved: 1 });
    // FatSecret finds nothing for this one, so Spoonacular is asked too
    const found = await t.api("GET", "/api/restaurants/search?q=chipotle%20bowl");
    expect(await counts()).toMatchObject({ outside_fatsecret: 2, outside_spoonacular: 1 });
    const item = found.body.items[0];
    await t.api("POST", "/api/restaurants/item", { source: item.source, sourceId: item.sourceId });
    expect(await counts()).toMatchObject({ outside_spoonacular: 2 });
    await t.api("POST", "/api/restaurants/item", { source: item.source, sourceId: item.sourceId });
    expect(await counts()).toMatchObject({ outside_spoonacular: 2, lookups_saved: 2 });
  });

  it("Check for changes is one outside call to the kept food's source", async () => {
    web();
    const id = (await scan()).body.food.id;
    later(H);
    await t.api("POST", "/api/foods/refresh", { cacheId: id });
    expect((await counts()).outside_off).toBe(2);
  });

  it("Check for changes counts one outside call for every source: USDA, FatSecret and Spoonacular too", async () => {
    await setRestaurantKeys(t, { spoonacular: "spoon-key", fatsecret: FS });
    expect((await t.api("PUT", "/api/admin/food-sources", { usdaApiKey: "usda-key" })).status).toBe(200);
    const fsGranola = fsFood(555, "Granola Bar", "Nature Valley", [{ serving_description: "1 bar", metric_serving_amount: "21.000", metric_serving_unit: "g", calories: "90", fat: "3.00", protein: "2.00", carbohydrate: "15.00" }]);
    restaurantWeb(t, { fsGet: () => ({ status: 200, json: { food: fsGranola } }), spoonItem: (id) => ({ status: 200, json: spoonItem(Number(id), "Bowl", "Chipotle", 655), headers: quota(30) }) });
    const rest = t.foodWeb.respond;
    t.foodWeb.respond = (url, call) => (url.startsWith("https://api.nal.usda.gov/fdc/v1/food/77") ? { status: 200, json: usdaFood(77, "Greek yogurt", 61) } : rest(url, call));
    const kept = await t.db
      .insert(foodCache)
      .values([
        { source: "usda", sourceId: "77", name: "Greek yogurt", servings: [{ label: "100 g", grams: 100 }], nutrients: { calories: 59 }, fetchedAt: t.clock.date! },
        { source: "fatsecret", sourceId: "555", name: "Granola Bar", servings: [{ label: "1 bar", grams: 21 }], nutrients: { calories: 90 }, fetchedAt: t.clock.date! },
        { source: "spoonacular", sourceId: "1001", name: "Bowl", servings: [{ label: "1 bowl", grams: 400 }], nutrients: { calories: 655 }, fetchedAt: t.clock.date! },
      ])
      .returning();
    later(2 * H); // past Spoonacular's hours
    for (const row of kept) expect((await t.api("POST", "/api/foods/refresh", { cacheId: row.id })).status, row.source).toBe(200);
    expect(await counts()).toEqual({ outside_usda: 1, outside_fatsecret: 1, outside_spoonacular: 1 });
  });

  it("Culury calls are the person's own outside lookups: exactly one per call made", async () => {
    culuryKnows(t, { recipes: [culuryRecipe(7, "Chili")] });
    await t.api("PUT", "/api/settings/culury", { url: CULURY, apiKey: "cul_readonly_SECRET_9f8e7d" });
    t.foodWeb.calls.length = 0;
    await search("chili");
    const made = t.foodWeb.calls.filter((c) => c.url.startsWith(CULURY)).length;
    expect(made).toBe(2); // the list, then the recipe's details
    expect((await counts()).outside_culury).toBe(made);
  });

  it("Describe it counts an AI estimate once it has one; a failed estimate counts nothing", async () => {
    await t.api("PUT", "/api/settings/ai", aiSettings);
    t.ai.respond = () => ({ status: 200, json: { choices: [{ message: { content: JSON.stringify({ unknown: true }) } }] } });
    expect((await t.api("POST", "/api/ai/estimate", { text: "asdfgh" })).status).toBe(422);
    expect(await counts()).toEqual({});
    aiAnswers(t, { name: "Chicken burrito", servings: [{ label: "1 burrito", grams: 300 }], nutrients: { calories: 650 } });
    expect((await t.api("POST", "/api/ai/estimate", { text: "a chicken burrito" })).status).toBe(200);
    expect(await counts()).toEqual({ ai_estimates: 1 });
  });
});

describe("the counter itself", () => {
  it("counts atomically: 25 at once make 25, one row per person and key", async () => {
    await Promise.all(Array.from({ length: 25 }, () => countUsage(t.app, 1, "barcodes_scanned")));
    expect(await counts()).toEqual({ barcodes_scanned: 25 });
    expect(await t.db.select().from(usageCounts)).toHaveLength(1);
  });

  it("never throws or waits for the database: a failing write is logged and the request goes on", async () => {
    const boom = new Error("db is down");
    const spy = vi.spyOn(t.db, "insert").mockImplementation(() => {
      throw boom;
    });
    let returned: unknown;
    try {
      returned = countUsage(t.app, 1, "barcodes_scanned"); // not awaited by the caller
    } finally {
      spy.mockRestore();
    }
    expect(returned).toBeUndefined();
    await expect(usageSettled()).resolves.toBeUndefined();
    expect(await counts()).toEqual({});
    // ...and the failure is a line in Settings › Logs, with whose count it was
    const lines = await t.db.select().from(appLog);
    expect(lines).toEqual([expect.objectContaining({ category: "api", level: "warning", source: "Usage counter", event: "Couldn't count barcodes_scanned", detail: "db is down", userId: 1 })]);
  });

  it("a person who is gone (their rows cascaded) can't make a count fail anything", async () => {
    countUsage(t.app, 999, "barcodes_scanned"); // no such user: the foreign key refuses, quietly
    await expect(usageSettled()).resolves.toBeUndefined();
  });

  it("deleting a person deletes their counts", async () => {
    const ben = await t.createUser("ben");
    countUsage(t.app, ben.id, "photos_read");
    expect(await counts(ben.id)).toEqual({ photos_read: 1 });
    await t.db.delete(users).where(eq(users.id, ben.id));
    expect(await counts(ben.id)).toEqual({});
  });
});
