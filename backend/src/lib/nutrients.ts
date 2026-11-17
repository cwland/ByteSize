// Nutrients, units, scaling and totals (pure). Metric inside; unknown = key absent, never 0.

export const NUTRIENT_KEYS = [
  "calories",
  "protein_g",
  "fiber_g",
  "carbs_g",
  "fat_g",
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
/** servings[0] is the base the nutrients are for. */
export type Serving = { label: string; grams?: number; ml?: number };
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
