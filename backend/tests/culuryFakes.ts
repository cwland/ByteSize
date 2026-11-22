// A fake RecipeHub (the person's own recipe / meal-plan app) on the fake food web, shaped like RecipeHub's real API:
//  GET /api/plan?from&to   -> [{ id, date, slot, position, recipeId, title, servings, note, imageUrl, totalMinutes, recipeServings }]
//  GET /api/recipes?q=     -> { total, recipes: [{ id, title, description, imageUrl, servings, ... }] } (no nutrition)
//  GET /api/recipes/:id    -> the recipe, with nutrition (per serving) or null
// A wrong or missing X-API-Key gets 401 { error: "Not logged in" }, like RecipeHub.
import type { TestApp } from "./helpers.js";
import { OFF_SEARCH, USDA } from "./foodFakes.js";
import { setCuluryLookup } from "../src/lib/culury.js";

/**
 * The fake DNS ByteSize checks a RecipeHub host name with before each call: a name listed here resolves to
 * its addresses; any other name resolves to a LAN address (192.168.1.20). Tests change it per case.
 */
export const fakeDns: Record<string, string[]> = {};
export const dnsLookups: string[] = [];
setCuluryLookup(async (host) => {
  dnsLookups.push(host);
  return fakeDns[host] ?? ["192.168.1.20"];
});
export function resetFakeDns() {
  for (const k of Object.keys(fakeDns)) delete fakeDns[k];
  dnsLookups.length = 0;
}

export const CULURY = "http://culury.lan:4000";
export const CULURY_KEY = "cul_readonly_SECRET_9f8e7d";

export type CuluryNutrition = {
  calories: number | null;
  fat: number | null;
  saturatedFat: number | null;
  carbs: number | null;
  fiber: number | null;
  sugar: number | null;
  addedSugar?: number | null;
  protein: number | null;
  sodium: number | null;
  source: "site" | "ai" | "you";
  servings?: number | null;
  servingSize?: string | null;
  note?: string | null;
  outdated?: boolean;
};

export const fullNutrition = (extra: Partial<CuluryNutrition> = {}): CuluryNutrition => ({
  calories: 520,
  fat: 18,
  saturatedFat: 6,
  carbs: 48,
  fiber: 7,
  sugar: 9,
  addedSugar: 2,
  protein: 41,
  sodium: 880,
  source: "you",
  servings: 4,
  servingSize: "About 1½ cups (340 g)",
  note: null,
  ...extra,
});

export function culuryRecipe(id: number, title: string, nutrition: CuluryNutrition | null = fullNutrition()) {
  return { id, title, description: null as string | null, imageUrl: `/api/images/${id}.jpg`, servings: 4, yieldText: "4 servings", totalMinutes: 30, nutrition, tags: [], me: { favorite: false } };
}

export type PlanRow = { date: string; slot: string; recipeId: number | null; title: string; servings?: number | null; note?: string | null; position?: number };

/**
 * RecipeHub at `base` with this key, plan and recipes. Anything else on the food web (OFF / USDA) finds
 * nothing. Also keeps any earlier responder for other hosts (a second person's RecipeHub).
 */
export function culuryKnows(t: TestApp, opts: { plan?: PlanRow[]; recipes?: ReturnType<typeof culuryRecipe>[]; key?: string; base?: string } = {}) {
  const base = opts.base ?? CULURY;
  const key = opts.key ?? CULURY_KEY;
  const plan = opts.plan ?? [];
  const recipes = opts.recipes ?? [];
  const before = t.foodWeb.respond;
  t.foodWeb.respond = (url, init) => {
    if (!url.startsWith(base + "/")) {
      if (url.startsWith(OFF_SEARCH)) return { status: 200, json: { hits: [] } };
      if (url.startsWith(USDA)) return { status: 200, json: { foods: [] } };
      return before(url, init);
    }
    if (init.headers["x-api-key"] !== key) return { status: 401, json: { error: "Not logged in" } };
    const u = new URL(url);
    const path = u.pathname.slice(new URL(base).pathname.replace(/\/$/, "").length);
    if (path === "/api/plan") {
      const from = u.searchParams.get("from")!;
      const to = u.searchParams.get("to")!;
      const rows = plan
        .filter((r) => r.date >= from && r.date <= to)
        .map((r, i) => ({ id: i + 1, position: 0, servings: null, note: null, imageUrl: null, totalMinutes: null, recipeServings: null, ...r }))
        .sort((a, b) => a.date.localeCompare(b.date) || a.slot.localeCompare(b.slot) || a.position - b.position);
      return { status: 200, json: rows };
    }
    if (path === "/api/recipes") {
      const q = (u.searchParams.get("q") ?? "").toLowerCase();
      const hits = recipes.filter((r) => r.title.toLowerCase().includes(q)).map(({ nutrition: _n, ...r }) => r);
      return { status: 200, json: { total: hits.length, recipes: hits } };
    }
    const m = /^\/api\/recipes\/(\d+)$/.exec(path);
    if (m) {
      const r = recipes.find((x) => x.id === Number(m[1]));
      return r ? { status: 200, json: r } : { status: 404, json: { error: "Recipe not found" } };
    }
    return { status: 404, json: { error: `Not found: GET ${path}` } };
  };
}

/** The calls made to a RecipeHub (any path). */
export const culuryCalls = (t: TestApp, base = CULURY) => t.foodWeb.calls.filter((c) => c.url.startsWith(base + "/"));
