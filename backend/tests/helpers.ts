import "dotenv/config";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { createDb } from "../src/db/index.js";
import { runMigrations } from "../src/db/migrate.js";
import { buildApp, type AppOptions } from "../src/app.js";
import { resetLoginLockouts } from "../src/routes/auth.js";
import { resetSessionTouches } from "../src/lib/sessions.js";
import { resetPasskeyChallenges } from "../src/routes/passkeys.js";
import type { AiFetch } from "../src/lib/ai.js";
import { resetRestaurantState } from "../src/lib/restaurants/index.js";
import type { EmailConfig, MailMessage, TransportFactory } from "../src/lib/mail.js";
import { resetForgotLimits } from "../src/routes/password-reset.js";
import { resetOAuthCache } from "../src/lib/oauth.js";

// Tests use their own database so they never touch real data.
// Create it once with: createdb bytesize_test (docker-compose.dev.yml does this for you)
const url = process.env.TEST_DATABASE_URL ?? "postgresql://bytesize:bytesize@localhost:5432/bytesize_test";
if (!url.includes("test")) throw new Error("TEST_DATABASE_URL must point at a test database");

export const TEST_SECRET = "test-secret-test-secret-test-secret-1234";

// beforeReady: register extra plugins (e.g. the web app) before the app is ready
// migrateWith: builds the schema in place of runMigrations (e.g. to test a migration on old-shape rows)
export async function setupTestApp(
  opts: Partial<Omit<AppOptions, "db">> = {},
  beforeReady?: (app: FastifyInstance) => Promise<void>,
  migrateWith?: (db: ReturnType<typeof createDb>["db"]) => Promise<void>,
) {
  const { db, pool } = createDb(url);
  await db.execute(sql`drop schema if exists public cascade`);
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`create schema public`);
  await (migrateWith ?? runMigrations)(db);
  // Fake AI: records calls; answer with ai.respond(url, body, headers) -> { status, json }, or a
  // streamed reply: { status, sse: ["data: {...}", ...], gapMs?: pause between pieces, hang?: stop
  // sending after the pieces without closing }. down = unreachable.
  type Streamed = { status: number; sse: string[]; gapMs?: number; hang?: boolean };
  const okReply = () => ({ status: 200, json: { choices: [{ message: { content: '{"ok": true}' } }] } });
  const ai = {
    calls: [] as { url: string; method: string; headers: Record<string, string>; body: any; signal?: AbortSignal }[],
    // (may return a promise, e.g. one that never settles to act like a server that hangs)
    respond: okReply as (url: string, body: any, headers: Record<string, string>) => { status: number; json: unknown } | Streamed | Promise<{ status: number; json: unknown } | Streamed>,
    down: false,
  };
  const aiFetch: AiFetch = async (url, init) => {
    if (ai.down) throw new Error("ECONNREFUSED");
    const body = init.body ? JSON.parse(init.body) : undefined;
    ai.calls.push({ url, method: init.method, headers: init.headers, body, signal: init.signal });
    const r = await ai.respond(url, body, init.headers);
    if ("sse" in r) {
      const enc = new TextEncoder();
      const pieces = r.sse;
      const stream = new ReadableStream<Uint8Array>({
        async start(c) {
          init.signal?.addEventListener("abort", () => c.error(new Error("aborted")));
          for (const p of pieces) {
            if (init.signal?.aborted) return;
            if (r.gapMs) await new Promise((res) => setTimeout(res, r.gapMs));
            if (init.signal?.aborted) return;
            c.enqueue(enc.encode(p + "\n\n"));
          }
          if (!r.hang) c.close();
        },
      });
      return { ok: r.status < 300, status: r.status, json: async () => ({}), body: stream };
    }
    return { ok: r.status < 300, status: r.status, json: async () => r.json };
  };
  // Fake food web (Open Food Facts, USDA): records calls; answer with foodWeb.respond(url, init) ->
  // { status, json, headers?, text? } (or a promise, e.g. one that never settles, for a hanging source); text
  // replaces the JSON body (e.g. something that isn't JSON). down = unreachable.
  type FoodReply = { status: number; json?: unknown; headers?: Record<string, string>; text?: string };
  const notFoundReply = (): FoodReply => ({ status: 404, json: { status: 0, status_verbose: "not found" } });
  const foodWeb = {
    calls: [] as { url: string; method: string; headers: Record<string, string>; body: any }[],
    respond: notFoundReply as (url: string, init: { method: string; headers: Record<string, string>; body: any }) => FoodReply | Promise<FoodReply>,
    down: false,
  };
  const foodFetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (foodWeb.down) throw new TypeError("fetch failed");
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const raw = typeof init?.body === "string" ? init.body : undefined;
    let body: any = raw;
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      // not JSON
    }
    const call = { url, method: init?.method ?? "GET", headers, body };
    foodWeb.calls.push(call);
    const reply = foodWeb.respond(url, call);
    const r = await (init?.signal
      ? Promise.race([
          reply,
          new Promise<never>((_, reject) => {
            if (init.signal!.aborted) reject(new Error("aborted"));
            init.signal!.addEventListener("abort", () => reject(new Error("aborted")));
          }),
        ])
      : reply);
    return new Response(r.text ?? JSON.stringify(r.json), { status: r.status, headers: { "content-type": "application/json", ...r.headers } });
  }) as typeof fetch;
  // The app's clock: set clock.date to fix "now" (reset() clears it back to the real time)
  const clock = { date: null as Date | null };
  // Waits the app asks for (the restaurant queue): recorded, never slept; with a fixed clock, the clock moves on instead
  const sleeps: number[] = [];
  const sleep = async (ms: number) => {
    sleeps.push(ms);
    if (clock.date) clock.date = new Date(clock.date.getTime() + ms);
  };
  // Fake email: nothing is ever sent. mail.sent records each message (with the settings it went out with);
  // mail.failNext makes the next send (or connection check) fail with that message.
  // mail.gate: while set, each send waits for it (a slow mail server).
  const mail = { sent: [] as (MailMessage & { from: string; config: EmailConfig })[], failNext: null as string | null, gate: null as Promise<void> | null };
  const failing = () => {
    const why = mail.failNext;
    mail.failNext = null;
    if (why) throw new Error(why);
  };
  const mailTransport: TransportFactory = (config) => ({
    async verify() {
      failing();
    },
    async sendMail(m) {
      if (mail.gate) await mail.gate;
      failing();
      mail.sent.push({ ...m, config });
    },
  });
  // Files (uploads, backups) go to a temp folder, removed on close. The daily backup is off unless a test asks for it.
  const dataDir = mkdtempSync(path.join(tmpdir(), "bytesize-test-"));
  const app = buildApp({ db, jwtSecret: TEST_SECRET, rateLimit: false, aiFetch, foodFetch, now: () => clock.date ?? new Date(), sleep, dataDir, backupSchedule: false, mailTransport, emailEnv: null, appOrigins: [], ...opts });
  if (beforeReady) await beforeReady(app);
  await app.ready();
  let token = "";

  async function api(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await app.inject({
      method: method as any,
      url: path,
      payload: body as any,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    });
    let parsed: any = res.body;
    try {
      parsed = res.body ? JSON.parse(res.body) : null;
    } catch {
      // not JSON
    }
    return { status: res.statusCode, body: parsed, headers: res.headers };
  }

  // Empty every table (keeps the schema and the migration record)
  async function reset() {
    token = "";
    clock.date = null;
    ai.calls.length = 0;
    ai.down = false;
    ai.respond = okReply;
    foodWeb.calls.length = 0;
    foodWeb.down = false;
    foodWeb.respond = notFoundReply;
    sleeps.length = 0;
    mail.sent.length = 0;
    mail.failNext = null;
    mail.gate = null;
    await app.mail.idle();
    app.mail.forgetTests();
    resetForgotLimits();
    resetOAuthCache();
    resetRestaurantState(app);
    const rows = await db.execute<{ tablename: string }>(sql`select tablename from pg_tables where schemaname = 'public'`);
    const names = rows.rows.map((r) => `"${r.tablename}"`);
    if (names.length) await db.execute(sql.raw(`truncate ${names.join(", ")} restart identity cascade`));
    resetLoginLockouts();
    resetSessionTouches();
    resetPasskeyChallenges();
    rmSync(path.join(dataDir, "uploads"), { recursive: true, force: true });
  }

  // First-run setup as the admin "cory"; signs in as them
  async function login() {
    const res = await api("POST", "/api/auth/setup", { username: "cory", password: "password123", email: "cory@example.com" });
    token = res.body.token;
    return res.body.user;
  }

  // The admin adds a person (the TestApp must be signed in as an admin), then they sign in
  async function createUser(username: string, opts: { isAdmin?: boolean; password?: string } = {}) {
    const password = opts.password ?? "password123";
    const made = await api("POST", "/api/admin/users", { username, password, isAdmin: opts.isAdmin ?? false });
    if (made.status !== 200) throw new Error(`createUser ${username}: ${made.status} ${JSON.stringify(made.body)}`);
    const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username, password } });
    return { id: made.body.user.id as number, token: JSON.parse(res.body).token as string };
  }

  return {
    app,
    db,
    api,
    ai,
    foodWeb,
    clock,
    sleeps,
    mail,
    reset,
    login,
    createUser,
    setToken: (t: string) => (token = t),
    getToken: () => token,
    close: async () => {
      await app.close();
      await pool.end();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

export type TestApp = Awaited<ReturnType<typeof setupTestApp>>;
