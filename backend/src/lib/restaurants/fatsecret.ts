// FatSecret Platform API: the first restaurant source, a typed-search source, and (Premier) a barcode source.
//   Token: POST https://oauth.fatsecret.com/connect/token, HTTP Basic (client id:secret),
//          grant_type=client_credentials (no scope: the token carries every scope the plan has), expires_in seconds.
//   Calls: POST https://platform.fatsecret.com/rest/server.api, Authorization: Bearer <token>, form body
//          method=foods.search (search_expression, max_results ≤ 50, format=json) and
//          method=food.get.v2 (food_id, format=json) and, on Premier ("barcode" scope),
//          method=food.find_id_for_barcode (barcode = GTIN-13, format=json) → { food_id: { value } } ("0": unknown).
// API errors arrive as HTTP 200 with { error: { code, message } }. FatSecret only answers from the IP
// addresses allowed in the account. Answers are kept for FatSecret's hours (24 h by default; see lookups.ts).
import type { Nutrients, Serving } from "../nutrients.js";
import { num, requestJson, round, SourceError, type FoodFetch, type SourceFood } from "../foodSources/types.js";
import { SOURCE_ID, type MenuHit, type RestaurantAdapter } from "./types.js";

export const FATSECRET_TOKEN_URL = "https://oauth.fatsecret.com/connect/token";
export const FATSECRET_API = "https://platform.fatsecret.com/rest/server.api";
const SEARCH_RESULTS = 20;
const EARLY_MS = 60_000; // renew a minute before the token runs out

export type FatSecretToken = { value: string; expiresAt: number };

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
/** FatSecret sends one result as an object and several as a list. */
const list = (v: unknown): any[] => (Array.isArray(v) ? v : v && typeof v === "object" ? [v] : []);

const err = (message: string, kind: SourceError["kind"]) => new SourceError("fatsecret", message, kind);
const badData = () => err("FatSecret sent something unexpected", "bad_data");
const badKey = () => err("FatSecret refused the client ID or secret — check them in Settings › Integrations", "bad_key");

export const NO_BARCODE_SCOPE = "Your FatSecret key doesn't include barcode lookups yet";
/** The scopes a barcode lookup's token asks for, after a plain token was refused with "missing scope" (14). */
export const BARCODE_SCOPE = "basic premier barcode";

// API error codes: 13 an invalid or expired token (renewed once); 14 the token lacks this method's scope (kind
// no_scope; the barcode lookup decides what that means); 21 this server's IP isn't allowed; 2–9 and 12 missing or refused credentials /
// permission; 106/107 an unknown food id.
function apiError(code: number): SourceError {
  if (code === 21) return err("FatSecret refused this server's IP address — allow it in your FatSecret account", "bad_key");
  if (code === 14) return err("FatSecret answered with an error (code 14)", "no_scope");
  if ((code >= 2 && code <= 9) || code === 12 || code === 13) return badKey();
  if (code === 106 || code === 107) return badData();
  return err(`FatSecret answered with an error (code ${code})`, "down");
}

// food.get serving fields → ByteSize keys (calories kcal, grams g, sodium/potassium mg)
const MAP: [string, keyof Nutrients, number][] = [
  ["calories", "calories", 1],
  ["protein", "protein_g", 2],
  ["carbohydrate", "carbs_g", 2],
  ["fat", "fat_g", 2],
  ["saturated_fat", "saturated_fat_g", 2],
  ["fiber", "fiber_g", 2],
  ["sugar", "sugar_g", 2],
  ["added_sugars", "added_sugar_g", 2],
  ["sodium", "sodium_mg", 1],
  ["potassium", "potassium_mg", 1],
];

function servingNutrients(s: any): Nutrients {
  const out: Nutrients = {};
  for (const [field, key, decimals] of MAP) {
    const v = num(s?.[field]);
    if (v !== undefined) out[key] = round(v, decimals);
  }
  return out;
}

export function normalizeFatSecret(food: any): SourceFood {
  const name = text(food?.food_name);
  const servings = list(food?.servings?.serving);
  const s = servings.find((x) => String(x?.is_default ?? "") === "1") ?? servings[0];
  if (!name || !SOURCE_ID.test(String(food?.food_id ?? "")) || !s) throw badData();
  const label = text(s.serving_description) ?? "1 serving";
  const amount = num(s.metric_serving_amount);
  const unit = String(s.metric_serving_unit ?? "").toLowerCase();
  const serving: Serving = amount && unit === "g" ? { label, grams: amount } : amount && unit === "ml" ? { label, ml: amount } : { label };
  return {
    source: "fatsecret",
    sourceId: String(food.food_id),
    barcode: null,
    name,
    brand: text(food?.brand_name),
    category: null,
    servings: [serving],
    nutrients: servingNutrients(s),
    imageUrl: null,
    raw: food,
  };
}

/** A foods.search hit: only brand foods (restaurants and other brands); calories from "Per … - Calories: 300kcal | …". */
function hitOf(f: any): MenuHit | null {
  const name = text(f?.food_name);
  const brand = text(f?.brand_name);
  if (!name || !brand || f?.food_type !== "Brand" || !SOURCE_ID.test(String(f?.food_id ?? ""))) return null;
  const m = /Calories:\s*([\d.]+)\s*kcal/i.exec(String(f?.food_description ?? ""));
  const calories = m ? num(m[1]) : undefined;
  return { source: "fatsecret", sourceId: String(f.food_id), chain: brand, name, calories: calories ?? null, imageUrl: null };
}

/**
 * A foods.search hit as a food (typed search): only what the hit's summary says, "Per 1/4 cup - Calories:
 * 140kcal | Fat: 2.00g | Carbs: 22.00g | Protein: 3.00g", for that serving. Marked summary in raw, so opening
 * it as a restaurant item fetches the whole food, and a summary never replaces a whole food already kept.
 */
export function summaryFood(f: any): SourceFood | null {
  const name = text(f?.food_name);
  const desc = String(f?.food_description ?? "");
  const per = /^Per\s+(.+?)\s+-\s+/i.exec(desc);
  const value = (label: string) => {
    const m = new RegExp(`${label}:\\s*([\\d.]+)`, "i").exec(desc);
    return m ? num(m[1]) : undefined;
  };
  const calories = value("Calories");
  if (!name || !SOURCE_ID.test(String(f?.food_id ?? "")) || !per || calories === undefined) return null;
  const label = per[1].trim();
  const metric = /^([\d.]+)\s*(g|ml)$/i.exec(label);
  const amount = metric ? num(metric[1]) : undefined;
  const unit = metric?.[2].toLowerCase();
  const serving: Serving = amount && unit === "g" ? { label: `${amount} g`, grams: amount } : amount && unit === "ml" ? { label: `${amount} ml`, ml: amount } : { label };
  const nutrients: Nutrients = { calories: round(calories, 1) };
  for (const [field, key] of [["Fat", "fat_g"], ["Carbs", "carbs_g"], ["Protein", "protein_g"]] as const) {
    const v = value(field);
    if (v !== undefined) nutrients[key] = round(v, 2);
  }
  return { source: "fatsecret", sourceId: String(f.food_id), barcode: null, name, brand: text(f?.brand_name), category: null, servings: [serving], nutrients, imageUrl: null, raw: { ...f, summary: true } };
}

export type FatSecretAdapter = RestaurantAdapter & {
  /** Typed search: every kind of food (generic and brands), as summaries. */
  searchFoods(q: string, limit?: number): Promise<SourceFood[]>;
  /** The FatSecret food id for a barcode (GTIN-13), or null when FatSecret doesn't know it. Premier only. */
  barcode(code: string): Promise<string | null>;
};

export function fatsecret(opts: { fetch: FoodFetch; clientId: string; clientSecret: string; timeoutMs: number; now: () => number; tokens: Map<string, FatSecretToken> }): FatSecretAdapter {
  // Tokens are kept per id + secret, so new credentials in Settings get a new token
  // A token asked for with explicit scopes (barcodes) is kept apart from the plain one
  const keyOf = (scope?: string) => `${opts.clientId}:${opts.clientSecret}${scope ? `|${scope}` : ""}`;
  async function token(scope?: string): Promise<string> {
    const tokenKey = keyOf(scope);
    const have = opts.tokens.get(tokenKey);
    if (have && have.expiresAt > opts.now()) return have.value;
    const basic = Buffer.from(`${opts.clientId}:${opts.clientSecret}`).toString("base64");
    const { status, json } = await requestJson(
      opts.fetch,
      "fatsecret",
      FATSECRET_TOKEN_URL,
      { method: "POST", headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: new URLSearchParams({ grant_type: "client_credentials", ...(scope ? { scope } : {}) }).toString() },
      opts.timeoutMs,
    );
    if (status === 400 || status === 401 || status === 403) throw badKey();
    if (status < 200 || status >= 300) throw err(`FatSecret answered with an error (${status})`, "down");
    const value = text(json?.access_token);
    if (!value) throw badData();
    const life = (num(json?.expires_in) ?? 86400) * 1000;
    opts.tokens.set(tokenKey, { value, expiresAt: opts.now() + Math.max(life - EARLY_MS, 0) });
    return value;
  }

  async function call(params: Record<string, string>, renewed = false, scope?: string): Promise<any> {
    const tokenKey = keyOf(scope);
    const bearer = await token(scope);
    const { status, json } = await requestJson(
      opts.fetch,
      "fatsecret",
      FATSECRET_API,
      { method: "POST", headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: new URLSearchParams({ ...params, format: "json" }).toString() },
      opts.timeoutMs,
    );
    if (status === 401 && !renewed) {
      opts.tokens.delete(tokenKey);
      return call(params, true, scope);
    }
    if (status < 200 || status >= 300) throw err(`FatSecret answered with an error (${status})`, "down");
    if (!json || typeof json !== "object") throw badData();
    if (json.error) {
      const code = Number(json.error?.code);
      // A token FatSecret no longer accepts: get a new one, once (tokens are free; no points burned)
      if (code === 13 && !renewed) {
        opts.tokens.delete(tokenKey);
        return call(params, true);
      }
      throw apiError(code);
    }
    return json;
  }

  return {
    source: "fatsecret",
    async search(q, limit = SEARCH_RESULTS) {
      const json = await call({ method: "foods.search", search_expression: q, max_results: String(Math.min(limit, 50)) });
      if (!json.foods || typeof json.foods !== "object") throw badData();
      return { items: list(json.foods.food).map(hitOf).filter((h): h is MenuHit => h !== null) };
    },
    async item(id) {
      const json = await call({ method: "food.get.v2", food_id: id });
      if (!json.food) throw badData();
      return { food: normalizeFatSecret(json.food) };
    },
    async searchFoods(q, limit = 10) {
      const json = await call({ method: "foods.search", search_expression: q, max_results: String(Math.min(limit, 50)) });
      if (!json.foods || typeof json.foods !== "object") throw badData();
      return list(json.foods.food).map(summaryFood).filter((f): f is SourceFood => f !== null);
    },
    async barcode(code) {
      const params = { method: "food.find_id_for_barcode", barcode: code };
      // A plain token without the barcode scope: one token asked for with it, and one more try. If FatSecret
      // won't give that token either, the key has no barcode access (no_scope).
      const scoped = opts.tokens.has(keyOf(BARCODE_SCOPE));
      let json: any;
      try {
        json = await call(params, false, scoped ? BARCODE_SCOPE : undefined);
      } catch (e) {
        if (scoped || !(e instanceof SourceError) || e.kind !== "no_scope") throw e;
        try {
          await token(BARCODE_SCOPE);
        } catch {
          throw err(NO_BARCODE_SCOPE, "no_scope");
        }
        json = await call(params, false, BARCODE_SCOPE);
      }
      const id = String(json?.food_id?.value ?? json?.food_id ?? "");
      if (!SOURCE_ID.test(id)) throw badData();
      return id === "0" ? null : id;
    },
  };
}
