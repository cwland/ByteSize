// Migration 0003 (birthdate, activity levels, needs_review) on rows saved in the 0002 shape.
// How: build the schema with only migrations 0000–0002 (a temporary copy of drizzle/ whose journal stops at 0002),
// insert old-shape rows with raw SQL, then run the real migrations, which apply just 0003.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { runMigrations } from "../src/db/migrate.js";
import { setupTestApp, type TestApp } from "./helpers.js";

const drizzleDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../drizzle");

function migrationsUpTo(tag: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bytesize-mig-"));
  fs.cpSync(drizzleDir, dir, { recursive: true });
  const journalPath = path.join(dir, "meta/_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  const end = journal.entries.findIndex((e: { tag: string }) => e.tag === tag);
  if (end < 0) throw new Error(`No migration ${tag}`);
  journal.entries = journal.entries.slice(0, end + 1);
  fs.writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

const OLD = [
  ["cory", 1974, "moderate"],
  ["sam", 1980, "sedentary"],
  ["lee", 1990, "light"],
  ["max", 1985, "active"],
  ["kim", 1970, "very"],
] as const;

let t: TestApp;
let rawBefore: { columns: string[] };
beforeAll(async () => {
  t = await setupTestApp({}, undefined, async (db) => {
    await migrate(db, { migrationsFolder: migrationsUpTo("0002_double_precision") });
    const hash = await bcrypt.hash("password123", 4);
    for (const [name, year, activity] of OLD) {
      const r = await db.execute<{ id: number }>(sql`insert into users (username, password_hash, is_admin) values (${name}, ${hash}, ${name === "cory"}) returning id`);
      await db.execute(sql`insert into user_body (user_id, sex, birth_year, height_cm, weight_kg, goal_weight_kg, activity, glp1)
        values (${r.rows[0].id}, 'male', ${year}, 182.88, 102.51187562, 81.6466266, ${activity}, true)`);
    }
    const cols = await db.execute<{ column_name: string }>(sql`select column_name from information_schema.columns where table_name = 'user_body'`);
    rawBefore = { columns: cols.rows.map((c) => c.column_name) };
    await runMigrations(db); // applies 0003 only
  });
});
afterAll(async () => t.close());

describe("migration 0003", () => {
  it("backfills birth_date, maps activity, flags every row for review and drops birth_year", async () => {
    expect(rawBefore.columns).toContain("birth_year");
    const rows = await t.db.execute<{ username: string; birth_date: string; activity: string; needs_review: boolean }>(
      sql`select u.username, to_char(b.birth_date, 'YYYY-MM-DD') as birth_date, b.activity, b.needs_review from user_body b join users u on u.id = b.user_id order by u.username`,
    );
    expect(rows.rows).toEqual([
      { username: "cory", birth_date: "1974-01-01", activity: "most", needs_review: true },
      { username: "kim", birth_date: "1970-01-01", activity: "physical", needs_review: true },
      { username: "lee", birth_date: "1990-01-01", activity: "some", needs_review: true },
      { username: "max", birth_date: "1985-01-01", activity: "physical", needs_review: true },
      { username: "sam", birth_date: "1980-01-01", activity: "sitting", needs_review: true },
    ]);
    const cols = await t.db.execute<{ column_name: string; is_nullable: string; column_default: string | null }>(
      sql`select column_name, is_nullable, column_default from information_schema.columns where table_name = 'user_body'`,
    );
    const byName = Object.fromEntries(cols.rows.map((c) => [c.column_name, c]));
    expect(byName.birth_year).toBeUndefined();
    expect(byName.birth_date.is_nullable).toBe("NO");
    expect(byName.needs_review.is_nullable).toBe("NO");
    expect(byName.needs_review.column_default).toBe("false");
  });

  it("an old body asks for a review once, then plans work", async () => {
    t.clock.date = new Date("2026-11-17T18:00:00Z");
    const login = await t.api("POST", "/api/auth/login", { username: "cory", password: "password123" });
    expect(login.status).toBe(200);
    t.setToken(login.body.token);

    const before = (await t.api("GET", "/api/body")).body.body;
    expect(before).toMatchObject({ birthDate: "1974-01-01", activity: "most", needsReview: true, weightKg: 102.51187562 });
    const blocked = await t.api("GET", "/api/plans");
    expect(blocked.status).toBe(409);
    expect(blocked.body).toEqual({ error: "Check your details first" });

    const { needsReview: _, ...details } = before;
    const put = await t.api("PUT", "/api/body", { ...details, birthDate: "1974-06-01", activity: "some" });
    expect(put.status).toBe(200);
    expect(put.body.body.needsReview).toBe(false);
    const plans = await t.api("GET", "/api/plans");
    expect(plans.status).toBe(200);
    expect(plans.body.tdee).toBe(2487);
    expect((await t.api("GET", "/api/plans")).status).toBe(200);
  });
});
