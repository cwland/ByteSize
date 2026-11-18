// Restaurant menus: Spoonacular first, FatSecret when Spoonacular has no key, is out of points, fails or
// finds nothing. Spoonacular calls go through a queue (at most one a second, on the app clock); its search
// answers are kept 24 h and an item's nutrition once fetched. FatSecret search hits are never kept; an item
// is stored (as a food_cache row) only when the person opens it to log or star it.
import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
import { appSettings, foodCache, logEntries, restaurantFavourites, restaurantSearches } from "../../db/schema.js";
import { logEvent } from "../appLog.js";
import { HttpError, badRequest, notFound } from "../errors.js";
import { cacheUpsert, SOURCE_TIMEOUT_MS, toResult, type FoodResult } from "../foods.js";
import { restaurantKeys, type RestaurantKeys } from "../foodSources/settings.js";
import { SOURCE_NAMES, SourceError } from "../foodSources/types.js";
import { fatsecret, type FatSecretToken } from "./fatsecret.js";
import { spoonacular } from "./spoonacular.js";
import { RESTAURANT_SOURCES, type MenuHit, type RestaurantAdapter, type RestaurantSource } from "./types.js";

export const QUOTA_MESSAGE = "Today's restaurant lookups are used up. They reset at midnight UTC — or use Describe it.";
export const NO_KEY_MESSAGE = "Add a restaurant data key in Settings › Integrations";
export const MIN_QUERY_MESSAGE = "Type at least 3 letters";
const SEARCH_FRESH_MS = 24 * 60 * 60 * 1000;
const SPACING_MS = 1000; // Spoonacular free plan: 1 request a second
export const QUOTA_KEY = "restaurant_quota"; // app_settings: { left, day } — Spoonacular points left on that UTC day

export type RestaurantItem = MenuHit & { cacheId: number | null };
export type RestaurantSearch = { items: RestaurantItem[]; lookupsLeft: number | null; errors: { source: RestaurantSource; message: string }[] };

// ---------- per-app state: the Spoonacular queue and FatSecret tokens (kept in memory only) ----------

// Keyed by the app's database handle: route plugins get their own (encapsulated) Fastify instance,
// but every one of them shares the root app's db object, so the whole app has one queue.
// inflight: item fetches under way ("source:id"), so two opens at once share one call
type State = { queue: Promise<unknown>; lastAt: number | null; tokens: Map<string, FatSecretToken>; inflight: Map<string, Promise<unknown>> };
const states = new WeakMap<object, State>();
function state(app: FastifyInstance): State {
  let s = states.get(app.db);
  if (!s) states.set(app.db, (s = { queue: Promise.resolve(), lastAt: null, tokens: new Map(), inflight: new Map() }));
  return s;
}

/** Forgets the queue timing and FatSecret tokens (tests). */
export function resetRestaurantState(app: FastifyInstance) {
  states.delete(app.db);
}

/** Runs fn after the previous queued call has finished and at least a second after it started (app clock). */
export function throttled<T>(app: FastifyInstance, fn: () => Promise<T>): Promise<T> {
  const st = state(app);
  const run = st.queue.then(async () => {
    if (st.lastAt !== null) {
      const wait = Math.min(SPACING_MS, st.lastAt + SPACING_MS - app.now().getTime());
      if (wait > 0) await app.sleep(wait);
    }
    st.lastAt = app.now().getTime();
    return fn();
  });
  st.queue = run.catch(() => {});
  return run;
}

// ---------- sources and quota ----------

function adapterFor(app: FastifyInstance, keys: RestaurantKeys, source: RestaurantSource): RestaurantAdapter | null {
  if (source === "spoonacular") return keys.spoonacular ? spoonacular({ fetch: app.foodFetch, apiKey: keys.spoonacular, timeoutMs: SOURCE_TIMEOUT_MS }) : null;
  const fs = keys.fatsecret;
  return fs ? fatsecret({ fetch: app.foodFetch, clientId: fs.clientId, clientSecret: fs.clientSecret, timeoutMs: SOURCE_TIMEOUT_MS, now: () => app.now().getTime(), tokens: state(app).tokens }) : null;
}

const configured = (keys: RestaurantKeys): RestaurantSource[] => RESTAURANT_SOURCES.filter((s) => (s === "spoonacular" ? keys.spoonacular : keys.fatsecret));
const utcDay = (d: Date) => d.toISOString().slice(0, 10);

/** Spoonacular points left today, as its last answer said (null: not known today). */
async function pointsLeft(app: FastifyInstance): Promise<number | null> {
  const [row] = await app.db.select().from(appSettings).where(eq(appSettings.key, QUOTA_KEY));
  const v = row?.value as { left?: unknown; day?: unknown } | undefined;
  return v && v.day === utcDay(app.now()) && typeof v.left === "number" ? v.left : null;
}

async function savePoints(app: FastifyInstance, left: number) {
  const value = { left, day: utcDay(app.now()) };
  await app.db.insert(appSettings).values({ key: QUOTA_KEY, value }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}

/** Forgets that Spoonacular was used up today (a new key gets tried straight away). */
export async function clearPoints(app: FastifyInstance) {
  await app.db.delete(appSettings).where(eq(appSettings.key, QUOTA_KEY));
}

/** "N lookups left today": whole points left, when Spoonacular is set up and has said today. */
async function lookupsLeft(app: FastifyInstance, keys: RestaurantKeys): Promise<number | null> {
  if (!keys.spoonacular) return null;
  const left = await pointsLeft(app);
  return left === null ? null : Math.floor(left);
}

const outOfPoints = async (app: FastifyInstance) => {
  const left = await pointsLeft(app);
  return left !== null && left < 1;
};

/** A queued Spoonacular call; a 402 is recorded before the next queued call starts. */
function spoonQueued<T>(app: FastifyInstance, fn: () => Promise<T>): Promise<T> {
  return throttled(app, async () => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof SourceError && err.kind === "quota") await savePoints(app, 0);
      throw err;
    }
  });
}

/** Checked again inside the queue: a call waiting behind one that got 402 never reaches Spoonacular. */
async function stillHasPoints(app: FastifyInstance) {
  if (await outOfPoints(app)) throw new SourceError("spoonacular", "Spoonacular's daily lookups are used up", "quota");
}

/** Logs a failed call (category food, no secrets: messages are ByteSize's own) and gives the message to show. */
async function failed(app: FastifyInstance, userId: number | null, source: RestaurantSource, what: string, err: unknown): Promise<string> {
  const quota = err instanceof SourceError && err.kind === "quota";
  if (quota && source === "spoonacular") await savePoints(app, 0);
  await logEvent(app.db, {
    category: "food",
    level: "warning",
    source: SOURCE_NAMES[source],
    event: `${SOURCE_NAMES[source]} ${what} failed`,
    detail: err instanceof SourceError ? `${err.kind}: ${err.message}` : "unexpected error",
    userId,
  });
  if (quota) return QUOTA_MESSAGE;
  return err instanceof SourceError ? err.message : `${SOURCE_NAMES[source]} couldn't be searched`;
}

// ---------- status and search ----------

export async function restaurantStatus(app: FastifyInstance) {
  const keys = await restaurantKeys(app);
  return { sources: configured(keys), lookupsLeft: await lookupsLeft(app, keys) };
}

const normalise = (q: string) => q.trim().replace(/\s+/g, " ");

async function freshSearch(app: FastifyInstance, query: string): Promise<MenuHit[] | null> {
  const since = new Date(app.now().getTime() - SEARCH_FRESH_MS);
  const [row] = await app.db
    .select()
    .from(restaurantSearches)
    .where(and(eq(restaurantSearches.source, "spoonacular"), eq(restaurantSearches.query, query), gte(restaurantSearches.fetchedAt, since)));
  return row ? (row.results as MenuHit[]) : null;
}

/** The saved food (if any) for each hit. */
async function withCacheIds(app: FastifyInstance, items: MenuHit[]): Promise<RestaurantItem[]> {
  if (!items.length) return [];
  const rows = await app.db
    .select({ id: foodCache.id, source: foodCache.source, sourceId: foodCache.sourceId })
    .from(foodCache)
    .where(or(...items.map((i) => and(eq(foodCache.source, i.source), eq(foodCache.sourceId, i.sourceId)))));
  const ids = new Map(rows.map((r) => [`${r.source}:${r.sourceId}`, r.id]));
  return items.map((i) => ({ ...i, cacheId: ids.get(`${i.source}:${i.sourceId}`) ?? null }));
}

export async function searchRestaurants(app: FastifyInstance, userId: number, raw: string | undefined): Promise<RestaurantSearch> {
  const keys = await restaurantKeys(app);
  if (!keys.spoonacular && !keys.fatsecret) throw badRequest(NO_KEY_MESSAGE);
  const q = normalise(raw ?? "");
  if (q.length < 3) throw badRequest(MIN_QUERY_MESSAGE);
  const errors: RestaurantSearch["errors"] = [];
  let items: MenuHit[] = [];

  const spoon = adapterFor(app, keys, "spoonacular");
  if (spoon) {
    const query = q.toLowerCase();
    const kept = await freshSearch(app, query);
    if (kept) items = kept;
    else if (await outOfPoints(app)) errors.push({ source: "spoonacular", message: QUOTA_MESSAGE });
    else {
      try {
        // Re-checked in the queue: the same search waiting behind another is answered from the cache
        items = await spoonQueued(app, async () => {
          const again = await freshSearch(app, query);
          if (again) return again;
          await stillHasPoints(app);
          const r = await spoon.search(q);
          if (r.quota) await savePoints(app, r.quota.left);
          const now = app.now();
          await app.db
            .insert(restaurantSearches)
            .values({ source: "spoonacular", query, results: r.items, fetchedAt: now })
            .onConflictDoUpdate({ target: [restaurantSearches.source, restaurantSearches.query], set: { results: r.items, fetchedAt: now } });
          return r.items;
        });
      } catch (err) {
        errors.push({ source: "spoonacular", message: await failed(app, userId, "spoonacular", "search", err) });
      }
    }
  }

  const fs = items.length ? null : adapterFor(app, keys, "fatsecret");
  if (fs) {
    try {
      items = (await fs.search(q)).items; // not stored: FatSecret's plan lists no storage permission
    } catch (err) {
      errors.push({ source: "fatsecret", message: await failed(app, userId, "fatsecret", "search", err) });
    }
  }
  return { items: await withCacheIds(app, items), lookupsLeft: await lookupsLeft(app, keys), errors };
}

// ---------- items ----------

/** An item's nutrition as a food: from the cache when fetched before, else fetched once and stored. */
export async function restaurantItem(app: FastifyInstance, userId: number, source: RestaurantSource, sourceId: string): Promise<{ food: FoodResult; lookupsLeft: number | null }> {
  const keys = await restaurantKeys(app);
  const find = () => app.db.select().from(foodCache).where(and(eq(foodCache.source, source), eq(foodCache.sourceId, sourceId)));
  const [have] = await find();
  if (have) {
    // Opened again: kept another 24 h, so the hourly cleanup can't remove a FatSecret food being logged
    if (source === "fatsecret") await app.db.update(foodCache).set({ fetchedAt: app.now() }).where(eq(foodCache.id, have.id));
    return { food: toResult(have, "cache"), lookupsLeft: await lookupsLeft(app, keys) };
  }

  const adapter = adapterFor(app, keys, source);
  if (!adapter) throw badRequest(NO_KEY_MESSAGE);
  if (source === "spoonacular" && (await outOfPoints(app))) throw new HttpError(503, QUOTA_MESSAGE);
  // Two opens of the same item at once share one fetch (and one stored row)
  const inflight = state(app).inflight;
  const key = `${source}:${sourceId}`;
  let pending = inflight.get(key) as Promise<void> | undefined;
  if (!pending) {
    pending = (async () => {
      let fetched;
      try {
        fetched =
          source === "spoonacular"
            ? await spoonQueued(app, async () => {
                if ((await find())[0]) return null;
                await stillHasPoints(app);
                return adapter.item(sourceId);
              })
            : await adapter.item(sourceId);
      } catch (err) {
        throw new HttpError(503, await failed(app, userId, source, "item lookup", err));
      }
      if (fetched) {
        if (fetched.quota) await savePoints(app, fetched.quota.left);
        await cacheUpsert(app.db, { ...fetched.food, source, sourceId }, app.now());
      }
    })().finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  await pending;
  const [row] = await find();
  return { food: toResult(row, "cache"), lookupsLeft: await lookupsLeft(app, keys) };
}

// ---------- admin Test ----------

/** Settings › Integrations › Test: one small search. Spoonacular's costs about 1 point. */
export async function testRestaurantSource(app: FastifyInstance, userId: number, source: RestaurantSource): Promise<{ ok: true; lookupsLeft?: number | null } | { ok: false; error: string }> {
  const keys = await restaurantKeys(app);
  const adapter = adapterFor(app, keys, source);
  if (!adapter) return { ok: false, error: NO_KEY_MESSAGE };
  try {
    if (source === "fatsecret") {
      await adapter.search("burger", 1);
      return { ok: true };
    }
    const r = await spoonQueued(app, () => adapter.search("burger", 1));
    if (r.quota) await savePoints(app, r.quota.left);
    return { ok: true, lookupsLeft: await lookupsLeft(app, keys) };
  } catch (err) {
    return { ok: false, error: await failed(app, userId, source, "test", err) };
  }
}

// ---------- favourites and recent chains (the person's own) ----------

export async function listFavourites(app: FastifyInstance, userId: number) {
  const rows = await app.db
    .select({ chain: restaurantFavourites.chain, food: foodCache })
    .from(restaurantFavourites)
    .innerJoin(foodCache, eq(foodCache.id, restaurantFavourites.cacheId))
    .where(eq(restaurantFavourites.userId, userId))
    .orderBy(asc(sql`lower(${restaurantFavourites.chain})`), asc(sql`lower(${foodCache.name})`), asc(foodCache.id));
  const chains: { chain: string; foods: FoodResult[] }[] = [];
  for (const r of rows) {
    const last = chains[chains.length - 1];
    if (last?.chain === r.chain) last.foods.push(toResult(r.food, "cache"));
    else chains.push({ chain: r.chain, foods: [toResult(r.food, "cache")] });
  }
  return { chains };
}

export async function addFavourite(app: FastifyInstance, userId: number, cacheId: number) {
  const [food] = await app.db
    .select()
    .from(foodCache)
    .where(and(eq(foodCache.id, cacheId), inArray(foodCache.source, [...RESTAURANT_SOURCES])));
  if (!food) throw notFound("Restaurant food");
  await app.db
    .insert(restaurantFavourites)
    .values({ userId, cacheId, chain: food.brand ?? "Restaurant", createdAt: app.now() })
    .onConflictDoNothing();
  return listFavourites(app, userId);
}

export async function removeFavourite(app: FastifyInstance, userId: number, cacheId: number) {
  const gone = await app.db
    .delete(restaurantFavourites)
    .where(and(eq(restaurantFavourites.userId, userId), eq(restaurantFavourites.cacheId, cacheId)))
    .returning({ id: restaurantFavourites.id });
  if (!gone.length) throw notFound("Favourite");
  return listFavourites(app, userId);
}

/** Chains of the restaurant foods the person logged, most recent first. */
export async function recentChains(app: FastifyInstance, userId: number, limit = 10): Promise<{ chains: string[] }> {
  const last = sql<Date>`max(${logEntries.createdAt})`;
  const rows = await app.db
    .select({ chain: foodCache.brand, last })
    .from(logEntries)
    .innerJoin(foodCache, sql`${logEntries.sourceRef} = 'cache:' || ${foodCache.id}`)
    .where(and(eq(logEntries.userId, userId), eq(logEntries.source, "cache"), inArray(foodCache.source, [...RESTAURANT_SOURCES]), sql`${foodCache.brand} is not null`))
    .groupBy(foodCache.brand)
    .orderBy(desc(last))
    .limit(limit);
  return { chains: rows.map((r) => r.chain!) };
}

// ---------- cleanup (on start, then hourly; logged under "schedule") ----------

const CLEANUP_EVERY_MS = 60 * 60 * 1000;

/**
 * Removes Spoonacular search answers older than 24 h, and FatSecret foods fetched more than 24 h ago
 * that nobody starred, logged, used in a recipe or quick meal, or corrected (FatSecret's plan lists no
 * storage permission). Spoonacular items are kept. Returns how many rows went.
 */
export async function cleanupRestaurants(app: FastifyInstance): Promise<{ foods: number; searches: number }> {
  const cutoff = new Date(app.now().getTime() - SEARCH_FRESH_MS);
  const searches = await app.db.delete(restaurantSearches).where(lt(restaurantSearches.fetchedAt, cutoff)).returning({ id: restaurantSearches.id });
  const foods = await app.db
    .delete(foodCache)
    .where(
      and(
        eq(foodCache.source, "fatsecret"),
        lt(foodCache.fetchedAt, cutoff),
        sql`not exists (select 1 from restaurant_favourites f where f.cache_id = ${foodCache.id})`,
        sql`not exists (select 1 from log_entries le where le.source_ref = 'cache:' || ${foodCache.id})`,
        sql`not exists (select 1 from recipe_items ri where ri.food_kind = 'cache' and ri.food_id = ${foodCache.id})`,
        sql`not exists (select 1 from user_foods uf where uf.base_cache_id = ${foodCache.id})`,
      ),
    )
    .returning({ id: foodCache.id });
  if (foods.length || searches.length) {
    await logEvent(app.db, {
      category: "schedule",
      level: "info",
      source: "Restaurant cleanup",
      event: `Removed ${foods.length} unused FatSecret food${foods.length === 1 ? "" : "s"} and ${searches.length} old restaurant search${searches.length === 1 ? "" : "es"}`,
      detail: "Kept 24 hours; starred, logged, recipe and corrected foods stay",
    });
  }
  return { foods: foods.length, searches: searches.length };
}

export function scheduleRestaurantCleanup(app: FastifyInstance) {
  const run = () =>
    cleanupRestaurants(app).catch((err) =>
      logEvent(app.db, { category: "schedule", level: "error", source: "Restaurant cleanup", event: "The restaurant cleanup failed", detail: (err as Error).message }),
    );
  let timer: NodeJS.Timeout | undefined;
  app.addHook("onReady", async () => {
    void run();
    timer = setInterval(run, CLEANUP_EVERY_MS);
    timer.unref();
  });
  app.addHook("onClose", async () => clearInterval(timer));
}
