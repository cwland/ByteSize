// M3 schema: the new tables, their unique keys, and migration 0008's starting weigh-in backfill.
// How: build the schema with migrations 0000–0007 only, seed a body row, then run the real migrations (applies 0008).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { runMigrations } from "../src/db/migrate.js";
import { badges, glp1Settings, glp1Shots, sideEffects, vacations, weighIns } from "../src/db/schema.js";
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

// A time zone whose date differs from UTC's right now: UTC−11 before 11:00 UTC, UTC+14 from 10:00 UTC
const TZ = new Date().getUTCHours() < 11 ? "Pacific/Pago_Pago" : "Pacific/Kiritimati";

let t: TestApp;
let uid: number;
let other: number;
beforeAll(async () => {
  t = await setupTestApp({}, undefined, async (db) => {
    await migrate(db, { migrationsFolder: migrationsUpTo("0007_recipes") });
    const hash = await bcrypt.hash("password123", 4);
    const a = await db.execute<{ id: number }>(sql`insert into users (username, password_hash, is_admin, timezone) values ('cory', ${hash}, true, ${TZ}) returning id`);
    const b = await db.execute<{ id: number }>(sql`insert into users (username, password_hash) values ('sam', ${hash}) returning id`);
    uid = a.rows[0].id;
    other = b.rows[0].id;
    await db.execute(sql`insert into user_body (user_id, sex, birth_date, height_cm, weight_kg, goal_weight_kg, activity, glp1)
      values (${uid}, 'male', '1974-01-01', 182.88, 102.5, 81.6, 'some', true)`);
    await runMigrations(db); // applies 0008 only
  });
});
afterAll(async () => t.close());

describe("migration 0008 (M3)", () => {
  it("gives each existing body row one starting weigh-in for the person's local today at its weight", async () => {
    const rows = await t.db.execute<{ user_id: number; weight_kg: number; local_day: boolean; utc_day: boolean }>(
      sql`select user_id, weight_kg, (day = (now() at time zone ${TZ})::date) as local_day, (day = (now() at time zone 'UTC')::date) as utc_day from weigh_ins`,
    );
    // The local date differs from UTC's in TZ, so this tells the two apart
    expect(rows.rows).toEqual([{ user_id: uid, weight_kg: 102.5, local_day: true, utc_day: false }]);
  });

  it("adds targets_weight_kg to user_body, null for existing rows", async () => {
    const r = await t.db.execute<{ targets_weight_kg: number | null }>(sql`select targets_weight_kg from user_body`);
    expect(r.rows).toEqual([{ targets_weight_kg: null }]);
  });
});

describe("M3 tables", () => {
  it("weigh_ins: one per person per day", async () => {
    await t.db.insert(weighIns).values({ userId: other, day: "2026-11-01", weightKg: 90 });
    await expect(t.db.insert(weighIns).values({ userId: other, day: "2026-11-01", weightKg: 91 })).rejects.toThrow();
    await t.db.insert(weighIns).values({ userId: uid, day: "2026-11-01", weightKg: 90 }); // another person, same day: fine
  });

  it("glp1_shots: one per person per day", async () => {
    const v = { userId: uid, day: "2026-11-02", medication: "Zepbound", doseMg: 5, site: "abdomen_left" };
    await t.db.insert(glp1Shots).values(v);
    await expect(t.db.insert(glp1Shots).values(v)).rejects.toThrow();
  });

  it("side_effects: one per person per day, effects kept as json", async () => {
    await t.db.insert(sideEffects).values({ userId: uid, day: "2026-11-02", effects: { nausea: 2, fatigue: 1 } });
    await expect(t.db.insert(sideEffects).values({ userId: uid, day: "2026-11-02", effects: {} })).rejects.toThrow();
    const [row] = await t.db.select().from(sideEffects);
    expect(row.effects).toEqual({ nausea: 2, fatigue: 1 });
    expect(row.note).toBeNull();
  });

  it("glp1_settings: one row per person", async () => {
    await t.db.insert(glp1Settings).values({ userId: uid, medication: "Zepbound", doseMg: 5, injectionWeekday: 3 });
    await expect(t.db.insert(glp1Settings).values({ userId: uid, medication: "x", doseMg: 1, injectionWeekday: 1 })).rejects.toThrow();
  });

  it("badges: one per person per badge, unseen by default", async () => {
    await t.db.insert(badges).values({ userId: uid, badge: "first_weigh_in", earnedOn: "2026-11-01" });
    await expect(t.db.insert(badges).values({ userId: uid, badge: "first_weigh_in", earnedOn: "2026-11-02" })).rejects.toThrow();
    await t.db.insert(badges).values({ userId: other, badge: "first_weigh_in", earnedOn: "2026-11-01" });
    const rows = await t.db.select().from(badges);
    expect(rows.every((r) => r.seen === false)).toBe(true);
  });

  it("vacations: ranges stored, removed with the person", async () => {
    await t.db.insert(vacations).values({ userId: other, fromDay: "2026-12-01", toDay: "2026-12-07" });
    await t.db.execute(sql`delete from users where id = ${other}`);
    expect(await t.db.select().from(vacations)).toEqual([]);
    expect(await t.db.select().from(weighIns).where(sql`user_id = ${other}`)).toEqual([]);
  });
});
