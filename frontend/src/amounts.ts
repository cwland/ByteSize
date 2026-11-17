import type { Serving, Unit, Units } from "./types";
import { ML_PER_FL_OZ } from "./units";

// How an amount reads: amount first, mixed fractions, plural nouns. "1½ bars", "⅓ cup", "2 slices (56 g)".

export const FRACTION_CHOICES = [
  { value: 0, label: "—" },
  { value: 0.25, label: "¼" },
  { value: 0.333, label: "⅓" },
  { value: 0.5, label: "½" },
  { value: 0.667, label: "⅔" },
  { value: 0.75, label: "¾" },
] as const;
export type Fraction = (typeof FRACTION_CHOICES)[number]["value"];

const GLYPHS: [number, string][] = [
  [0.25, "¼"],
  [1 / 3, "⅓"],
  [0.5, "½"],
  [2 / 3, "⅔"],
  [0.75, "¾"],
];
const VOLUME: Unit[] = ["ml", "fl_oz", "cup", "tbsp", "tsp"];
const UNIT_TEXT: Record<Unit, string> = { serving: "serving", g: "g", oz: "oz", ml: "ml", fl_oz: "fl oz", cup: "cup", tbsp: "tbsp", tsp: "tsp" };

// A count: "1½", "⅓", "2"; otherwise one decimal ("1.4")
export function countText(x: number): string {
  const whole = Math.floor(x + 0.02);
  const rest = x - whole;
  if (Math.abs(rest) <= 0.02) return String(whole);
  const g = GLYPHS.find(([v]) => Math.abs(rest - v) <= 0.02);
  if (g) return `${whole || ""}${g[1]}`;
  return String(Math.round(x * 10) / 10);
}
// A metric measure: whole numbers from 10 up, one decimal below
const measureText = (x: number) => String(x >= 10 ? Math.round(x) : Math.round(x * 10) / 10);

const METRIC_WORDS = new Set(["g", "kg", "mg", "ml", "l"]);
const UNIT_WORDS = new Set([...METRIC_WORDS, "oz", "lb", "lbs", "tbsp", "tsp", "fl", "floz"]);
const ADJECTIVES = new Set(["small", "medium", "large", "extra", "whole", "jumbo", "mini", "thin", "thick", "regular", "big"]);

const plural = (w: string) => (/(ss|sh|ch|x)$/i.test(w) ? `${w}es` : /[^aeiou]y$/i.test(w) ? `${w.slice(0, -1)}ies` : /s$/i.test(w) ? w : `${w}s`);
const singular = (w: string) => (/[^aeiou]ies$/i.test(w) ? `${w.slice(0, -3)}y` : /(ss|sh|ch|x)es$/i.test(w) ? w.slice(0, -2) : /[^s]s$/i.test(w) ? w.slice(0, -1) : w);

// Pluralise (or singularise) the noun in "slice", "medium banana", "cup, chopped"
function nounFor(noun: string, many: boolean): string {
  if (/\(s\)/.test(noun)) return noun;
  const words = noun.split(" ");
  const i = words.findIndex((w) => w && !ADJECTIVES.has(w.toLowerCase()));
  if (i < 0) return noun;
  const [, word, tail] = words[i].match(/^([A-Za-z]+)(.*)$/) ?? [];
  if (!word) return noun;
  words[i] = (many ? plural(word) : singular(word)) + tail;
  return words.join(" ");
}

const leadingNumber = (s: string): number | null => {
  const g = GLYPHS.find(([, t]) => t === s);
  if (g) return g[0];
  const frac = s.match(/^(\d+)\/(\d+)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

function servingText(label: string, q: number): string {
  // fractions ("2/3 cup") must be tried before plain numbers, or "2/3" reads as 2 then "/3 cup"
  const m = label.trim().match(/^(\d+\/\d+|\d+(?:\.\d+)?|[¼⅓½⅔¾])\s*(.*)$/);
  const n = (m && leadingNumber(m[1])) ?? 1;
  const rest = m ? m[2] : label.trim();
  const total = n * q;
  const [, noun = rest, paren] = rest.match(/^(.*?)\s*(\([^)]*\))?$/) ?? [];
  const scaledParen = paren ? ` ${paren.replace(/\d+(?:\.\d+)?/g, (d) => measureText(Number(d) * q))}` : "";
  const first = noun.split(/[\s,]/)[0].toLowerCase();
  if (UNIT_WORDS.has(first)) return `${METRIC_WORDS.has(first) ? measureText(total) : countText(total)} ${noun}${scaledParen}`.trim();
  if (!noun) return `${countText(total)}${scaledParen}`;
  return `${countText(total)} ${nounFor(noun, total > 1.02)}${scaledParen}`;
}

// The amount of an entry or portion, e.g. formatAmount(servings, 1, "serving", 1.5, 1) → "1½ bars"
export function formatAmount(servings: Serving[], servingIndex: number, unit: Unit, quantity: number, fraction: number, units?: Units): string {
  const q = quantity * fraction;
  if (unit === "serving") return servingText(servings[servingIndex]?.label ?? "serving", q);
  // logged water (saved with a single "1 ml" serving, or none) in the person's units
  const isWater = servings.length === 0 || (servings.length === 1 && servings[0].label === "1 ml" && servings[0].ml === 1);
  if (unit === "ml" && units === "imperial" && isWater) return `${Math.round(q / ML_PER_FL_OZ)} fl oz`;
  const approx = VOLUME.includes(unit) && servings[0]?.approx ? "≈ " : "";
  const amount = unit === "g" || unit === "ml" ? measureText(q) : countText(q);
  const word = unit === "cup" && q > 1.02 ? "cups" : UNIT_TEXT[unit];
  return `${approx}${amount} ${word}`;
}

// Every way to measure this food: its own servings ("s:<index>"), then g/oz, then volumes (≈ when estimated)
export function unitChoices(servings: Serving[]): { value: string; label: string }[] {
  const base = servings[0];
  const approx = base?.approx ? "≈ " : "";
  return [
    ...servings.map((s, i) => ({ value: `s:${i}`, label: s.label })),
    ...(base?.grams ? (["g", "oz"] as Unit[]) : []).map((u) => ({ value: u, label: UNIT_TEXT[u] })),
    ...(base?.ml ? VOLUME : []).map((u) => ({ value: u, label: `${approx}${UNIT_TEXT[u]}` })),
  ];
}

// 1.5 → { whole: 1, fraction: 0.5 }: the nearest whole + picker fraction
export function splitWhole(q: number): { whole: number; fraction: Fraction } {
  let whole = Math.floor(q);
  const rest = q - whole;
  let best: Fraction = 0;
  let bestDiff = rest; // distance to 0
  for (const f of FRACTION_CHOICES) {
    const d = Math.abs(rest - f.value);
    if (d < bestDiff) {
      best = f.value;
      bestDiff = d;
    }
  }
  if (1 - rest < bestDiff) {
    whole += 1;
    best = 0;
  }
  return { whole, fraction: best };
}

// The picker's fractions are rounded labels; ⅓ and ⅔ mean exactly a third
export const exactFraction = (f: number) => (f === 0.333 ? 1 / 3 : f === 0.667 ? 2 / 3 : f);
