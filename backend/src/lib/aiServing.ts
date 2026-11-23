import { and, ilike, isNotNull, or, type SQL } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { foodCache } from "../db/schema.js";
import type { Nutrients, Serving } from "./nutrients.js";

// An AI draft of a branded product takes the serving a food database gives it ("2.5 tbsp"), not the AI's guess
// ("3 tablespoons, 21 g"), when a food the server has kept from a database is that product and its calories per
// serving agree with the AI's (±15%). Only kept foods are looked at: no outside call, so the estimate is no slower.

type Draft = { name: string; brand: string | null; servings: Serving[]; nutrients: Nutrients };
type Kept = { name: string; brand: string | null; servings: unknown; nutrients: unknown };

const tokens = (s: string | null | undefined) =>
  new Set(
    (s ?? "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1),
  );
const isBase = (s: Serving) => /^\s*100\s*(g|ml)\s*$/i.test(s.label);

/** A kept food's package serving and its calories: its own second serving after a "100 g" base, else its first. */
function packageServing(k: Kept): { serving: Serving; calories: number } | null {
  const servings = (Array.isArray(k.servings) ? k.servings : []) as Serving[];
  const kcal = (k.nutrients as Nutrients | null)?.calories;
  const base = servings[0];
  if (!base || typeof kcal !== "number") return null;
  if (!isBase(base)) return { serving: base, calories: kcal };
  const own = servings[1];
  if (!own || isBase(own)) return null;
  const share = own.grams && base.grams ? own.grams / base.grams : own.ml && base.ml ? own.ml / base.ml : null;
  return share ? { serving: own, calories: kcal * share } : null;
}

/** The draft with a kept database food's serving when one is the same product; else the draft unchanged. */
export async function withDatabaseServing<T extends Draft>(db: Db, draft: T): Promise<T> {
  if (!draft.brand) return draft;
  const brand = tokens(draft.brand);
  const all = new Set([...tokens(draft.name), ...brand]);
  const product = [...tokens(draft.name)].filter((w) => !brand.has(w));
  const aiKcal = draft.nutrients.calories;
  if (!product.length || typeof aiKcal !== "number" || aiKcal <= 0) return draft;

  const longest = [...product].sort((a, b) => b.length - a.length).slice(0, 3);
  const rows: Kept[] = await db
    .select({ name: foodCache.name, brand: foodCache.brand, servings: foodCache.servings, nutrients: foodCache.nutrients })
    .from(foodCache)
    .where(and(isNotNull(foodCache.servings), or(...longest.map((w): SQL => ilike(foodCache.name, `%${w}%`)))))
    .limit(100);

  let best: { serving: Serving; words: number } | null = null;
  for (const r of rows) {
    const rowBrand = tokens(r.brand);
    if (rowBrand.size && ![...rowBrand].some((w) => brand.has(w))) continue; // another brand's
    const words = [...tokens(r.name)].filter((w) => !rowBrand.has(w) && !brand.has(w));
    if (words.length < 2 || !words.every((w) => all.has(w))) continue; // says something the AI's product doesn't
    const pkg = packageServing(r);
    if (!pkg || Math.abs(pkg.calories - aiKcal) > 0.15 * Math.max(pkg.calories, aiKcal)) continue;
    if (!best || words.length > best.words) best = { serving: pkg.serving, words: words.length };
  }
  if (!best) return draft;
  const { label, grams, ml } = best.serving;
  const serving: Serving = { label, ...(grams ? { grams } : {}), ...(ml ? { ml } : {}) };
  return { ...draft, servings: [serving] };
}
