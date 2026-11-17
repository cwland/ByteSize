import type { Nutrients, Serving, Unit, Units } from "./types";
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

// Units besides the food's own servings it can be measured in
export function unitChoices(servings: Serving[]): Unit[] {
  const base = servings[0];
  return [...(base?.grams ? (["g", "oz"] as Unit[]) : []), ...(base?.ml ? (["ml", "fl_oz", "cup", "tbsp", "tsp"] as Unit[]) : [])];
}

export const FRACTIONS = [
  { label: "¼", value: 0.25 },
  { label: "⅓", value: 1 / 3 },
  { label: "½", value: 0.5 },
  { label: "¾", value: 0.75 },
  { label: "Full", value: 1 },
];
const num = (n: number) => String(Math.round(n * 100) / 100);
const fractionText = (f: number) => FRACTIONS.find((x) => Math.abs(x.value - f) < 0.001)?.label ?? num(f);

// "2 slices", "½ × 1 bar", "2 × 1 bar", "50 g", water "8 fl oz"
export function portionText(e: { servings: Serving[]; servingIndex: number; unit: Unit; quantity: number; fraction: number }, units: Units) {
  let amount: string;
  if (e.unit === "serving") {
    const label = e.servings[e.servingIndex]?.label ?? "serving";
    amount = e.quantity === 1 ? label : `${num(e.quantity)} × ${label}`;
  } else if (e.unit === "ml" && units === "imperial") {
    amount = `${Math.round(e.quantity / ML_PER_FL_OZ)} fl oz`;
  } else {
    amount = `${num(e.quantity)} ${UNIT_LABEL[e.unit]}`;
  }
  return e.fraction < 0.999 ? `${fractionText(e.fraction)} × ${amount}` : amount;
}
