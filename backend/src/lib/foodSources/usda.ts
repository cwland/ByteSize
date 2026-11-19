// USDA FoodData Central: /foods/search for text and (Branded) barcodes, /food/{fdcId} for one kept food again.
// Values are per 100 g (100 ml).
import { normalizeBarcode } from "../barcode.js";
import type { Nutrients, Serving } from "../nutrients.js";
import { num, requestJson, round, sourceStatusError, type FoodFetch, type SourceFood } from "./types.js";

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

// nutrientNumber candidates in order of preference, and how many decimals to keep
const MAP: [keyof Nutrients, string[], "kcal" | "g" | "mg"][] = [
  ["calories", ["208", "958", "957"], "kcal"],
  ["protein_g", ["203"], "g"],
  ["fiber_g", ["291"], "g"],
  ["carbs_g", ["205", "205.2"], "g"],
  ["fat_g", ["204", "298"], "g"],
  ["saturated_fat_g", ["606"], "g"],
  ["sugar_g", ["269", "269.3"], "g"],
  ["added_sugar_g", ["539"], "g"],
  ["sodium_mg", ["307"], "mg"],
  ["potassium_mg", ["306"], "mg"],
  ["magnesium_mg", ["304"], "mg"],
];

/** A nutrient value converted to the unit ByteSize keeps (kcal, g or mg); undefined if the unit is odd. */
function inUnit(value: number, unitName: unknown, want: "kcal" | "g" | "mg"): number | undefined {
  const u = String(unitName ?? "").toUpperCase();
  if (want === "kcal") return u === "KCAL" || u === "" ? value : u === "KJ" ? value / 4.184 : undefined;
  const toMg: Record<string, number> = { G: 1000, MG: 1, UG: 0.001, "µG": 0.001 };
  const f = toMg[u] ?? (u === "" ? (want === "g" ? 1000 : 1) : undefined);
  if (f === undefined) return undefined;
  return want === "g" ? (value * f) / 1000 : value * f;
}

function servingUnit(u: unknown): "g" | "ml" | null {
  const s = String(u ?? "").toLowerCase();
  if (s === "g" || s === "grm" || s === "gm") return "g";
  if (s === "ml" || s === "mlt") return "ml";
  return null;
}

export function normalizeUsda(food: any): SourceFood {
  const byNumber = new Map<string, { value: unknown; unitName: unknown }>();
  for (const fn of Array.isArray(food?.foodNutrients) ? food.foodNutrients : []) {
    const number = String(fn?.nutrientNumber ?? fn?.nutrient?.number ?? "");
    if (number && !byNumber.has(number)) byNumber.set(number, { value: fn?.value ?? fn?.amount, unitName: fn?.unitName ?? fn?.nutrient?.unitName });
  }
  const nutrients: Nutrients = {};
  for (const [key, numbers, unit] of MAP) {
    for (const n of numbers) {
      const hit = byNumber.get(n);
      const value = hit ? num(hit.value) : undefined;
      const v = value === undefined ? undefined : inUnit(value, hit!.unitName, unit);
      if (v !== undefined) {
        nutrients[key] = round(v, unit === "g" ? 2 : 1);
        break;
      }
    }
  }

  const unit = food?.dataType === "Branded" ? servingUnit(food?.servingSizeUnit) : null;
  const servings: Serving[] = [unit === "ml" ? { label: "100 ml", ml: 100 } : { label: "100 g", grams: 100 }];
  const size = num(food?.servingSize);
  if (unit && size) {
    const label = text(food?.householdServingFullText) ?? `${size} ${unit}`;
    servings.push(unit === "ml" ? { label, ml: size } : { label, grams: size });
  }

  const cat = food?.foodCategory;
  return {
    source: "usda",
    sourceId: String(food?.fdcId ?? ""),
    barcode: food?.gtinUpc ? normalizeBarcode(String(food.gtinUpc)) : null,
    name: text(food?.description) ?? "Unnamed food",
    brand: text(food?.brandName) ?? text(food?.brandOwner),
    category: text(cat) ?? text(cat?.description) ?? text(food?.brandedFoodCategory),
    servings,
    nutrients,
    imageUrl: null,
    raw: food,
  };
}

async function search(fetchFn: FoodFetch, apiKey: string, query: string, dataType: string[], timeoutMs: number, pageSize = 10): Promise<any[]> {
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(apiKey)}`;
  const init: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, pageSize, dataType }),
  };
  const { status, json } = await requestJson(fetchFn, "usda", url, init, timeoutMs);
  if (status < 200 || status >= 300) throw sourceStatusError("usda", status);
  return Array.isArray(json?.foods) ? json.foods : [];
}

const usable = (foods: any[]) =>
  foods
    .filter((f) => text(f?.description))
    .map(normalizeUsda)
    .filter((f) => f.nutrients.calories !== undefined);

/**
 * Text search: plain whole foods (Foundation / SR Legacy, marked basic) and Branded foods are asked
 * for separately, at the same time, so branded hits never crowd out the basic ones. Basic come first;
 * a food both calls return is kept once, as basic. When one call fails, the other's foods are still
 * returned, with the failure as `error`; when both fail, it throws.
 */
export async function usdaSearch(fetchFn: FoodFetch, apiKey: string, q: string, timeoutMs: number): Promise<{ foods: SourceFood[]; error: Error | null }> {
  const [basicCall, brandedCall] = await Promise.allSettled([
    search(fetchFn, apiKey, q, ["Foundation", "SR Legacy"], timeoutMs, 5),
    search(fetchFn, apiKey, q, ["Branded"], timeoutMs, 10),
  ]);
  if (basicCall.status === "rejected" && brandedCall.status === "rejected") throw basicCall.reason;
  const basic = basicCall.status === "fulfilled" ? usable(basicCall.value).map((f) => ({ ...f, basic: true as const })) : [];
  const seen = new Set(basic.map((f) => f.sourceId));
  const branded = brandedCall.status === "fulfilled" ? usable(brandedCall.value).filter((f) => !seen.has(f.sourceId)) : [];
  const failed = basicCall.status === "rejected" ? basicCall.reason : brandedCall.status === "rejected" ? brandedCall.reason : null;
  return { foods: [...basic, ...branded], error: failed };
}

export async function usdaByBarcode(fetchFn: FoodFetch, apiKey: string, code: string, timeoutMs: number): Promise<SourceFood | null> {
  const want = normalizeBarcode(code);
  if (!want) return null;
  const foods = await search(fetchFn, apiKey, code, ["Branded"], timeoutMs);
  const hit = foods.find((f) => f?.gtinUpc && normalizeBarcode(String(f.gtinUpc)) === want);
  return hit ? normalizeUsda(hit) : null;
}

/** One food by its FDC id (Check for changes); null when USDA no longer has it. */
export async function usdaById(fetchFn: FoodFetch, apiKey: string, fdcId: string, timeoutMs: number): Promise<SourceFood | null> {
  if (!/^\d{1,19}$/.test(fdcId)) return null;
  const url = `https://api.nal.usda.gov/fdc/v1/food/${fdcId}?api_key=${encodeURIComponent(apiKey)}`;
  const { status, json } = await requestJson(fetchFn, "usda", url, { method: "GET", headers: { Accept: "application/json" } }, timeoutMs);
  if (status === 404) return null;
  if (status < 200 || status >= 300) throw sourceStatusError("usda", status);
  return json && typeof json === "object" && text(json.description) ? normalizeUsda(json) : null;
}
