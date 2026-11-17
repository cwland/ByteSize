// USDA FoodData Central: /foods/search for text and (Branded) barcodes. Values are per 100 g (100 ml).
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

async function search(fetchFn: FoodFetch, apiKey: string, query: string, dataType: string[], timeoutMs: number): Promise<any[]> {
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(apiKey)}`;
  const init: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, pageSize: 10, dataType }),
  };
  const { status, json } = await requestJson(fetchFn, "usda", url, init, timeoutMs);
  if (status < 200 || status >= 300) throw sourceStatusError("usda", status);
  return Array.isArray(json?.foods) ? json.foods : [];
}

export async function usdaSearch(fetchFn: FoodFetch, apiKey: string, q: string, timeoutMs: number): Promise<SourceFood[]> {
  const foods = await search(fetchFn, apiKey, q, ["Foundation", "SR Legacy", "Branded"], timeoutMs);
  return foods
    .filter((f) => text(f?.description))
    .map(normalizeUsda)
    .filter((f) => f.nutrients.calories !== undefined);
}

export async function usdaByBarcode(fetchFn: FoodFetch, apiKey: string, code: string, timeoutMs: number): Promise<SourceFood | null> {
  const want = normalizeBarcode(code);
  if (!want) return null;
  const foods = await search(fetchFn, apiKey, code, ["Branded"], timeoutMs);
  const hit = foods.find((f) => f?.gtinUpc && normalizeBarcode(String(f.gtinUpc)) === want);
  return hit ? normalizeUsda(hit) : null;
}
