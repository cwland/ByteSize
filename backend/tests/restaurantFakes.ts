// Fake restaurant data sources (Spoonacular menu items, FatSecret) for the fake food web.
import type { TestApp } from "./helpers.js";

export const SPOON = "https://api.spoonacular.com/food/menuItems";
export const SPOON_SEARCH = `${SPOON}/search`;
export const FS_TOKEN = "https://oauth.fatsecret.com/connect/token";
export const FS_API = "https://platform.fatsecret.com/rest/server.api";

export const QUOTA_MESSAGE = "Today's restaurant lookups are used up. They reset at midnight UTC — or use Describe it.";
export const NO_KEY_MESSAGE = "Add a restaurant data key in Settings › Integrations";

/** A Spoonacular menu item as search (with addMenuItemInformation) and Get Menu Item Information send it. */
export function spoonItem(id: number, title: string, chain: string, kcal?: number, extra: Record<string, unknown> = {}) {
  const nutrients = kcal === undefined ? [] : [
    { name: "Calories", amount: kcal, unit: "cal", percentOfDailyNeeds: 50 },
    { name: "Fat", amount: 21, unit: "g", percentOfDailyNeeds: 30 },
    { name: "Protein", amount: 32, unit: "g", percentOfDailyNeeds: 64 },
    { name: "Carbohydrates", amount: 40, unit: "g", percentOfDailyNeeds: 13 },
  ];
  return {
    id,
    title,
    restaurantChain: chain,
    image: `https://img.spoonacular.com/menu-items/${id}-312x231.png`,
    imageType: "png",
    servings: { number: 1, size: null, unit: null },
    nutrition: { nutrients, caloricBreakdown: { percentProtein: 30, percentFat: 35, percentCarbs: 35 } },
    ...extra,
  };
}

/** Quota headers like Spoonacular's (points). */
export const quota = (left: number, used = 50 - left, request = 1) => ({
  "X-API-Quota-Request": String(request),
  "X-API-Quota-Used": String(used),
  "X-API-Quota-Left": String(left),
});

/** A FatSecret foods.search hit (v1: a description string, no full nutrients). */
export function fsHit(id: number, name: string, brand: string | null, kcal: number, per = "1 burrito") {
  return {
    food_id: String(id),
    food_name: name,
    ...(brand ? { brand_name: brand } : {}),
    food_type: brand ? "Brand" : "Generic",
    food_description: `Per ${per} - Calories: ${kcal}kcal | Fat: 20.00g | Carbs: 50.00g | Protein: 30.00g`,
    food_url: `https://foods.fatsecret.com/calories-nutrition/x/${id}`,
  };
}

/** A FatSecret food.get answer's food. */
export function fsFood(id: number, name: string, brand: string, servings: Record<string, string>[]) {
  return { food_id: String(id), food_name: name, food_type: "Brand", brand_name: brand, food_url: "https://foods.fatsecret.com/x", servings: { serving: servings.length === 1 ? servings[0] : servings } };
}

export type RestaurantWeb = {
  spoonSearch?: (q: string, url: URL) => { status: number; json?: unknown; headers?: Record<string, string>; text?: string };
  spoonItem?: (id: string) => { status: number; json?: unknown; headers?: Record<string, string>; text?: string };
  fsToken?: () => { status: number; json?: unknown };
  fsSearch?: (q: string) => { status: number; json?: unknown; text?: string };
  fsGet?: (id: string) => { status: number; json?: unknown };
};

/** Routes the fake food web to the given restaurant handlers (anything else: 404). */
export function restaurantWeb(t: TestApp, web: RestaurantWeb) {
  let tokenN = 0;
  t.foodWeb.respond = (raw, call) => {
    const url = new URL(raw);
    if (raw.startsWith(SPOON_SEARCH)) return web.spoonSearch ? web.spoonSearch(url.searchParams.get("query") ?? "", url) : { status: 200, json: { menuItems: [] }, headers: quota(40) };
    if (raw.startsWith(SPOON + "/")) return web.spoonItem ? web.spoonItem(url.pathname.split("/").pop()!) : { status: 404, json: {} };
    if (raw === FS_TOKEN) return web.fsToken ? web.fsToken() : { status: 200, json: { access_token: `tok-${++tokenN}`, token_type: "Bearer", expires_in: 86400 } };
    if (raw === FS_API) {
      const p = new URLSearchParams(String(call.body ?? ""));
      if (p.get("method") === "foods.search") return web.fsSearch ? web.fsSearch(p.get("search_expression") ?? "") : { status: 200, json: { foods: { max_results: "20", total_results: "0", page_number: "0" } } };
      if (p.get("method") === "food.get.v2") return web.fsGet ? web.fsGet(p.get("food_id") ?? "") : { status: 200, json: { error: { code: 106, message: "Invalid ID" } } };
    }
    return { status: 404, json: {} };
  };
}

export const spoonCalls = (t: TestApp) => t.foodWeb.calls.filter((c) => c.url.startsWith(SPOON));
export const fsCalls = (t: TestApp, method?: string) =>
  t.foodWeb.calls.filter((c) => c.url === FS_API && (!method || new URLSearchParams(String(c.body)).get("method") === method));
export const tokenCalls = (t: TestApp) => t.foodWeb.calls.filter((c) => c.url === FS_TOKEN);

/** The admin sets the restaurant keys (the TestApp must be signed in as the admin). */
export async function setRestaurantKeys(t: TestApp, keys: { spoonacular?: string | null; fatsecret?: { id: string; secret: string } | null }) {
  const body: Record<string, unknown> = {};
  if (keys.spoonacular !== undefined) body.spoonacularApiKey = keys.spoonacular;
  if (keys.fatsecret !== undefined) {
    body.fatsecretClientId = keys.fatsecret?.id ?? null;
    body.fatsecretClientSecret = keys.fatsecret?.secret ?? null;
  }
  const res = await t.api("PUT", "/api/admin/food-sources", body);
  if (res.status !== 200) throw new Error(`setRestaurantKeys: ${res.status} ${JSON.stringify(res.body)}`);
}
