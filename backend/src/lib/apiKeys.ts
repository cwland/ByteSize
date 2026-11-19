import crypto from "node:crypto";
import { hashApiKey } from "./auth.js";

// Personal API keys (Settings › API keys, spec §35). A key belongs to one person and acts as that person
// only (never as an admin). This file is the one place that decides what a key may reach: a route is open
// to a key only when it is on one of the two lists below, matched by method and route pattern exactly as
// Fastify registered it. Everything else - admin, settings and integrations, the key routes, backups and
// export, every "show a saved key" route, sign-in, sessions, passkeys, passwords, and any route added
// later - answers a key with 403. Adding a route to these lists is a decision: tests/api-keys.test.ts
// lists them by hand.

export const KEY_ACCESS = ["read", "log"] as const;
export type KeyAccess = (typeof KEY_ACCESS)[number];
export const KEY_ACCESS_LABELS: Record<KeyAccess, string> = { read: "Read only", log: "Read and log" };

// Read only: the person's own data (day, log, foods, my foods, weight, GLP-1, goals/targets, trends, activity, app info)
export const KEY_READ_ROUTES: ReadonlySet<string> = new Set([
  "GET /api/health",
  "GET /api/day/:date",
  "GET /api/days/logged",
  "GET /api/foods/search",
  "GET /api/foods/barcode/:code",
  "GET /api/foods/cache/:id",
  "GET /api/foods/recent",
  "GET /api/foods/frequent",
  "GET /api/my-foods",
  "GET /api/my-foods/:id",
  "GET /api/weight",
  "GET /api/glp1",
  "GET /api/glp1/after-injection",
  "GET /api/side-effects",
  "GET /api/body",
  "GET /api/plans",
  "GET /api/targets",
  "GET /api/trends/weekly",
  "GET /api/badges",
  "GET /api/vacations",
  "GET /api/app-info",
  "GET /api/activity/:day",
  "GET /api/activity",
  "GET /api/workouts/estimate",
  "GET /api/workout-calories",
]);

// Read and log adds: log entries (water is a log entry), weigh-ins, GLP-1 shots and side effects, steps and workouts
// (a phone sends Health's as source "health": steps by day, workouts by their externalId, so a resend is safe)
export const KEY_LOG_ROUTES: ReadonlySet<string> = new Set([
  "POST /api/log",
  "POST /api/log/meal",
  "PATCH /api/log/:id",
  "DELETE /api/log/:id",
  "POST /api/log/move",
  "PUT /api/weigh-ins/:day",
  "DELETE /api/weigh-ins/:day",
  "PUT /api/glp1/shots/:day",
  "DELETE /api/glp1/shots/:day",
  "PUT /api/side-effects/:day",
  "PUT /api/steps/:day",
  "DELETE /api/steps/:day",
  "POST /api/workouts",
  "PATCH /api/workouts/:id",
  "DELETE /api/workouts/:id",
]);

export const BAD_KEY = "That API key isn't valid.";
export const READ_ONLY_KEY = "This key can only read";
export const KEYS_CANT = "Keys can't do that";
export const KEY_TOO_FAST = "Too many requests with this key. Wait a minute and try again.";
// The eye, after the server's JWT_SECRET changed: the key still works (it is found by its hash), it just can't be shown
export const UNREADABLE_API_KEY = "This key can't be shown any more because the server's secret changed. It still works; make a new key if you need to see one.";
export const MAX_KEYS = 20;
export const TOO_MANY_KEYS = `You can have up to ${MAX_KEYS} keys. Delete one to make another.`;

/**
 * What a key may do on a route: null = allowed, else the 403 message.
 * route: the matched route pattern ("/api/day/:date"), never the address as typed. HEAD is GET.
 */
export function keyDenial(access: KeyAccess, method: string, route: string): string | null {
  const m = method === "HEAD" ? "GET" : method;
  const r = `${m} ${route}`;
  if (KEY_READ_ROUTES.has(r)) return null;
  if (KEY_LOG_ROUTES.has(r)) return access === "log" ? null : READ_ONLY_KEY;
  return KEYS_CANT;
}

// ---------- the key itself ----------

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BODY_LENGTH = 43; // 32 bytes in base62 (62^43 > 2^256)
export const KEY_SHAPE = /^bs_[0-9A-Za-z]{43}$/;
export const PREFIX_LENGTH = 11; // "bs_" and 8 more: enough to tell keys apart, far too few to guess one

function base62(bytes: Buffer) {
  let n = BigInt(`0x${bytes.toString("hex")}`);
  let out = "";
  while (n > 0n) {
    out = BASE62[Number(n % 62n)] + out;
    n /= 62n;
  }
  return out.padStart(BODY_LENGTH, "0");
}

/** A new key: bs_ + 32 random bytes in base62, its first characters, and its SHA-256 hash (for lookup). */
export function generateApiKey() {
  const key = `bs_${base62(crypto.randomBytes(32))}`;
  return { key, prefix: key.slice(0, PREFIX_LENGTH), hash: hashApiKey(key) };
}

/** Looks like a ByteSize key (a Bearer value that isn't one is taken to be a login token). */
export const isKeyLike = (bearer: string) => bearer.startsWith("bs_");

/** Two hashes compared in constant time. */
export function sameHash(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ---------- how often a key is used ----------

export interface KeyRateLimit {
  max: number; // requests per window, per key
  windowMs: number;
}
export const DEFAULT_KEY_RATE_LIMIT: KeyRateLimit = { max: 120, windowMs: 60_000 };
export const LAST_USED_EVERY_MS = 60_000; // last used is written at most once a minute

/** Counts requests per key (by its hash) in a sliding window. true = this one is over the limit. */
export function keyLimiter(limit: KeyRateLimit) {
  const hits = new Map<string, number[]>();
  return (keyId: string, now: number) => {
    if (hits.size > 10_000) for (const [k, times] of hits) if (now - times[times.length - 1] >= limit.windowMs) hits.delete(k);
    const recent = (hits.get(keyId) ?? []).filter((at) => now - at < limit.windowMs);
    if (recent.length >= limit.max) {
      hits.set(keyId, recent);
      return true;
    }
    recent.push(now);
    hits.set(keyId, recent);
    return false;
  };
}
