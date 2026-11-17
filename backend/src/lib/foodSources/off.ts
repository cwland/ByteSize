// Open Food Facts: product by barcode (API v2) and text search (search-a-licious).
import { normalizeBarcode } from "../barcode.js";
import type { Nutrients, Serving } from "../nutrients.js";
import { APP_VERSION } from "../version.js";
import { num, requestJson, round, sourceStatusError, type FoodFetch, type SourceFood } from "./types.js";

export const OFF_FIELDS = [
  "code",
  "product_name",
  "brands",
  "categories_tags",
  "nutriments",
  "serving_size",
  "serving_quantity",
  "serving_quantity_unit",
  "nutrition_data_per",
  "image_front_small_url",
].join(",");

export const OFF_USER_AGENT = `ByteSize/${APP_VERSION} (self-hosted; https://github.com/cwland/ByteSize)`;
const headers = { "User-Agent": OFF_USER_AGENT, Accept: "application/json" };

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

function firstBrand(brands: unknown): string | null {
  if (Array.isArray(brands)) return brands.map(text).find((b) => b) ?? null;
  const s = text(brands);
  return s ? (s.split(",").map((b) => b.trim()).find((b) => b) ?? null) : null;
}

/** OFF product → SourceFood. Nutrients per 100 g (or 100 ml for drinks given per 100 ml). */
export function normalizeOff(p: any): SourceFood {
  const n = (p?.nutriments ?? {}) as Record<string, unknown>;
  const perMl = p?.nutrition_data_per === "100ml" || Object.keys(n).some((k) => k.endsWith("_100ml"));
  const suffix = perMl ? "_100ml" : "_100g";
  // Per-100 value: the _100ml key for drinks (falling back to _100g, which OFF fills the same way)
  const v = (key: string) => num(n[key + suffix]) ?? (perMl ? num(n[key + "_100g"]) : undefined);

  const nutrients: Nutrients = {};
  const kcal = v("energy-kcal");
  const kj = v("energy-kj") ?? v("energy");
  if (kcal !== undefined) nutrients.calories = round(kcal, 1);
  else if (kj !== undefined) nutrients.calories = round(kj / 4.184, 1);
  const grams: [string, keyof Nutrients][] = [
    ["proteins", "protein_g"],
    ["fiber", "fiber_g"],
    ["carbohydrates", "carbs_g"],
    ["fat", "fat_g"],
    ["saturated-fat", "saturated_fat_g"],
    ["sugars", "sugar_g"],
    ["added-sugars", "added_sugar_g"],
    ["polyols", "sugar_alcohol_g"],
  ];
  for (const [k, to] of grams) {
    const x = v(k);
    if (x !== undefined) nutrients[to] = round(x, 2);
  }
  const mg: [string, keyof Nutrients][] = [
    ["sodium", "sodium_mg"],
    ["potassium", "potassium_mg"],
    ["magnesium", "magnesium_mg"],
  ];
  for (const [k, to] of mg) {
    const x = v(k); // OFF stores minerals in grams
    if (x !== undefined) nutrients[to] = round(x * 1000, 1);
  }

  const servings: Serving[] = [perMl ? { label: "100 ml", ml: 100 } : { label: "100 g", grams: 100 }];
  const size = text(p?.serving_size);
  const qty = num(p?.serving_quantity);
  if (size && qty) {
    const unit = String(p?.serving_quantity_unit ?? "").toLowerCase();
    const inMl = unit === "ml" || (unit !== "g" && perMl);
    servings.push(inMl ? { label: size, ml: qty } : { label: size, grams: qty });
  }

  const code = String(p?.code ?? "");
  const cats = Array.isArray(p?.categories_tags) ? p.categories_tags : [];
  return {
    source: "off",
    sourceId: code,
    barcode: normalizeBarcode(code),
    name: text(p?.product_name) ?? "Unnamed product",
    brand: firstBrand(p?.brands),
    category: text(cats[0]),
    servings,
    nutrients,
    imageUrl: text(p?.image_front_small_url),
    raw: p,
  };
}

export async function offByBarcode(fetchFn: FoodFetch, code: string, timeoutMs: number): Promise<SourceFood | null> {
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${OFF_FIELDS}`;
  const { status, json } = await requestJson(fetchFn, "off", url, { method: "GET", headers }, timeoutMs);
  if (status === 404) return null;
  if (status < 200 || status >= 300) throw sourceStatusError("off", status);
  if (!json || json.status === 0 || json.status === "0" || !json.product) return null;
  return normalizeOff({ code: json.code ?? code, ...json.product });
}

export async function offSearch(fetchFn: FoodFetch, q: string, timeoutMs: number, limit = 10): Promise<SourceFood[]> {
  const url = `https://search.openfoodfacts.org/search?q=${encodeURIComponent(q)}&page_size=${limit}&fields=${OFF_FIELDS}`;
  const { status, json } = await requestJson(fetchFn, "off", url, { method: "GET", headers }, timeoutMs);
  if (status < 200 || status >= 300) throw sourceStatusError("off", status);
  const hits: unknown[] = Array.isArray(json?.hits) ? json.hits : [];
  return hits
    .filter((h: any) => text(h?.product_name))
    .map(normalizeOff)
    .filter((f) => f.nutrients.calories !== undefined);
}
