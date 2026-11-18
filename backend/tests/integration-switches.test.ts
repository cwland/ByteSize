import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { setupTestApp, type TestApp } from "./helpers.js";
import { asUser } from "./isolation.js";
import { aiSettings, OFF_PRODUCT, OFF_SEARCH, offProduct, USDA, usdaFood, usdaReply } from "./foodFakes.js";
import { barcodePhoto, photoUpload } from "./photoFakes.js";
import { CULURY, CULURY_KEY, culuryCalls, culuryKnows, culuryRecipe, resetFakeDns } from "./culuryFakes.js";
import { fsCalls, fsFood, fsHit, quota, restaurantWeb, setRestaurantKeys, spoonCalls, spoonItem } from "./restaurantFakes.js";
import { setSourceKeys } from "../src/lib/foodSources/settings.js";
import { userSettings } from "../src/db/schema.js";

// § 18: an on/off switch per integration. A source that is off is never called and never reported.
let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
beforeEach(async () => {
  await t.reset();
  resetFakeDns();
  await t.login(); // admin "cory"
});
afterAll(async () => t.close());

const CODE = "3000000000007"; // a real EAN-13 (check digit 7), so it can be drawn as a photo
const FS = { id: "fs-id", secret: "fs-secret" };
const sources = () => t.api("GET", "/api/admin/food-sources");
const turn = (enabled: Record<string, boolean>) => t.api("PUT", "/api/admin/food-sources", { enabled });
const storedSources = async () => (await t.db.execute<{ value: any }>(sql`select value from app_settings where key = 'food_sources'`)).rows[0]?.value ?? null;
const offCalls = () => t.foodWeb.calls.filter((c) => c.url.startsWith(OFF_SEARCH) || c.url.startsWith(OFF_PRODUCT));
const usdaCalls = () => t.foodWeb.calls.filter((c) => c.url.startsWith(USDA));

/** OFF and USDA both answer: OFF knows CODE, USDA finds a yogurt for any search. */
function foodWeb() {
  t.foodWeb.respond = (url, call) => {
    if (url.startsWith(OFF_SEARCH)) return { status: 200, json: { hits: [offProduct("3000000000002", "Greek yogurt bar", 300)] } };
    if (url.startsWith(OFF_PRODUCT)) return url.includes(CODE) ? { status: 200, json: { code: CODE, status: 1, product: offProduct(CODE, "Crunchy bar", 400) } } : { status: 404, json: { status: 0 } };
    if (url.startsWith(USDA)) return usdaReply(call, [usdaFood(1, "Greek yogurt, plain", 59), usdaFood(2, "Greek yogurt cup", 100, "0000000000017")]);
    return { status: 404, json: {} };
  };
}

describe("starting state (also for servers set up before the switches)", () => {
  it("a fresh server: Open Food Facts on, the sources that need a key off", async () => {
    expect((await sources()).body).toEqual({
      off: { enabled: true },
      usda: { hasKey: false, enabled: false },
      spoonacular: { hasKey: false, enabled: false },
      fatsecret: { hasKey: false, enabled: false },
    });
  });

  it("a saved key with no switch ever stored: that source is on", async () => {
    // As an existing server has it: keys only, nothing about switches
    await setSourceKeys(t.app, { usdaApiKey: "usda-key", spoonacularApiKey: "spoon-key", fatsecretClientId: FS.id, fatsecretClientSecret: FS.secret });
    expect(JSON.stringify(await storedSources())).not.toContain("enabled");
    expect((await sources()).body).toEqual({
      off: { enabled: true },
      usda: { hasKey: true, enabled: true },
      spoonacular: { hasKey: true, enabled: true },
      fatsecret: { hasKey: true, enabled: true },
    });
    expect((await t.api("GET", "/api/restaurants/status")).body.sources).toEqual(["spoonacular", "fatsecret"]);
  });

  it("Culury: on when linked, off when not (no switch stored)", async () => {
    expect((await t.api("GET", "/api/settings/culury")).body).toEqual({ url: null, hasKey: false, enabled: false });
    culuryKnows(t);
    await t.api("PUT", "/api/settings/culury", { url: CULURY, apiKey: CULURY_KEY });
    expect((await t.api("GET", "/api/settings/culury")).body).toEqual({ url: CULURY, hasKey: true, enabled: true });
    const [row] = await t.db.select().from(userSettings);
    expect(row.culuryEnabled).toBeNull();
  });
});

describe("the admin's switches", () => {
  it("a change of switch alone never touches a saved key", async () => {
    await t.api("PUT", "/api/admin/food-sources", { usdaApiKey: "usda-key", spoonacularApiKey: "spoon-key" });
    const before = await storedSources();
    const off = await turn({ usda: false, spoonacular: false, off: false });
    expect(off.status).toBe(200);
    expect(off.body).toEqual({ off: { enabled: false }, usda: { hasKey: true, enabled: false }, spoonacular: { hasKey: true, enabled: false }, fatsecret: { hasKey: false, enabled: false } });
    const after = await storedSources();
    expect(after.usdaApiKey).toBe(before.usdaApiKey);
    expect(after.spoonacularApiKey).toBe(before.spoonacularApiKey);
    expect((await sources()).body).toEqual(off.body);
  });

  it("on with no key yet: shown as on, but unused until a key is saved", async () => {
    foodWeb();
    expect((await turn({ usda: true })).body.usda).toEqual({ hasKey: false, enabled: true });
    const r = await t.api("GET", "/api/foods/search?q=greek%20yogurt");
    expect(r.body.errors).toEqual([]);
    expect(usdaCalls()).toHaveLength(0);
    // removing a key later leaves a switch that was turned on, on
    await t.api("PUT", "/api/admin/food-sources", { usdaApiKey: "usda-key" });
    await t.api("PUT", "/api/admin/food-sources", { usdaApiKey: null });
    expect((await sources()).body.usda).toEqual({ hasKey: false, enabled: true });
  });

  it("only the admin can change them", async () => {
    const sam = await t.createUser("sam");
    const as = asUser(t, sam.token);
    expect((await as("PUT", "/api/admin/food-sources", { enabled: { off: false } })).status).toBe(403);
    expect((await sources()).body.off).toEqual({ enabled: true });
  });

  it("refuses a switch that isn't true or false, or an unknown source", async () => {
    expect((await turn({ off: "no" as unknown as boolean })).status).toBe(400);
    expect((await t.api("PUT", "/api/admin/food-sources", { enabled: { culury: false } })).status).toBe(400);
  });
});

describe("Open Food Facts and USDA off", () => {
  beforeEach(async () => {
    await t.api("PUT", "/api/admin/food-sources", { usdaApiKey: "usda-key" });
    foodWeb();
  });

  it("search: Open Food Facts off is never asked and not reported", async () => {
    await turn({ off: false });
    const r = await t.api("GET", "/api/foods/search?q=greek%20yogurt");
    expect(r.status).toBe(200);
    expect(offCalls()).toHaveLength(0);
    expect(usdaCalls().length).toBeGreaterThan(0);
    expect(r.body.errors).toEqual([]);
    expect(r.body.groups.map((g: any) => g.source)).not.toContain("off");
  });

  it("search: USDA off is never asked and not reported, even when Open Food Facts fails", async () => {
    await turn({ usda: false });
    t.foodWeb.respond = (url) => (url.startsWith(OFF_SEARCH) ? { status: 500, json: {} } : { status: 200, json: { foods: [] } });
    const r = await t.api("GET", "/api/foods/search?q=greek%20yogurt");
    expect(usdaCalls()).toHaveLength(0);
    expect(r.body.errors.map((e: any) => e.source)).toEqual(["off"]);
  });

  it("barcode: each source that is off is skipped silently", async () => {
    await turn({ off: false });
    const r = await t.api("GET", `/api/foods/barcode/${CODE}`);
    expect(offCalls()).toHaveLength(0);
    expect(usdaCalls()).toHaveLength(1);
    expect(r.body.errors).toEqual([]);
    t.foodWeb.calls.length = 0;
    await turn({ usda: false });
    const none = await t.api("GET", `/api/foods/barcode/${CODE}`);
    expect(t.foodWeb.calls).toHaveLength(0);
    expect(none.body).toMatchObject({ food: null, errors: [] });
  });

  it("a typed barcode in search and a barcode photo follow the switches too", async () => {
    await turn({ off: false, usda: false });
    expect((await t.api("GET", `/api/foods/search?q=${CODE}`)).body).toMatchObject({ groups: [], errors: [] });
    const { payload, headers } = photoUpload([await barcodePhoto(CODE)], "barcode");
    const photo = await t.api("POST", "/api/photos/analyze", payload, headers);
    expect(photo.status).toBe(200);
    expect(photo.body).toMatchObject({ barcode: CODE, errors: [] });
    expect(photo.body.food).toBeUndefined();
    expect(t.foodWeb.calls).toHaveLength(0);
  });

  it("off, then on again: the saved key is kept and used again", async () => {
    await turn({ usda: false });
    expect((await sources()).body.usda).toEqual({ hasKey: true, enabled: false });
    await t.api("GET", "/api/foods/search?q=greek%20yogurt");
    expect(usdaCalls()).toHaveLength(0);
    await turn({ usda: true });
    const r = await t.api("GET", "/api/foods/search?q=greek%20yogurt");
    expect(usdaCalls().length).toBeGreaterThan(0);
    expect(usdaCalls()[0].url).toContain("api_key=usda-key");
    expect(r.body.groups.map((g: any) => g.source)).toContain("basic");
  });
});

describe("restaurant sources off", () => {
  const bowl = spoonItem(1001, "Chicken Burrito Bowl", "Chipotle", 655);
  const burrito = fsFood(101, "Chicken Burrito", "Chipotle", [{ serving_description: "1 burrito", metric_serving_amount: "510.000", metric_serving_unit: "g", calories: "1070", fat: "41.00", protein: "52.00", carbohydrate: "120.00" }]);
  beforeEach(async () => {
    await setRestaurantKeys(t, { spoonacular: "spoon-key", fatsecret: FS });
    restaurantWeb(t, {
      spoonSearch: () => ({ status: 200, json: { menuItems: [bowl] }, headers: quota(40) }),
      spoonItem: () => ({ status: 200, json: bowl, headers: quota(39) }),
      fsSearch: () => ({ status: 200, json: { foods: { food: fsHit(101, "Chicken Burrito", "Chipotle", 1070) } } }),
      fsGet: () => ({ status: 200, json: { food: burrito } }),
    });
  });

  it("Spoonacular off: search goes straight to FatSecret, Spoonacular is never asked or reported", async () => {
    await turn({ spoonacular: false });
    expect((await t.api("GET", "/api/restaurants/status")).body).toEqual({ sources: ["fatsecret"], lookupsLeft: null });
    const r = await t.api("GET", "/api/restaurants/search?q=chipotle");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ items: [{ source: "fatsecret", name: "Chicken Burrito" }], lookupsLeft: null, errors: [] });
    expect(spoonCalls(t)).toHaveLength(0);
    const item = await t.api("POST", "/api/restaurants/item", { source: "spoonacular", sourceId: "1001" });
    expect(item.status).toBe(400);
    expect(spoonCalls(t)).toHaveLength(0);
  });

  it("FatSecret off: never asked, even when Spoonacular finds nothing", async () => {
    await turn({ fatsecret: false });
    restaurantWeb(t, { spoonSearch: () => ({ status: 200, json: { menuItems: [] }, headers: quota(40) }) });
    expect((await t.api("GET", "/api/restaurants/status")).body.sources).toEqual(["spoonacular"]);
    const r = await t.api("GET", "/api/restaurants/search?q=chipotle");
    expect(r.body).toMatchObject({ items: [], errors: [] });
    expect(fsCalls(t)).toHaveLength(0);
    expect((await t.api("POST", "/api/restaurants/item", { source: "fatsecret", sourceId: "101" })).status).toBe(400);
    expect(t.foodWeb.calls.filter((c) => !c.url.startsWith("https://api.spoonacular.com"))).toHaveLength(0);
  });

  it("both off: no restaurant sources, and search makes no outside call", async () => {
    await turn({ spoonacular: false, fatsecret: false });
    expect((await t.api("GET", "/api/restaurants/status")).body).toEqual({ sources: [], lookupsLeft: null });
    expect((await t.api("GET", "/api/restaurants/search?q=chipotle")).status).toBe(400);
    expect(t.foodWeb.calls).toHaveLength(0);
  });

  it("off, then on again: the saved key is used again", async () => {
    await turn({ spoonacular: false });
    await turn({ spoonacular: true });
    expect((await sources()).body.spoonacular).toEqual({ hasKey: true, enabled: true });
    const r = await t.api("GET", "/api/restaurants/search?q=chipotle");
    expect(r.body.items[0]).toMatchObject({ source: "spoonacular" });
    expect(spoonCalls(t)[0].headers["x-api-key"]).toBe("spoon-key");
  });
});

describe("Culury off (the person's own switch)", () => {
  const linkIt = async () => {
    culuryKnows(t, { recipes: [culuryRecipe(7, "Chili")], plan: [{ date: "2026-11-17", slot: "dinner", recipeId: 7, title: "Chili" }] });
    expect((await t.api("PUT", "/api/settings/culury", { url: CULURY, apiKey: CULURY_KEY })).status).toBe(200);
    t.foodWeb.calls.length = 0;
  };
  const turnCulury = (enabled: unknown) => t.api("PUT", "/api/settings/culury/enabled", { enabled });

  it("the switch alone never touches the address or key", async () => {
    await linkIt();
    const [before] = await t.db.select().from(userSettings);
    const r = await turnCulury(false);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ url: CULURY, hasKey: true, enabled: false });
    const [after] = await t.db.select().from(userSettings);
    expect(after).toMatchObject({ culuryUrl: before.culuryUrl, culuryKeyEnc: before.culuryKeyEnc, culuryEnabled: false });
    expect((await turnCulury("yes")).status).toBe(400);
  });

  it("plan, recipes and search never ask Culury and report nothing", async () => {
    await linkIt();
    await turnCulury(false);
    expect((await t.api("GET", "/api/culury/plan?day=2026-11-17")).body).toEqual({ linked: false, days: [], errors: [] });
    expect((await t.api("GET", "/api/culury/recipes/7")).status).toBe(400);
    const s = await t.api("GET", "/api/foods/search?q=chili");
    expect(s.body.groups.map((g: any) => g.source)).not.toContain("culury");
    expect(s.body.errors).toEqual([]);
    expect(culuryCalls(t)).toHaveLength(0);
  });

  it("off, then on again: the saved link is used again", async () => {
    await linkIt();
    await turnCulury(false);
    expect((await turnCulury(true)).body).toEqual({ url: CULURY, hasKey: true, enabled: true });
    const plan = await t.api("GET", "/api/culury/plan?day=2026-11-17");
    expect(plan.body).toMatchObject({ linked: true, days: [{ day: "2026-11-17" }] });
    expect(culuryCalls(t)[0].headers["x-api-key"]).toBe(CULURY_KEY);
  });

  it("switched on before linking: on, not linked yet", async () => {
    expect((await turnCulury(true)).body).toEqual({ url: null, hasKey: false, enabled: true });
    expect((await t.api("GET", "/api/culury/plan?day=2026-11-17")).body).toEqual({ linked: false, days: [], errors: [] });
  });

  it("members have their own switch", async () => {
    const sam = await t.createUser("sam");
    const as = asUser(t, sam.token);
    expect((await as("PUT", "/api/settings/culury/enabled", { enabled: true })).body).toEqual({ url: null, hasKey: false, enabled: true });
  });
});

describe("AI services switch", () => {
  it("can be changed on its own; the services and keys are kept", async () => {
    await t.api("PUT", "/api/settings/ai", { ...aiSettings, services: [{ ...aiSettings.services[0], apiKey: "ai-key" }] });
    const off = await t.api("PUT", "/api/settings/ai", { enabled: false });
    expect(off.status).toBe(200);
    expect(off.body.settings).toMatchObject({ enabled: false, services: [{ name: "Home AI", model: "qwen", hasKey: true }] });
    expect((await t.api("GET", "/api/ai/status")).body).toMatchObject({ ready: false });
    const on = await t.api("PUT", "/api/settings/ai", { enabled: true });
    expect(on.body.settings).toMatchObject({ enabled: true, services: [{ name: "Home AI", hasKey: true }] });
  });

  it("with nothing set up yet, switching it off is remembered", async () => {
    expect((await t.api("PUT", "/api/settings/ai", { enabled: false })).body.settings).toMatchObject({ enabled: false, services: [] });
  });

  it("is admin-only", async () => {
    const sam = await t.createUser("sam");
    expect((await asUser(t, sam.token)("PUT", "/api/settings/ai", { enabled: false })).status).toBe(403);
  });
});
