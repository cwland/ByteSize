// Foods: the barcode waterfall, grouped search, the food cache, a person's own foods
// (custom foods and overrides of cached foods) and AI drafts.
import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, gte, inArray, ne, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/index.js";
import { foodCache, userFoods } from "../db/schema.js";
import { AiError } from "./ai.js";
import { logEvent } from "./appLog.js";
import { normalizeBarcode } from "./barcode.js";
import { HttpError, badRequest } from "./errors.js";
import { iconFor } from "./foodIcons.js";
import { offByBarcode, offSearch } from "./foodSources/off.js";
import { usdaKey } from "./foodSources/settings.js";
import { SourceError, type SourceFood } from "./foodSources/types.js";
import { usdaByBarcode, usdaSearch } from "./foodSources/usda.js";
import { NUTRIENT_KEYS, withLiquidVolumes, type NutrientKey, type Nutrients, type Serving } from "./nutrients.js";
import { linkPhoto, photoForFood, photoUrl, signImageUrl } from "./photos.js";

export type FoodResult = {
  kind: "cache" | "user_food";
  id: number;
  name: string;
  brand: string | null;
  icon: string;
  barcode: string | null;
  servings: Serving[];
  nutrients: Nutrients;
  aiFields: string[];
  imageUrl: string | null;
  override: boolean;
  source: "off" | "usda" | "mine" | "ai";
  /** What kind of food it is: a plain food (cached or the person's own), a correction, a recipe or a quick meal. */
  foodKind: FoodKind;
};
export type FoodKind = "custom" | "override" | "recipe" | "quick_meal";
export const COMPOUND_KINDS = ["recipe", "quick_meal"] as const;
export type GroupSource = "mine" | "basic" | "cache" | "off" | "usda";
export type SearchGroup = { source: GroupSource; label: string; foods: FoodResult[] };
/** suggestion: a close spelling from saved food names ("Did you mean …?"), only when little was found. */
export type SearchResult = { groups: SearchGroup[]; errors: { source: string; message: string }[]; suggestion?: string };

type CacheRow = typeof foodCache.$inferSelect;
type UserFoodRow = typeof userFoods.$inferSelect;

export const GROUP_LABELS: Record<GroupSource, string> = { mine: "My foods", basic: "Basic foods", cache: "Saved foods", off: "Open Food Facts", usda: "USDA" };
export const SOURCE_TIMEOUT_MS = 3000; // per outside source
const CACHE_FRESH_MS = 30 * 24 * 60 * 60 * 1000;
const NOT_A_BARCODE = "That doesn't look like a barcode";
const DUP_BARCODE = "You already have a food with this barcode";
export const AI_NOT_READY = "Set up an AI service first";

// ---------- shapes ----------

/** Only the keys ByteSize knows, with finite non-negative numbers (anything else = unknown, left out). */
export function cleanNutrients(v: unknown): Nutrients {
  const out: Nutrients = {};
  if (!v || typeof v !== "object") return out;
  for (const k of NUTRIENT_KEYS) {
    const x = (v as Record<string, unknown>)[k];
    if (typeof x === "number" && Number.isFinite(x) && x >= 0) out[k] = x;
  }
  return out;
}

/** AI-flagged keys that are actually present, in the standard order. */
const presentAiFields = (aiFields: readonly string[], nutrients: Nutrients) => NUTRIENT_KEYS.filter((k) => aiFields.includes(k) && nutrients[k] !== undefined);

export function toResult(row: CacheRow, kind: "cache"): FoodResult;
export function toResult(row: UserFoodRow, kind: "user_food"): FoodResult;
export function toResult(row: CacheRow | UserFoodRow, kind: "cache" | "user_food"): FoodResult {
  const nutrients = (row.nutrients ?? {}) as Nutrients;
  const base = { kind, id: row.id, name: row.name, brand: row.brand, icon: iconFor(row.category, row.name), barcode: row.barcode, servings: withLiquidVolumes(row.servings as Serving[], row.category, row.name), nutrients };
  if (kind === "cache") {
    const c = row as CacheRow;
    return { ...base, aiFields: [], imageUrl: signImageUrl(c.imageUrl), override: false, source: c.source === "usda" ? "usda" : "off", foodKind: "custom" };
  }
  const u = row as UserFoodRow;
  const aiFields = presentAiFields(u.aiFields, nutrients);
  const keys = Object.keys(nutrients);
  // Every value is an untouched AI guess → "ai"; anything the person typed or corrected → "mine"
  const allAi = keys.length > 0 && aiFields.length === keys.length;
  return { ...base, aiFields, imageUrl: u.imagePath ? signImageUrl(photoUrl(u.imagePath)) : null, override: u.kind === "override", source: allAi ? "ai" : "mine", foodKind: foodKindOf(u.kind) };
}

/** A stored user_foods.kind as FoodResult.foodKind (an AI estimate the person saved is one of their own foods). */
export const foodKindOf = (kind: string): FoodKind => (kind === "override" || kind === "recipe" || kind === "quick_meal" ? kind : "custom");

// ---------- cache ----------

const cacheValues = (f: SourceFood, now: Date) => ({
  source: f.source,
  sourceId: f.sourceId,
  barcode: f.barcode,
  name: f.name,
  brand: f.brand,
  category: f.category,
  servings: f.servings,
  nutrients: f.nutrients,
  imageUrl: f.imageUrl,
  raw: f.raw ?? null,
  fetchedAt: now,
});

const upsertSet = {
  barcode: sql`excluded.barcode`,
  name: sql`excluded.name`,
  brand: sql`excluded.brand`,
  category: sql`excluded.category`,
  servings: sql`excluded.servings`,
  nutrients: sql`excluded.nutrients`,
  imageUrl: sql`excluded.image_url`,
  raw: sql`excluded.raw`,
  fetchedAt: sql`excluded.fetched_at`,
};

/** Saves (or refreshes) one outside food in the cache; returns its id. */
export async function cacheUpsert(db: Db, f: SourceFood, now = new Date()): Promise<number> {
  const [row] = await upsertMany(db, [f], now);
  return row.id;
}

/** Saves outside foods in the cache (one statement); returns the rows in the same order (duplicates once). */
async function upsertMany(db: Db, foods: SourceFood[], now: Date): Promise<CacheRow[]> {
  const unique = [...new Map(foods.filter((f) => f.sourceId).map((f) => [`${f.source}:${f.sourceId}`, f])).values()];
  if (!unique.length) return [];
  const rows = await db
    .insert(foodCache)
    .values(unique.map((f) => cacheValues(f, now)))
    .onConflictDoUpdate({ target: [foodCache.source, foodCache.sourceId], set: upsertSet })
    .returning();
  const byKey = new Map(rows.map((r) => [`${r.source}:${r.sourceId}`, r]));
  return unique.map((f) => byKey.get(`${f.source}:${f.sourceId}`)!).filter(Boolean);
}

// ---------- outside sources ----------

const SOURCE_LABEL = { off: "Open Food Facts", usda: "USDA" } as const;

async function logSourceFailure(app: FastifyInstance, userId: number, source: "off" | "usda", what: string, err: unknown) {
  await logEvent(app.db, {
    category: "food",
    level: "warning",
    source: SOURCE_LABEL[source],
    event: `${SOURCE_LABEL[source]} ${what} failed`,
    detail: err instanceof Error ? err.message : String(err),
    userId,
  });
}

const friendly = (source: "off" | "usda", err: unknown) => (err instanceof SourceError ? err.message : `${SOURCE_LABEL[source]} couldn't be searched`);

// ---------- barcode ----------

export type BarcodeHit = { code: string; food: FoodResult | null; from: GroupSource | null; errors: SearchResult["errors"] };

/**
 * The waterfall: the person's own food with that barcode, a fresh cached food, Open Food Facts,
 * then USDA (only with a key). Outside finds are cached. A stale cached food is still used when
 * the outside sources can't refresh it.
 */
export async function lookupBarcode(app: FastifyInstance, userId: number, raw: string): Promise<BarcodeHit> {
  const code = normalizeBarcode(raw);
  if (!code) throw badRequest(NOT_A_BARCODE);
  const { db } = app;

  const [mine] = await db
    .select()
    .from(userFoods)
    .where(and(eq(userFoods.userId, userId), eq(userFoods.barcode, code), eq(userFoods.archived, false)))
    .limit(1);
  const errors: SearchResult["errors"] = []; // sources that couldn't be checked: "not found" isn't certain then
  if (mine) return { code, food: toResult(mine, "user_food"), from: "mine", errors };

  const now = app.now();
  const [cached] = await db.select().from(foodCache).where(eq(foodCache.barcode, code)).orderBy(desc(foodCache.fetchedAt)).limit(1);
  if (cached && cached.fetchedAt.getTime() >= now.getTime() - CACHE_FRESH_MS) return { code, food: toResult(cached, "cache"), from: "cache", errors };

  let found: SourceFood | null = null;
  try {
    found = await offByBarcode(app.foodFetch, code, SOURCE_TIMEOUT_MS);
  } catch (err) {
    await logSourceFailure(app, userId, "off", "barcode lookup", err);
    errors.push({ source: "off", message: friendly("off", err) });
  }
  if (!found) {
    const key = await usdaKey(app);
    if (key) {
      try {
        found = await usdaByBarcode(app.foodFetch, key, code, SOURCE_TIMEOUT_MS);
      } catch (err) {
        await logSourceFailure(app, userId, "usda", "barcode lookup", err);
        errors.push({ source: "usda", message: friendly("usda", err) });
      }
    }
  }
  if (found) {
    const [row] = await upsertMany(db, [{ ...found, barcode: found.barcode ?? code }], now);
    return { code, food: toResult(row, "cache"), from: found.source, errors };
  }
  if (cached) return { code, food: toResult(cached, "cache"), from: "cache", errors };
  return { code, food: null, from: null, errors };
}

// ---------- text matching ----------

const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");
const words = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
const allWords = (hay: SQL, q: string) => and(...words(q).map((w) => sql`${hay} ilike ${"%" + escapeLike(w) + "%"}`))!;
const userHay = sql`lower(${userFoods.name} || ' ' || coalesce(${userFoods.brand}, ''))`;
const cacheHay = sql`lower(${foodCache.name} || ' ' || coalesce(${foodCache.brand}, ''))`;
/** A cached USDA whole food (Foundation / SR Legacy, as USDA's own record says): shown under "Basic foods". */
const isBasicRow = (c: CacheRow) => c.source === "usda" && ["Foundation", "SR Legacy"].includes((c.raw as { dataType?: unknown } | null)?.dataType as string);
const TYPO_MATCH = 0.45; // word_similarity at which a name counts as the search mistyped

export const MY_FOOD_KINDS = ["all", "foods", "recipes", "meals"] as const;
export const MY_FOOD_SORTS = ["recent", "used", "az"] as const;
export type MyFoodsOptions = { kind?: (typeof MY_FOOD_KINDS)[number]; sort?: (typeof MY_FOOD_SORTS)[number] };
const KIND_FILTER = { foods: ["custom", "ai", "override"], recipes: ["recipe"], meals: ["quick_meal"] } as const;

/**
 * The person's active foods matching q: every word appears, or it's close (pg_trgm, forgives typos).
 * kind narrows to plain foods, recipes or quick meals; sort: recent (last used, else made), used (most
 * logged), az. Without a sort: best match first for a search, else A–Z.
 */
export async function findMyFoods(db: Db, userId: number, q: string | null, limit: number, opts: MyFoodsOptions = {}): Promise<UserFoodRow[]> {
  const kind = opts.kind && opts.kind !== "all" ? inArray(userFoods.kind, [...KIND_FILTER[opts.kind]]) : undefined;
  const mine = and(eq(userFoods.userId, userId), eq(userFoods.archived, false), kind);
  const az = [asc(sql`lower(${userFoods.name})`), asc(userFoods.id)];
  const sorted = {
    az,
    used: [desc(userFoods.useCount), sql`${userFoods.lastUsedAt} desc nulls last`, ...az],
    recent: [desc(sql`coalesce(${userFoods.lastUsedAt}, ${userFoods.createdAt})`), desc(userFoods.id)],
  };
  if (!q) return db.select().from(userFoods).where(mine).orderBy(...sorted[opts.sort ?? "az"]).limit(limit);
  const lq = q.toLowerCase();
  const similarity = sql`word_similarity(${lq}, ${userHay})`;
  return db
    .select()
    .from(userFoods)
    .where(and(mine, sql`(${allWords(userHay, q)} or ${similarity} >= ${TYPO_MATCH})`))
    .orderBy(...(opts.sort ? sorted[opts.sort] : [desc(similarity), desc(userFoods.useCount), asc(userFoods.name)]))
    .limit(limit);
}

// ---------- search ----------

const DIGITS = /^[\d\s-]+$/;

export async function searchFoods(app: FastifyInstance, userId: number, raw: string | undefined): Promise<SearchResult> {
  const q = (raw ?? "").trim().replace(/\s+/g, " ");
  if (q.length < 2) throw badRequest("Type at least 2 characters");

  // A typed barcode: the same answer as a scan
  if (DIGITS.test(q) && normalizeBarcode(q)) {
    const hit = await lookupBarcode(app, userId, q);
    return { groups: hit.food && hit.from ? [{ source: hit.from, label: GROUP_LABELS[hit.from], foods: [hit.food] }] : [], errors: hit.errors };
  }

  const { db } = app;
  // Outside sources start at once (each with its own timeout) while the local lists are read
  const key = await usdaKey(app);
  // Each source gives its foods, plus an error when only part of it answered (USDA's two calls)
  const outside: { source: "off" | "usda"; run: Promise<{ foods: SourceFood[]; error: Error | null }> }[] = [
    { source: "off", run: offSearch(app.foodFetch, q, SOURCE_TIMEOUT_MS).then((foods) => ({ foods, error: null })) },
  ];
  if (key) outside.push({ source: "usda", run: usdaSearch(app.foodFetch, key, q, SOURCE_TIMEOUT_MS) });
  for (const o of outside) o.run.catch(() => {}); // handled below

  const mine = await findMyFoods(db, userId, q, 10);
  // The person's own versions hide the cached ones they replace
  const notMine = sql`not exists (select 1 from ${userFoods} uf where uf.user_id = ${userId} and uf.archived = false and (uf.base_cache_id = ${foodCache.id} or uf.barcode = ${foodCache.barcode}))`;
  // Every word appears, or it's close (pg_trgm, forgives typos), like the person's own foods
  const similarity = sql`word_similarity(${q.toLowerCase()}, ${cacheHay})`;
  const cache = await db
    .select()
    .from(foodCache)
    .where(and(sql`(${allWords(cacheHay, q)} or ${similarity} >= ${TYPO_MATCH})`, notMine))
    .orderBy(desc(sql`${foodCache.name} ilike ${escapeLike(q) + "%"}`), desc(similarity), desc(foodCache.fetchedAt))
    .limit(10);

  const myBarcodes = new Set(mine.map((f) => f.barcode).filter(Boolean));
  const myBases = new Set(mine.map((f) => f.baseCacheId).filter(Boolean));
  const shown = new Set(cache.map((c) => c.id));
  // A saved USDA whole food is still a basic food, on every later search too
  const found: Record<GroupSource, FoodResult[]> = {
    mine: mine.map((f) => toResult(f, "user_food")),
    basic: cache.filter(isBasicRow).map((c) => toResult(c, "cache")),
    cache: cache.filter((c) => !isBasicRow(c)).map((c) => toResult(c, "cache")),
    off: [],
    usda: [],
  };
  const errors: SearchResult["errors"] = [];

  const settled = await Promise.allSettled(outside.map((o) => o.run));
  const now = app.now();
  for (const [i, o] of outside.entries()) {
    const s = settled[i];
    let rows: CacheRow[] = [];
    const fail = async (err: unknown) => {
      errors.push({ source: o.source, message: friendly(o.source, err) });
      await logSourceFailure(app, userId, o.source, "search", err);
    };
    try {
      if (s.status === "rejected") throw s.reason;
      rows = await upsertMany(db, s.value.foods, now);
    } catch (err) {
      await fail(err);
      continue;
    }
    if (s.value.error) await fail(s.value.error); // part failed: what did come is still shown
    const fresh = rows.filter((r) => !shown.has(r.id) && !myBases.has(r.id) && !(r.barcode && myBarcodes.has(r.barcode)));
    fresh.forEach((r) => shown.add(r.id));
    // USDA's plain whole foods (Foundation / SR Legacy) get their own group; the rest are branded
    const basicIds = new Set(s.value.foods.filter((f) => f.basic).map((f) => f.sourceId));
    for (const r of fresh) found[basicIds.has(r.sourceId) ? "basic" : o.source].push(toResult(r, "cache"));
  }

  const lq = q.toLowerCase();
  const startsFirst = (foods: FoodResult[]) => [...foods].sort((a, b) => Number(b.name.toLowerCase().startsWith(lq)) - Number(a.name.toLowerCase().startsWith(lq)));
  const groups = (["mine", "basic", "cache", "off", "usda"] as const)
    .map((source): SearchGroup => ({ source, label: GROUP_LABELS[source], foods: startsFirst(found[source]) }))
    .filter((g) => g.foods.length);
  const total = groups.reduce((n, g) => n + g.foods.length, 0);
  const suggestion = total < SUGGEST_BELOW ? await suggestSpelling(db, userId, q) : undefined;
  return { groups, errors, ...(suggestion ? { suggestion } : {}) };
}

// ---------- did you mean ----------

const SUGGEST_BELOW = 3; // "Did you mean" only when fewer foods than this were found
const SUGGEST_MATCH = 0.5; // word_similarity a saved word needs to be offered
const SUGGEST_SHORT = 5; // a search shorter than this is likely a real word ("beef", "pear"): it must also be similar as a whole (>= 0.5)

/** The search's own plural / singular forms: offering one of these isn't a spelling fix. */
function formsOf(q: string): Set<string> {
  const forms = new Set([q, q + "s", q + "es"]);
  if (q.endsWith("y")) forms.add(q.slice(0, -1) + "ies");
  if (q.endsWith("s")) forms.add(q.slice(0, -1));
  if (q.endsWith("es")) forms.add(q.slice(0, -2));
  if (q.endsWith("ies")) forms.add(q.slice(0, -3) + "y");
  return forms;
}

/** A plain -s plural without its s (bananas → banana, carrots → carrot); any other word as it is. */
const dropPlainS = (w: string) => (/[^eisu]s$/.test(w) ? w.slice(0, -1) : w);

/**
 * A close spelling of a one-word search, drawn from the words of saved food names (the shared cache
 * and the person's own foods). Always a saved word as it is, except that a plain -s plural loses its
 * s for a search that doesn't end in s ("bananna" → "banana"). Never the search itself or one of its
 * plural / singular forms, and never a longer word the search is already part of ("apple" in
 * "pineapple" is spelled right). A search that is itself (or in plural / singular) a saved word is
 * spelled right: no suggestion ("pie" with "Pies" saved never gets "pineapple").
 */
export async function suggestSpelling(db: Db, userId: number, q: string): Promise<string | undefined> {
  const lq = q.toLowerCase();
  if (/\s/.test(lq) || lq.length < 3) return undefined;
  const split = (col: SQL) => sql`regexp_split_to_table(lower(${col}), '[^[:alpha:]]+')`;
  const forms = formsOf(lq);
  const known = sql`w in (${sql.join([...forms].map((f) => sql`${f}`), sql`, `)})`;
  // The search (or its plural / singular) found among saved words = spelled right: those rows sort first
  const { rows } = await db.execute<{ w: string }>(sql`
    with words as (
      select ${split(sql`${foodCache.name}`)} as w from ${foodCache}
      union
      select ${split(sql`${userFoods.name}`)} from ${userFoods} where ${userFoods.userId} = ${userId} and ${userFoods.archived} = false
    )
    select w from words
    where ${known} or (length(w) >= 3 and word_similarity(${lq}, w) >= ${SUGGEST_MATCH}
      and (${lq.length >= SUGGEST_SHORT} or similarity(${lq}, w) >= ${SUGGEST_MATCH}))
    order by ${known} desc, similarity(${lq}, w) desc, word_similarity(${lq}, w) desc, w
    limit 10`);
  if (rows.some(({ w }) => forms.has(w))) return undefined;
  const inside = [...forms].filter((f) => f.length >= 3 && f.length <= lq.length);
  for (const { w } of rows) {
    const out = lq.endsWith("s") ? w : dropPlainS(w);
    if (inside.some((f) => out.includes(f))) continue; // the search is already inside a longer word
    return out;
  }
  return undefined;
}

// ---------- my foods ----------

const serving = z
  .object({
    label: z.string().trim().min(1, "Give the serving a name").max(60),
    grams: z.number().positive().max(100000).optional(),
    ml: z.number().positive().max(100000).optional(),
    approx: z.boolean().optional(),
  })
  // An approximate volume (worked out from the grams when read) is never stored as a real one
  .transform((s) => ({ label: s.label, ...(s.grams !== undefined ? { grams: s.grams } : {}), ...(s.ml !== undefined && !(s.approx && s.grams !== undefined) ? { ml: s.ml } : {}) }));
const nutrientsSchema = z.strictObject(Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, z.number().nonnegative().max(1000000).optional()])) as Record<NutrientKey, z.ZodOptional<z.ZodNumber>>);

export const foodFields = z.object({
  name: z.string().trim().min(1, "Give the food a name").max(200),
  brand: z.string().trim().max(200).nullable().optional(),
  barcode: z.string().trim().max(40).nullable().optional(),
  servings: z.array(serving).min(1, "Add at least one serving").max(20),
  nutrients: nutrientsSchema,
  category: z.string().trim().max(100).nullable().optional(),
  aiFields: z.array(z.enum(NUTRIENT_KEYS)).max(NUTRIENT_KEYS.length).optional(),
  photoId: z.string().max(40).optional(), // an upload from /api/photos/analyze: the food's photo from now on
});
export type FoodFields = z.infer<typeof foodFields>;
export const overrideFields = z.object({
  cacheId: z.number().int().positive().max(2147483647),
  name: foodFields.shape.name.optional(),
  brand: foodFields.shape.brand,
  servings: foodFields.shape.servings.optional(),
  nutrients: nutrientsSchema.optional(),
});

/** A barcode as typed → its stored form (null for none); not a barcode → 400. */
function barcodeField(v: string | null | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v.trim() === "") return null;
  const code = normalizeBarcode(v);
  if (!code) throw badRequest(NOT_A_BARCODE);
  return code;
}

const isUniqueViolation = (e: unknown) => {
  const x = e as { code?: string; cause?: { code?: string } };
  return x?.code === "23505" || x?.cause?.code === "23505";
};

async function barcodeTaken(db: Db, userId: number, code: string | null | undefined, exceptId?: number) {
  if (!code) return false;
  const [row] = await db
    .select({ id: userFoods.id })
    .from(userFoods)
    .where(and(eq(userFoods.userId, userId), eq(userFoods.barcode, code), eq(userFoods.archived, false), exceptId ? ne(userFoods.id, exceptId) : undefined))
    .limit(1);
  return !!row;
}

async function guardUnique<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (e) {
    if (isUniqueViolation(e)) throw new HttpError(409, DUP_BARCODE);
    throw e;
  }
}

export async function createMyFood(app: FastifyInstance, userId: number, body: FoodFields): Promise<FoodResult> {
  const barcode = barcodeField(body.barcode) ?? null;
  if (await barcodeTaken(app.db, userId, barcode)) throw new HttpError(409, DUP_BARCODE);
  const nutrients = cleanNutrients(body.nutrients);
  const imagePath = body.photoId ? await photoForFood(app, userId, body.photoId, null) : null;
  const [row] = await guardUnique(() =>
    app.db
      .insert(userFoods)
      .values({
        userId,
        kind: "custom",
        name: body.name,
        brand: body.brand || null,
        barcode,
        category: body.category || null,
        servings: body.servings,
        nutrients,
        aiFields: presentAiFields(body.aiFields ?? [], nutrients),
        imagePath,
      })
      .returning()
  );
  if (body.photoId) await linkPhoto(app, userId, body.photoId);
  return toResult(row, "user_food");
}

export async function ownFood(db: Db, userId: number, id: number) {
  const [row] = await db
    .select()
    .from(userFoods)
    .where(and(eq(userFoods.id, id), eq(userFoods.userId, userId), eq(userFoods.archived, false)));
  if (!row) throw new HttpError(404, "Food not found");
  return row;
}

export async function updateMyFood(app: FastifyInstance, userId: number, id: number, body: Partial<FoodFields>): Promise<FoodResult> {
  const row = await ownFood(app.db, userId, id);
  if ((COMPOUND_KINDS as readonly string[]).includes(row.kind)) throw badRequest("Edit recipes and quick meals in their own editor");
  const barcode = barcodeField(body.barcode);
  if (barcode !== undefined && (await barcodeTaken(app.db, userId, barcode, id))) throw new HttpError(409, DUP_BARCODE);
  const nutrients = body.nutrients ? cleanNutrients(body.nutrients) : (row.nutrients as Nutrients);
  const imagePath = body.photoId ? await photoForFood(app, userId, body.photoId, row.imagePath) : undefined;
  // Values the person changed are theirs now, not the AI's (unless the caller says which are AI)
  const old = row.nutrients as Nutrients;
  const aiFields = body.aiFields ?? row.aiFields.filter((k) => old[k as NutrientKey] === nutrients[k as NutrientKey]);
  const [updated] = await guardUnique(() =>
    app.db
      .update(userFoods)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.brand !== undefined ? { brand: body.brand || null } : {}),
        ...(barcode !== undefined ? { barcode } : {}),
        ...(body.category !== undefined ? { category: body.category || null } : {}),
        ...(body.servings !== undefined ? { servings: body.servings } : {}),
        nutrients,
        aiFields: presentAiFields(aiFields, nutrients),
        ...(imagePath !== undefined ? { imagePath } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(userFoods.id, id), eq(userFoods.userId, userId)))
      .returning()
  );
  if (body.photoId) await linkPhoto(app, userId, body.photoId);
  return toResult(updated, "user_food");
}

/**
 * A correction of a cached food, bound to its barcode: a copy of the cached food with the edits.
 * If the person already has an active food with that barcode (or a correction of this food),
 * that one is updated instead.
 */
export async function overrideFood(app: FastifyInstance, userId: number, body: z.infer<typeof overrideFields>): Promise<FoodResult> {
  const { db } = app;
  const [base] = await db.select().from(foodCache).where(eq(foodCache.id, body.cacheId));
  if (!base) throw new HttpError(404, "Food not found");
  const values = {
    kind: "override",
    name: body.name ?? base.name,
    brand: body.brand !== undefined ? body.brand || null : base.brand,
    barcode: base.barcode,
    baseCacheId: base.id,
    category: base.category,
    servings: body.servings ?? (base.servings as Serving[]),
    // The web app sends the whole edited set, so a value it leaves out is unknown now
    nutrients: body.nutrients ? cleanNutrients(body.nutrients) : (base.nutrients as Nutrients),
    aiFields: [] as string[],
  };
  const mine = and(eq(userFoods.userId, userId), eq(userFoods.archived, false));
  const [existing] = await db
    .select({ id: userFoods.id })
    .from(userFoods)
    .where(and(mine, base.barcode ? eq(userFoods.barcode, base.barcode) : eq(userFoods.baseCacheId, base.id)))
    .limit(1);
  const [row] = existing
    ? await db.update(userFoods).set({ ...values, updatedAt: new Date() }).where(eq(userFoods.id, existing.id)).returning()
    : await guardUnique(() => db.insert(userFoods).values({ userId, ...values }).returning());
  return toResult(row, "user_food");
}

/** A food the person may log or use as an ingredient: any cached food, or one of their own active foods. */
export async function loadFood(db: Db, userId: number, ref: { kind: "cache" | "user_food"; id: number }): Promise<FoodResult> {
  if (ref.kind === "cache") {
    const [row] = await db.select().from(foodCache).where(eq(foodCache.id, ref.id));
    if (row) return toResult(row, "cache");
  } else {
    const [row] = await db
      .select()
      .from(userFoods)
      .where(and(eq(userFoods.id, ref.id), eq(userFoods.userId, userId), eq(userFoods.archived, false)));
    if (row) return toResult(row, "user_food");
  }
  throw new HttpError(404, "Food not found");
}

// ---------- AI ----------

const SYSTEM = [
  "You are a nutrition label expert. You estimate nutrition facts for foods as sold or served in the United States.",
  "Use US serving sizes (the way a US nutrition label or restaurant menu would).",
  `Nutrient keys (per the first serving): ${NUTRIENT_KEYS.join(", ")}. Units: calories in kcal, *_g in grams, *_mg in milligrams, water_ml in millilitres.`,
  "Give every key you can reasonably estimate; leave out a key only when it can't be known.",
  "Values are plain numbers only (no units, no ranges, no strings). Answer with JSON only.",
].join("\n");

async function aiReady(app: FastifyInstance) {
  if (!(await app.ai.active("food"))) throw new HttpError(503, AI_NOT_READY);
}

async function askFood(app: FastifyInstance, userId: number, user: string) {
  try {
    return (await app.ai.ask("food", SYSTEM, user, { userId, maxTokens: 1200 })).json;
  } catch (err) {
    if (err instanceof AiError) throw new HttpError(502, err.message);
    throw err;
  }
}

const aiFood = z.object({
  name: z.string().trim().min(1).max(200),
  brand: z.string().trim().max(200).nullable().optional(),
  category: z.string().trim().max(100).nullable().optional(),
  servings: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(60),
        grams: z.number().positive().nullable().optional(),
        ml: z.number().positive().nullable().optional(),
      })
    )
    .min(1),
  nutrients: z.record(z.string(), z.unknown()),
});

export type AiDraft = Omit<FoodResult, "id" | "kind" | "foodKind"> & { category: string };

export async function estimateFood(app: FastifyInstance, userId: number, text: string): Promise<AiDraft> {
  await aiReady(app);
  const json = await askFood(
    app,
    userId,
    `Estimate this food: ${JSON.stringify(text)}\n\nAnswer as JSON: {"name": string, "brand": string | null, "category": string, "servings": [{"label": string, "grams"?: number, "ml"?: number}], "nutrients": {<key>: number}}. servings[0] is the usual US serving and the nutrients are for it.`
  );
  const draft = aiDraft(json);
  if (!draft) {
    await logEvent(app.db, { category: "ai", level: "warning", source: "AI estimate", event: "The AI's food estimate couldn't be used", detail: JSON.stringify(json).slice(0, 600), userId });
    throw new HttpError(502, "The AI's answer didn't look like a food. Try again, or describe it differently.");
  }
  return draft;
}

/** An AI answer as a draft food (every value AI-estimated); null when it isn't a food with at least one nutrient. */
export function aiDraft(json: unknown): AiDraft | null {
  const parsed = aiFood.safeParse(json);
  const nutrients = parsed.success ? cleanNutrients(parsed.data.nutrients) : {};
  if (!parsed.success || !Object.keys(nutrients).length) return null;
  const f = parsed.data;
  const category = f.category || "";
  return {
    name: f.name,
    brand: f.brand || null,
    category,
    icon: iconFor(category, f.name),
    barcode: null,
    servings: f.servings.map((s) => ({ label: s.label, ...(s.grams ? { grams: s.grams } : {}), ...(s.ml ? { ml: s.ml } : {}) })),
    nutrients,
    aiFields: Object.keys(nutrients),
    imageUrl: null,
    override: false,
    source: "ai",
  };
}

/** Asks AI for only the nutrients a stored food is missing. A draft: nothing is saved. */
export async function fillGaps(app: FastifyInstance, userId: number, ref: { kind: "cache" | "user_food"; id: number }): Promise<{ nutrients: Nutrients; aiFields: string[] }> {
  const { db } = app;
  const [row] =
    ref.kind === "cache"
      ? await db.select().from(foodCache).where(eq(foodCache.id, ref.id))
      : await db.select().from(userFoods).where(and(eq(userFoods.id, ref.id), eq(userFoods.userId, userId), eq(userFoods.archived, false)));
  if (!row) throw new HttpError(404, "Food not found");
  const known = row.nutrients as Nutrients;
  const missing = NUTRIENT_KEYS.filter((k) => known[k] === undefined);
  if (!missing.length) return { nutrients: {}, aiFields: [] };
  await aiReady(app);
  const servings = row.servings as Serving[];
  const json = await askFood(
    app,
    userId,
    [
      `Food: ${JSON.stringify({ name: row.name, brand: row.brand, category: row.category })}`,
      `Serving: ${JSON.stringify(servings[0])}`,
      `Known nutrients for that serving: ${JSON.stringify(known)}`,
      `Estimate ONLY these missing keys for that serving: ${missing.join(", ")}.`,
      `Answer as JSON: {"nutrients": {<key>: number}}. Leave out a key you can't estimate.`,
    ].join("\n")
  );
  const got = cleanNutrients(json && typeof json.nutrients === "object" ? json.nutrients : json);
  const nutrients: Nutrients = {};
  for (const k of missing) if (got[k] !== undefined) nutrients[k] = got[k];
  return { nutrients, aiFields: Object.keys(nutrients) };
}
