import type { Serving } from "./nutrients.js";

// L1 (SPEC-01): the units a person counts a food in, worked out from its servings when it's looked up (never stored
// on the food): "1 prune" from "5 prunes", "1 slice" from "4 slices (56g)", and small / medium / large for whole
// produce. They're only ever added after the food's own servings, so every stored servingIndex keeps its meaning.

/** Words that measure rather than count ("2 tbsp", "3 oz", "2 servings"): never "1 tbsp" from them. */
const MEASURING = new Set([
  "g", "gram", "grams", "gr", "kg", "mg", "oz", "ounce", "ounces", "lb", "lbs", "pound", "pounds",
  "cup", "cups", "c", "tbsp", "tablespoon", "tablespoons", "tbs", "tsp", "teaspoon", "teaspoons",
  "ml", "l", "liter", "liters", "litre", "litres", "fl", "floz", "pint", "pints", "quart", "quarts", "gallon",
  "serving", "servings", "container", "containers", "package", "packages", "pkg", "bottle", "bottles", "can", "cans",
  "scoop", "scoops", "portion", "portions", "packet", "packets", "pouch", "pouches", "box", "boxes", "bag", "bags",
  "jar", "jars", "carton", "cartons", "envelope", "envelopes", "dash", "pinch", "drop", "drops",
]);

/** "5 prunes", "4 slices (56g)", "12 crackers": the count and the counted thing. */
const COUNTED = /^\s*(\d+(?:\.\d+)?)\s+([a-z][a-z' -]*?)\s*(?:\(.*\))?\s*$/i;

/** One of the thing: "prunes" → "prune", "berries" → "berry", "pieces" → "piece" (last word only). */
export function singular(noun: string): string {
  const words = noun.trim().split(/\s+/);
  const last = words.pop() ?? "";
  const lower = last.toLowerCase();
  let one = last;
  if (lower.endsWith("ies") && lower.length > 4) one = last.slice(0, -3) + "y";
  else if (/(ches|shes|sses|xes|zes)$/.test(lower)) one = last.slice(0, -2);
  else if (lower.endsWith("oes")) one = last.slice(0, -2);
  else if (lower.endsWith("s") && !lower.endsWith("ss") && !lower.endsWith("us")) one = last.slice(0, -1);
  return [...words, one].join(" ");
}

/** Typical grams of a small, medium and large one (USDA standard sizes). Longer names first (sweet potato before potato). */
export const SIZE_TABLE: { match: RegExp; grams: [number, number, number] }[] = [
  { match: /\bsweet potato(es)?\b/i, grams: [60, 114, 180] },
  { match: /\bchicken breasts?\b/i, grams: [120, 174, 240] },
  { match: /\bapples?\b/i, grams: [149, 182, 223] },
  { match: /\bbananas?\b/i, grams: [101, 118, 136] },
  { match: /\boranges?\b/i, grams: [96, 131, 184] },
  { match: /\bpears?\b/i, grams: [148, 178, 230] },
  { match: /\bpeach(es)?\b/i, grams: [130, 150, 175] },
  { match: /\bpotato(es)?\b/i, grams: [170, 213, 369] },
  { match: /\beggs?\b/i, grams: [38, 44, 50] },
  { match: /\bavocados?\b/i, grams: [136, 150, 201] },
];

const positive = (n: number | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
const round = (n: number) => Math.round(n * 100) / 100;

/** One of the counted thing in a serving, as a serving: by weight/volume when they can be compared with servings[0], else as a share. */
function countedOne(s: Serving, i: number, base: Serving): Serving | null {
  const m = COUNTED.exec(s.label);
  if (!m) return null;
  const count = Number(m[1]);
  const noun = m[2].trim();
  if (!(count > 1) || MEASURING.has(noun.split(/\s+/)[0].toLowerCase())) return null;
  const label = `1 ${singular(noun)}`;
  if (positive(s.grams) && positive(base.grams)) return { label, grams: round(s.grams / count), derived: true };
  if (positive(s.ml) && positive(base.ml)) return { label, ml: round(s.ml / count), derived: true };
  if (i === 0) return { label, per: 1 / count, derived: true };
  if (positive(s.per)) return { label, per: s.per / count, derived: true };
  return null;
}

/** The food's servings, then the counted and sized units it can also be logged in. */
export function withMeasures(servings: Serving[], name: string | null | undefined): Serving[] {
  const own = servings.filter((s) => !s.derived);
  const base = own[0];
  if (!base) return servings;
  const out: Serving[] = [...own];
  const has = (label: string) => out.some((s) => s.label.toLowerCase() === label.toLowerCase());
  const add = (s: Serving | null) => {
    if (s && !has(s.label)) out.push(s);
  };

  own.forEach((s, i) => add(countedOne(s, i, base)));

  const sized = own.some((s) => /\b(small|medium|large)\b/i.test(s.label));
  const row = name ? SIZE_TABLE.find((r) => r.match.test(name)) : undefined;
  if (row && !sized && positive(base.grams)) {
    (["small", "medium", "large"] as const).forEach((size, k) => add({ label: `1 ${size}`, grams: row.grams[k], derived: true }));
  }
  return out;
}
