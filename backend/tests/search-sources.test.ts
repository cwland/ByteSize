import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";
import { OFF_SEARCH, USDA, usdaReply } from "./foodFakes.js";
import { CULURY, CULURY_KEY, culuryKnows, culuryRecipe, resetFakeDns } from "./culuryFakes.js";
import { setRestaurantKeys } from "./restaurantFakes.js";

// § 22: the search says which sources it asked, so Add food can draw a pill for each (even one with no results)
let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
beforeEach(async () => {
  await t.reset();
  resetFakeDns();
  await t.login();
  t.foodWeb.respond = (url, call) => (url.startsWith(OFF_SEARCH) ? { status: 200, json: { hits: [] } } : url.startsWith(USDA) ? usdaReply(call, []) : { status: 404, json: {} });
});
afterAll(async () => t.close());

const searched = async (q = "greek yogurt") => (await t.api("GET", `/api/foods/search?q=${encodeURIComponent(q)}`)).body.searched;
const turn = (enabled: Record<string, boolean>) => t.api("PUT", "/api/admin/food-sources", { enabled });

describe("searched sources", () => {
  it("a fresh server asks My foods and Open Food Facts, even with nothing found", async () => {
    expect(await searched()).toEqual(["mine", "off"]);
  });

  it("a USDA key adds Basic foods and USDA, in pill order", async () => {
    await t.api("PUT", "/api/admin/food-sources", { usdaApiKey: "usda-key" });
    expect(await searched()).toEqual(["mine", "basic", "usda", "off"]);
  });

  it("FatSecret and a linked RecipeHub come in their places", async () => {
    await t.api("PUT", "/api/admin/food-sources", { usdaApiKey: "usda-key" });
    await setRestaurantKeys(t, { fatsecret: { id: "fs-id", secret: "fs-secret" } });
    culuryKnows(t, { recipes: [culuryRecipe(7, "Chili")], plan: [] });
    await t.api("PUT", "/api/settings/culury", { url: CULURY, apiKey: CULURY_KEY });
    expect(await searched()).toEqual(["mine", "fatsecret", "basic", "usda", "off", "culury"]);
  });

  it("a source switched off is not listed", async () => {
    await t.api("PUT", "/api/admin/food-sources", { usdaApiKey: "usda-key" });
    await turn({ off: false, usda: false });
    expect(await searched()).toEqual(["mine"]);
  });

  it("a source that fails is still listed", async () => {
    t.foodWeb.respond = () => ({ status: 500, json: {} });
    const r = await t.api("GET", "/api/foods/search?q=greek%20yogurt");
    expect(r.body.errors.map((e: any) => e.source)).toEqual(["off"]);
    expect(r.body.searched).toEqual(["mine", "off"]);
  });

  it("a typed barcode is not a source search: no pills", async () => {
    expect(await searched("3000000000007")).toEqual([]);
  });
});
