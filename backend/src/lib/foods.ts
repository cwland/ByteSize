// Foods: the barcode waterfall, grouped search, the food cache, a person's own foods
// (custom foods and overrides of cached foods) and AI drafts.
import type { FastifyInstance } from "fastify";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  ne,
  sql,
  type SQL,
} from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/index.js";
import {
  barcodePicks,
  fatsecretBarcodes,
  foodCache,
  foodSearches,
  userFoods,
} from "../db/schema.js";
import {
  culuryLink,
  culuryMessage,
  logCuluryFailure,
  searchCulury,
} from "./culury.js";
import { AiError, AiStopped, type AiProgress } from "./ai.js";
import { logEvent } from "./appLog.js";
import { normalizeBarcode } from "./barcode.js";
import { HttpError, badRequest } from "./errors.js";
import { iconFor } from "./foodIcons.js";
import { offByBarcode, offSearch } from "./foodSources/off.js";
import {
  fatsecretPlan,
  setBarcodeScopeMissing,
  sourceHours,
  sourceSwitches,
  usdaKeyInUse,
  type SourceHours,
} from "./foodSources/settings.js";
import { fatsecretInUse } from "./restaurants/index.js";
import { SourceError, type SourceFood } from "./foodSources/types.js";
import { usdaByBarcode, usdaSearch } from "./foodSources/usda.js";
import { countUsage, type UsageKey } from "./usage.js";
import { withMeasures } from "./measures.js";
import {
  NUTRIENT_KEYS,
  withLiquidVolumes,
  type NutrientKey,
  type Nutrients,
  type Serving,
} from "./nutrients.js";
import { linkPhoto, photoForFood, photoUrl, signImageUrl } from "./photos.js";

export type FoodResult = {
  kind: "cache" | "user_food" | "culury";
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
  source:
    "off" | "usda" | "spoonacular" | "fatsecret" | "mine" | "ai" | "culury";
  /** What kind of food it is: a plain food (cached or the person's own), a correction, a recipe or a quick meal. */
  foodKind: FoodKind;
  /** A kept copy of an outside food: when it was fetched ("Saved copy from …"); null when fetched just now. Absent for the person's own foods. */
  savedAt?: string | null;
  /** A FatSecret typed-search summary (calories, fat, carbs, protein only): fetched whole when opened or tracked. */
  summary?: boolean;
  /** A correction (override): the database food it corrects. Absent on every other food. */
  baseCacheId?: number;
};
export type FoodKind = "custom" | "override" | "recipe" | "quick_meal";
export const COMPOUND_KINDS = ["recipe", "quick_meal"] as const;
export type GroupSource =
  "mine" | "culury" | "basic" | "fatsecret" | "usda" | "off" | "cache";
export type SearchGroup = {
  source: GroupSource;
  label: string;
  foods: FoodResult[];
};
/** suggestion: a close spelling from saved food names ("Did you mean …?"), only when little was found. */
// searched: the sources a typed search asked (pill order), so a source with nothing found still has its pill (§22)
export type SearchResult = {
  groups: SearchGroup[];
  errors: { source: string; message: string }[];
  searched: GroupSource[];
  suggestion?: string;
};

type CacheRow = typeof foodCache.$inferSelect;
type UserFoodRow = typeof userFoods.$inferSelect;

// Typed search shows the groups in this order (§21); "Saved foods" holds kept foods of other sources (restaurant items)
const GROUP_ORDER = [
  "mine",
  "culury",
  "basic",
  "fatsecret",
  "usda",
  "off",
  "cache",
] as const;
export const GROUP_LABELS: Record<GroupSource, string> = {
  mine: "My foods",
  culury: "Culury",
  basic: "Basic foods",
  fatsecret: "FatSecret",
  usda: "USDA branded",
  off: "Open Food Facts",
  cache: "Saved foods",
};
export const SOURCE_TIMEOUT_MS = 3000; // per outside source
const HOUR_MS = 60 * 60 * 1000;
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

// food_cache.source values shown as themselves (restaurant rows: brand = the chain)
const CACHE_SOURCES = new Set(["off", "usda", "spoonacular", "fatsecret"]);

/** AI-flagged keys that are actually present, in the standard order. */
const presentAiFields = (aiFields: readonly string[], nutrients: Nutrients) =>
  NUTRIENT_KEYS.filter(
    (k) => aiFields.includes(k) && nutrients[k] !== undefined,
  );

export function toResult(row: CacheRow, kind: "cache"): FoodResult;
export function toResult(row: UserFoodRow, kind: "user_food"): FoodResult;
export function toResult(
  row: CacheRow | UserFoodRow,
  kind: "cache" | "user_food",
): FoodResult {
  const nutrients = (row.nutrients ?? {}) as Nutrients;
  const base = {
    kind,
    id: row.id,
    name: row.name,
    brand: row.brand,
    icon: iconFor(row.category, row.name),
    barcode: row.barcode,
    servings: withMeasures(
      withLiquidVolumes(row.servings as Serving[], row.category, row.name),
      row.name,
    ),
    nutrients,
  };
  if (kind === "cache") {
    const c = row as CacheRow;
    return {
      ...base,
      aiFields: [],
      imageUrl: signImageUrl(c.imageUrl),
      override: false,
      source: CACHE_SOURCES.has(c.source)
        ? (c.source as FoodResult["source"])
        : "off",
      foodKind: "custom",
      savedAt: c.fetchedAt.toISOString(),
      summary: (c.raw as { summary?: unknown } | null)?.summary === true,
    };
  }
  const u = row as UserFoodRow;
  const aiFields = presentAiFields(u.aiFields, nutrients);
  const keys = Object.keys(nutrients);
  // Every value is an untouched AI guess → "ai"; anything the person typed or corrected → "mine"
  const allAi = keys.length > 0 && aiFields.length === keys.length;
  return {
    ...base,
    aiFields,
    imageUrl: u.imagePath ? signImageUrl(photoUrl(u.imagePath)) : null,
    override: u.kind === "override",
    source: allAi ? "ai" : "mine",
    foodKind: foodKindOf(u.kind),
    ...(u.kind === "override" && u.baseCacheId
      ? { baseCacheId: u.baseCacheId }
      : {}),
  };
}

/** A stored user_foods.kind as FoodResult.foodKind (an AI estimate the person saved is one of their own foods). */
export const foodKindOf = (kind: string): FoodKind =>
  kind === "override" || kind === "recipe" || kind === "quick_meal"
    ? kind
    : "custom";

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
  barcode: sql`coalesce(excluded.barcode, ${foodCache.barcode})`, // a FatSecret food.get has no barcode: keep the scanned one
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
export async function cacheUpsert(
  db: Db,
  f: SourceFood,
  now = new Date(),
): Promise<number> {
  const [row] = await upsertMany(db, [f], now);
  return row.id;
}

/** A FatSecret typed-search summary (calories, fat, carbs and protein for one serving), not a whole food. */
const SUMMARY = sql`(${foodCache.raw} ->> 'summary') = 'true'`;

/**
 * Saves outside foods in the cache (one statement); returns the rows in the same order (duplicates once).
 * A summary replaces only another summary: a whole food already kept stays as it is (and is returned).
 */
async function upsertMany(
  db: Db,
  foods: SourceFood[],
  now: Date,
): Promise<CacheRow[]> {
  const unique = [
    ...new Map(
      foods
        .filter((f) => f.sourceId)
        .map((f) => [`${f.source}:${f.sourceId}`, f]),
    ).values(),
  ];
  if (!unique.length) return [];
  const isSummary = (f: SourceFood) =>
    (f.raw as { summary?: unknown } | null)?.summary === true;
  const write = async (list: SourceFood[], onlySummaries: boolean) => {
    if (!list.length) return [];
    return db
      .insert(foodCache)
      .values(list.map((f) => cacheValues(f, now)))
      .onConflictDoUpdate({
        target: [foodCache.source, foodCache.sourceId],
        set: upsertSet,
        ...(onlySummaries ? { setWhere: SUMMARY } : {}),
      })
      .returning();
  };
  const summaries = unique.filter(isSummary);
  const rows = [
    ...(await write(
      unique.filter((f) => !isSummary(f)),
      false,
    )),
    ...(await write(summaries, true)),
  ];
  const byKey = new Map(rows.map((r) => [`${r.source}:${r.sourceId}`, r]));
  // Summaries skipped because a whole food is kept: that kept food
  const skipped = summaries.filter(
    (f) => !byKey.has(`${f.source}:${f.sourceId}`),
  );
  if (skipped.length) {
    const kept = await db
      .select()
      .from(foodCache)
      .where(
        and(
          eq(foodCache.source, "fatsecret"),
          inArray(
            foodCache.sourceId,
            skipped.map((f) => f.sourceId),
          ),
        ),
      );
    for (const r of kept) byKey.set(`${r.source}:${r.sourceId}`, r);
  }
  return unique
    .map((f) => byKey.get(`${f.source}:${f.sourceId}`)!)
    .filter(Boolean);
}

/** Marks kept foods as used now (found, opened or tracked): the cleanup leaves them an hour. */
export async function touchUsed(db: Db, ids: number[], now: Date) {
  if (ids.length)
    await db
      .update(foodCache)
      .set({ lastUsedAt: now })
      .where(inArray(foodCache.id, ids));
}

/** Whether a kept food is fresher than its source's hours. */
const fresh = (row: CacheRow, hours: SourceHours, now: Date) =>
  row.fetchedAt.getTime() >=
  now.getTime() - (hours[row.source as keyof SourceHours] ?? 0) * HOUR_MS;
/** A food fetched just now: no "Saved copy" note. */
const justFetched = (row: CacheRow): FoodResult => ({
  ...toResult(row, "cache"),
  savedAt: null,
});

// ---------- outside sources ----------

const SOURCE_LABEL = {
  off: "Open Food Facts",
  usda: "USDA",
  fatsecret: "FatSecret",
} as const;
type Outside = keyof typeof SOURCE_LABEL;

async function logSourceFailure(
  app: FastifyInstance,
  userId: number,
  source: Outside,
  what: string,
  err: unknown,
) {
  await logEvent(app.db, {
    category: "food",
    level: "warning",
    source: SOURCE_LABEL[source],
    event: `${SOURCE_LABEL[source]} ${what} failed`,
    detail: err instanceof Error ? err.message : String(err),
    userId,
  });
}

const friendly = (source: Outside, err: unknown) =>
  err instanceof SourceError
    ? err.message
    : `${SOURCE_LABEL[source]} couldn't be searched`;

// ---------- barcode ----------

export type BarcodeHit = {
  code: string;
  food: FoodResult | null;
  from: GroupSource | null;
  errors: SearchResult["errors"];
  /** The sources disagree on what this barcode is: one entry per different product, the most complete first. Empty otherwise. */
  choices: FoodResult[];
};

/**
 * A barcode: the person's own food with it wins outright, then the kept food they picked for it before. Otherwise
 * every source is asked at once (2026-11-22 barcode choices) — Open Food Facts, FatSecret (Premier only; a barcode it
 * found before is that one food fetched again) and USDA (only with a key) — each answered from its kept copy while
 * that is fresher than the source's hours. A source that can't be reached falls back to its stale kept copy, and is
 * listed in errors. What's found is kept; the most complete is the food, and `choices` lists the different products
 * when the sources disagree. A source the admin switched off is skipped silently.
 */
export async function lookupBarcode(
  app: FastifyInstance,
  userId: number,
  raw: string,
): Promise<BarcodeHit> {
  const code = normalizeBarcode(raw);
  if (!code) throw badRequest(NOT_A_BARCODE);
  const { db } = app;
  countUsage(app, userId, "barcodes_scanned");
  const errors: SearchResult["errors"] = []; // sources that couldn't be checked: "not found" isn't certain then
  const none = (): BarcodeHit => ({
    code,
    food: null,
    from: null,
    errors,
    choices: [],
  });

  const [mine] = await db
    .select()
    .from(userFoods)
    .where(
      and(
        eq(userFoods.userId, userId),
        eq(userFoods.barcode, code),
        eq(userFoods.archived, false),
      ),
    )
    .limit(1);
  if (mine)
    return { ...none(), food: toResult(mine, "user_food"), from: "mine" };

  const now = app.now();
  const [picked] = await db
    .select({ row: foodCache })
    .from(barcodePicks)
    .innerJoin(foodCache, eq(foodCache.id, barcodePicks.cacheId))
    .where(
      and(eq(barcodePicks.userId, userId), eq(barcodePicks.barcode, code)),
    );
  if (picked) {
    await touchUsed(db, [picked.row.id], now);
    return {
      ...none(),
      food: toResult(picked.row, "cache"),
      from: picked.row.source as GroupSource,
    };
  }

  const hours = await sourceHours(app);
  const kept = await db
    .select()
    .from(foodCache)
    .where(eq(foodCache.barcode, code))
    .orderBy(desc(foodCache.fetchedAt));
  const keptOf = (source: string) => kept.filter((r) => r.source === source);
  const freshOf = (source: string) =>
    keptOf(source).find((r) => fresh(r, hours, now));
  const switches = await sourceSwitches(app);
  const fs = await fatsecretInUse(app);
  const plan = fs ? await fatsecretPlan(app) : null;
  const [link] = fs
    ? await db
        .select()
        .from(fatsecretBarcodes)
        .where(eq(fatsecretBarcodes.barcode, code))
    : [];
  const usdaKey = await usdaKeyInUse(app);

  // One source's answer: its fresh kept copy, else asked (null: doesn't know it, or isn't asked); a failure falls
  // back to the stale kept copy
  type Answer = { row: CacheRow; fetched: boolean } | null;
  const ask = async (
    source: "off" | "fatsecret" | "usda",
    usage: UsageKey,
    what: () => Promise<SourceFood | null>,
  ): Promise<Answer> => {
    const ready = freshOf(source);
    if (ready) return { row: ready, fetched: false };
    countUsage(app, userId, usage);
    try {
      const found = await what();
      if (!found) return null;
      const [row] = await upsertMany(
        db,
        [{ ...found, barcode: found.barcode ?? code }],
        app.now(),
      );
      return { row, fetched: true };
    } catch (err) {
      if (
        source === "fatsecret" &&
        err instanceof SourceError &&
        err.kind === "no_scope"
      ) {
        await setBarcodeScopeMissing(app, true); // shown once on the FatSecret card; barcodes skip FatSecret now
        return null;
      }
      await logSourceFailure(app, userId, source, "barcode lookup", err);
      errors.push({ source, message: friendly(source, err) });
      const stale = keptOf(source)[0];
      return stale ? { row: stale, fetched: false } : null;
    }
  };
  // FatSecret takes GTIN-13: EAN-8 is padded with zeros; a longer code (a GTIN-14 case code) isn't asked
  const fsCode = code.length <= 13 ? code.padStart(13, "0") : null;
  const fsAsks =
    fs &&
    (link || (fsCode && plan?.plan === "premier" && !plan.barcodeScopeMissing));
  const answers = await Promise.all([
    switches.off
      ? ask("off", "outside_off", () =>
          offByBarcode(app.foodFetch, code, SOURCE_TIMEOUT_MS),
        )
      : null,
    fsAsks
      ? ask("fatsecret", "outside_fatsecret", async () => {
          if (link) return (await fs.item(link.foodId)).food;
          const id = await fs.barcode(fsCode!);
          if (!id) return null;
          await db
            .insert(fatsecretBarcodes)
            .values({ barcode: code, foodId: id, createdAt: app.now() })
            .onConflictDoUpdate({
              target: fatsecretBarcodes.barcode,
              set: { foodId: id },
            });
          return (await fs.item(id)).food;
        })
      : null,
    usdaKey
      ? ask("usda", "outside_usda", () =>
          usdaByBarcode(app.foodFetch, usdaKey, code, SOURCE_TIMEOUT_MS),
        )
      : null,
  ]);
  const found = answers.filter((a): a is NonNullable<Answer> => a !== null);
  // A source switched off or without a key still has its kept copy to offer when nothing else answers
  if (!found.length) {
    const any = kept[0];
    if (!any) return none();
    await touchUsed(db, [any.id], now);
    return {
      ...none(),
      food: toResult(any, "cache"),
      from: any.source as GroupSource,
    };
  }
  if (found.every((a) => !a.fetched)) countUsage(app, userId, "lookups_saved");
  await touchUsed(
    db,
    found.map((a) => a.row.id),
    app.now(),
  );
  const ranked = found.sort(
    (a, b) => completeness(b.row) - completeness(a.row),
  );
  const result = (a: NonNullable<Answer>) =>
    a.fetched ? justFetched(a.row) : toResult(a.row, "cache");
  const products = differentProducts(ranked.map((a) => a.row));
  return {
    code,
    food: result(ranked[0]),
    from: ranked[0].row.source as GroupSource,
    errors,
    choices:
      products.length > 1
        ? ranked.filter((a) => products.includes(a.row)).map(result)
        : [],
  };
}

/** Remembers the kept food a person picked for a barcode the sources disagreed on (404 when it isn't that barcode's). */
export async function pickBarcode(
  app: FastifyInstance,
  userId: number,
  raw: string,
  cacheId: number,
): Promise<void> {
  const code = normalizeBarcode(raw);
  if (!code) throw badRequest(NOT_A_BARCODE);
  const [row] = await app.db
    .select({ id: foodCache.id })
    .from(foodCache)
    .where(and(eq(foodCache.id, cacheId), eq(foodCache.barcode, code)));
  if (!row) throw new HttpError(404, "That food isn't one of this barcode's");
  await app.db
    .insert(barcodePicks)
    .values({ userId, barcode: code, cacheId, createdAt: app.now() })
    .onConflictDoUpdate({
      target: [barcodePicks.userId, barcodePicks.barcode],
      set: { cacheId, createdAt: app.now() },
    });
}

const SOURCE_ORDER: Record<string, number> = {
  fatsecret: 0.3,
  usda: 0.2,
  off: 0.1,
};
const tokens = (s: string | null | undefined) =>
  new Set(
    (s ?? "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1),
  );
/** The words of a food's name that aren't its brand ("Hills bros" by Hills Bros. has none: it doesn't say what it is). */
const productWords = (r: CacheRow) => {
  const brand = tokens(r.brand);
  return new Set([...tokens(r.name)].filter((w) => !brand.has(w)));
};

/**
 * How complete a kept food is, to put the likeliest right one first: a name that says more than the brand, a real
 * serving (not just "100 g"), protein / carbs / fat present; ties go FatSecret, USDA, Open Food Facts.
 */
export function completeness(r: CacheRow): number {
  const servings = (r.servings ?? []) as Serving[];
  const n = (r.nutrients ?? {}) as Nutrients;
  let score = SOURCE_ORDER[r.source] ?? 0;
  if (productWords(r).size > 0) score += 3;
  if (servings.some((s) => !/^100 ?(g|ml)$/i.test(s.label.trim()))) score += 2;
  for (const k of ["protein_g", "carbs_g", "fat_g"] as const)
    if (typeof n[k] === "number") score += 0.5;
  return score;
}

const per100 = (r: CacheRow): number | null => {
  const s = ((r.servings ?? []) as Serving[]).find((x) => x.grams);
  const kcal = (r.nutrients as Nutrients | null)?.calories;
  return s?.grams && typeof kcal === "number" ? (kcal / s.grams) * 100 : null;
};
/** The same product from two sources: both names say what it is, one's words contain the other's, and calories agree (±15%). */
function sameProduct(a: CacheRow, b: CacheRow): boolean {
  const wa = productWords(a);
  const wb = productWords(b);
  if (!wa.size || !wb.size) return false;
  const [small, big] = wa.size <= wb.size ? [wa, wb] : [wb, wa];
  if (![...small].every((w) => big.has(w))) return false;
  const ka = per100(a);
  const kb = per100(b);
  return (
    ka === null || kb === null || Math.abs(ka - kb) <= 0.15 * Math.max(ka, kb)
  );
}
/** One row per different product, in the order given (the first of each kind kept). */
export function differentProducts(rows: CacheRow[]): CacheRow[] {
  const out: CacheRow[] = [];
  for (const r of rows) if (!out.some((o) => sameProduct(o, r))) out.push(r);
  return out;
}

// ---------- text matching ----------

const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");
const words = (q: string) =>
  q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
const allWords = (hay: SQL, q: string) =>
  and(...words(q).map((w) => sql`${hay} ilike ${"%" + escapeLike(w) + "%"}`))!;
const userHay = sql`lower(${userFoods.name} || ' ' || coalesce(${userFoods.brand}, ''))`;
const cacheHay = sql`lower(${foodCache.name} || ' ' || coalesce(${foodCache.brand}, ''))`;
/** A cached USDA whole food (Foundation / SR Legacy, as USDA's own record says): shown under "Basic foods". */
const isBasicRow = (c: CacheRow) =>
  c.source === "usda" &&
  ["Foundation", "SR Legacy"].includes(
    (c.raw as { dataType?: unknown } | null)?.dataType as string,
  );
const TYPO_MATCH = 0.45; // word_similarity at which a name counts as the search mistyped

export const MY_FOOD_KINDS = ["all", "foods", "recipes", "meals"] as const;
export const MY_FOOD_SORTS = ["recent", "used", "az"] as const;
export type MyFoodsOptions = {
  kind?: (typeof MY_FOOD_KINDS)[number];
  sort?: (typeof MY_FOOD_SORTS)[number];
};
const KIND_FILTER = {
  foods: ["custom", "ai", "override"],
  recipes: ["recipe"],
  meals: ["quick_meal"],
} as const;

/**
 * The person's active foods matching q: every word appears, or it's close (pg_trgm, forgives typos).
 * kind narrows to plain foods, recipes or quick meals; sort: recent (last used, else made), used (most
 * logged), az. Without a sort: best match first for a search, else A–Z.
 */
export async function findMyFoods(
  db: Db,
  userId: number,
  q: string | null,
  limit: number,
  opts: MyFoodsOptions = {},
): Promise<UserFoodRow[]> {
  const kind =
    opts.kind && opts.kind !== "all"
      ? inArray(userFoods.kind, [...KIND_FILTER[opts.kind]])
      : undefined;
  const mine = and(
    eq(userFoods.userId, userId),
    eq(userFoods.archived, false),
    kind,
  );
  const az = [asc(sql`lower(${userFoods.name})`), asc(userFoods.id)];
  const sorted = {
    az,
    used: [
      desc(userFoods.useCount),
      sql`${userFoods.lastUsedAt} desc nulls last`,
      ...az,
    ],
    recent: [
      desc(sql`coalesce(${userFoods.lastUsedAt}, ${userFoods.createdAt})`),
      desc(userFoods.id),
    ],
  };
  if (!q)
    return db
      .select()
      .from(userFoods)
      .where(mine)
      .orderBy(...sorted[opts.sort ?? "az"])
      .limit(limit);
  const lq = q.toLowerCase();
  const similarity = sql`word_similarity(${lq}, ${userHay})`;
  return db
    .select()
    .from(userFoods)
    .where(
      and(
        mine,
        sql`(${allWords(userHay, q)} or ${similarity} >= ${TYPO_MATCH})`,
      ),
    )
    .orderBy(
      ...(opts.sort
        ? sorted[opts.sort]
        : [desc(similarity), desc(userFoods.useCount), asc(userFoods.name)]),
    )
    .limit(limit);
}

// ---------- search ----------

const DIGITS = /^[\d\s-]+$/;

export const MAX_QUERY = 100; // a typed search's length, for its kept answer and the outside calls

export async function searchFoods(
  app: FastifyInstance,
  userId: number,
  raw: string | undefined,
): Promise<SearchResult> {
  const q = (raw ?? "").trim().replace(/\s+/g, " ").slice(0, MAX_QUERY).trim();
  if (q.length < 2) throw badRequest("Type at least 2 characters");

  // A typed barcode: the same answer as a scan
  if (DIGITS.test(q) && normalizeBarcode(q)) {
    const hit = await lookupBarcode(app, userId, q);
    return {
      groups:
        hit.food && hit.from
          ? [
              {
                source: hit.from,
                label: GROUP_LABELS[hit.from],
                foods: [hit.food],
              },
            ]
          : [],
      errors: hit.errors,
      searched: [],
    };
  }

  const { db } = app;
  const query = q.toLowerCase();
  const now = app.now();
  const hours = await sourceHours(app);
  // Each source that is on answers from its kept answer for this search (fresher than its hours), else it is
  // asked at once (each with its own timeout) while the local lists are read. A call gives its foods, plus an
  // error when only part of it answered (USDA's two calls); only a whole answer is kept.
  type Answer = { foods: SourceFood[]; error: Error | null };
  const outside: {
    source: Outside;
    kept: { id: number; basic?: true }[] | null;
    run: Promise<Answer> | null;
  }[] = [];
  const add = async (source: Outside, call: () => Promise<Answer>) => {
    const [kept] = await db
      .select()
      .from(foodSearches)
      .where(
        and(
          eq(foodSearches.source, source),
          eq(foodSearches.query, query),
          gte(
            foodSearches.fetchedAt,
            new Date(now.getTime() - hours[source] * HOUR_MS),
          ),
        ),
      );
    if (kept) countUsage(app, userId, "lookups_saved");
    else countUsage(app, userId, `outside_${source}`);
    const run = kept ? null : call();
    run?.catch(() => {}); // handled below
    outside.push({ source, kept: kept ? kept.results : null, run });
  };
  const key = await usdaKeyInUse(app);
  const fs = await fatsecretInUse(app);
  if (fs)
    await add("fatsecret", () =>
      fs.searchFoods(q).then((foods) => ({ foods, error: null })),
    );
  if (key)
    await add("usda", () =>
      usdaSearch(app.foodFetch, key, q, SOURCE_TIMEOUT_MS),
    );
  if ((await sourceSwitches(app)).off)
    await add("off", () =>
      offSearch(app.foodFetch, q, SOURCE_TIMEOUT_MS).then((foods) => ({
        foods,
        error: null,
      })),
    );
  // The person's own Culury recipes (only their own link), at the same time
  const culury = await culuryLink(app, userId);
  const culuryRun = culury ? searchCulury(app, culury, q) : null;
  // Pill order (My foods is always searched); Basic foods are USDA's whole foods, so they are asked whenever USDA is
  const searched: GroupSource[] = [
    "mine",
    ...(fs ? (["fatsecret"] as const) : []),
    ...(key ? (["basic", "usda"] as const) : []),
    ...(outside.some((o) => o.source === "off") ? (["off"] as const) : []),
    ...(culury ? (["culury"] as const) : []),
  ];
  culuryRun?.catch(() => {}); // handled below

  const mine = await findMyFoods(db, userId, q, 10);
  // The person's own versions hide the kept ones they replace
  const notMine = sql`not exists (select 1 from ${userFoods} uf where uf.user_id = ${userId} and uf.archived = false and (uf.base_cache_id = ${foodCache.id} or uf.barcode = ${foodCache.barcode}))`;
  // Every word appears, or it's close (pg_trgm, forgives typos), like the person's own foods
  const similarity = sql`word_similarity(${query}, ${cacheHay})`;
  const cache = await db
    .select()
    .from(foodCache)
    .where(
      and(
        sql`(${allWords(cacheHay, q)} or ${similarity} >= ${TYPO_MATCH})`,
        notMine,
      ),
    )
    .orderBy(
      desc(sql`${foodCache.name} ilike ${escapeLike(q) + "%"}`),
      desc(similarity),
      desc(foodCache.fetchedAt),
    )
    .limit(10);

  const myBarcodes = new Set(mine.map((f) => f.barcode).filter(Boolean));
  const myBases = new Set(mine.map((f) => f.baseCacheId).filter(Boolean));
  const shown = new Set<number>();
  const found: Record<GroupSource, FoodResult[]> = {
    mine: mine.map((f) => toResult(f, "user_food")),
    culury: [],
    basic: [],
    fatsecret: [],
    usda: [],
    off: [],
    cache: [],
  };
  const errors: SearchResult["errors"] = [];
  /** A kept food in its source's group (a USDA whole food under Basic foods); a food fetched just now has no saved date. */
  const place = (r: CacheRow, basic: boolean) => {
    if (shown.has(r.id)) return;
    shown.add(r.id);
    const group: GroupSource =
      basic || isBasicRow(r)
        ? "basic"
        : r.source === "off" || r.source === "usda" || r.source === "fatsecret"
          ? r.source
          : "cache";
    found[group].push(
      r.fetchedAt.getTime() === now.getTime()
        ? justFetched(r)
        : toResult(r, "cache"),
    );
  };

  if (culuryRun) {
    try {
      found.culury = await culuryRun;
    } catch (err) {
      errors.push({ source: "culury", message: culuryMessage(err) });
      await logCuluryFailure(app, userId, "search", err);
    }
  }

  const settled = await Promise.allSettled(
    outside.map((o) => o.run ?? Promise.resolve(null)),
  );
  for (const [i, o] of outside.entries()) {
    const s = settled[i];
    let rows: CacheRow[] = [];
    let basicIds = new Set<number>();
    const fail = async (err: unknown) => {
      errors.push({ source: o.source, message: friendly(o.source, err) });
      await logSourceFailure(app, userId, o.source, "search", err);
    };
    try {
      if (s.status === "rejected") throw s.reason;
      if (o.kept) {
        const ids = o.kept.map((k) => k.id);
        const byId = new Map(
          (ids.length
            ? await db
                .select()
                .from(foodCache)
                .where(inArray(foodCache.id, ids))
            : []
          ).map((r) => [r.id, r]),
        );
        rows = ids.map((id) => byId.get(id)).filter((r): r is CacheRow => !!r); // a food cleaned up since is left out
        basicIds = new Set(o.kept.filter((k) => k.basic).map((k) => k.id));
      } else {
        const answer = s.value!;
        rows = await upsertMany(db, answer.foods, now);
        // USDA's plain whole foods (Foundation / SR Legacy) get their own group; the rest are branded
        const basicRefs = new Set(
          answer.foods.filter((f) => f.basic).map((f) => f.sourceId),
        );
        basicIds = new Set(
          rows.filter((r) => basicRefs.has(r.sourceId)).map((r) => r.id),
        );
        if (answer.error)
          await fail(answer.error); // part failed: what did come is still shown, but not kept
        else {
          const results = rows.map((r) =>
            basicIds.has(r.id)
              ? { id: r.id, basic: true as const }
              : { id: r.id },
          );
          await db
            .insert(foodSearches)
            .values({ source: o.source, query, results, fetchedAt: now })
            .onConflictDoUpdate({
              target: [foodSearches.source, foodSearches.query],
              set: { results, fetchedAt: now },
            });
        }
      }
    } catch (err) {
      await fail(err);
      continue;
    }
    for (const r of rows)
      if (!myBases.has(r.id) && !(r.barcode && myBarcodes.has(r.barcode)))
        place(r, basicIds.has(r.id));
  }
  // Kept foods that match the words (or a typo of them), from earlier searches and scans
  for (const r of cache) place(r, false);
  await touchUsed(db, [...shown], now);

  const lq = q.toLowerCase();
  const startsFirst = (foods: FoodResult[]) =>
    [...foods].sort(
      (a, b) =>
        Number(b.name.toLowerCase().startsWith(lq)) -
        Number(a.name.toLowerCase().startsWith(lq)),
    );
  const groups = GROUP_ORDER.map((source): SearchGroup => ({
    source,
    label: GROUP_LABELS[source],
    foods: startsFirst(found[source]),
  })).filter((g) => g.foods.length);
  const total = groups.reduce((n, g) => n + g.foods.length, 0);
  const suggestion =
    total < SUGGEST_BELOW ? await suggestSpelling(db, userId, q) : undefined;
  return { groups, errors, searched, ...(suggestion ? { suggestion } : {}) };
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
export async function suggestSpelling(
  db: Db,
  userId: number,
  q: string,
): Promise<string | undefined> {
  const lq = q.toLowerCase();
  if (/\s/.test(lq) || lq.length < 3) return undefined;
  const split = (col: SQL) =>
    sql`regexp_split_to_table(lower(${col}), '[^[:alpha:]]+')`;
  const forms = formsOf(lq);
  const known = sql`w in (${sql.join(
    [...forms].map((f) => sql`${f}`),
    sql`, `,
  )})`;
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
  const inside = [...forms].filter(
    (f) => f.length >= 3 && f.length <= lq.length,
  );
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
  .transform((s) => ({
    label: s.label,
    ...(s.grams !== undefined ? { grams: s.grams } : {}),
    ...(s.ml !== undefined && !(s.approx && s.grams !== undefined)
      ? { ml: s.ml }
      : {}),
  }));
const nutrientsSchema = z.strictObject(
  Object.fromEntries(
    NUTRIENT_KEYS.map((k) => [
      k,
      z.number().nonnegative().max(1000000).optional(),
    ]),
  ) as Record<NutrientKey, z.ZodOptional<z.ZodNumber>>,
);

export const foodFields = z.object({
  name: z.string().trim().min(1, "Give the food a name").max(200),
  brand: z.string().trim().max(200).nullable().optional(),
  barcode: z.string().trim().max(40).nullable().optional(),
  // A unit worked out on lookup ("1 prune") is never saved: it's worked out again next time
  servings: z.preprocess(
    (v) =>
      Array.isArray(v)
        ? v.filter(
            (s) =>
              !(
                s &&
                typeof s === "object" &&
                (s as { derived?: unknown }).derived === true
              ),
          )
        : v,
    z.array(serving).min(1, "Add at least one serving").max(20),
  ),
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

async function barcodeTaken(
  db: Db,
  userId: number,
  code: string | null | undefined,
  exceptId?: number,
) {
  if (!code) return false;
  const [row] = await db
    .select({ id: userFoods.id })
    .from(userFoods)
    .where(
      and(
        eq(userFoods.userId, userId),
        eq(userFoods.barcode, code),
        eq(userFoods.archived, false),
        exceptId ? ne(userFoods.id, exceptId) : undefined,
      ),
    )
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

export async function createMyFood(
  app: FastifyInstance,
  userId: number,
  body: FoodFields,
): Promise<FoodResult> {
  const barcode = barcodeField(body.barcode) ?? null;
  if (await barcodeTaken(app.db, userId, barcode))
    throw new HttpError(409, DUP_BARCODE);
  const nutrients = cleanNutrients(body.nutrients);
  const imagePath = body.photoId
    ? await photoForFood(app, userId, body.photoId, null)
    : null;
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
      .returning(),
  );
  if (body.photoId) await linkPhoto(app, userId, body.photoId);
  return toResult(row, "user_food");
}

export async function ownFood(db: Db, userId: number, id: number) {
  const [row] = await db
    .select()
    .from(userFoods)
    .where(
      and(
        eq(userFoods.id, id),
        eq(userFoods.userId, userId),
        eq(userFoods.archived, false),
      ),
    );
  if (!row) throw new HttpError(404, "Food not found");
  return row;
}

export async function updateMyFood(
  app: FastifyInstance,
  userId: number,
  id: number,
  body: Partial<FoodFields>,
): Promise<FoodResult> {
  const row = await ownFood(app.db, userId, id);
  if ((COMPOUND_KINDS as readonly string[]).includes(row.kind))
    throw badRequest("Edit recipes and quick meals in their own editor");
  const barcode = barcodeField(body.barcode);
  if (
    barcode !== undefined &&
    (await barcodeTaken(app.db, userId, barcode, id))
  )
    throw new HttpError(409, DUP_BARCODE);
  const nutrients = body.nutrients
    ? cleanNutrients(body.nutrients)
    : (row.nutrients as Nutrients);
  const imagePath = body.photoId
    ? await photoForFood(app, userId, body.photoId, row.imagePath)
    : undefined;
  // Values the person changed are theirs now, not the AI's (unless the caller says which are AI)
  const old = row.nutrients as Nutrients;
  const aiFields =
    body.aiFields ??
    row.aiFields.filter(
      (k) => old[k as NutrientKey] === nutrients[k as NutrientKey],
    );
  const [updated] = await guardUnique(() =>
    app.db
      .update(userFoods)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.brand !== undefined ? { brand: body.brand || null } : {}),
        ...(barcode !== undefined ? { barcode } : {}),
        ...(body.category !== undefined
          ? { category: body.category || null }
          : {}),
        ...(body.servings !== undefined ? { servings: body.servings } : {}),
        nutrients,
        aiFields: presentAiFields(aiFields, nutrients),
        ...(imagePath !== undefined ? { imagePath } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(userFoods.id, id), eq(userFoods.userId, userId)))
      .returning(),
  );
  if (body.photoId) await linkPhoto(app, userId, body.photoId);
  return toResult(updated, "user_food");
}

/**
 * A correction of a cached food, bound to its barcode: a copy of the cached food with the edits.
 * If the person already has an active food with that barcode (or a correction of this food),
 * that one is updated instead.
 */
export async function overrideFood(
  app: FastifyInstance,
  userId: number,
  body: z.infer<typeof overrideFields>,
): Promise<FoodResult> {
  const { db } = app;
  const [base] = await db
    .select()
    .from(foodCache)
    .where(eq(foodCache.id, body.cacheId));
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
    nutrients: body.nutrients
      ? cleanNutrients(body.nutrients)
      : (base.nutrients as Nutrients),
    aiFields: [] as string[],
  };
  const mine = and(eq(userFoods.userId, userId), eq(userFoods.archived, false));
  const [existing] = await db
    .select({ id: userFoods.id })
    .from(userFoods)
    .where(
      and(
        mine,
        base.barcode
          ? eq(userFoods.barcode, base.barcode)
          : eq(userFoods.baseCacheId, base.id),
      ),
    )
    .limit(1);
  const [row] = existing
    ? await db
        .update(userFoods)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(userFoods.id, existing.id))
        .returning()
    : await guardUnique(() =>
        db
          .insert(userFoods)
          .values({ userId, ...values })
          .returning(),
      );
  return toResult(row, "user_food");
}

/** A food the person may log or use as an ingredient: any cached food, or one of their own active foods. */
export async function loadFood(
  db: Db,
  userId: number,
  ref: { kind: "cache" | "user_food"; id: number },
): Promise<FoodResult> {
  if (ref.kind === "cache") {
    const [row] = await db
      .select()
      .from(foodCache)
      .where(eq(foodCache.id, ref.id));
    if (row) return toResult(row, "cache");
  } else {
    const [row] = await db
      .select()
      .from(userFoods)
      .where(
        and(
          eq(userFoods.id, ref.id),
          eq(userFoods.userId, userId),
          eq(userFoods.archived, false),
        ),
      );
    if (row) return toResult(row, "user_food");
  }
  throw new HttpError(404, "Food not found");
}

// ---------- AI ----------

const SYSTEM = [
  "You are a nutrition label expert. You estimate nutrition facts for foods as sold or served in the United States.",
  "Use US serving sizes (the way a US nutrition label or restaurant menu would).",
  'Keep each serving label short, under 40 characters, like a label would write it ("1 sandwich", "1 cup (240 ml)"): never list the ingredients in it.',
  `Nutrient keys (per the first serving): ${NUTRIENT_KEYS.join(", ")}. Units: calories in kcal, *_g in grams, *_mg in milligrams, water_ml in millilitres.`,
  "Give every key you can reasonably estimate; leave out a key only when it can't be known.",
  "Values are plain numbers only (no units, no ranges, no strings). Answer with JSON only.",
].join("\n");

export async function aiReady(app: FastifyInstance) {
  if (!(await app.ai.active("food"))) throw new HttpError(503, AI_NOT_READY);
}

// Room for models that think before answering (common on OpenRouter), and asked to think only a little
const askFood = (
  app: FastifyInstance,
  userId: number,
  user: string,
  opts: { signal?: AbortSignal; onProgress?: (p: AiProgress) => void } = {},
) =>
  app.ai
    .ask("food", SYSTEM, user, {
      userId,
      maxTokens: 4000,
      reasoning: "low",
      ...opts,
    })
    .then((r) => r.json);

const SERVING_LABEL_MAX = 60;

/** A serving label the AI made too long, cut to fit at the last whole word (one long word: cut mid-word) with "…". */
export function shortLabel(label: string): string {
  if (label.length <= SERVING_LABEL_MAX) return label;
  const room = label.slice(0, SERVING_LABEL_MAX - 1);
  const atWord = room.replace(/\s+\S*$/, "");
  return `${(atWord || room).replace(/[\s,;:(\-]+$/, "")}…`;
}

const aiFood = z.object({
  name: z.string().trim().min(1).max(200),
  brand: z.string().trim().max(200).nullable().optional(),
  category: z.string().trim().max(100).nullable().optional(),
  servings: z
    .array(
      z.object({
        // The AI sometimes writes the whole recipe into the label: shortened rather than losing the estimate
        label: z.string().trim().min(1).transform(shortLabel),
        grams: z.number().positive().nullable().optional(),
        ml: z.number().positive().nullable().optional(),
      }),
    )
    .min(1),
  nutrients: z.record(z.string(), z.unknown()),
});

export type AiDraft = Omit<FoodResult, "id" | "kind" | "foodKind"> & {
  category: string;
};

// What the person sees when the estimate fails (never which AI service it was)
export const AI_COULDNT_ESTIMATE =
  "The AI couldn't estimate that. Try again, or describe it differently.";
export const AI_NO_IDEA =
  "Couldn't work out what that is. Try describing it differently.";

/** One food of several the AI saw or read about (a plate photo, "2 eggs and toast"): a draft and how much of it. */
export type EstimateItem = {
  food: AiDraft;
  servingIndex: number;
  quantity: number;
};
export const MAX_ESTIMATE_ITEMS = 12;

/** The usable items of an AI answer {"items": [...]}: each a draft with a positive amount (1 when missing), at most 12. */
export function estimateItems(json: unknown): EstimateItem[] {
  const list = (json as { items?: unknown } | null)?.items;
  if (!Array.isArray(list)) return [];
  const out: EstimateItem[] = [];
  for (const raw of list) {
    const food = aiDraft(raw);
    if (!food) continue;
    const q = Number((raw as { quantity?: unknown }).quantity);
    out.push({
      food,
      servingIndex: 0,
      quantity: Number.isFinite(q) && q > 0 && q <= 100 ? q : 1,
    });
    if (out.length === MAX_ESTIMATE_ITEMS) break;
  }
  return out;
}

// assumed: the AI took the text to mean something worth confirming ("Did you mean Cheerios?"): interpretedAs
export type Estimate = {
  food: AiDraft;
  assumed: boolean;
  interpretedAs?: string;
};

const ESTIMATE_ASK = (text: string) =>
  [
    `Estimate this food: ${JSON.stringify(text)}`,
    "",
    'Assume the most likely food the person meant: the text may misspell it, write a brand name loosely, or leave words out. Only when nothing sensible fits, give up and answer {"unknown": true}.',
    `Answer as JSON: {"name": string, "brand": string | null, "category": string, "servings": [{"label": string, "grams"?: number, "ml"?: number}], "nutrients": {<key>: number}, "assumed": boolean, "interpretedAs"?: string}. servings[0] is the usual US serving and the nutrients are for it.`,
    'name is the food as you understood it. Set assumed to true (and interpretedAs to what you took it to mean, e.g. "Cheerios" for "cherios") only when you changed or guessed what was typed: a misspelling, an unclear or partial name, a guessed brand, a missing word. Not when you only reworded clear words (order, case, commas, plurals, adding the usual name): "a large banana" named as "Banana, large" is not assumed; leave assumed false and interpretedAs out.',
  ].join("\n");

/**
 * Describe it: the AI's draft of a food from a few words, and whether it had to assume what was meant.
 * signal: the person cancelled (AiStopped is thrown); onProgress: what's happening, e.g. another AI asked.
 */
export async function estimateFood(
  app: FastifyInstance,
  userId: number,
  text: string,
  opts: { signal?: AbortSignal; onProgress?: (p: AiProgress) => void } = {},
): Promise<Estimate> {
  await aiReady(app);
  let json: Record<string, unknown>;
  try {
    json = await askFood(app, userId, ESTIMATE_ASK(text), opts);
  } catch (err) {
    if (err instanceof AiStopped || !(err instanceof AiError)) throw err;
    throw new HttpError(502, AI_COULDNT_ESTIMATE); // what went wrong is in Settings › Logs
  }
  if (json.unknown === true) throw new HttpError(422, AI_NO_IDEA);
  const food = aiDraft(json);
  if (!food) {
    await logEvent(app.db, {
      category: "ai",
      level: "warning",
      source: "AI estimate",
      event: "The AI's food estimate couldn't be used",
      detail: JSON.stringify(json).slice(0, 600),
      userId,
    });
    throw new HttpError(502, AI_COULDNT_ESTIMATE);
  }
  // Read on their own: a wrong-shaped answer here only means nothing to confirm
  countUsage(app, userId, "ai_estimates");
  const assumed = z.boolean().safeParse(json.assumed).data === true;
  const interpretedAs = z
    .string()
    .trim()
    .min(1)
    .max(200)
    .safeParse(json.interpretedAs).data;
  return assumed
    ? { food, assumed, interpretedAs: interpretedAs ?? food.name }
    : { food, assumed };
}

const ESTIMATE_ITEMS_ASK = (text: string) =>
  [
    `List the foods in this description: ${JSON.stringify(text)}`,
    "",
    'List each separate food once ("2 eggs, toast and coffee" is three foods), with a usual US serving for it and how many of those servings were eaten (2 eggs: quantity 2 of "1 large egg").',
    'Assume the most likely foods the person meant: the text may misspell a food, write a brand name loosely, or leave words out. Only when nothing sensible fits, give up and answer {"unknown": true}.',
    `Answer as JSON: {"items": [{"name": string, "brand": string | null, "category": string, "servings": [{"label": string, "grams"?: number, "ml"?: number}], "nutrients": {<key>: number}, "quantity": number}], "mealName": string | null, "assumed": boolean, "interpretedAs"?: string}. servings[0] is the usual US serving and the nutrients are for it.`,
    'When there are two or more foods, mealName is a short everyday name for them eaten together (e.g. "Breakfast sandwich", "Eggs and toast"), under 40 characters; with one food it is null.',
    "Set assumed to true (and interpretedAs to what you took the text to mean) only when you changed or guessed what was typed: a misspelling, an unclear name, a guessed brand. Not when you only reworded clear words.",
  ].join("\n");

/** The foods' everyday name together (One meal): the AI's, else their names joined; null for one food (nothing to switch to). */
export function mealNameOf(
  items: readonly EstimateItem[],
  aiName: unknown,
): string | null {
  if (items.length < 2) return null;
  const given = z.string().trim().min(1).safeParse(aiName).data;
  if (given) return shortLabel(given);
  const names = items.map((i) => i.food.name);
  return shortLabel(
    `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`,
  );
}

export type ItemsEstimate = {
  items: EstimateItem[];
  mealName: string | null;
  assumed: boolean;
  interpretedAs?: string;
};

/**
 * Describe it with several foods: one draft per food with its amount, a name for them together (One meal), and
 * whether the AI had to assume. signal / onProgress as for estimateFood.
 */
export async function estimateFoodItems(
  app: FastifyInstance,
  userId: number,
  text: string,
  opts: { signal?: AbortSignal; onProgress?: (p: AiProgress) => void } = {},
): Promise<ItemsEstimate> {
  await aiReady(app);
  let json: Record<string, unknown>;
  try {
    json = await askFood(app, userId, ESTIMATE_ITEMS_ASK(text), opts);
  } catch (err) {
    if (err instanceof AiStopped || !(err instanceof AiError)) throw err;
    throw new HttpError(502, AI_COULDNT_ESTIMATE);
  }
  if (json.unknown === true) throw new HttpError(422, AI_NO_IDEA);
  const items = estimateItems(json);
  if (!items.length) {
    await logEvent(app.db, {
      category: "ai",
      level: "warning",
      source: "AI estimate",
      event: "The AI's food estimate couldn't be used",
      detail: JSON.stringify(json).slice(0, 600),
      userId,
    });
    throw new HttpError(502, AI_COULDNT_ESTIMATE);
  }
  countUsage(app, userId, "ai_estimates");
  const assumed = z.boolean().safeParse(json.assumed).data === true;
  const interpretedAs = z
    .string()
    .trim()
    .min(1)
    .max(200)
    .safeParse(json.interpretedAs).data;
  const mealName = mealNameOf(items, json.mealName);
  return assumed
    ? {
        items,
        mealName,
        assumed,
        interpretedAs:
          interpretedAs ?? items.map((i) => i.food.name).join(", "),
      }
    : { items, mealName, assumed };
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
    // At most 20 servings, and no weight/volume a log entry can't hold (100,000 g or ml): Log all mustn't fail on them
    servings: f.servings
      .slice(0, 20)
      .map((s) => ({
        label: s.label,
        ...(s.grams && s.grams <= 100000 ? { grams: s.grams } : {}),
        ...(s.ml && s.ml <= 100000 ? { ml: s.ml } : {}),
      })),
    nutrients,
    aiFields: Object.keys(nutrients),
    imageUrl: null,
    override: false,
    source: "ai",
  };
}

/** Asks AI for only the nutrients a stored food is missing. A draft: nothing is saved. */
export async function fillGaps(
  app: FastifyInstance,
  userId: number,
  ref: { kind: "cache" | "user_food"; id: number },
): Promise<{ nutrients: Nutrients; aiFields: string[] }> {
  const { db } = app;
  const [row] =
    ref.kind === "cache"
      ? await db.select().from(foodCache).where(eq(foodCache.id, ref.id))
      : await db
          .select()
          .from(userFoods)
          .where(
            and(
              eq(userFoods.id, ref.id),
              eq(userFoods.userId, userId),
              eq(userFoods.archived, false),
            ),
          );
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
    ].join("\n"),
  ).catch((err) => {
    throw err instanceof AiError ? new HttpError(502, err.message) : err;
  });
  const got = cleanNutrients(
    json && typeof json.nutrients === "object" ? json.nutrients : json,
  );
  const nutrients: Nutrients = {};
  for (const k of missing) if (got[k] !== undefined) nutrients[k] = got[k];
  return { nutrients, aiFields: Object.keys(nutrients) };
}
