// Spoonacular menu items (https://spoonacular.com/food-api/docs#Search-Menu-Items, #Get-Menu-Item-Information).
// The key goes in the x-api-key header, never the URL. Free plan: 50 points/day, then 402 until midnight UTC.
//   GET /food/menuItems/search?query=&number=&addMenuItemInformation=true   1 point + 0.01 per result
//   GET /food/menuItems/{id}                                                1 point
// Nutrition is for the whole item.
import type { Nutrients, Serving } from "../nutrients.js";
import { num, requestJson, round, SourceError, type FoodFetch, type SourceFood } from "../foodSources/types.js";
import { SOURCE_ID, type MenuHit, type Quota, type RestaurantAdapter } from "./types.js";

export const SPOONACULAR_BASE = "https://api.spoonacular.com/food/menuItems";
const SEARCH_RESULTS = 10;

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Points left today from X-API-Quota-Left, when sent. */
export function quotaFrom(headers: Headers): Quota | undefined {
  const raw = headers.get("x-api-quota-left");
  const n = raw === null || raw.trim() === "" ? NaN : Number(raw);
  return Number.isFinite(n) ? { left: Math.max(0, n) } : undefined;
}

// Spoonacular nutrient names → ByteSize keys and the unit kept
const MAP: [string, keyof Nutrients, "kcal" | "g" | "mg"][] = [
  ["calories", "calories", "kcal"],
  ["protein", "protein_g", "g"],
  ["carbohydrates", "carbs_g", "g"],
  ["fat", "fat_g", "g"],
  ["saturated fat", "saturated_fat_g", "g"],
  ["fiber", "fiber_g", "g"],
  ["sugar", "sugar_g", "g"],
  ["added sugar", "added_sugar_g", "g"],
  ["sodium", "sodium_mg", "mg"],
  ["potassium", "potassium_mg", "mg"],
  ["magnesium", "magnesium_mg", "mg"],
];

function inUnit(value: number, unit: unknown, want: "kcal" | "g" | "mg"): number | undefined {
  const u = String(unit ?? "").trim().toLowerCase();
  if (want === "kcal") return ["cal", "kcal", ""].includes(u) ? value : u === "kj" ? value / 4.184 : undefined;
  const toMg: Record<string, number> = { g: 1000, mg: 1, µg: 0.001, ug: 0.001, mcg: 0.001 };
  const f = toMg[u];
  if (f === undefined) return undefined;
  return want === "g" ? (value * f) / 1000 : value * f;
}

function nutrientsOf(item: any): Nutrients {
  const list: any[] = Array.isArray(item?.nutrition?.nutrients) ? item.nutrition.nutrients : [];
  const byName = new Map<string, any>();
  for (const n of list) {
    const name = String(n?.name ?? "").trim().toLowerCase();
    if (name && !byName.has(name)) byName.set(name, n);
  }
  const out: Nutrients = {};
  for (const [name, key, unit] of MAP) {
    const hit = byName.get(name);
    const amount = hit ? num(hit.amount) : undefined;
    const v = amount === undefined ? undefined : inUnit(amount, hit.unit, unit);
    if (v !== undefined) out[key] = round(v, unit === "g" ? 2 : 1);
  }
  return out;
}

function imageOf(item: any): string | null {
  const img = text(item?.image);
  if (img && /^https:\/\//.test(img)) return img;
  // Get Menu Item Information sends only imageType; the documented image address is built from the id
  const type = text(item?.imageType);
  return type && /^[a-z]+$/i.test(type) && validId(item) ? `https://img.spoonacular.com/menu-items/${String(item.id)}-312x231.${type}` : null;
}

/** Ids are numbers; anything else is dropped (it would end up in URLs). */
const validId = (item: any) => (typeof item?.id === "number" || typeof item?.id === "string") && SOURCE_ID.test(String(item.id));

function hitOf(item: any): MenuHit | null {
  const name = text(item?.title);
  if (!name || !validId(item)) return null;
  const calories = nutrientsOf(item).calories;
  return { source: "spoonacular", sourceId: String(item.id), chain: text(item?.restaurantChain) ?? "Restaurant", name, calories: calories ?? null, imageUrl: imageOf(item) };
}

export function normalizeSpoonacular(item: any): SourceFood {
  const name = text(item?.title);
  if (!name || !validId(item)) throw new SourceError("spoonacular", "Spoonacular sent something unexpected", "bad_data");
  // One serving = the whole item; grams only when Spoonacular gives the item's weight in grams
  const s = item?.servings;
  const size = num(s?.size);
  const grams = size && (num(s?.number) ?? 1) === 1 && ["g", "gram", "grams"].includes(String(s?.unit ?? "").toLowerCase()) ? size : undefined;
  const servings: Serving[] = [grams ? { label: "1 item", grams } : { label: "1 item" }];
  return {
    source: "spoonacular",
    sourceId: String(item.id),
    barcode: null,
    name,
    brand: text(item?.restaurantChain),
    category: null,
    servings,
    nutrients: nutrientsOf(item),
    imageUrl: imageOf(item),
    raw: item,
  };
}

/** A non-2xx answer as a typed error (never echoes the body, which may repeat the key). */
function statusError(status: number): SourceError {
  if (status === 402) return new SourceError("spoonacular", "Spoonacular's daily lookups are used up", "quota");
  if (status === 401 || status === 403) return new SourceError("spoonacular", "Spoonacular refused the key — check it in Settings › Integrations", "bad_key");
  if (status === 429) return new SourceError("spoonacular", "Spoonacular is busy — try again in a moment", "down");
  return new SourceError("spoonacular", `Spoonacular answered with an error (${status})`, "down");
}

const badData = () => new SourceError("spoonacular", "Spoonacular sent something unexpected", "bad_data");

export function spoonacular(opts: { fetch: FoodFetch; apiKey: string; timeoutMs: number }): RestaurantAdapter {
  const get = async (url: string) => {
    const { status, json, headers } = await requestJson(opts.fetch, "spoonacular", url, { method: "GET", headers: { "x-api-key": opts.apiKey, Accept: "application/json" } }, opts.timeoutMs);
    if (status < 200 || status >= 300) throw statusError(status);
    if (!json || typeof json !== "object") throw badData();
    return { json, quota: quotaFrom(headers) };
  };
  return {
    source: "spoonacular",
    async search(q, limit = SEARCH_RESULTS) {
      const params = new URLSearchParams({ query: q, number: String(limit), addMenuItemInformation: "true" });
      const { json, quota } = await get(`${SPOONACULAR_BASE}/search?${params}`);
      if (!Array.isArray(json.menuItems)) throw badData();
      const items = json.menuItems.map(hitOf).filter((h: MenuHit | null): h is MenuHit => h !== null);
      return quota ? { items, quota } : { items };
    },
    async item(id) {
      const { json, quota } = await get(`${SPOONACULAR_BASE}/${encodeURIComponent(id)}`);
      const food = normalizeSpoonacular(json);
      return quota ? { food, quota } : { food };
    },
  };
}
