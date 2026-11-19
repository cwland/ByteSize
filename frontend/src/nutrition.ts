import type { Nutrients, Serving, Unit } from "./types";
import { ML_PER_FL_OZ } from "./units";

// Client copy of the API's portion math (backend lib/nutrients.ts), for the live portion preview.
const GRAMS: Partial<Record<Unit, number>> = { g: 1, oz: 28.349523125 };
const ML: Partial<Record<Unit, number>> = { ml: 1, fl_oz: ML_PER_FL_OZ, cup: 236.5882365, tbsp: 14.78676478125, tsp: 4.92892159375 };

export const UNIT_LABEL: Record<Unit, string> = { serving: "serving", g: "g", oz: "oz", ml: "ml", fl_oz: "fl oz", cup: "cup", tbsp: "tbsp", tsp: "tsp" };

// How many base servings (servings[0]) this amount is
export function amountFactor(servings: Serving[], servingIndex: number, unit: Unit, quantity: number): number {
  const base = servings[0];
  const fail = () => new Error(`Can't measure this food in ${UNIT_LABEL[unit]}`);
  if (unit === "serving") {
    const s = servings[servingIndex];
    if (!base || !s) throw fail();
    if (s.grams && base.grams) return (quantity * s.grams) / base.grams;
    if (s.ml && base.ml) return (quantity * s.ml) / base.ml;
    if (servingIndex === 0) return quantity;
    throw fail();
  }
  if (GRAMS[unit] !== undefined) {
    if (!base?.grams) throw fail();
    return (quantity * GRAMS[unit]!) / base.grams;
  }
  if (!base?.ml) throw fail();
  return (quantity * ML[unit]!) / base.ml;
}

export function scaleNutrients(per: Nutrients, factor: number): Nutrients {
  const out: Nutrients = {};
  for (const [k, v] of Object.entries(per) as [keyof Nutrients, number][]) {
    if (typeof v !== "number") continue;
    out[k] = k === "calories" ? Math.round(v * factor) : Math.round(v * factor * 10) / 10;
  }
  return out;
}
