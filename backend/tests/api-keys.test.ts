import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { setupTestApp, TEST_SECRET, type TestApp } from "./helpers.js";
import { asUser, twoUsers } from "./isolation.js";
import { apiKeys, appLog, users } from "../src/db/schema.js";
import { buildApp } from "../src/app.js";
import { hashApiKey } from "../src/lib/auth.js";
import { decryptSecret, encryptSecret } from "../src/lib/secrets.js";
import { BAD_KEY, KEYS_CANT, KEY_LOG_ROUTES, KEY_READ_ROUTES, READ_ONLY_KEY, UNREADABLE_API_KEY } from "../src/lib/apiKeys.js";

// Settings › API keys (§35): a person's own keys for their tools (Home Assistant, n8n, Shortcuts, scripts)
let t: TestApp;
// Every API route as the server registered it ("GET /api/day/:date"), for the default-deny check
const routes: string[] = [];
beforeAll(
  async () =>
    (t = await setupTestApp({}, async (app) => {
      app.addHook("onRoute", (r) => {
        for (const m of [r.method].flat()) if (r.url.startsWith("/api/") && m !== "HEAD") routes.push(`${m} ${r.url}`);
      });
    }))
);
beforeEach(async () => {
  await t.reset();
  await t.login(); // admin "cory"
});
afterAll(async () => t.close());

const KEY = /^bs_[0-9A-Za-z]{43}$/;
const DAY = "2026-11-10"; // a past day, whatever the real date
const logLines = async () => JSON.stringify(await t.db.select().from(appLog));

async function newKey(name = "Home Assistant", access?: "read" | "log", as: (m: string, url: string, body?: unknown) => Promise<{ status: number; body: any }> = t.api) {
  const r = await as("POST", "/api/keys", access ? { name, access } : { name });
  expect(r.status).toBe(201);
  return r.body as { key: string; id: number; name: string; prefix: string; access: string };
}
// Calls the API with a key (and nothing else)
async function withKey(key: string, method: string, url: string, body?: unknown, app: FastifyInstance = t.app) {
  const res = await app.inject({ method: method as "GET", url, payload: body as object, headers: { authorization: `Bearer ${key}` } });
  return { status: res.statusCode, body: res.body ? res.json() : null, headers: res.headers };
}

describe("making and managing keys", () => {
  it("makes a key: bs_ and 43 base62 characters, shown once in the answer, never cached", async () => {
    const r = await t.api("POST", "/api/keys", { name: "  Home Assistant  " });
    expect(r.status).toBe(201);
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(r.body).toMatchObject({ name: "Home Assistant", access: "read", lastUsedAt: null });
    expect(r.body.key).toMatch(KEY);
    expect(r.body.prefix).toBe(r.body.key.slice(0, 11));
    const second = await newKey("n8n", "log");
    expect(second.key).not.toBe(r.body.key);
    expect(second.access).toBe("log");
  });

  it("lists the person's keys with name, first characters, access and dates, never the key", async () => {
    const made = await newKey("Shortcuts", "log");
    const r = await t.api("GET", "/api/keys");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ keys: [{ id: made.id, name: "Shortcuts", prefix: made.prefix, access: "log", createdAt: expect.any(String), lastUsedAt: null }] });
    expect(JSON.stringify(r.body)).not.toContain(made.key);
  });

  it("keeps a SHA-256 hash for lookup and the key encrypted for the eye, never the key as it is", async () => {
    const made = await newKey();
    const [row] = await t.db.select().from(apiKeys);
    expect(row.keyHash).toBe(hashApiKey(made.key));
    expect(decryptSecret(row.keyEnc, TEST_SECRET)).toBe(made.key);
    expect(JSON.stringify(row)).not.toContain(made.key);
    expect(row.userId).toBe(1);
  });

  it("needs a name of 1 to 60 characters and a known access level", async () => {
    expect((await t.api("POST", "/api/keys", { name: "   " })).status).toBe(400);
    expect((await t.api("POST", "/api/keys", { name: "x".repeat(61) })).status).toBe(400);
    expect((await t.api("POST", "/api/keys", { name: "x".repeat(60) })).status).toBe(201);
    expect((await t.api("POST", "/api/keys", { name: "a", access: "admin" })).status).toBe(400);
  });

  it("allows at most 20 keys a person", async () => {
    for (let i = 0; i < 20; i++) await newKey(`key ${i}`);
    const r = await t.api("POST", "/api/keys", { name: "one more" });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("You can have up to 20 keys. Delete one to make another.");
    // someone else still can
    const sam = await t.createUser("sam");
    expect((await asUser(t, sam.token)("POST", "/api/keys", { name: "mine" })).status).toBe(201);
  });

  it("renames a key and changes its access; the key itself stays the same", async () => {
    const made = await newKey("Old name");
    const r = await t.api("PATCH", `/api/keys/${made.id}`, { name: "New name", access: "log" });
    expect(r.status).toBe(200);
    expect(r.body.key).toMatchObject({ id: made.id, name: "New name", access: "log", prefix: made.prefix });
    expect(JSON.stringify(r.body)).not.toContain(made.key);
    expect((await withKey(made.key, "POST", "/api/log", { day: DAY, water_ml: 250 })).status).toBe(200);
    expect((await t.api("PATCH", `/api/keys/${made.id}`, { name: "" })).status).toBe(400);
    expect((await t.api("PATCH", `/api/keys/9999`, { name: "x" })).status).toBe(404);
  });

  it("deleting a key stops it at once", async () => {
    const made = await newKey();
    expect((await withKey(made.key, "GET", `/api/day/${DAY}`)).status).toBe(200);
    expect((await t.api("DELETE", `/api/keys/${made.id}`)).status).toBe(204);
    expect((await withKey(made.key, "GET", `/api/day/${DAY}`)).status).toBe(401);
    expect((await t.api("GET", "/api/keys")).body.keys).toEqual([]);
    expect((await t.api("DELETE", `/api/keys/${made.id}`)).status).toBe(404);
  });

  it("deleting a person deletes their keys", async () => {
    const sam = await t.createUser("sam");
    await newKey("sam's", "read", asUser(t, sam.token));
    await t.db.delete(users).where(eq(users.id, sam.id));
    expect(await t.db.select().from(apiKeys)).toEqual([]);
  });

  it("the eye shows the owner's key again: logged without the key, never cached", async () => {
    const made = await newKey("n8n");
    const r = await t.api("GET", `/api/keys/${made.id}/key`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ key: made.key });
    expect(r.headers["cache-control"]).toBe("no-store");
    const lines = await t.db.select().from(appLog);
    expect(lines.find((l) => l.event === "API key shown")).toMatchObject({ category: "api", level: "info", userId: 1, detail: expect.stringContaining("n8n") });
    expect(await logLines()).not.toContain(made.key);
  });

  it("the eye says so when the key can't be read (JWT_SECRET changed); the key still works", async () => {
    const made = await newKey();
    await t.db.update(apiKeys).set({ keyEnc: encryptSecret(made.key, "a-different-secret-a-different-secret-12") });
    const r = await t.api("GET", `/api/keys/${made.id}/key`);
    expect(r.status).toBe(409);
    expect(r.body.error).toBe(UNREADABLE_API_KEY);
    expect(r.headers["cache-control"]).toBe("no-store");
    expect((await withKey(made.key, "GET", "/api/weight")).status).toBe(200);
    const missing = await t.api("GET", "/api/keys/9999/key");
    expect(missing.status).toBe(404);
    expect(missing.headers["cache-control"]).toBe("no-store");
  });

  it("the eye is rate-limited like the other reveal routes", async () => {
    const made = await newKey();
    const app2 = buildApp({ db: t.db, jwtSecret: TEST_SECRET, rateLimit: { max: 100, windowMs: 60_000 }, dataDir: t.app.dataDir, backupSchedule: false, appOrigins: [] });
    await app2.ready();
    try {
      const get = () => app2.inject({ method: "GET", url: `/api/keys/${made.id}/key`, headers: { authorization: `Bearer ${t.getToken()}` } });
      for (let i = 0; i < 30; i++) expect((await get()).statusCode).toBe(200);
      expect((await get()).statusCode).toBe(429);
    } finally {
      await app2.close();
    }
  });

  it("the key never shows up in the activity log: made, shown, used, renamed, deleted", async () => {
    const made = await newKey("Scripts", "log");
    await t.api("GET", `/api/keys/${made.id}/key`);
    await withKey(made.key, "POST", "/api/log", { day: DAY, water_ml: 250 });
    await withKey(made.key, "GET", "/api/admin/users");
    await withKey(made.key + "x", "GET", "/api/weight");
    await t.api("PATCH", `/api/keys/${made.id}`, { name: "Renamed" });
    await t.api("DELETE", `/api/keys/${made.id}`);
    const said = await logLines();
    expect(said).toContain("API key made");
    expect(said).toContain("API key deleted");
    expect(said).not.toContain(made.key);
    expect(said).not.toContain(made.key.slice(11));
  });
});

describe("using a key", () => {
  it("a read key reads the owner's day, as the owner", async () => {
    expect((await t.api("POST", "/api/log", { day: DAY, water_ml: 500 })).status).toBe(200);
    const made = await newKey();
    const r = await withKey(made.key, "GET", `/api/day/${DAY}`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual((await t.api("GET", `/api/day/${DAY}`)).body);
    expect(r.body.entries).toHaveLength(1);
  });

  it("a wrong, deleted, malformed or turned-off key gets 401 with the same message", async () => {
    const made = await newKey();
    const sam = await t.createUser("sam");
    const samKey = await newKey("sam", "read", asUser(t, sam.token));
    const deleted = await newKey("gone");
    await t.api("DELETE", `/api/keys/${deleted.id}`);
    await t.api("PATCH", `/api/admin/users/${sam.id}`, { disabled: true });
    const wrong = "bs_" + "A".repeat(43);
    const answers = [];
    for (const k of [wrong, deleted.key, "bs_short", made.key.slice(0, -1) + "!", made.key + "0", samKey.key, "bs_"]) {
      const r = await withKey(k, "GET", `/api/day/${DAY}`);
      answers.push([r.status, r.body.error]);
    }
    expect(answers).toEqual(Array(7).fill([401, BAD_KEY]));
    // a public route doesn't let a bad key through either
    expect((await withKey(wrong, "GET", "/api/auth/status")).status).toBe(401);
  });

  it("a read key can't write: 403 'This key can only read'", async () => {
    const made = await newKey("reader", "read");
    for (const [m, url, body] of [
      ["POST", "/api/log", { day: DAY, water_ml: 250 }],
      ["PUT", `/api/weigh-ins/${DAY}`, { weightKg: 80 }],
      ["DELETE", "/api/log/1"],
      ["PUT", `/api/glp1/shots/${DAY}`, {}],
      ["PUT", `/api/steps/${DAY}`, { steps: 100 }],
      ["POST", "/api/workouts", { day: DAY, type: "walk", minutes: 10 }],
      ["DELETE", "/api/workouts/1"],
    ] as const) {
      const r = await withKey(made.key, m, url, body);
      expect([m, url, r.status, r.body.error]).toEqual([m, url, 403, READ_ONLY_KEY]);
    }
    expect((await t.api("GET", `/api/day/${DAY}`)).body.entries).toEqual([]);
  });

  it("steps and workouts: a read key reads them; a read-and-log key sends them the way a phone Shortcut does (safe to resend)", async () => {
    const reader = await newKey("reader", "read");
    const logger = await newKey("phone", "log");
    for (let i = 0; i < 2; i++) expect((await withKey(logger.key, "PUT", `/api/steps/${DAY}`, { steps: 8123, source: "health" })).status).toBe(200);
    for (let i = 0; i < 2; i++) expect((await withKey(logger.key, "POST", "/api/workouts", { day: DAY, type: "run", minutes: 30, calories: 300, source: "health", externalId: "HK-9" })).status).toBe(200);
    const read = await withKey(reader.key, "GET", `/api/activity/${DAY}`);
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({ steps: 8123, stepsSource: "health", workouts: [{ externalId: "HK-9" }] });
    expect((await withKey(reader.key, "GET", `/api/activity?from=${DAY}&to=${DAY}`)).body.days).toMatchObject([{ steps: 8123, workouts: 1 }]);
    const w = read.body.workouts[0];
    expect((await withKey(logger.key, "PATCH", `/api/workouts/${w.id}`, { minutes: 31 })).status).toBe(200);
    expect((await withKey(logger.key, "DELETE", `/api/workouts/${w.id}`)).status).toBe(204);
    expect((await withKey(logger.key, "DELETE", `/api/steps/${DAY}?source=health`)).status).toBe(204);
    // The plan setting is changed only in the app
    expect((await withKey(logger.key, "PUT", "/api/workout-calories", { mode: "bank" })).status).toBe(403);
    expect((await withKey(reader.key, "GET", "/api/workout-calories")).status).toBe(200);
  });

  it("goals (§40c): any key reads them with their progress; no key makes, edits, ends or deletes one", async () => {
    const reader = await newKey("reader", "read");
    const logger = await newKey("phone", "log");
    const g = (await t.api("POST", "/api/goals", { type: "workouts", target: 3, period: "week" })).body.goal;
    for (const k of [reader, logger]) {
      const all = await withKey(k.key, "GET", "/api/goals");
      expect(all.status).toBe(200);
      expect(all.body.active).toMatchObject([{ id: g.id, progress: { state: "active" } }]);
      expect((await withKey(k.key, "GET", `/api/goals/${g.id}`)).body.goal.id).toBe(g.id);
      for (const [m, url, body] of [
        ["POST", "/api/goals", { type: "steps", target: 5000, period: "week" }],
        ["PATCH", `/api/goals/${g.id}`, { target: 4 }],
        ["POST", `/api/goals/${g.id}/end`, {}],
        ["DELETE", `/api/goals/${g.id}`],
      ] as const) {
        const r = await withKey(k.key, m, url, body);
        expect([m, url, r.status, r.body.error]).toEqual([m, url, 403, KEYS_CANT]);
      }
    }
    expect((await t.api("GET", "/api/goals")).body.active).toMatchObject([{ id: g.id, target: 3 }]);
  });

  it("a read-and-log key adds, edits and deletes log entries, water and weigh-ins for its owner", async () => {
    const made = await newKey("logger", "log");
    const water = await withKey(made.key, "POST", "/api/log", { day: DAY, water_ml: 250 });
    expect(water.status).toBe(200);
    const id = (await t.api("GET", `/api/day/${DAY}`)).body.entries[0].id;
    expect((await withKey(made.key, "PATCH", `/api/log/${id}`, { quantity: 300 })).status).toBe(200);
    expect((await withKey(made.key, "PUT", `/api/weigh-ins/${DAY}`, { weightKg: 80 })).status).toBe(200);
    expect((await t.api("GET", "/api/weight")).body.weighIns).toEqual([expect.objectContaining({ day: DAY, weightKg: 80 })]);
    expect((await withKey(made.key, "DELETE", `/api/log/${id}`)).status).toBe(204);
    expect((await withKey(made.key, "DELETE", `/api/weigh-ins/${DAY}`)).status).toBe(204);
  });

  it("no key reaches admin, settings, keys, backups, export, reveal or sign-in routes, whatever its level (and the owner is an admin)", async () => {
    const made = await newKey("everything", "log");
    const forbidden = [
      "GET /api/admin/users",
      "POST /api/admin/users",
      "GET /api/admin/backups",
      "POST /api/admin/backups",
      "POST /api/admin/backups/restore",
      "GET /api/admin/food-sources/usda/key",
      "GET /api/settings/me",
      "PUT /api/settings/me",
      "GET /api/settings/ai",
      "GET /api/settings/ai/x/key",
      "GET /api/settings/culury",
      "GET /api/settings/culury/key",
      "GET /api/settings/email/password",
      "GET /api/settings/oauth/secret",
      "GET /api/keys",
      "POST /api/keys",
      `GET /api/keys/${made.id}/key`,
      `PATCH /api/keys/${made.id}`,
      `DELETE /api/keys/${made.id}`,
      "GET /api/export",
      "GET /api/auth/me",
      "POST /api/auth/login",
      "POST /api/auth/password",
      "POST /api/auth/logout-all",
      "GET /api/auth/sessions",
      "POST /api/passkeys/register/options",
      "GET /api/passkeys",
      "PATCH /api/profile",
      "GET /api/logs",
      "POST /api/weight/import",
      "POST /api/my-foods",
    ];
    for (const r of forbidden) {
      const [m, url] = r.split(" ");
      const got = await withKey(made.key, m, url, m === "GET" || m === "DELETE" ? undefined : {});
      expect([r, got.status, got.body.error]).toEqual([r, 403, KEYS_CANT]);
    }
    // the key still works and still has its name: nothing above ran
    expect((await t.api("GET", "/api/keys")).body.keys).toMatchObject([{ name: "everything" }]);
  });

  it("default deny: every API route not on the key lists answers a key with 403", async () => {
    const made = await newKey("everything", "log");
    const allowed = new Set([...KEY_READ_ROUTES, ...KEY_LOG_ROUTES]);
    const others = [...new Set(routes)].filter((r) => !allowed.has(r));
    expect(others.length).toBeGreaterThan(60);
    for (const r of others) {
      const [m, pattern] = r.split(" ");
      const url = pattern.replace(/:\w+/g, "1");
      const got = await withKey(made.key, m, url, m === "GET" || m === "DELETE" ? undefined : {});
      expect([r, got.status]).toEqual([r, 403]);
    }
  });

  it("the key lists hold only the person's own data routes (reviewed by hand)", () => {
    expect([...KEY_READ_ROUTES].sort()).toEqual(
      [
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
        "GET /api/goals",
        "GET /api/goals/:id",
      ].sort()
    );
    expect([...KEY_LOG_ROUTES].sort()).toEqual(
      [
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
      ].sort()
    );
    // every listed route really exists
    for (const r of [...KEY_READ_ROUTES, ...KEY_LOG_ROUTES]) expect(routes).toContain(r);
  });

  it("an admin's key is not an admin: it acts as the person only", async () => {
    const made = await newKey("admin's", "log");
    expect((await t.api("GET", "/api/app-info")).body.everyone).toBeDefined(); // signed in, the admin sees everyone's numbers
    const info = await withKey(made.key, "GET", "/api/app-info");
    expect(info.status).toBe(200);
    expect(info.body.everyone).toBeUndefined();
  });

  it("each use updates last used, at most once a minute", async () => {
    t.clock.date = new Date("2026-11-18T12:00:00Z");
    const made = await newKey();
    await withKey(made.key, "GET", "/api/weight");
    const first = (await t.api("GET", "/api/keys")).body.keys[0].lastUsedAt;
    expect(first).toBe("2026-11-18T12:00:00.000Z");
    t.clock.date = new Date("2026-11-18T12:00:30Z");
    await withKey(made.key, "GET", "/api/weight");
    expect((await t.api("GET", "/api/keys")).body.keys[0].lastUsedAt).toBe(first);
    t.clock.date = new Date("2026-11-18T12:01:05Z");
    await withKey(made.key, "GET", "/api/weight");
    expect((await t.api("GET", "/api/keys")).body.keys[0].lastUsedAt).toBe("2026-11-18T12:01:05.000Z");
  });

  it("is rate-limited per key (120 a minute by default)", async () => {
    const one = await newKey("one");
    const two = await newKey("two");
    const app2 = buildApp({ db: t.db, jwtSecret: TEST_SECRET, rateLimit: false, keyRateLimit: { max: 3, windowMs: 60_000 }, dataDir: t.app.dataDir, backupSchedule: false, appOrigins: [] });
    await app2.ready();
    try {
      for (let i = 0; i < 3; i++) expect((await withKey(one.key, "GET", "/api/weight", undefined, app2)).status).toBe(200);
      const over = await withKey(one.key, "GET", "/api/weight", undefined, app2);
      expect(over.status).toBe(429);
      expect(over.body.error).toBe("Too many requests with this key. Wait a minute and try again.");
      expect((await withKey(two.key, "GET", "/api/weight", undefined, app2)).status).toBe(200); // its own count
    } finally {
      await app2.close();
    }
  });

  it("each use goes in the server log at debug level, never the key", async () => {
    const made = await newKey("debugged", "log");
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, done) {
        lines.push(chunk.toString());
        done();
      },
    });
    const app2 = buildApp({ db: t.db, jwtSecret: TEST_SECRET, rateLimit: false, logger: { level: "debug", stream }, dataDir: t.app.dataDir, backupSchedule: false, appOrigins: [] });
    await app2.ready();
    try {
      await withKey(made.key, "GET", "/api/weight", undefined, app2);
      await withKey(made.key, "POST", "/api/log", { day: DAY, water_ml: 100 }, app2);
      await withKey(made.key, "GET", "/api/admin/users", undefined, app2);
      await withKey(made.key.slice(0, -2) + "zz", "GET", "/api/weight", undefined, app2);
    } finally {
      await app2.close();
    }
    const all = lines.join("");
    expect(lines.filter((l) => l.includes('"msg":"API key used"') && l.includes('"level":20'))).toHaveLength(2);
    expect(all).toContain(made.prefix);
    expect(all).not.toContain(made.key);
    expect(all).not.toContain(made.key.slice(11, -2));
  });
});
