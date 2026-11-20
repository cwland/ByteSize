// Nutrients, units, scaling and totals (pure). Metric inside; unknown = key absent, never 0.

export const NUTRIENT_KEYS = [
  "calories",
  "protein_g",
  "fiber_g",
  "carbs_g",
  "fat_g",
  "saturated_fat_g",
  "sugar_g",
  "added_sugar_g",
  "sugar_alcohol_g",
  "sodium_mg",
  "potassium_mg",
  "magnesium_mg",
  "water_ml",
] as const;

export type NutrientKey = (typeof NUTRIENT_KEYS)[number];
export type Nutrients = Partial<Record<NutrientKey, number>>;
/**
 * servings[0] is the base the nutrients are for. approx: the ml was estimated from the grams
 * (1 g ≈ 1 ml) for a drink known only by weight; it plays no other part in the maths.
 */
/** per: how many of servings[0] one of this is, for a counted unit with no weight ("1 cracker" of "12 crackers").
 * derived: worked out on lookup (lib/measures.ts), never stored on a food. */
export type Serving = { label: string; grams?: number; ml?: number; approx?: true; per?: number; derived?: true };
export type Unit = "serving" | "g" | "oz" | "ml" | "fl_oz" | "cup" | "tbsp" | "tsp";

export class UnitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnitError";
  }
}

/** Grams per mass unit. */
const MASS_G: Partial<Record<Unit, number>> = { g: 1, oz: 28.349523125 };
/** Millilitres per volume unit. */
const VOLUME_ML: Partial<Record<Unit, number>> = {
  ml: 1,
  fl_oz: 29.5735295625,
  cup: 236.5882365,
  tbsp: 14.78676478125,
  tsp: 4.92892159375,
};

const positive = (n: number | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

/** How many base servings (servings[0]) `quantity` of `unit` is. Throws UnitError when it can't be measured. */
export function amountFactor(servings: Serving[], servingIndex: number, unit: Unit, quantity: number): number {
  const cant = () => new UnitError(`Can't measure this food in ${unit}`);
  const base = servings[0];
  if (!base) throw cant();

  if (unit === "serving") {
    const s = servings[servingIndex];
    if (!s) throw cant();
    if (servingIndex === 0) return quantity;
    if (positive(s.grams) && positive(base.grams)) return quantity * (s.grams / base.grams);
    if (positive(s.ml) && positive(base.ml)) return quantity * (s.ml / base.ml);
    if (positive(s.per)) return quantity * s.per;
    throw cant();
  }

  const g = MASS_G[unit];
  if (g !== undefined) {
    if (!positive(base.grams)) throw cant();
    return (quantity * g) / base.grams;
  }
  const ml = VOLUME_ML[unit];
  if (ml !== undefined) {
    if (!positive(base.ml)) throw cant();
    return (quantity * ml) / base.ml;
  }
  throw cant();
}

// ---------- liquid measures ----------

/** Words that make a food a liquid (category or name; whole words, plural "s"/"es" allowed). */
export const LIQUID_WORDS = ["milk", "juice", "drink", "beverage", "water", "coffee", "tea", "soda", "broth", "shake", "smoothie", "kefir", "oil", "syrup", "creamer"];
/** Words that make it a solid even so ("milk chocolate", "cheese, whole milk", "coffee beans", "tuna in oil"), checked first. */
const SOLID_WORDS = ["cheese", "milk chocolate", "bar", "powder", "cereal", "cookie", "cracker", "chip", "cake", "ice cream", "bean", "ground", "candy", "candie", "pudding", "tuna", "sardine", "fish", "chestnut", "mix", "mixes", "ricotta", "cottage", "oatmeal", "oats"];

const wordsRe = (words: string[]) => new RegExp(`\\b(?:${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?:e?s)?\\b`);
const LIQUID_RE = wordsRe(LIQUID_WORDS);
const SOLID_RE = wordsRe(SOLID_WORDS);
const plain = (t: string | null | undefined) => (t ?? "").toLowerCase().replace(/[^a-z]+/g, " "); // "en:milks" → "en milks"

/** Liquid by name first (a solid word wins), then by category. */
export function isLiquid(category: string | null | undefined, name: string | null | undefined): boolean {
  const n = plain(name);
  if (SOLID_RE.test(n)) return false;
  if (LIQUID_RE.test(n)) return true;
  // USDA files whole fruit under "Fruits and Fruit Juices": that says nothing either way (juices say so by name)
  const c = plain(category).replace("fruits and fruit juices", " ");
  if (SOLID_RE.test(c)) return false;
  return LIQUID_RE.test(c);
}

/**
 * A drink known only by weight gets volumes: ml = grams (1 g ≈ 1 ml), marked approx, on every
 * serving with grams. Foods with a real volume on servings[0], and solids, come back unchanged.
 */
export function withLiquidVolumes(servings: Serving[], category: string | null | undefined, name: string | null | undefined): Serving[] {
  const base = servings[0];
  if (!base || !positive(base.grams) || base.ml !== undefined || !isLiquid(category, name)) return servings;
  return servings.map((s) => (positive(s.grams) && s.ml === undefined ? { ...s, ml: s.grams, approx: true as const } : s));
}

function roundKey(key: NutrientKey, v: number): number {
  return key === "calories" ? Math.round(v) : Math.round(v * 10) / 10;
}

/** Multiplies known keys only; calories rounded to whole, the rest to 1 decimal. */
export function scaleNutrients(per: Nutrients, factor: number): Nutrients {
  const out: Nutrients = {};
  for (const k of NUTRIENT_KEYS) {
    const v = per[k];
    if (typeof v === "number" && Number.isFinite(v)) out[k] = roundKey(k, v * factor);
  }
  return out;
}

/** Totals with unknown treated as 0; unknownCount[key] = items lacking that key (only keys with ≥1). */
export function sumNutrients(list: Nutrients[]): Nutrients & { unknownCount: Record<string, number> } {
  const totals: Nutrients = {};
  const unknownCount: Record<string, number> = {};
  for (const k of NUTRIENT_KEYS) {
    let sum = 0;
    for (const n of list) {
      const v = n[k];
      if (typeof v === "number" && Number.isFinite(v)) sum += v;
      else unknownCount[k] = (unknownCount[k] ?? 0) + 1;
    }
    totals[k] = roundKey(k, sum);
  }
  return { ...totals, unknownCount };
}

// ---------- combining two amounts of the same food (§28) ----------

export type Amount = { servingIndex: number; unit: Unit; quantity: number; fraction: number };

/** How many grams (or millilitres) one of this amount's unit is, or undefined when it doesn't say. */
function perUnit(servings: Serving[], a: Amount, dim: "grams" | "ml"): number | undefined {
  if (a.unit === "serving") {
    const v = servings[a.servingIndex]?.[dim];
    return positive(v) ? v : undefined;
  }
  return (dim === "grams" ? MASS_G : VOLUME_ML)[a.unit];
}

/**
 * `added` (measured against `addedServings`) put into `existing` (against `servings`), in the existing
 * amount's own unit: the same unit adds up; different units add through grams, or else millilitres.
 * null when they can't meet (they then stay separate entries).
 */
export function combineAmounts(servings: Serving[], existing: Amount, addedServings: Serving[], added: Amount): Amount | null {
  const have = existing.quantity * existing.fraction;
  const add = added.quantity * added.fraction;
  const round = (n: number) => Math.round(n * 10000) / 10000;
  const sameUnit = existing.unit === added.unit && (existing.unit !== "serving" || existing.servingIndex === added.servingIndex);
  if (sameUnit) return { servingIndex: existing.servingIndex, unit: existing.unit, quantity: round(have + add), fraction: 1 };
  for (const dim of ["grams", "ml"] as const) {
    const into = perUnit(servings, existing, dim);
    const from = perUnit(addedServings, added, dim);
    if (into && from) return { servingIndex: existing.servingIndex, unit: existing.unit, quantity: round(have + (add * from) / into), fraction: 1 };
  }
  return null;
}
