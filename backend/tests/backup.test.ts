import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import * as tar from "tar";
import pg from "pg";
import { eq, getTableName, is, sql } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TEST_SECRET, setupTestApp, type TestApp } from "./helpers.js";
import { buildApp } from "../src/app.js";
import { asUser, twoUsers } from "./isolation.js";
import { aiSettings } from "./foodFakes.js";
import { setRestaurantKeys } from "./restaurantFakes.js";
import { multipart, plainPhoto } from "./photoFakes.js";
import * as schema from "../src/db/schema.js";
import {
  appLog,
  appSettings,
  badges,
  foodCache,
  glp1Settings,
  glp1Shots,
  logEntries,
  passkeys,
  recipeItems,
  restaurantFavourites,
  restaurantSearches,
  foodSearches,
  fatsecretBarcodes,
  sideEffects,
  targets,
  uploads,
  userBody,
  userFoods,
  userSettings,
  users,
  vacations,
  weighIns,
} from "../src/db/schema.js";
import { encryptSecret } from "../src/lib/secrets.js";
import { storePhoto } from "../src/lib/photos.js";
import { BACKED_UP_TABLES, CACHE_REFERENCES, SKIP_TABLES, backupHooks, cleanLeftovers, cleanLeftoversOnStart, dailyBackupCheck, dailyStatus, writeBackup } from "../src/lib/backup.js";

let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
beforeEach(async () => {
  await t.reset();
  rmSync(backupsDir(), { recursive: true, force: true });
  delete process.env.BACKUP_HOUR;
  delete process.env.BACKUP_KEEP;
});
const defaultHooks = { ...backupHooks };
afterEach(() => {
  Object.assign(backupHooks, defaultHooks);
  dailyStatus.failure = null;
  delete process.env.BACKUP_HOUR;
  delete process.env.BACKUP_KEEP;
});
afterAll(async () => t.close());

// How many migrations this server has (a backup records it as its schema)
const SCHEMA = (JSON.parse(readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8")) as { entries: unknown[] }).entries.length;
const NOT_A_BACKUP = "That isn't a ByteSize backup.";
const NEWER = "This backup is from a newer ByteSize. Update first.";
const backupsDir = () => path.join(t.app.dataDir, "backups");
const uploadsDir = () => path.join(t.app.dataDir, "uploads");
const backupFiles = () => (existsSync(backupsDir()) ? readdirSync(backupsDir()).filter((n) => !n.startsWith(".")).sort() : []);

/** Signs in again with a password (a restore ends every session). */
async function signIn(username = "cory") {
  const res = await t.app.inject({ method: "POST", url: "/api/auth/login", payload: { username, password: "password123" } });
  t.setToken(JSON.parse(res.body).token);
}

/** Two people with something in every backed-up table, a photo, and saved keys. */
async function seed() {
  const admin = await t.login(); // "cory"
  const { a, b } = await twoUsers(t);
  await t.api("PUT", "/api/settings/ai", { ...aiSettings, services: [{ ...aiSettings.services[0], apiKey: "sk-home-ai" }] });
  await setRestaurantKeys(t, { spoonacular: "spoon-key", fatsecret: { id: "fs-id", secret: "fs-secret" } });
  await t.api("PUT", "/api/admin/food-sources", { usdaApiKey: "usda-key" });
  await t.db.insert(appSettings).values({ key: "restaurant_quota", value: { left: 10, day: "2026-11-17" } });
  await t.db.insert(restaurantSearches).values({ source: "spoonacular", query: "taco", results: [] });
  await t.db.insert(foodSearches).values({ source: "off", query: "oats", results: [] }); // a kept search answer: not backed up
  await t.db.insert(fatsecretBarcodes).values({ barcode: "0000000000789", foodId: "555" }); // kept for good: backed up
  await t.db.insert(appLog).values({ category: "food", level: "warning", event: "A lookup was slow", detail: "line one\nline two", userId: a.id });

  const [cache] = await t.db
    .insert(foodCache)
    .values({ source: "off", sourceId: "123", barcode: "0000000000123", name: "Oats, rolled", brand: "Acme", servings: [{ label: "1/2 cup", grams: 40 }], nutrients: { calories: 150, protein_g: 5.25 }, raw: { nested: { a: [1, "two", null, true] } } })
    .returning();
  // Cached foods each kept by one kind of use, and one nobody used (a search result: not backed up)
  const cached = (sourceId: string) => ({ source: "usda", sourceId, name: `Food ${sourceId}`, servings: [], nutrients: { calories: 1 } });
  const [corrected, loggedOnly, inRecipeOnly, unused] = await t.db.insert(foodCache).values([cached("corrected"), cached("logged"), cached("recipe"), cached("unused")]).returning();
  for (const [i, u] of [a, b].entries()) {
    await t.db.insert(userBody).values({ userId: u.id, sex: i ? "male" : "female", birthDate: "1985-03-0" + (i + 1), heightCm: 170.18 + i, weightKg: 81.123456789, goalWeightKg: 70, activity: "some", glp1: i === 0, targetsWeightKg: null });
    await t.db.insert(userSettings).values({ userId: u.id, weekStart: 1, waterButtonsMl: [250, 500], culuryUrl: i ? null : "http://culury.lan:4000", culuryKeyEnc: i ? null : encryptSecret("cul_key", TEST_SECRET) });
    await t.db.insert(targets).values({ userId: u.id, effectiveFrom: "2026-11-01", plan: "steady", caloriesMin: 1600, caloriesMax: 1800, proteinMin: 100.5, proteinMax: 140, fiberMin: 25, fiberMax: 38, waterMin: 2000, waterMax: 3000 });
    await t.db.insert(weighIns).values({ userId: u.id, day: "2026-11-10", weightKg: 82.4 + i / 10, note: i ? null : "after run, \"tired\"" });
    await t.db.insert(glp1Settings).values({ userId: u.id, medication: "semaglutide", doseMg: 0.25, injectionWeekday: 3 });
    await t.db.insert(glp1Shots).values({ userId: u.id, day: "2026-11-12", medication: "semaglutide", doseMg: 0.25, site: "abdomen_left" });
    await t.db.insert(sideEffects).values({ userId: u.id, day: "2026-11-13", effects: { nausea: 2 }, note: null });
    await t.db.insert(badges).values({ userId: u.id, badge: "first_log", earnedOn: "2026-11-10", seen: i === 1 });
    await t.db.insert(vacations).values({ userId: u.id, fromDay: "2026-12-20", toDay: "2026-12-27" });
    await t.db.insert(restaurantFavourites).values({ userId: u.id, cacheId: cache.id, chain: "Acme Diner" });
    await t.db.insert(passkeys).values({ userId: u.id, credentialId: `cred-${u.id}`, publicKey: "pk", transports: ["internal"], rpId: "localhost", name: "Phone" });
  }
  const photo = await storePhoto(t.app, a.id, await plainPhoto(40, 30));
  await t.db.update(uploads).set({ linkedAt: new Date() }).where(eq(uploads.id, photo.id));
  const [custom] = await t.db
    .insert(userFoods)
    .values({ userId: a.id, kind: "custom", name: "Protein bar", servings: [{ label: "1 bar", grams: 60 }], nutrients: { calories: 210, protein_g: 20 }, aiFields: ["fiber_g", "sugar_g"], imagePath: photo.path, barcode: "0000000000456" })
    .returning();
  await t.db.insert(userFoods).values({ userId: b.id, kind: "override", name: "Food corrected", baseCacheId: corrected.id, servings: [], nutrients: { calories: 2 } });
  const [recipe] = await t.db.insert(userFoods).values({ userId: a.id, kind: "recipe", name: "Overnight oats", servings: [{ label: "1 serving" }], nutrients: { calories: 360 }, recipeServings: 2, servingGrams: null }).returning();
  await t.db.insert(recipeItems).values([
    { recipeId: recipe.id, position: 0, foodKind: "cache", foodId: cache.id, unit: "g", quantity: 80, snapshot: { name: "Oats", brand: null, icon: "🥣", foodKind: "cache", nutrients: { calories: 300 }, perServing: { calories: 150 }, servings: [], aiFields: [] } },
    { recipeId: recipe.id, position: 1, foodKind: "user_food", foodId: custom.id, unit: "serving", quantity: 1, fraction: 0.5, snapshot: { name: "Protein bar", brand: null, icon: "🍫", foodKind: "custom", nutrients: { calories: 105 }, perServing: { calories: 210 }, servings: [], aiFields: [] } },
    { recipeId: recipe.id, position: 2, foodKind: "cache", foodId: inRecipeOnly.id, unit: "g", quantity: 10, snapshot: { name: "Food recipe", brand: null, icon: "🥣", foodKind: "cache", nutrients: { calories: 1 }, perServing: { calories: 1 }, servings: [], aiFields: [] } },
  ]);
  for (const u of [a, b]) {
    await t.db.insert(logEntries).values([
      // nutrients unknown (fiber, sodium...) stay absent
      { userId: u.id, day: "2026-11-15", meal: "breakfast", name: "Oats", icon: "🥣", source: "cache", sourceRef: `cache:${cache.id}`, unit: "g", quantity: 40, perServing: { calories: 150 }, servings: [{ label: "1/2 cup", grams: 40 }], nutrients: { calories: 150 } },
      { userId: u.id, day: "2026-11-15", meal: "snacks", name: "Protein bar", icon: "🍫", imageUrl: `/api/photos/${photo.id}`, source: "user_food", sourceRef: String(custom.id), unit: "serving", quantity: 1, fraction: 0.333333333333, perServing: { calories: 210 }, servings: [], nutrients: { calories: 69.99999993 }, aiEstimated: true },
    ]);
  }
  await t.db.insert(logEntries).values({ userId: a.id, day: "2026-11-14", meal: "lunch", name: "Food logged", icon: "🥣", source: "cache", sourceRef: `cache:${loggedOnly.id}`, unit: "g", quantity: 5, perServing: {}, servings: [], nutrients: {} });
  return { admin, a, b, photo, cacheId: cache.id, unusedCacheId: unused.id };
}

/** Every backed-up table's rows (as PostgreSQL writes them, so timestamps keep their microseconds). */
async function snapshot() {
  const out: Record<string, string[]> = {};
  for (const name of BACKED_UP_TABLES) {
    const r = await t.db.execute<{ r: string }>(sql`select row_to_json(x)::text as r from ${sql.identifier(name)} x order by r`);
    out[name] = r.rows.map((x) => x.r);
  }
  // Not compared: the points counter (never backed up) and the sign-in a login line points at (sessions aren't kept)
  out.app_settings = out.app_settings.filter((r) => JSON.parse(r).key !== "restaurant_quota");
  out.login_events = out.login_events.map((r) => JSON.stringify({ ...JSON.parse(r), session_id: null }));
  return out;
}
/** after, without log lines written since before was taken. */
function sameData(after: Record<string, string[]>, before: Record<string, string[]>) {
  const lastLog = Math.max(0, ...before.app_log.map((r) => JSON.parse(r).id));
  expect({ ...after, app_log: after.app_log.filter((r) => JSON.parse(r).id <= lastLog) }).toEqual(before);
}

function photoBytes(rel: string) {
  return readFileSync(path.join(uploadsDir(), rel));
}

/** A .tar.gz of hand-made entries (type "0" file, "1" hard link, "2" symlink, "3" device, "5" folder). */
function tarEntry(name: string, opts: { type?: string; data?: Buffer | string; linkpath?: string } = {}) {
  const data = typeof opts.data === "string" ? Buffer.from(opts.data) : (opts.data ?? Buffer.alloc(0));
  const h = Buffer.alloc(512);
  h.write(name, 0, 100, "utf8");
  h.write("0000644\0", 100);
  h.write("0000000\0", 108);
  h.write("0000000\0", 116);
  h.write(data.length.toString(8).padStart(11, "0") + "\0", 124);
  h.write("00000000000\0", 136);
  h.write("        ", 148);
  h.write(opts.type ?? "0", 156);
  if (opts.linkpath) h.write(opts.linkpath, 157, 100, "utf8");
  h.write("ustar\0", 257);
  h.write("00", 263);
  let sum = 0;
  for (const byte of h) sum += byte;
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  return Buffer.concat([h, data, Buffer.alloc((512 - (data.length % 512)) % 512)]);
}
const tarGz = (entries: Buffer[]) => gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)]));

/** The bytesize.json inside a backup in the backups folder. */
async function backupJson(name: string): Promise<any> {
  const out = mkdtempSync(path.join(tmpdir(), "bytesize-read-"));
  try {
    await tar.x({ file: path.join(backupsDir(), name), cwd: out });
    return JSON.parse(readFileSync(path.join(out, "bytesize.json"), "utf8"));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

/** Restore from an uploaded file (the file part first, confirm after it). */
async function restoreUpload(data: Buffer, confirm = "RESTORE") {
  const { payload, headers } = multipart([
    { name: "file", filename: "my-backup.tar.gz", type: "application/gzip", data },
    { name: "confirm", value: confirm },
  ]);
  return t.api("POST", "/api/admin/backups/restore", payload, headers);
}

async function makeBackup() {
  const r = await t.api("POST", "/api/admin/backups");
  expect(r.status).toBe(200);
  return r.body.backup as { name: string; size: number; createdAt: string };
}

describe("backups", () => {
  it("every table is backed up or skipped on purpose", async () => {
    const inSchema = Object.values(schema)
      .filter((v) => is(v, PgTable))
      .map((v) => getTableName(v as PgTable))
      .sort();
    expect([...BACKED_UP_TABLES, ...SKIP_TABLES].sort()).toEqual(inSchema);
    // sign-ins, and the short-lived codes and OAuth flows that lead to one, are never backed up
    expect(SKIP_TABLES).toEqual(expect.arrayContaining(["sessions", "password_reset_codes", "oauth_flows", "oauth_tickets"]));
    const inDb = await t.db.execute<{ tablename: string }>(sql`select tablename from pg_tables where schemaname = 'public'`);
    expect(inDb.rows.map((r) => r.tablename).sort()).toEqual(inSchema);
  });

  it("food_cache: every column that points at a cached food is considered (a new one must be added)", async () => {
    // Foreign keys to food_cache, as the database has them
    const fks = await t.db.execute<{ ref: string }>(sql`
      select c.conrelid::regclass::text || '.' || a.attname as ref
      from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
      where c.contype = 'f' and c.confrelid = 'food_cache'::regclass`);
    expect(fks.rows.length).toBeGreaterThan(0);
    for (const { ref } of fks.rows) expect(CACHE_REFERENCES, ref).toContain(ref);
    // ...and the ones without a foreign key: a log line's or a recipe ingredient's "cache:<id>" / (cache, id)
    expect(CACHE_REFERENCES).toEqual(expect.arrayContaining(["log_entries.source_ref", "recipe_items.food_id"]));
  });

  it("round trip: a backup restores every table, the photos and the id counters exactly", async () => {
    const { a, b, photo, unusedCacheId } = await seed();
    const all = await snapshot();
    // A cached food nobody used (a search result) isn't kept
    const before: Record<string, string[]> = { ...all, food_cache: all.food_cache.filter((r) => JSON.parse(r).id !== unusedCacheId) };
    expect(before.food_cache).toHaveLength(all.food_cache.length - 1);
    for (const name of BACKED_UP_TABLES) expect(before[name].length, `${name} has rows to check`).toBeGreaterThan(0);
    const jpeg = photoBytes(photo.path);
    const adminToken = t.getToken();

    const backup = await makeBackup();
    expect(backup.name).toMatch(/^bytesize-\d{4}-\d{2}-\d{2}-\d{6}\.tar\.gz$/);
    expect(backup.size).toBeGreaterThan(0);
    const json = await backupJson(backup.name);
    expect(json).toMatchObject({ app: "bytesize", format: 1, schema: SCHEMA, createdAt: expect.any(String) });
    expect(Object.keys(json.tables).sort()).toEqual([...BACKED_UP_TABLES].sort());
    expect(json.tables.app_settings.map((r: any) => r.key)).not.toContain("restaurant_quota");
    expect(json.tables.food_cache.map((r: any) => r.id).sort()).toEqual(before.food_cache.map((r) => JSON.parse(r).id).sort());
    // Secrets stay as stored (encrypted)
    expect(JSON.stringify(json)).not.toContain("sk-home-ai");
    expect(JSON.stringify(json)).not.toContain("cul_key");

    // Change things after the backup
    await t.db.update(users).set({ displayName: "Changed" }).where(eq(users.id, a.id));
    await t.db.delete(weighIns).where(eq(weighIns.userId, b.id));
    await t.db.delete(userFoods).where(eq(userFoods.userId, a.id));
    await t.db.insert(logEntries).values({ userId: b.id, day: "2026-11-16", meal: "lunch", name: "New", icon: "🍎", source: "cache", unit: "g", quantity: 1, perServing: {}, servings: [], nutrients: {} });
    await t.db.update(appSettings).set({ value: { left: 3, day: "2026-11-17" } }).where(eq(appSettings.key, "restaurant_quota"));
    rmSync(path.join(uploadsDir(), photo.path));
    mkdirSync(path.join(uploadsDir(), String(b.id)), { recursive: true });
    writeFileSync(path.join(uploadsDir(), String(b.id), "stray.jpg"), "new photo");

    const r = await t.api("POST", "/api/admin/backups/restore", { name: backup.name, confirm: "RESTORE" });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ restored: { schema: SCHEMA, users: 3, photos: 1 }, unreadableKeys: [] });

    sameData(await snapshot(), before);
    // Nothing points at a cached food that isn't there
    const dangling = await t.db.execute<{ n: number }>(sql`select
      (select count(*) from log_entries where source = 'cache' and source_ref not in (select 'cache:' || id from food_cache))
      + (select count(*) from recipe_items where food_kind = 'cache' and food_id not in (select id from food_cache)) as n`);
    expect(Number(dangling.rows[0].n)).toBe(0);
    expect(photoBytes(photo.path)).toEqual(jpeg);
    expect(existsSync(path.join(uploadsDir(), String(b.id), "stray.jpg"))).toBe(false);
    // The points counter is the server's, not the backup's
    const [quota] = await t.db.select().from(appSettings).where(eq(appSettings.key, "restaurant_quota"));
    expect(quota.value).toEqual({ left: 3, day: "2026-11-17" });
    // New rows get new ids
    await t.db.insert(logEntries).values({ userId: a.id, day: "2026-11-17", meal: "lunch", name: "After", icon: "🍎", source: "cache", unit: "g", quantity: 1, perServing: {}, servings: [], nutrients: {} });
    await t.db.insert(userFoods).values({ userId: a.id, kind: "custom", name: "After", servings: [], nutrients: {} });
    // Everyone signs in again
    expect((await asUser(t, adminToken)("GET", "/api/admin/backups")).status).toBe(401);
    expect((await asUser(t, a.token)("GET", "/api/day/2026-11-15")).status).toBe(401);
    await signIn();
    const list = await t.api("GET", "/api/admin/backups");
    expect(list.body.backups.map((x: any) => x.name)).toEqual([expect.stringMatching(/-before-restore\.tar\.gz$/), backup.name].sort().reverse());
    // The safety backup holds what was there just before (the changed name)
    const safety = await backupJson(list.body.backups.find((x: any) => x.name.endsWith("-before-restore.tar.gz")).name);
    expect(safety.tables.users.find((u: any) => u.id === a.id).display_name).toBe("Changed");
  });

  it("lists backups newest first with the number kept", async () => {
    await t.login();
    t.clock.date = new Date(2026, 10, 15, 8, 0, 0);
    const first = await makeBackup();
    t.clock.date = new Date(2026, 10, 16, 9, 30, 15);
    const second = await makeBackup();
    expect(second.name).toBe("bytesize-2026-11-16-093015.tar.gz");
    expect(second.createdAt).toBe(new Date(2026, 10, 16, 9, 30, 15).toISOString());
    process.env.BACKUP_KEEP = "7";
    const r = await t.api("GET", "/api/admin/backups");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      backups: [
        { name: second.name, size: statSync(path.join(backupsDir(), second.name)).size, createdAt: second.createdAt },
        { name: first.name, size: first.size, createdAt: first.createdAt },
      ],
      keep: 7,
      unreadableKeys: [],
      problem: null,
    });
    delete process.env.BACKUP_KEEP;
    expect((await t.api("GET", "/api/admin/backups")).body.keep).toBe(14);
  });

  it("downloads and deletes a backup", async () => {
    await t.login();
    const b = await makeBackup();
    const res = await t.app.inject({ method: "GET", url: `/api/admin/backups/${b.name}`, headers: { authorization: `Bearer ${t.getToken()}` } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/gzip");
    expect(res.headers["content-disposition"]).toBe(`attachment; filename="${b.name}"`);
    expect(res.rawPayload).toEqual(readFileSync(path.join(backupsDir(), b.name)));
    expect(await t.api("DELETE", `/api/admin/backups/${b.name}`)).toMatchObject({ status: 200, body: { ok: true } });
    expect(backupFiles()).toEqual([]);
    expect((await t.api("DELETE", `/api/admin/backups/${b.name}`)).status).toBe(404);
  });

  it("not admin: a member can't list, make, download, delete or restore", async () => {
    await t.login();
    const b = await makeBackup();
    const member = await t.createUser("anna");
    const as = asUser(t, member.token);
    expect((await as("GET", "/api/admin/backups")).status).toBe(403);
    expect((await as("POST", "/api/admin/backups")).status).toBe(403);
    expect((await as("GET", `/api/admin/backups/${b.name}`)).status).toBe(403);
    expect((await as("DELETE", `/api/admin/backups/${b.name}`)).status).toBe(403);
    expect((await as("POST", "/api/admin/backups/restore", { name: b.name, confirm: "RESTORE" })).status).toBe(403);
    expect(backupFiles()).toEqual([b.name]);
  });

  it("confirm: a restore without RESTORE typed changes nothing", async () => {
    await seed();
    const b = await makeBackup();
    await t.db.delete(weighIns);
    const before = await snapshot();
    for (const confirm of [undefined, "", "restore", "RESTORE "]) {
      const r = await t.api("POST", "/api/admin/backups/restore", { name: b.name, confirm });
      expect(r).toMatchObject({ status: 400, body: { error: "Type RESTORE to confirm." } });
    }
    const up = await restoreUpload(readFileSync(path.join(backupsDir(), b.name)), "yes");
    expect(up).toMatchObject({ status: 400, body: { error: "Type RESTORE to confirm." } });
    sameData(await snapshot(), before);
    expect(backupFiles()).toEqual([b.name]);
    expect(readdirSync(backupsDir()).filter((n) => n.startsWith(".")), "no upload left behind").toEqual([]);
  });

  it("bad files are refused before anything is emptied, with no safety backup", async () => {
    const { photo } = await seed();
    const before = await snapshot();
    const jpeg = photoBytes(photo.path);
    const good = JSON.stringify({ app: "bytesize", format: 1, schema: SCHEMA, createdAt: "2026-11-17T00:00:00Z", tables: {} });
    const cases: [string, Buffer, string][] = [
      ["plain text", Buffer.from("hello, this is not a backup"), NOT_A_BACKUP],
      ["a gzip that isn't a tar", gzipSync(Buffer.from("just some words ".repeat(100))), NOT_A_BACKUP],
      ["a tar without bytesize.json", tarGz([tarEntry("notes.txt", { data: "hi" })]), NOT_A_BACKUP],
      ["garbage JSON", tarGz([tarEntry("bytesize.json", { data: "{ not json" })]), NOT_A_BACKUP],
      ["another app's JSON", tarGz([tarEntry("bytesize.json", { data: good.replace('"bytesize"', '"other"') })]), NOT_A_BACKUP],
      ["tables that aren't lists", tarGz([tarEntry("bytesize.json", { data: good.replace('"tables":{}', '"tables":{"users":5}') })]), NOT_A_BACKUP],
      ["a newer schema", tarGz([tarEntry("bytesize.json", { data: good.replace(`"schema":${SCHEMA}`, `"schema":${SCHEMA + 1}`) })]), NEWER],
      ["a newer format", tarGz([tarEntry("bytesize.json", { data: good.replace('"format":1', '"format":2') })]), NEWER],
    ];
    for (const [what, data, message] of cases) {
      const r = await restoreUpload(data);
      expect(r, what).toMatchObject({ status: 400, body: { error: message } });
    }
    sameData(await snapshot(), before);
    expect(photoBytes(photo.path)).toEqual(jpeg);
    expect(backupFiles()).toEqual([]);
    expect(existsSync(backupsDir()) ? readdirSync(backupsDir()) : [], "no temp files left").toEqual([]);
    expect(readdirSync(t.app.dataDir).sort()).toEqual(existsSync(backupsDir()) ? ["backups", "uploads"] : ["uploads"]);
  });

  it("hostile archive: only bytesize.json and uploads/<id>/<name> files are taken out", async () => {
    const { admin, photo } = await seed();
    const b = await makeBackup();
    const json = JSON.stringify(await backupJson(b.name));
    const ok = Buffer.from("an ok photo");
    const archive = tarGz([
      tarEntry("bytesize.json", { data: json }),
      tarEntry("../evil.txt", { data: "evil" }),
      tarEntry("/abs-bytesize-test.txt", { data: "evil" }),
      tarEntry(`uploads/${admin.id}/../../evil.txt`, { data: "evil" }),
      tarEntry(`uploads/${admin.id}/link.jpg`, { type: "2", linkpath: "/etc/passwd" }),
      tarEntry(`uploads/${admin.id}/hard.jpg`, { type: "1", linkpath: "bytesize.json" }),
      tarEntry(`uploads/${admin.id}/dev.jpg`, { type: "3" }),
      tarEntry("uploads/evil.jpg", { data: "evil" }),
      tarEntry(`uploads/${admin.id}/sub/evil.jpg`, { data: "evil" }),
      tarEntry("backups/evil.tar.gz", { data: "evil" }),
      tarEntry(`uploads/${admin.id}/ok.jpg`, { data: ok }),
    ]);
    const r = await restoreUpload(archive);
    expect(r.status).toBe(200);
    expect(r.body.restored).toEqual({ schema: SCHEMA, users: 3, photos: 1 });
    expect(readFileSync(path.join(uploadsDir(), String(admin.id), "ok.jpg"))).toEqual(ok);
    // The backup had a photo but this archive doesn't: the photos are the archive's
    expect(existsSync(path.join(uploadsDir(), photo.path))).toBe(false);
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const d of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, d.name);
        if (d.isDirectory()) walk(p);
        else files.push(path.relative(t.app.dataDir, p));
      }
    };
    walk(t.app.dataDir);
    expect(files.filter((f) => !f.startsWith("backups/"))).toEqual([`uploads/${admin.id}/ok.jpg`]);
    expect(files.filter((f) => f.startsWith("backups/")).length).toBe(2); // the backup and the safety backup
    expect(existsSync(path.join(t.app.dataDir, "..", "evil.txt"))).toBe(false);
    expect(existsSync("/abs-bytesize-test.txt")).toBe(false);
  });

  it("failure mid-restore: a row that breaks a rule leaves the data and photos as they were", async () => {
    const { photo } = await seed();
    const b = await makeBackup();
    const json = await backupJson(b.name);
    json.tables.users.push({ ...json.tables.users[0], id: 999 }); // the same username twice
    await t.db.delete(weighIns);
    const before = await snapshot();
    const jpeg = photoBytes(photo.path);
    const r = await restoreUpload(tarGz([tarEntry("bytesize.json", { data: JSON.stringify(json) })]));
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/nothing was changed/i);
    expect(r.body.error).not.toMatch(/duplicate key|constraint/i); // plain words; the details are in the log
    sameData(await snapshot(), before);
    expect(photoBytes(photo.path)).toEqual(jpeg);
    expect((await t.api("GET", "/api/admin/backups")).status).toBe(200); // still signed in
    const [line] = await t.db.select().from(appLog).where(eq(appLog.level, "error"));
    expect(line).toMatchObject({ category: "api", event: expect.stringMatching(/restore/i), detail: expect.stringMatching(/table users.*duplicate key/) });
    expect(line.detail).not.toMatch(/\$2[ab]\$|password_hash|v1:/); // never the rows themselves
  });

  it("failure mid-restore: no password hash or saved key from the backup reaches the log or the answer", async () => {
    await seed();
    const b = await makeBackup();
    const json = await backupJson(b.name);
    const withHash = structuredClone(json);
    withHash.tables.users[0].username = null; // NOT NULL: PostgreSQL would quote the whole failing row
    expect(withHash.tables.users[0].password_hash).toMatch(/^\$2[ab]\$/);
    const withKey = structuredClone(json);
    const anna = withKey.tables.user_settings.find((r: any) => r.culury_key_enc);
    anna.culury_key_enc = encryptSecret("cul_key", TEST_SECRET);
    anna.user_id = null;
    await t.db.delete(weighIns);
    const before = await snapshot();
    for (const data of [withHash, withKey]) {
      const r = await restoreUpload(tarGz([tarEntry("bytesize.json", { data: JSON.stringify(data) })]));
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/doesn't fit/);
      expect(JSON.stringify(r.body)).not.toMatch(/\$2[ab]\$|v1:/);
    }
    sameData(await snapshot(), before);
    const lines = await t.db.select().from(appLog);
    const failures = lines.filter((l) => l.level === "error");
    expect(failures).toHaveLength(2);
    expect(failures.map((l) => l.detail)).toEqual([expect.stringMatching(/table users.*column username/), expect.stringMatching(/table user_settings.*column user_id/)]);
    for (const l of lines) expect(JSON.stringify(l)).not.toMatch(/\$2[ab]\$|v1:/);
  });

  it("a restore that fails for another reason (a lock wait) says to try again", async () => {
    await seed();
    const b = await makeBackup();
    await t.db.delete(weighIns);
    const before = await snapshot();
    backupHooks.lockTimeoutMs = 200;
    const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL ?? "postgresql://bytesize:bytesize@localhost:5432/bytesize_test" });
    const holder = await pool.connect();
    try {
      await holder.query("begin");
      await holder.query("lock table weigh_ins in access share mode"); // someone reading: the restore can't empty it
      const r = await t.api("POST", "/api/admin/backups/restore", { name: b.name, confirm: "RESTORE" });
      expect(r).toMatchObject({ status: 400, body: { error: "The restore didn't finish, and nothing was changed. Try again." } });
    } finally {
      await holder.query("rollback");
      holder.release();
      await pool.end();
    }
    sameData(await snapshot(), before);
  });

  it("a bytesize.json over the size cap is reported as too large", async () => {
    await seed();
    const before = await snapshot();
    backupHooks.maxJsonBytes = 100;
    const json = JSON.stringify({ app: "bytesize", format: 1, schema: SCHEMA, createdAt: "2026-11-17T00:00:00Z", tables: { notes: [{ text: "x".repeat(200) }] } });
    const r = await restoreUpload(tarGz([tarEntry("bytesize.json", { data: json })]));
    expect(r).toMatchObject({ status: 400, body: { error: "This backup is too large to restore here." } });
    sameData(await snapshot(), before);
    expect(backupFiles()).toEqual([]);
  });

  it("photos that can't be swapped in or moved back: logged with where the old ones are", async () => {
    const { photo } = await seed();
    const b = await makeBackup();
    const jpeg = photoBytes(photo.path);
    let calls = 0;
    backupHooks.rename = async (from, to) => {
      calls++;
      if (calls === 1) return defaultHooks.rename(from, to); // the old photos moved aside
      throw new Error("disk full"); // the new ones in, and the old ones back
    };
    const r = await t.api("POST", "/api/admin/backups/restore", { name: b.name, confirm: "RESTORE" });
    expect(r.status).toBe(500);
    expect(r.body.restored).toBe(true); // the data is the backup's: the page treats it as a finished restore
    expect(r.body.error).toMatch(/before-restore\.tar\.gz/);
    expect(r.body.error).toMatch(/data was restored/);
    expect(r.body.error).toMatch(/Sign in again/);
    const old = readdirSync(t.app.dataDir).find((n) => n.startsWith(".uploads-old-"))!;
    expect(old).toBeTruthy();
    expect(readFileSync(path.join(t.app.dataDir, old, photo.path))).toEqual(jpeg); // not lost
    const errors = (await t.db.select().from(appLog)).filter((l) => l.level === "error");
    expect(errors.map((l) => l.detail).join(" ")).toContain(old);
    expect(errors.map((l) => l.detail).join(" ")).toMatch(/-before-restore\.tar\.gz/);
  });

  it("older schema: missing columns take their defaults, extra ones and unknown tables are ignored", async () => {
    const { a } = await seed();
    const b = await makeBackup();
    const json = await backupJson(b.name);
    json.schema = 5;
    for (const row of json.tables.user_settings) delete row.week_start; // added by a later migration
    json.tables.users[0].old_column = "gone";
    json.tables.old_table = [{ id: 1 }];
    const r = await restoreUpload(tarGz([tarEntry("bytesize.json", { data: JSON.stringify(json) })]));
    expect(r.status).toBe(200);
    expect(r.body.restored).toEqual({ schema: 5, users: 3, photos: 0 });
    const [s] = await t.db.select().from(userSettings).where(eq(userSettings.userId, a.id));
    expect(s.weekStart).toBe(0);
    expect(s.waterButtonsMl).toEqual([250, 500]);
    expect(readdirSync(uploadsDir())).toEqual([]);
  });

  it("names: a name that isn't a backup's can't reach any file", async () => {
    await t.login();
    mkdirSync(backupsDir(), { recursive: true });
    writeFileSync(path.join(backupsDir(), "notes.txt"), "not a backup");
    writeFileSync(path.join(t.app.dataDir, ".env"), "SECRET=1");
    for (const name of ["..%2F..%2F.env", "..%2F.env", "notes.txt", "bytesize-2026-11-17-030000.tar.gz", "%2Fetc%2Fpasswd", "restore"]) {
      expect((await t.api("GET", `/api/admin/backups/${name}`)).status, name).toBe(404);
      expect((await t.api("DELETE", `/api/admin/backups/${name}`)).status, name).toBe(404);
    }
    expect(existsSync(path.join(backupsDir(), "notes.txt"))).toBe(true);
    expect(existsSync(path.join(t.app.dataDir, ".env"))).toBe(true);
    for (const name of ["../x", "../../.env", "notes.txt", "bytesize-2026-11-17-030000.tar.gz", ""]) {
      const r = await t.api("POST", "/api/admin/backups/restore", { name, confirm: "RESTORE" });
      expect(r.status, name).toBe(400);
    }
  });

  it("lock: a delete while a backup is running is told one is running", async () => {
    await t.login();
    const first = await makeBackup();
    const running = writeBackup(t.app);
    const r = await t.api("DELETE", `/api/admin/backups/${first.name}`);
    expect(r).toMatchObject({ status: 409, body: { error: "A backup is already running." } });
    await running;
    expect(backupFiles()).toContain(first.name);
  });

  it("two backups in the same second don't overwrite each other", async () => {
    await t.login();
    t.clock.date = new Date(2026, 10, 17, 9, 0, 0);
    const x = await makeBackup();
    const y = await makeBackup();
    expect(x.name).toBe("bytesize-2026-11-17-090000.tar.gz");
    expect(y.name).toBe("bytesize-2026-11-17-090001.tar.gz");
    expect(backupFiles()).toEqual([x.name, y.name]);
  });

  it("lock: two backups at once, the second is told one is running", async () => {
    await seed();
    const [x, y] = await Promise.all([t.api("POST", "/api/admin/backups"), t.api("POST", "/api/admin/backups")]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    expect([x, y].find((r) => r.status === 409)!.body).toEqual({ error: "A backup is already running." });
    expect(backupFiles()).toHaveLength(1);
  });

  it("a backup too large for a restore to take fails: nothing is listed and the reason is logged", async () => {
    await seed();
    backupHooks.maxJsonBytes = 100;
    const r = await t.api("POST", "/api/admin/backups");
    expect(r.status).toBe(507);
    expect(r.body.error).toMatch(/^The backup is too large for ByteSize to restore \([\d.]+ MB of data; the limit is [\d.]+ MB\)\.$/);
    expect(backupFiles()).toEqual([]);
    expect(readdirSync(backupsDir()), "no temp files left").toEqual([]);
    const errors = (await t.db.select().from(appLog)).filter((l) => l.level === "error");
    expect(errors).toHaveLength(1);
    expect(`${errors[0].event} ${errors[0].detail}`).toContain(r.body.error);

    // The daily one: not saved either, and logged
    t.clock.date = new Date(2026, 10, 17, 4, 0, 0);
    expect(await dailyBackupCheck(t.app)).toBeNull();
    expect(backupFiles()).toEqual([]);
    const daily = (await t.db.select().from(appLog).where(eq(appLog.category, "schedule"))).filter((l) => l.level === "error");
    expect(daily).toHaveLength(1);
    expect(daily[0].detail).toMatch(/too large for ByteSize to restore/);
  });

  it("a backup with no admin account is refused before anything is emptied, with no safety backup", async () => {
    await seed();
    const b = await makeBackup();
    const json = await backupJson(b.name);
    for (const u of json.tables.users) u.is_admin = false;
    await t.db.delete(weighIns);
    const before = await snapshot();
    const r = await restoreUpload(tarGz([tarEntry("bytesize.json", { data: JSON.stringify(json) })]));
    expect(r).toMatchObject({ status: 400, body: { error: "This backup has no admin account, so it can't be restored." } });
    const none = await restoreUpload(tarGz([tarEntry("bytesize.json", { data: JSON.stringify({ ...json, tables: { ...json.tables, users: [] } }) })]));
    expect(none).toMatchObject({ status: 400, body: { error: "This backup has no admin account, so it can't be restored." } });
    sameData(await snapshot(), before);
    expect(backupFiles()).toEqual([b.name]);
  });

  it("a value of the wrong kind: the log says where, never the value", async () => {
    await seed();
    const b = await makeBackup();
    const json = await backupJson(b.name);
    const marker = "ZQX-MARKER-4711";
    json.tables.weigh_ins[0].weight_kg = `${marker} kilos`;
    await t.db.delete(weighIns);
    const before = await snapshot();
    const r = await restoreUpload(tarGz([tarEntry("bytesize.json", { data: JSON.stringify(json) })]));
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/doesn't fit/);
    expect(JSON.stringify(r.body)).not.toContain(marker);
    sameData(await snapshot(), before);
    const lines = await t.db.select().from(appLog);
    const [failure] = lines.filter((l) => l.level === "error");
    expect(failure.detail).toMatch(/\[22/); // the error code is kept
    for (const l of lines) expect(JSON.stringify(l)).not.toContain(marker);
  });

  it("on start, leftovers of an interrupted backup or restore are removed; old photos are kept and pointed out", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bytesize-leftovers-"));
    try {
      const at = (...p: string[]) => path.join(dir, ...p);
      mkdirSync(at("backups", ".work-abc123", "uploads", "1"), { recursive: true });
      writeFileSync(at("backups", ".work-abc123", "bytesize.json"), "{}");
      writeFileSync(at("backups", ".upload-0123456789abcdef.tmp"), "half an upload");
      writeFileSync(at("backups", ".bytesize-2026-11-17-030000.tar.gz.tmp"), "half a backup");
      writeFileSync(at("backups", "bytesize-2026-11-16-030000.tar.gz"), "a backup");
      writeFileSync(at("backups", "notes.txt"), "someone's notes");
      mkdirSync(at(".restore-xyz789", "uploads"), { recursive: true });
      mkdirSync(at(".uploads-old-a1b2c3", "1"), { recursive: true });
      writeFileSync(at(".uploads-old-a1b2c3", "1", "p.jpg"), "photo");
      mkdirSync(at("uploads", "1"), { recursive: true });
      writeFileSync(at("uploads", "1", "q.jpg"), "photo");
      writeFileSync(at(".env"), "SECRET=1");

      const app = buildApp({ db: t.db, jwtSecret: TEST_SECRET, rateLimit: false, dataDir: dir, backupSchedule: false });
      await app.ready();
      await app.close();

      expect(readdirSync(at("backups")).sort()).toEqual(["bytesize-2026-11-16-030000.tar.gz", "notes.txt"]);
      expect(readdirSync(dir).sort()).toEqual([".env", ".uploads-old-a1b2c3", "backups", "uploads"]);
      expect(readFileSync(at(".uploads-old-a1b2c3", "1", "p.jpg"), "utf8")).toBe("photo");
      const warnings = (await t.db.select().from(appLog)).filter((l) => l.level === "warning");
      expect(warnings).toHaveLength(1);
      expect(`${warnings[0].event} ${warnings[0].detail}`).toContain(".uploads-old-a1b2c3");
      expect(`${warnings[0].event} ${warnings[0].detail}`).toMatch(/interrupted restore/);

      // No photo folder and one old one: nothing is moved, only the warning again
      rmSync(at("uploads"), { recursive: true });
      await cleanLeftovers({ db: t.db, dataDir: dir } as never);
      expect(readdirSync(dir).sort()).toEqual([".env", ".uploads-old-a1b2c3", "backups"]);
      expect((await t.db.select().from(appLog)).filter((l) => l.level === "warning")).toHaveLength(2);

      // Nothing left over: nothing logged
      rmSync(at(".uploads-old-a1b2c3"), { recursive: true });
      await cleanLeftovers({ db: t.db, dataDir: dir } as never);
      expect((await t.db.select().from(appLog)).filter((l) => l.level === "warning")).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a cleanup that fails on start never stops the server from starting", async () => {
    const errors: unknown[] = [];
    // no data folder to look in: the cleanup itself throws
    const broken = { db: t.db, dataDir: undefined, log: { error: (e: unknown) => errors.push(e) } };
    await expect(cleanLeftovers(broken as never)).rejects.toThrow();
    await expect(cleanLeftoversOnStart(broken as never)).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
  });

  it("activity log: backup, download, delete and restore each say who and which file", async () => {
    const { admin } = await seed();
    const apiLines = () => t.db.select().from(appLog).where(eq(appLog.category, "api"));
    const b = await makeBackup();
    // (checked before the restore: the restore puts back the log as it was when the backup was made)
    const made = (await apiLines()).find((l) => /backup made/i.test(l.event));
    expect((await t.app.inject({ method: "GET", url: `/api/admin/backups/${b.name}`, headers: { authorization: `Bearer ${t.getToken()}` } })).statusCode).toBe(200);
    const downloaded = (await apiLines()).find((l) => /downloaded/i.test(l.event));
    await t.api("POST", "/api/admin/backups/restore", { name: b.name, confirm: "RESTORE" });
    await signIn();
    await t.api("DELETE", `/api/admin/backups/${b.name}`);
    const lines = await apiLines();
    const restored = lines.find((l) => /restored/i.test(l.event));
    const deleted = lines.find((l) => /deleted/i.test(l.event));
    for (const l of [made, downloaded, restored, deleted]) {
      expect(l).toMatchObject({ level: "info", userId: admin.id });
      expect(l!.detail).toContain(b.name);
      expect(l!.detail).toContain("cory");
    }
    expect(restored!.detail).toMatch(/-before-restore\.tar\.gz/);
  });
});

describe("daily backup", () => {
  const at = (day: number, h: number, m = 0) => {
    t.clock.date = new Date(2026, 10, day, h, m, 0);
  };
  const daily = () => backupFiles().filter((n) => /^bytesize-\d{4}-\d{2}-\d{2}-\d{6}\.tar\.gz$/.test(n));

  it("one a day, after BACKUP_HOUR (default 3), checked hourly", async () => {
    await t.login();
    at(17, 2, 59);
    expect(await dailyBackupCheck(t.app)).toBeNull();
    expect(backupFiles()).toEqual([]);
    at(17, 3, 5);
    expect(await dailyBackupCheck(t.app)).toBe("bytesize-2026-11-17-030500.tar.gz");
    at(17, 23, 0);
    expect(await dailyBackupCheck(t.app)).toBeNull();
    at(18, 2, 0);
    expect(await dailyBackupCheck(t.app)).toBeNull();
    at(18, 10, 0); // the server was off at 03:00
    expect(await dailyBackupCheck(t.app)).toBe("bytesize-2026-11-18-100000.tar.gz");
    expect(daily()).toEqual(["bytesize-2026-11-17-030500.tar.gz", "bytesize-2026-11-18-100000.tar.gz"]);
    const [line] = await t.db.select().from(appLog).where(eq(appLog.category, "schedule"));
    expect(line).toMatchObject({ level: "info", userId: null, detail: expect.stringContaining("bytesize-2026-11-17-030500.tar.gz") });
  });

  it("BACKUP_HOUR moves it; a backup made by hand earlier today doesn't count, a labelled one doesn't either", async () => {
    await t.login();
    process.env.BACKUP_HOUR = "5";
    at(17, 4, 0);
    expect(await dailyBackupCheck(t.app)).toBeNull();
    mkdirSync(backupsDir(), { recursive: true });
    writeFileSync(path.join(backupsDir(), "bytesize-2026-11-17-040000.tar.gz"), "x"); // before today's hour
    writeFileSync(path.join(backupsDir(), "bytesize-2026-11-17-051000-before-restore.tar.gz"), "x");
    at(17, 6, 0);
    expect(await dailyBackupCheck(t.app)).toBe("bytesize-2026-11-17-060000.tar.gz");
    at(17, 7, 0);
    expect(await dailyBackupCheck(t.app)).toBeNull();
  });

  it("keeps the newest BACKUP_KEEP (default 14); 0 turns the daily backup off", async () => {
    await t.login();
    mkdirSync(backupsDir(), { recursive: true });
    const old = Array.from({ length: 14 }, (_, i) => `bytesize-2026-10-${String(i + 1).padStart(2, "0")}-030000.tar.gz`);
    for (const n of old) writeFileSync(path.join(backupsDir(), n), "x");
    at(17, 3, 0);
    expect(await dailyBackupCheck(t.app)).toBe("bytesize-2026-11-17-030000.tar.gz");
    expect(backupFiles()).toHaveLength(14);
    expect(backupFiles()).not.toContain(old[0]);
    expect(backupFiles()).toContain(old[1]);

    process.env.BACKUP_KEEP = "0";
    at(18, 4, 0);
    expect(await dailyBackupCheck(t.app)).toBeNull();
    expect(backupFiles()).toHaveLength(14);
  });
});

describe("daily backup problems", () => {
  const at = (day: number, h: number, m = 0) => {
    t.clock.date = new Date(2026, 10, day, h, m, 0);
  };
  const problem = async () => (await t.api("GET", "/api/admin/backups")).body.problem;

  it("a failing daily backup shows in the list until one works, and is logged once per new reason", async () => {
    await t.login();
    expect(await problem()).toBeNull();
    backupHooks.maxJsonBytes = 10;
    at(17, 3, 0);
    expect(await dailyBackupCheck(t.app)).toBeNull();
    expect(await problem()).toMatch(/^The last backup failed: The backup is too large for ByteSize to restore/);
    at(17, 4, 0);
    expect(await dailyBackupCheck(t.app)).toBeNull(); // the next hour: the same failure
    const failures = () => t.db.select().from(appLog).where(eq(appLog.level, "error"));
    expect(await failures()).toHaveLength(1);
    backupHooks.maxJsonBytes = defaultHooks.maxJsonBytes;
    rmSync(backupsDir(), { recursive: true, force: true });
    writeFileSync(backupsDir(), "not a folder"); // a different reason: logged
    at(17, 5, 0);
    expect(await dailyBackupCheck(t.app)).toBeNull();
    expect(await failures()).toHaveLength(2);
    expect(await problem()).not.toMatch(/too large/);
    rmSync(backupsDir());
    at(17, 6, 0);
    expect(await dailyBackupCheck(t.app)).toBe("bytesize-2026-11-17-060000.tar.gz");
    expect(await problem()).toBeNull();
    // Failing again after a success is a new failure: logged
    backupHooks.maxJsonBytes = 10;
    at(18, 3, 0);
    expect(await dailyBackupCheck(t.app)).toBeNull();
    expect(await failures()).toHaveLength(3);
  });

  it("no daily backup for more than 36 hours shows in the list (not when the daily backup is off)", async () => {
    await t.login();
    mkdirSync(backupsDir(), { recursive: true });
    writeFileSync(path.join(backupsDir(), "bytesize-2026-11-15-030000.tar.gz"), "x");
    at(16, 15, 0); // 36 hours later
    expect(await problem()).toBeNull();
    writeFileSync(path.join(backupsDir(), "bytesize-2026-11-17-010000-before-restore.tar.gz"), "x"); // a labelled one doesn't count
    at(16, 15, 1);
    expect(await problem()).toMatch(/^No backup has been saved since Nov 15, 2026, 3:00 AM\.$/);
    process.env.BACKUP_KEEP = "0";
    expect(await problem()).toBeNull();
  });

  it("the prune after a daily backup runs while the backup lock is still held", async () => {
    await t.login();
    process.env.BACKUP_KEEP = "1";
    mkdirSync(backupsDir(), { recursive: true });
    writeFileSync(path.join(backupsDir(), "bytesize-2026-11-01-030000.tar.gz"), "x");
    const during: string[] = [];
    backupHooks.remove = async (file) => {
      during.push(await writeBackup(t.app).then(() => "ran", (e: Error) => e.message));
      return defaultHooks.remove(file);
    };
    at(17, 3, 0);
    expect(await dailyBackupCheck(t.app)).toBe("bytesize-2026-11-17-030000.tar.gz");
    expect(during).toEqual(["A backup is already running."]);
    expect(backupFiles()).toEqual(["bytesize-2026-11-17-030000.tar.gz"]);
  });
});

describe("unreadable keys", () => {
  it("names saved keys the current JWT_SECRET can't open", async () => {
    const { a } = await seed();
    expect((await t.api("GET", "/api/admin/backups")).body.unreadableKeys).toEqual([]);
    const other = "another-secret-another-secret-another-1234";
    const [ai] = await t.db.select().from(appSettings).where(eq(appSettings.key, "ai"));
    const v = ai.value as any;
    v.services[0].apiKeyEnc = encryptSecret("sk-x", other);
    await t.db.update(appSettings).set({ value: v }).where(eq(appSettings.key, "ai"));
    const [fs] = await t.db.select().from(appSettings).where(eq(appSettings.key, "food_sources"));
    await t.db
      .update(appSettings)
      .set({ value: { ...(fs.value as any), usdaApiKey: encryptSecret("u", other), fatsecretClientSecret: encryptSecret("f", other) } })
      .where(eq(appSettings.key, "food_sources"));
    await t.db.update(userSettings).set({ culuryKeyEnc: encryptSecret("c", other) }).where(eq(userSettings.userId, a.id));
    const r = await t.api("GET", "/api/admin/backups");
    expect(r.body.unreadableKeys).toEqual(["Home AI key", "USDA key", "FatSecret secret", "Culury key for anna"]);
  });
});
