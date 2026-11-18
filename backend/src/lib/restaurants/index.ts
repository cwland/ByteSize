// Restaurant menus: a kept answer first, then FatSecret, then Spoonacular when FatSecret has no key, is off, fails
// or finds nothing. A source the admin switched off counts as not set up: never asked, never reported. Search
// answers (both sources) and items are kept for their source's hours (Settings › Integrations; FatSecret 24 h,
// Spoonacular 1 h by default) and cleaned up hourly (lookups.ts). Spoonacular calls go through a queue (at most
// one a second, on the app clock).
import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
import { appSettings, foodCache, logEntries, restaurantFavourites, restaurantSearches } from "../../db/schema.js";
import { logEvent } from "../appLog.js";
import { HttpError, badRequest, notFound } from "../errors.js";
import { cacheUpsert, SOURCE_TIMEOUT_MS, toResult, touchUsed, type FoodResult } from "../foods.js";
import { restaurantKeys, restaurantKeysInUse, sourceHours, type RestaurantKeys } from "../foodSources/settings.js";
import { SOURCE_NAMES, SourceError } from "../foodSources/types.js";
import { fatsecret, type FatSecretAdapter, type FatSecretToken } from "./fatsecret.js";
import { spoonacular } from "./spoonacular.js";
import { RESTAURANT_SOURCES, type MenuHit, type RestaurantAdapter, type RestaurantSource } from "./types.js";

export const QUOTA_MESSAGE = "Today's restaurant lookups are used up. They reset at midnight UTC — or use Describe it.";
export const NO_KEY_MESSAGE = "Add a restaurant data key in Settings › Integrations";
export const TURN_ON_MESSAGE = "Turn on FatSecret or Spoonacular in Settings › Integrations.";
export const MIN_QUERY_MESSAGE = "Type at least 3 letters";
const HOUR_MS = 60 * 60 * 1000;
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
  return fatsecretWith(app, keys);
}

function fatsecretWith(app: FastifyInstance, keys: RestaurantKeys): FatSecretAdapter | null {
  const fs = keys.fatsecret;
  return fs ? fatsecret({ fetch: app.foodFetch, clientId: fs.clientId, clientSecret: fs.clientSecret, timeoutMs: SOURCE_TIMEOUT_MS, now: () => app.now().getTime(), tokens: state(app).tokens }) : null;
}

/** FatSecret when it is on and has its id and secret (typed search, barcodes, Check for changes); else null. */
export async function fatsecretInUse(app: FastifyInstance): Promise<FatSecretAdapter | null> {
  return fatsecretWith(app, await restaurantKeysInUse(app));
}

/** A queued Spoonacular item fetch (Check for changes), or null when Spoonacular isn't in use. */
export async function spoonacularItem(app: FastifyInstance, sourceId: string) {
  const adapter = adapterFor(app, await restaurantKeysInUse(app), "spoonacular");
  if (!adapter) return null;
  if (await outOfPoints(app)) throw new SourceError("spoonacular", QUOTA_MESSAGE, "quota");
  return spoonQueued(app, async () => {
    await stillHasPoints(app);
    const r = await adapter.item(sourceId);
    if (r.quota) await savePoints(app, r.quota.left);
    return r.food;
  });
}

// FatSecret first (more chains, no daily points), then Spoonacular
const configured = (keys: RestaurantKeys): RestaurantSource[] => (["fatsecret", "spoonacular"] as const).filter((s) => (s === "spoonacular" ? keys.spoonacular : keys.fatsecret));
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

/** No source in use although a key is saved: the admin switched them off. */
async function switchedOff(app: FastifyInstance, inUse: RestaurantKeys): Promise<boolean> {
  return configured(inUse).length === 0 && configured(await restaurantKeys(app)).length > 0;
}

/** Why a request can't use a source: a key is saved but switched off, or there's no key. */
const unusable = async (app: FastifyInstance, inUse: RestaurantKeys) => badRequest((await switchedOff(app, inUse)) ? TURN_ON_MESSAGE : NO_KEY_MESSAGE);

/** turnedOff: keys are saved but every source is switched off (Add food says to turn one on). */
export async function restaurantStatus(app: FastifyInstance) {
  const keys = await restaurantKeysInUse(app);
  return { sources: configured(keys), lookupsLeft: await lookupsLeft(app, keys), turnedOff: await switchedOff(app, keys) };
}

const normalise = (q: string) => q.trim().replace(/\s+/g, " ");

/** The source's kept answer for this search, while it is fresher than the source's hours. */
async function keptSearch(app: FastifyInstance, source: RestaurantSource, query: string): Promise<MenuHit[] | null> {
  const since = new Date(app.now().getTime() - (await sourceHours(app))[source] * HOUR_MS);
  const [row] = await app.db
    .select()
    .from(restaurantSearches)
    .where(and(eq(restaurantSearches.source, source), eq(restaurantSearches.query, query), gte(restaurantSearches.fetchedAt, since)));
  return row ? (row.results as MenuHit[]) : null;
}

async function keepSearch(app: FastifyInstance, source: RestaurantSource, query: string, items: MenuHit[]) {
  const now = app.now();
  await app.db
    .insert(restaurantSearches)
    .values({ source, query, results: items, fetchedAt: now })
    .onConflictDoUpdate({ target: [restaurantSearches.source, restaurantSearches.query], set: { results: items, fetchedAt: now } });
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
  const keys = await restaurantKeysInUse(app);
  if (!keys.spoonacular && !keys.fatsecret) throw await unusable(app, keys);
  const q = normalise(raw ?? "");
  if (q.length < 3) throw badRequest(MIN_QUERY_MESSAGE);
  const errors: RestaurantSearch["errors"] = [];
  let items: MenuHit[] = [];
  const query = q.toLowerCase();

  const fs = adapterFor(app, keys, "fatsecret");
  if (fs) {
    const kept = await keptSearch(app, "fatsecret", query);
    if (kept) items = kept;
    else {
      try {
        items = (await fs.search(q)).items;
        await keepSearch(app, "fatsecret", query, items);
      } catch (err) {
        errors.push({ source: "fatsecret", message: await failed(app, userId, "fatsecret", "search", err) });
      }
    }
  }

  const spoon = items.length ? null : adapterFor(app, keys, "spoonacular");
  if (spoon) {
    const kept = await keptSearch(app, "spoonacular", query);
    if (kept) items = kept;
    else if (await outOfPoints(app)) errors.push({ source: "spoonacular", message: QUOTA_MESSAGE });
    else {
      try {
        // Re-checked in the queue: the same search waiting behind another is answered from the kept answer
        items = await spoonQueued(app, async () => {
          const again = await keptSearch(app, "spoonacular", query);
          if (again) return again;
          await stillHasPoints(app);
          const r = await spoon.search(q);
          if (r.quota) await savePoints(app, r.quota.left);
          await keepSearch(app, "spoonacular", query, r.items);
          return r.items;
        });
      } catch (err) {
        errors.push({ source: "spoonacular", message: await failed(app, userId, "spoonacular", "search", err) });
      }
    }
  }
  return { items: await withCacheIds(app, items), lookupsLeft: await lookupsLeft(app, keys), errors };
}

// ---------- items ----------

/** A FatSecret typed-search summary (not the whole food). */
const isSummary = (row: typeof foodCache.$inferSelect) => (row.raw as { summary?: unknown } | null)?.summary === true;

/**
 * An item's nutrition as a food: the kept copy while it is fresher than its source's hours, else fetched once
 * and kept (a FatSecret typed-search summary is fetched whole). A kept copy is still used when its source is off.
 */
export async function restaurantItem(app: FastifyInstance, userId: number, source: RestaurantSource, sourceId: string): Promise<{ food: FoodResult; lookupsLeft: number | null }> {
  const keys = await restaurantKeysInUse(app);
  const find = () => app.db.select().from(foodCache).where(and(eq(foodCache.source, source), eq(foodCache.sourceId, sourceId)));
  const since = app.now().getTime() - (await sourceHours(app))[source] * HOUR_MS;
  const [have] = await find();
  const kept = have && !isSummary(have) ? have : null;
  // Opened: used now, so the hourly cleanup leaves it while it is being tracked ("Saved copy from" stays the fetch time)
  const keptCopy = async () => {
    await touchUsed(app.db, [kept!.id], app.now());
    return { food: toResult(kept!, "cache"), lookupsLeft: await lookupsLeft(app, keys) };
  };
  if (kept && kept.fetchedAt.getTime() >= since) return keptCopy();

  // Past its hours, a kept copy is still used when the source can't be asked (off, out of points) or fails
  const adapter = adapterFor(app, keys, source);
  if (!adapter && kept) return keptCopy();
  // This source isn't in use: switched off (its key is saved) or no key
  if (!adapter) throw badRequest((await restaurantKeys(app))[source] ? TURN_ON_MESSAGE : NO_KEY_MESSAGE);
  if (source === "spoonacular" && (await outOfPoints(app))) {
    if (kept) return keptCopy();
    throw new HttpError(503, QUOTA_MESSAGE);
  }
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
                const [meanwhile] = await find(); // fetched by a queued open of the same item
                if (meanwhile && !isSummary(meanwhile) && meanwhile.fetchedAt.getTime() >= since && (!have || meanwhile.fetchedAt > have.fetchedAt)) return null;
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
  try {
    await pending;
  } catch (err) {
    if (kept) return keptCopy();
    throw err;
  }
  const [row] = await find();
  await touchUsed(app.db, [row.id], app.now());
  return { food: { ...toResult(row, "cache"), savedAt: null }, lookupsLeft: await lookupsLeft(app, keys) };
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

/**
 * A kept food about to be shown whole or tracked: a FatSecret typed-search summary is fetched whole first (one
 * call, then kept); anything else as kept. Either way it counts as used now. When FatSecret can't be asked (off,
 * failing) the summary is used as it is.
 */
export async function wholeKeptFood(app: FastifyInstance, userId: number, cacheId: number): Promise<FoodResult> {
  const [row] = await app.db.select().from(foodCache).where(eq(foodCache.id, cacheId));
  if (!row) throw notFound("Food");
  if (row.source === "fatsecret" && isSummary(row)) {
    try {
      return (await restaurantItem(app, userId, "fatsecret", row.sourceId)).food;
    } catch {
      // FatSecret off or failing: the summary is better than nothing
    }
  }
  await touchUsed(app.db, [row.id], app.now());
  return toResult(row, "cache");
}
