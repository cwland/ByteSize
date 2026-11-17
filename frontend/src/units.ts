import type { Units } from "./types";

// Display conversions. Everything is stored metric; imperial is the default display.
export const KG_PER_LB = 0.45359237;
export const CM_PER_IN = 2.54;
export const ML_PER_FL_OZ = 29.5735295625;

export const lbToKg = (lb: number) => lb * KG_PER_LB;
export const kgToLb = (kg: number) => kg / KG_PER_LB;
export const inToCm = (inches: number) => inches * CM_PER_IN;
export const flOzToMl = (oz: number) => oz * ML_PER_FL_OZ;
export const mlToFlOz = (ml: number) => ml / ML_PER_FL_OZ;

// 177.8 cm -> 5 ft 10 in (whole inches; 71.97 in is 6 ft 0 in)
export function cmToFtIn(cm: number) {
  const total = Math.round(cm / CM_PER_IN);
  return { ft: Math.floor(total / 12), in: total % 12 };
}

const num = (n: number, digits = 0) => n.toLocaleString("en-US", { maximumFractionDigits: digits });

export const formatWeight = (kg: number, units: Units) => (units === "metric" ? `${num(kg, 1)} kg` : `${num(kgToLb(kg), 1)} lb`);
// Weight as a bare number in the person's units, to 1 decimal (inputs, chart axes), and back to kg
export const weightValue = (kg: number, units: Units) => Math.round((units === "metric" ? kg : kgToLb(kg)) * 10) / 10;
export const weightUnit = (units: Units) => (units === "metric" ? "kg" : "lb");
export const weightToKg = (value: number, units: Units) => (units === "metric" ? value : lbToKg(value));
export const formatWater = (ml: number, units: Units) => (units === "metric" ? `${num(ml)} ml` : `${num(mlToFlOz(ml))} fl oz`);
// Water as a bare number in the person's units (rings, editors)
export const waterValue = (ml: number, units: Units) => Math.round(units === "metric" ? ml : mlToFlOz(ml));
export const waterUnit = (units: Units) => (units === "metric" ? "ml" : "fl oz");
export const fmt = (n: number) => num(Math.round(n));
