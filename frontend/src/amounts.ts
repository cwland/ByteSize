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

// Nouns ending in -ie: their plural is -ies too ("cookies"), so singular() can't just turn -ies into -y
const IE_NOUNS = new Set("cookie brownie smoothie pie veggie hoagie goalie beanie rookie sweetie birdie zombie movie calorie tie".split(" "));
const plural = (w: string) => (/(ss|sh|ch|x)$/i.test(w) ? `${w}es` : /[^aeiou]y$/i.test(w) ? `${w.slice(0, -1)}ies` : /s$/i.test(w) ? w : `${w}s`);
const singular = (w: string) =>
  /ies$/i.test(w) && IE_NOUNS.has(w.slice(0, -1).toLowerCase())
    ? w.slice(0, -1)
    : /[^aeiou]ies$/i.test(w)
      ? `${w.slice(0, -3)}y`
      : /(ss|sh|ch|x)es$/i.test(w)
        ? w.slice(0, -2)
        : /[^s]s$/i.test(w)
          ? w.slice(0, -1)
          : w;

const PREPOSITIONS = new Set(["of", "with", "without", "in", "from", "for"]);
// Measures and containers: when a serving name starts with one ("cup sliced", "can soda", "slice whole wheat
// bread"), that word is the noun whatever follows it
const MEASURES = new Set(
  "cup can slice bottle bar piece scoop packet serving container link stick glass bowl pouch package pack box bag jar carton handful patty fillet strip wedge sheet envelope tablet capsule pinch dash leaf clove spear square cube pod sprig ring shot portion tablespoon teaspoon spoonful loaf bun roll tortilla cookie cracker".split(" "),
);

// Words that are the counted thing when they end a name, even after a measure word ("tortilla chips",
// "cookie dough bites", "peanut butter cups"): the measure word there says what kind, not how much
const COUNTED_LAST = new Set(
  "chip bite crisp ball cluster nugget wafer round triangle twist puff drop cup bar square stick ring piece strip wedge cracker cookie".split(" "),
);

// Pluralise (or singularise) the noun of a serving name: a measure or container word that comes first (after
// any size: "2 cups sliced", "2 large slices bread"), unless the name ends in a word that is itself counted
// ("2 tortilla chips", "2 cookie dough bites"); otherwise the last word before a comma or a preposition
// ("6 pitted prunes", "2 pieces of bread", "2 fruits without skin"). A size on its own ("large") stays.
// In a hyphenated word the last part takes it ("2 roll-ups").
// labelCount: the serving name's own number ("1 tortilla chip" 1, "10 tortilla chips" 10; null when it has none).
// A counted last word takes the count only when its number agrees with that: singular in a label of 1 or less,
// plural (after a singular measure word) in a label of more. Otherwise it is what's in the measure ("1 cup
// chocolate chips", "1 bag potato chips", "2 cups chocolate chips") and the measure takes the count.
function nounFor(noun: string, many: boolean, labelCount: number | null = null): string {
  if (/\(s\)/.test(noun)) return noun;
  const comma = noun.indexOf(",");
  const head = comma < 0 ? noun : noun.slice(0, comma);
  const words = head.split(" ");
  const first = words.findIndex((w) => w && !ADJECTIVES.has(w.toLowerCase()));
  const prep = words.findIndex((w, i) => i > 0 && PREPOSITIONS.has(w.toLowerCase()));
  const last = (prep < 0 ? words.length : prep) - 1;
  const isPlural = (w: string) => singular(w.toLowerCase()) !== w.toLowerCase();
  const counts = (w: string | undefined, m: string) => {
    if (!w || !COUNTED_LAST.has(singular(w.toLowerCase()))) return false;
    if (labelCount === null) return !isPlural(m);
    return labelCount <= 1.02 ? !isPlural(w) : isPlural(w) && !isPlural(m);
  };
  const measure = first >= 0 && MEASURES.has(singular(words[first].toLowerCase())) && !(last > first && counts(words[last], words[first]));
  const i = measure ? first : last;
  if (i < 0 || ADJECTIVES.has(words[i].toLowerCase())) return noun;
  const [, lead, word, tail] = words[i].match(/^((?:[A-Za-z]+-)*)([A-Za-z]+)(.*)$/) ?? [];
  if (!word) return noun;
  words[i] = lead + (many ? plural(word) : singular(word)) + tail;
  return words.join(" ") + (comma < 0 ? "" : noun.slice(comma));
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
  return `${countText(total)} ${nounFor(noun, total > 1.02, m ? n : null)}${scaledParen}`;
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
