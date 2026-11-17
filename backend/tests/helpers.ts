import "dotenv/config";
import { sql } from "drizzle-orm";
import { createDb } from "../src/db/index.js";
import { runMigrations } from "../src/db/migrate.js";
import { buildApp, type AppOptions } from "../src/app.js";
import { resetLoginLockouts } from "../src/routes/auth.js";
import { resetSessionTouches } from "../src/lib/sessions.js";

// Tests use their own database so they never touch real data.
// Create it once with: createdb bytesize_test (docker-compose.dev.yml does this for you)
const url = process.env.TEST_DATABASE_URL ?? "postgresql://bytesize:bytesize@localhost:5432/bytesize_test";
if (!url.includes("test")) throw new Error("TEST_DATABASE_URL must point at a test database");

export const TEST_SECRET = "test-secret-test-secret-test-secret-1234";

export async function setupTestApp(opts: Partial<Omit<AppOptions, "db">> = {}) {
  const { db, pool } = createDb(url);
  await db.execute(sql`drop schema if exists public cascade`);
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`create schema public`);
  await runMigrations(db);
  const app = buildApp({ db, jwtSecret: TEST_SECRET, rateLimit: false, ...opts });
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
    const rows = await db.execute<{ tablename: string }>(sql`select tablename from pg_tables where schemaname = 'public'`);
    const names = rows.rows.map((r) => `"${r.tablename}"`);
    if (names.length) await db.execute(sql.raw(`truncate ${names.join(", ")} restart identity cascade`));
    resetLoginLockouts();
    resetSessionTouches();
  }

  // First-run setup as the admin "alex"; signs in as them
  async function login() {
    const res = await api("POST", "/api/auth/setup", { username: "alex", password: "password123", email: "alex@example.com" });
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
    reset,
    login,
    createUser,
    setToken: (t: string) => (token = t),
    getToken: () => token,
    close: async () => {
      await app.close();
      await pool.end();
    },
  };
}

export type TestApp = Awaited<ReturnType<typeof setupTestApp>>;
