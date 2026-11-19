// Kept lookups (§21): the hourly cleanup of answers older than their source's hours, "Check for changes" (one
// kept food fetched again from its source), and the admin's Saved barcodes list. Kept foods (food_cache) are
// shared public data, not anyone's own.
import type { FastifyInstance } from "fastify";
import { and, desc, eq, ilike, inArray, isNotNull, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { foodCache, foodSearches, restaurantSearches } from "../db/schema.js";
import { waitOnClose } from "./schedule.js";
import { logEvent } from "./appLog.js";
import { cleanupInvites } from "./invites.js";
import { HttpError, badRequest, notFound } from "./errors.js";
import { cacheUpsert, SOURCE_TIMEOUT_MS, toResult, type FoodResult } from "./foods.js";
import { offByBarcode } from "./foodSources/off.js";
import { SWITCHED_SOURCES, sourceHours, sourceSwitches, usdaKeyInUse, type SourceHours } from "./foodSources/settings.js";
import { SOURCE_NAMES, SourceError, type SourceFood, type SourceName } from "./foodSources/types.js";
import { usdaById } from "./foodSources/usda.js";
import { countUsage } from "./usage.js";
import { QUOTA_MESSAGE, fatsecretInUse, spoonacularItem } from "./restaurants/index.js";

const HOUR_MS = 60 * 60 * 1000;
const CLEANUP_EVERY_MS = HOUR_MS;
type CacheRow = typeof foodCache.$inferSelect;

/**
 * A kept food something uses, by the "table.column" that points at it: a starred restaurant item, a logged entry
 * (entries keep their own copy, but recent chains and backups read the kept food), a recipe or quick-meal
 * ingredient, or a "My foods" edit based on it. Every column a backup counts (backup.ts CACHE_REFERENCES) is here.
 */
const USES: Record<string, SQL> = {
  "restaurant_favourites.cache_id": sql`exists (select 1 from restaurant_favourites f where f.cache_id = ${foodCache.id})`,
  "log_entries.source_ref": sql`exists (select 1 from log_entries le where le.source_ref = 'cache:' || ${foodCache.id})`,
  "recipe_items.food_id": sql`exists (select 1 from recipe_items ri where ri.food_kind = 'cache' and ri.food_id = ${foodCache.id})`,
  "user_foods.base_cache_id": sql`exists (select 1 from user_foods uf where uf.base_cache_id = ${foodCache.id})`,
};
export const IN_USE_REFS = Object.keys(USES);
export const IN_USE: SQL = sql`(${sql.join(Object.values(USES), sql` or `)})`;
/** Found, opened or tracked this recently: kept, so a food someone is about to track isn't cleaned up under them. */
const RECENT_USE_MS = HOUR_MS;

// ---------- cleanup (on start, then hourly; logged under "schedule") ----------

/**
 * Removes kept foods and kept search answers (typed and restaurant searches) older than their source's hours,
 * except foods in use. The FatSecret barcode → food id links stay for good. Returns how many rows went.
 */
export async function cleanupLookups(app: FastifyInstance): Promise<{ foods: number; searches: number }> {
  const hours = await sourceHours(app);
  let foods = 0;
  let searches = 0;
  for (const source of SWITCHED_SOURCES) {
    const cutoff = new Date(app.now().getTime() - hours[source] * HOUR_MS);
    const usedSince = new Date(app.now().getTime() - RECENT_USE_MS);
    const notRecent = or(isNull(foodCache.lastUsedAt), lt(foodCache.lastUsedAt, usedSince));
    foods += (await app.db.delete(foodCache).where(and(eq(foodCache.source, source), lt(foodCache.fetchedAt, cutoff), notRecent, sql`not ${IN_USE}`)).returning({ id: foodCache.id })).length;
    searches += (await app.db.delete(foodSearches).where(and(eq(foodSearches.source, source), lt(foodSearches.fetchedAt, cutoff))).returning({ id: foodSearches.id })).length;
    searches += (await app.db.delete(restaurantSearches).where(and(eq(restaurantSearches.source, source), lt(restaurantSearches.fetchedAt, cutoff))).returning({ id: restaurantSearches.id })).length;
  }
  if (foods || searches) {
    await logEvent(app.db, {
      category: "schedule",
      level: "info",
      source: "Lookup cleanup",
      event: `Removed ${foods} kept food${foods === 1 ? "" : "s"} and ${searches} kept search${searches === 1 ? "" : "es"}`,
      detail: "Older than their source's hours; foods in use (logged, starred, in a recipe or quick meal, or edited) stay",
    });
  }
  return { foods, searches };
}

/** The hourly cleanups: kept lookups, then old invite links (§46). Each logs its own failure; never throws. */
export async function runCleanups(app: FastifyInstance) {
  await cleanupLookups(app).catch((err) => logEvent(app.db, { category: "schedule", level: "error", source: "Lookup cleanup", event: "The lookup cleanup failed", detail: (err as Error).message }));
  await cleanupInvites(app).catch((err) => logEvent(app.db, { category: "schedule", level: "error", source: "Invite cleanup", event: "The invite cleanup failed", detail: (err as Error).message }));
}

export function scheduleLookupCleanup(app: FastifyInstance) {
  const run = () => runCleanups(app);
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<unknown> = Promise.resolve();
  app.addHook("onReady", async () => {
    await run(); // the first run finishes before the app is ready (it never throws), so nothing races it at start
    timer = setInterval(() => void (running = run()), CLEANUP_EVERY_MS);
    timer.unref();
  });
  app.addHook("onClose", async () => {
    clearInterval(timer);
    await waitOnClose(app, "lookup cleanup", running); // closing waits (a while) for a run still going
  });
}

// ---------- Check for changes ----------

export const TURN_ON = (source: SourceName) => `Turn on ${SOURCE_NAMES[source]} in Settings › Integrations to check for changes`;
export type RefreshResult = { result: "updated" | "up_to_date"; food: FoodResult };
/** Check for changes: 10 a minute per person (each one calls an outside source). */
export const refreshRateLimit = {
  rateLimit: { max: 10, timeWindow: 60_000, keyGenerator: (req: { routeOptions: { url?: string }; auth?: { userId: number }; ip: string }) => `${req.routeOptions.url}|${req.auth?.userId ?? req.ip}` },
};

/** The same in any key order (a value read back from jsonb has its keys in jsonb's order). */
const sorted = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sorted(x)])) : v;
const shown = (r: { name: string; brand: string | null; servings: unknown; nutrients: unknown }) => JSON.stringify(sorted([r.name, r.brand, r.servings, r.nutrients]));

/** The kept food as its source has it now; null when the source no longer knows it. */
async function fetchAgain(app: FastifyInstance, userId: number, row: CacheRow): Promise<SourceFood | null> {
  const source = row.source as SourceName;
  if (source === "off") {
    // A kept food of a source that is off can't be checked (its switch means: never call it)
    if (!(await sourceSwitches(app)).off) throw badRequest(TURN_ON("off"));
    countUsage(app, userId, "outside_off");
    return offByBarcode(app.foodFetch, row.sourceId, SOURCE_TIMEOUT_MS);
  }
  if (source === "usda") {
    const key = await usdaKeyInUse(app);
    if (!key) throw badRequest(TURN_ON("usda"));
    countUsage(app, userId, "outside_usda");
    return usdaById(app.foodFetch, key, row.sourceId, SOURCE_TIMEOUT_MS);
  }
  if (source === "fatsecret") {
    const fs = await fatsecretInUse(app);
    if (!fs) throw badRequest(TURN_ON("fatsecret"));
    countUsage(app, userId, "outside_fatsecret");
    return (await fs.item(row.sourceId)).food;
  }
  if (source === "spoonacular") {
    const food = await spoonacularItem(app, row.sourceId, userId);
    if (!food) throw badRequest(TURN_ON("spoonacular"));
    return food;
  }
  throw badRequest("This food can't be checked for changes");
}

/**
 * Check for changes: one call to the kept food's source; the kept copy is replaced by what the source says now
 * (and counts as fetched now). "updated" when its name, brand, servings or nutrients changed.
 */
export async function refreshKept(app: FastifyInstance, userId: number, cacheId: number): Promise<RefreshResult> {
  const [row] = await app.db.select().from(foodCache).where(eq(foodCache.id, cacheId));
  if (!row) throw notFound("Food");
  // Spoonacular's daily points are the server's: a copy younger than its hours isn't fetched again
  if (row.source === "spoonacular") {
    const again = new Date(row.fetchedAt.getTime() + (await sourceHours(app)).spoonacular * HOUR_MS);
    if (again > app.now()) throw new HttpError(409, `This copy is already up to date — Spoonacular lets ByteSize check again after ${again.toISOString().slice(11, 16)} UTC`);
  }
  let food: SourceFood | null;
  try {
    food = await fetchAgain(app, userId, row);
  } catch (err) {
    if (!(err instanceof SourceError)) throw err;
    await logEvent(app.db, { category: "food", level: "warning", source: SOURCE_NAMES[err.source], event: `${SOURCE_NAMES[err.source]} check for changes failed`, detail: `${err.kind}: ${err.message}`, userId });
    throw new HttpError(503, err.kind === "quota" ? QUOTA_MESSAGE : err.message);
  }
  if (!food) throw new HttpError(404, `${SOURCE_NAMES[row.source as SourceName] ?? "Its source"} no longer has this food`);
  // Same source and id as kept (an OFF code may come back in another form); the scanned barcode stays
  await cacheUpsert(app.db, { ...food, source: row.source as SourceName, sourceId: row.sourceId, barcode: food.barcode ?? row.barcode }, app.now());
  const [now] = await app.db.select().from(foodCache).where(eq(foodCache.id, cacheId));
  return { result: shown(now) === shown(row) ? "up_to_date" : "updated", food: { ...toResult(now, "cache"), savedAt: null } };
}

// ---------- Saved barcodes (admin) ----------

export type SavedBarcode = { cacheId: number; barcode: string; name: string; brand: string | null; source: string; savedAt: string; deletesAt: string | null; inUse: boolean };

const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");

function savedFilter(q: string | undefined, sources?: string[]): SQL {
  const bySource = sources ? (sources.length ? inArray(foodCache.source, sources) : sql`false`) : undefined;
  return and(searchFilter(q), bySource)!;
}

function searchFilter(q: string | undefined): SQL {
  const words = (q ?? "").trim();
  if (!words) return isNotNull(foodCache.barcode);
  const like = `%${escapeLike(words)}%`;
  return and(isNotNull(foodCache.barcode), or(ilike(foodCache.name, like), ilike(foodCache.brand, like), ilike(foodCache.barcode, like)))!;
}

/**
 * Every kept food with a barcode, newest first, pageSize a page; q matches the name, brand or barcode; sources narrows
 * to those sources. `sources` in the answer counts per source for the filter pills: it follows q but not the filter.
 */
export async function listSavedBarcodes(app: FastifyInstance, q: string | undefined, page: number, pageSize: number, sources?: string[]) {
  const where = savedFilter(q, sources);
  const perSource = await app.db.select({ source: foodCache.source, n: sql<number>`count(*)::int` }).from(foodCache).where(searchFilter(q)).groupBy(foodCache.source);
  const counts = Object.fromEntries(perSource.map((r) => [r.source, r.n]));
  const [{ total }] = await app.db.select({ total: sql<number>`count(*)::int` }).from(foodCache).where(where);
  const rows = await app.db
    .select({ row: foodCache, inUse: sql<boolean>`${IN_USE}` })
    .from(foodCache)
    .where(where)
    .orderBy(desc(foodCache.fetchedAt), desc(foodCache.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const hours = await sourceHours(app);
  const items: SavedBarcode[] = rows.map(({ row, inUse }) => {
    const h = hours[row.source as keyof SourceHours];
    return {
      cacheId: row.id,
      barcode: row.barcode!,
      name: row.name,
      brand: row.brand,
      source: row.source,
      savedAt: row.fetchedAt.toISOString(),
      deletesAt: inUse || h === undefined ? null : new Date(row.fetchedAt.getTime() + h * HOUR_MS).toISOString(),
      inUse,
    };
  });
  return { total, page, pageSize, sources: counts, items };
}

/** Deletes one kept barcode food; one in use stays (409). The FatSecret barcode link stays. */
export async function deleteSavedBarcode(app: FastifyInstance, cacheId: number) {
  const [row] = await app.db.select({ id: foodCache.id, inUse: sql<boolean>`${IN_USE}` }).from(foodCache).where(and(eq(foodCache.id, cacheId), isNotNull(foodCache.barcode)));
  if (!row) throw notFound("Saved barcode");
  if (row.inUse) throw new HttpError(409, "Kept — in use, so it can't be deleted");
  await app.db.delete(foodCache).where(eq(foodCache.id, cacheId));
  return { deleted: 1 };
}

/** "Delete all not in use": every kept barcode food nothing uses. */
export async function deleteUnusedBarcodes(app: FastifyInstance) {
  const gone = await app.db
    .delete(foodCache)
    .where(and(isNotNull(foodCache.barcode), sql`not ${IN_USE}`))
    .returning({ id: foodCache.id });
  return { deleted: gone.length };
}
