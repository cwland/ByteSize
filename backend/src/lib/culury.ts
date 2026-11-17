// Culury: the person's own recipe / meal-planning app, read over HTTP with a read-only API key (X-API-Key).
// ByteSize never writes to it. The link is per person (user_settings.culury_url / culury_key_enc, the key
// encrypted). Only GET {culury}/api/plan and GET {culury}/api/recipes… are ever called, with a 3 s timeout,
// no redirects followed, and failures reported as plain messages (never Culury's answer, the key or the URL).
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { userSettings } from "../db/schema.js";
import { logEvent } from "./appLog.js";
import { addDays, MEALS, type Meal } from "./days.js";
import { badRequest } from "./errors.js";
import { iconFor } from "./foodIcons.js";
import type { FoodResult } from "./foods.js";
import type { NutrientKey, Nutrients, Serving } from "./nutrients.js";
import { decryptSecret, encryptSecret } from "./secrets.js";

export const CULURY_TIMEOUT_MS = 3000;
const MAX_URL = 300;
const MAX_KEY = 300;
// Cloud metadata services: never a Culury
const BLOCKED_HOSTS = new Set(["metadata.google.internal", "metadata", "169.254.169.254", "[fd00:ec2::254]"]);

/** Culury didn't answer usefully. The message is safe to show (never the key, the URL or Culury's answer). */
export class CuluryError extends Error {
  constructor(
    message: string,
    public notFound = false,
  ) {
    super(message);
    this.name = "CuluryError";
  }
}

// ---------- the link ----------

/**
 * A Culury address as it's kept: http(s) only, no user name or password, no query or fragment, no trailing
 * slash (a path is kept, for a Culury behind a sub-path). Anything else is a 400.
 */
export function cleanCuluryUrl(raw: string): string {
  const bad = () => badRequest("Enter Culury's address, like http://192.168.1.20:4000 (http or https, no user name or password)");
  if (raw.length > MAX_URL) throw bad();
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw bad();
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw bad();
  if (u.username || u.password || !u.hostname) throw bad();
  const host = u.hostname.toLowerCase();
  // link-local (169.254.x.x, also as ::ffff:169.254.x.x, fe80::) is where cloud metadata lives
  if (BLOCKED_HOSTS.has(host) || /^169\.254\./.test(host) || /^\[fe[89ab][0-9a-f]:/i.test(host) || /^\[::ffff:a9fe:/i.test(host)) throw bad();
  return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
}

export type CuluryLink = { url: string; key: string };

async function storedLink(app: FastifyInstance, userId: number) {
  const [row] = await app.db.select({ url: userSettings.culuryUrl, keyEnc: userSettings.culuryKeyEnc }).from(userSettings).where(eq(userSettings.userId, userId));
  return { url: row?.url ?? null, key: row?.keyEnc ? decryptSecret(row.keyEnc, app.jwtSecret) : null };
}

/** This person's Culury link, or null when they haven't linked one (or its key can't be read any more). */
export async function culuryLink(app: FastifyInstance, userId: number): Promise<CuluryLink | null> {
  const { url, key } = await storedLink(app, userId);
  return url && key ? { url, key } : null;
}

/** What Settings shows: the address and whether a key is saved (the key itself is never sent back). */
export async function culurySummary(app: FastifyInstance, userId: number) {
  const { url, key } = await storedLink(app, userId);
  return { url, hasKey: key !== null };
}

/** Saves the link. A new address needs the key typed again, so a saved key never goes to another host. */
export async function saveCuluryLink(app: FastifyInstance, userId: number, rawUrl: string, apiKey: string | undefined) {
  const url = cleanCuluryUrl(rawUrl);
  const key = apiKey?.trim();
  if (key && key.length > MAX_KEY) throw badRequest("That API key is too long");
  const current = await storedLink(app, userId);
  if (!key && !(current.key && current.url === url)) throw badRequest("Enter Culury's API key (Culury › Settings › API keys, Read only)");
  const set = { culuryUrl: url, ...(key ? { culuryKeyEnc: encryptSecret(key, app.jwtSecret) } : {}) };
  await app.db
    .insert(userSettings)
    .values({ userId, culuryUrl: url, culuryKeyEnc: encryptSecret(key || current.key!, app.jwtSecret) })
    .onConflictDoUpdate({ target: userSettings.userId, set });
}

export async function removeCuluryLink(app: FastifyInstance, userId: number) {
  await app.db.update(userSettings).set({ culuryUrl: null, culuryKeyEnc: null }).where(eq(userSettings.userId, userId));
}

// ---------- calling Culury ----------

/** GET {culury}{path}?{query} with the key; the parsed JSON. path is one of ours, never from a request. */
async function culuryGet(app: FastifyInstance, link: CuluryLink, path: "/api/plan" | "/api/recipes" | `/api/recipes/${number}`, query: Record<string, string> = {}, timeoutMs = CULURY_TIMEOUT_MS): Promise<unknown> {
  const qs = new URLSearchParams(query).toString();
  const url = `${link.url}${path}${qs ? `?${qs}` : ""}`;
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctrl.abort();
      reject(new CuluryError("Culury took too long to answer"));
    }, Math.max(0, timeoutMs));
  });
  const call = (async () => {
    let res: Response;
    try {
      // redirect "manual": a 3xx is answered as it is (and refused below), never followed to another host
      res = await app.foodFetch(url, { method: "GET", headers: { "X-API-Key": link.key, Accept: "application/json" }, redirect: "manual", signal: ctrl.signal });
    } catch {
      throw new CuluryError("Couldn't reach Culury");
    }
    if (res.status === 401) throw new CuluryError("Culury didn't accept the API key");
    if (res.status === 403) throw new CuluryError("Culury refused the API key (it needs Read only access, with API keys turned on in Culury)");
    if (res.status === 404) throw new CuluryError("Culury didn't find that (check the address)", true);
    if (res.status < 200 || res.status >= 300) throw new CuluryError(`Culury answered with an error (${res.status})`);
    try {
      return (await res.json()) as unknown;
    } catch {
      throw new CuluryError("Culury's answer didn't make sense");
    }
  })();
  try {
    return await Promise.race([call, timedOut]);
  } finally {
    clearTimeout(timer);
    call.catch(() => {}); // a late failure after the timeout is already handled
  }
}

export const culuryMessage = (err: unknown) => (err instanceof CuluryError ? err.message : "Culury couldn't be reached");

export async function logCuluryFailure(app: FastifyInstance, userId: number, what: string, err: unknown) {
  await logEvent(app.db, { category: "food", level: "warning", source: "Culury", event: `Culury ${what} failed`, detail: culuryMessage(err), userId });
}

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const posInt = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

type PlanRow = { date: string; slot: string; recipeId: number | null; title: string; servings: number | null; note: string | null };

/** Culury's plan between two days (its rows as Culury sends them, malformed ones left out). */
async function planBetween(app: FastifyInstance, link: CuluryLink, from: string, to: string): Promise<PlanRow[]> {
  const json = await culuryGet(app, link, "/api/plan", { from, to });
  if (!Array.isArray(json)) throw new CuluryError("Culury's answer didn't make sense");
  return json.flatMap((r): PlanRow[] => {
    const date = typeof r?.date === "string" && ISO_DAY.test(r.date) ? r.date : null;
    const title = text(r?.title);
    if (!date || !title) return [];
    return [{ date, slot: text(r.slot) ?? "", recipeId: posInt(r.recipeId), title, servings: posInt(r.servings), note: text(r.note) }];
  });
}

/** Test connection: today's plan, with the key. Throws CuluryError with a plain reason. */
export async function testCulury(app: FastifyInstance, link: CuluryLink, today: string) {
  await planBetween(app, link, today, today);
}

// ---------- the meal plan ----------

export type PlanItem = { slot: string; title: string; recipeId: number | null; servings: number | null; note: string | null };
export type PlanDay = { day: string; items: PlanItem[] };

/** Does a Culury slot ("snack", "second-breakfast") go with a ByteSize meal ("snacks")? */
const slotMatches = (slot: string, meal: Meal) => {
  const word = meal === "snacks" ? "snack" : meal;
  return slot.toLowerCase().split(/[^a-z]+/).some((w) => w === word || w === meal);
};

/**
 * The plan from day−3 to day+4, grouped by day (days with something planned): the selected day first, then
 * the others in date order; on the selected day the meal matching `meal` first. Notes without a recipe
 * ("Leftovers") are included with recipeId null (shown, not loggable).
 */
export async function mealPlan(app: FastifyInstance, link: CuluryLink, day: string, meal: Meal | undefined): Promise<PlanDay[]> {
  const rows = await planBetween(app, link, addDays(day, -3), addDays(day, 4));
  const byDay = new Map<string, PlanItem[]>();
  for (const r of rows) {
    if (r.date < addDays(day, -3) || r.date > addDays(day, 4)) continue;
    const items = byDay.get(r.date) ?? [];
    items.push({ slot: r.slot, title: r.title, recipeId: r.recipeId, servings: r.servings, note: r.note });
    byDay.set(r.date, items);
  }
  const days = [...byDay.entries()].sort(([a], [b]) => (a === day ? -1 : b === day ? 1 : a.localeCompare(b))).map(([d, items]) => ({ day: d, items }));
  if (meal && days[0]?.day === day) {
    days[0].items = [...days[0].items.filter((i) => slotMatches(i.slot, meal)), ...days[0].items.filter((i) => !slotMatches(i.slot, meal))];
  }
  return days;
}

export const isMeal = (v: unknown): v is Meal => (MEALS as readonly unknown[]).includes(v);

// ---------- recipes as foods ----------

// Culury's per-serving nutrition -> ByteSize's keys (sodium is mg in both)
const NUTRITION_MAP: [string, NutrientKey, number][] = [
  ["calories", "calories", 1],
  ["protein", "protein_g", 2],
  ["fiber", "fiber_g", 2],
  ["carbs", "carbs_g", 2],
  ["fat", "fat_g", 2],
  ["saturatedFat", "saturated_fat_g", 2],
  ["sugar", "sugar_g", 2],
  ["addedSugar", "added_sugar_g", 2],
  ["sodium", "sodium_mg", 1],
];
const round = (v: number, decimals: number) => Math.round(v * 10 ** decimals) / 10 ** decimals;

export type CuluryFood = { food: FoodResult; hasNutrition: boolean; outdated: boolean };

/** A Culury recipe (GET /api/recipes/:id, or a list row without nutrition) as a loggable food. */
export function culuryFood(recipe: any): CuluryFood | null {
  const id = posInt(recipe?.id);
  const name = text(recipe?.title);
  if (!id || !name) return null;
  const n = recipe?.nutrition && typeof recipe.nutrition === "object" ? recipe.nutrition : null;
  const nutrients: Nutrients = {};
  for (const [from, to, decimals] of NUTRITION_MAP) {
    const v = n?.[from];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) nutrients[to] = round(v, decimals);
  }
  // "About 1½ cups (340 g)" -> 340 g; anything else: servings only
  const grams = typeof n?.servingSize === "string" ? /\((\d+(?:\.\d+)?)\s*g\)/i.exec(n.servingSize) : null;
  const serving: Serving = { label: "1 serving", ...(grams && Number(grams[1]) > 0 ? { grams: Number(grams[1]) } : {}) };
  const keys = Object.keys(nutrients);
  return {
    food: {
      kind: "culury",
      id,
      name,
      brand: null,
      icon: iconFor(null, name),
      barcode: null,
      servings: [serving],
      nutrients,
      aiFields: n?.source === "ai" ? keys : [], // Culury's own AI estimate is still an AI estimate
      imageUrl: null, // Culury's images need its login: not shown
      override: false,
      source: "culury",
      foodKind: "recipe",
    },
    hasNutrition: keys.length > 0,
    outdated: n?.outdated === true,
  };
}

/** One recipe from the person's Culury. CuluryError (notFound for a recipe Culury doesn't have). */
export async function culuryRecipe(app: FastifyInstance, link: CuluryLink, id: number, timeoutMs = CULURY_TIMEOUT_MS): Promise<CuluryFood> {
  const found = culuryFood(await culuryGet(app, link, `/api/recipes/${id}`, {}, timeoutMs));
  if (!found || found.food.id !== id) throw new CuluryError("Culury's answer didn't make sense");
  return found;
}

const SEARCH_LIMIT = 8;

/**
 * Recipes matching q (Culury's own search, GET /api/recipes?q=), each opened for its nutrition, all within
 * the 3 s budget. A recipe whose details didn't come in time is still listed, with nutrients unknown.
 */
export async function searchCulury(app: FastifyInstance, link: CuluryLink, q: string): Promise<FoodResult[]> {
  const deadline = Date.now() + CULURY_TIMEOUT_MS;
  const json = (await culuryGet(app, link, "/api/recipes", { q, limit: String(SEARCH_LIMIT) })) as { recipes?: unknown };
  if (!json || !Array.isArray(json.recipes)) throw new CuluryError("Culury's answer didn't make sense");
  const listed = json.recipes.map(culuryFood).filter((f): f is CuluryFood => f !== null).slice(0, SEARCH_LIMIT);
  const details = await Promise.allSettled(listed.map((f) => culuryRecipe(app, link, f.food.id, deadline - Date.now())));
  return listed.map((f, i) => {
    const d = details[i];
    return d.status === "fulfilled" ? d.value.food : f.food;
  });
}
