// Whole-server backups: a .tar.gz in <data dir>/backups holding bytesize.json (every backed-up table's rows,
// read in one consistent snapshot) and uploads/<user id>/<file> (the photos). Only an admin makes, downloads,
// deletes or restores them. A restore replaces everything: one database transaction, then the photo folder
// is swapped; a "before-restore" safety backup is written first. Saved secrets stay encrypted as stored.
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { eq, getTableName, is, sql, type SQL } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import * as tar from "tar";
import { z } from "zod";
import * as schema from "../db/schema.js";
import { appSettings, userSettings, users } from "../db/schema.js";
import { logEvent } from "./appLog.js";
import { waitOnClose } from "./schedule.js";
import { HttpError, badRequest } from "./errors.js";
import { QUOTA_KEY } from "./restaurants/index.js";
import { decryptSecret } from "./secrets.js";

// bytesize-2026-11-17-030000.tar.gz, or with a label: bytesize-2026-11-17-142501-before-restore.tar.gz
export const BACKUP_NAME = /^bytesize-\d{4}-\d{2}-\d{2}-\d{6}(-[a-z-]+)?\.tar\.gz$/;
// Not backed up: sign-ins (everyone signs in again), forgot-password codes, OAuth sign-ins and invite links on their way
// (minutes long), and kept search answers (restaurant and typed searches: a cache kept for each source's hours)...
export const SKIP_TABLES = ["sessions", "password_reset_codes", "oauth_flows", "oauth_tickets", "invites", "restaurant_searches", "food_searches", "log_trash"];
// ...nor the Spoonacular points counter (an app_settings row: the server keeps its own)
const SKIP_SETTINGS = [QUOTA_KEY];
const CACHE_TABLE = "food_cache";
export const DATA_FILE = "bytesize.json";
export const FORMAT = 1;

export const NOT_A_BACKUP = "That isn't a ByteSize backup.";
export const NEWER_BACKUP = "This backup is from a newer ByteSize. Update first.";
export const BACKUP_BUSY = "A backup is already running.";
const TOO_LARGE = "This backup is too large to restore here.";
const DOESNT_FIT = "This backup couldn't be restored, so nothing was changed. Some of its data doesn't fit this server; the details are in Settings › Logs.";
const NO_ADMIN = "This backup has no admin account, so it can't be restored.";
const DIDNT_FINISH = "The restore didn't finish, and nothing was changed. Try again.";

const MAX_PHOTO_BYTES = 50 * 1024 * 1024; // each (kept photos are ≤1600 px JPEGs)
const MAX_EXTRACT_BYTES = 20 * 1024 * 1024 * 1024; // everything taken out of one archive
const PHOTO_ENTRY = /^uploads\/\d{1,10}\/[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;
const INSERT_BATCH = 500;
const CHECK_EVERY_MS = 60 * 60 * 1000;

/** Limits and file moves, swappable in tests. */
export const backupHooks = {
  maxJsonBytes: 200 * 1024 * 1024,
  lockTimeoutMs: 30_000, // a restore waits this long for a table someone is using, then says to try again
  rename: (from: string, to: string) => fs.rename(from, to),
  remove: (file: string) => fs.rm(file, { force: true }), // pruning old backups
  started: async (): Promise<void> => {}, // called once a backup or restore holds the lock (tests hold it there)
};

// ---------- the tables, from the Drizzle schema (a new table is backed up without touching this file) ----------

type TableInfo = { name: string; columns: string[]; serials: string[]; refs: string[]; nullOnRestore: string[]; cacheRefs: string[] };

function tableInfo(): TableInfo[] {
  const tables = (Object.values(schema) as unknown[]).filter((v): v is PgTable => is(v, PgTable));
  const all = tables.map((t) => {
    const cfg = getTableConfig(t);
    const refs: string[] = [];
    const nullOnRestore: string[] = []; // columns pointing at a table that isn't backed up (login_events.session_id)
    const cacheRefs: string[] = []; // columns pointing at food_cache (what keeps a cached food in a backup)
    for (const fk of cfg.foreignKeys) {
      const ref = fk.reference();
      const target = getTableName(ref.foreignTable);
      if (SKIP_TABLES.includes(target)) nullOnRestore.push(...ref.columns.map((c) => c.name));
      else if (target !== cfg.name) refs.push(target);
      if (target === CACHE_TABLE) cacheRefs.push(...ref.columns.map((c) => c.name));
    }
    return { name: cfg.name, columns: cfg.columns.map((c) => c.name), serials: cfg.columns.filter((c) => c.columnType === "PgSerial").map((c) => c.name), refs, nullOnRestore, cacheRefs };
  });
  // Foreign-key order: a table comes after every table it points at
  const kept = all.filter((t) => !SKIP_TABLES.includes(t.name));
  const ordered: TableInfo[] = [];
  const placed = new Set<string>();
  while (ordered.length < kept.length) {
    const next = kept.filter((t) => !placed.has(t.name) && t.refs.every((r) => placed.has(r)));
    if (!next.length) throw new Error("The tables' foreign keys go round in a circle");
    for (const t of next) {
      ordered.push(t);
      placed.add(t.name);
    }
  }
  return ordered;
}

const TABLES = tableInfo();
/** Every table a backup holds, in foreign-key order. */
export const BACKED_UP_TABLES = TABLES.map((t) => t.name);

// Cached foods (food_cache) are kept only when something backed up uses them: search results nobody picked
// would make backups grow without end. Foreign keys to it come from the schema; these two point at it by value.
const LOOSE_CACHE_REFS: { ref: string; uses: SQL }[] = [
  { ref: "log_entries.source_ref", uses: sql`('cache:' || x.id) in (select source_ref from log_entries where source_ref like 'cache:%')` },
  { ref: "recipe_items.food_id", uses: sql`x.id in (select food_id from recipe_items where food_kind = 'cache')` },
];
const FK_CACHE_REFS = TABLES.flatMap((t) => t.cacheRefs.map((c) => ({ ref: `${t.name}.${c}`, uses: sql`x.id in (select ${sql.identifier(c)} from ${sql.identifier(t.name)})` })));
/** Every "table.column" that keeps a cached food in a backup. */
export const CACHE_REFERENCES = [...FK_CACHE_REFS, ...LOOSE_CACHE_REFS].map((r) => r.ref);
const cacheInUse = sql.join([...FK_CACHE_REFS, ...LOOSE_CACHE_REFS].map((r) => sql`(${r.uses})`), sql` or `);

// ---------- one backup or restore at a time ----------

let busy = false;
async function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  if (busy) throw new HttpError(409, BACKUP_BUSY);
  busy = true;
  try {
    await backupHooks.started();
    return await fn();
  } finally {
    busy = false;
  }
}

// ---------- names and the folder ----------

export const backupsDir = (app: FastifyInstance) => path.join(app.dataDir, "backups");
const uploadsDir = (app: FastifyInstance) => path.join(app.dataDir, "uploads");

const pad = (n: number) => String(n).padStart(2, "0");
const stamp = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

/** When a backup was made (server local time, from its name). */
function createdAtOf(name: string): string {
  const m = /^bytesize-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(name)!;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).toISOString();
}
const labelled = (name: string) => !/^bytesize-\d{4}-\d{2}-\d{2}-\d{6}\.tar\.gz$/.test(name);

/** The file of a backup in the backups folder; null for a name that isn't a backup's or a file that isn't there. */
export async function backupFile(app: FastifyInstance, name: unknown): Promise<string | null> {
  if (typeof name !== "string" || !BACKUP_NAME.test(name)) return null;
  const file = path.join(backupsDir(app), name);
  try {
    return (await fs.lstat(file)).isFile() ? file : null;
  } catch {
    return null;
  }
}

export type BackupInfo = { name: string; size: number; createdAt: string };

/** The backups, newest first. */
export async function listBackups(app: FastifyInstance): Promise<BackupInfo[]> {
  let names: string[];
  try {
    names = (await fs.readdir(backupsDir(app))).filter((n) => BACKUP_NAME.test(n));
  } catch {
    return [];
  }
  const out: BackupInfo[] = [];
  for (const name of names) {
    const st = await fs.lstat(path.join(backupsDir(app), name)).catch(() => null);
    if (st?.isFile()) out.push({ name, size: st.size, createdAt: createdAtOf(name) });
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.name.localeCompare(a.name));
}

/** Keeps the newest `keep` backups; deletes the rest. Returns the names deleted. Run it under the lock. */
async function pruneBackups(app: FastifyInstance, keep: number): Promise<string[]> {
  const old = (await listBackups(app)).slice(Math.max(0, keep));
  for (const b of old) await backupHooks.remove(path.join(backupsDir(app), b.name));
  return old.map((b) => b.name);
}

/** Deletes a backup (not while a backup or restore is running: 409). False when there's no such backup. */
export function deleteBackup(app: FastifyInstance, name: string): Promise<boolean> {
  return exclusive(async () => {
    const file = await backupFile(app, name);
    if (!file) return false;
    await fs.rm(file, { force: true });
    return true;
  });
}

const exists = (file: string) => fs.lstat(file).then(() => true, () => false);

// ---------- writing ----------

async function migrationCount(db: { execute: FastifyInstance["db"]["execute"] }): Promise<number> {
  const r = await db.execute<{ n: number }>(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
  return r.rows[0].n;
}

const keptRows = (table: string): SQL =>
  table === "app_settings" ? sql`where x.key not in (${sql.join(SKIP_SETTINGS.map((k) => sql`${k}`), sql`, `)})` : table === CACHE_TABLE ? sql`where ${cacheInUse}` : sql``;

/** bytesize.json: every backed-up table, all read in one repeatable-read snapshot, as PostgreSQL writes it. */
async function writeData(app: FastifyInstance, file: string, createdAt: string) {
  const fh = await fs.open(file, "w");
  try {
    await app.db.transaction(
      async (tx) => {
        const schemaVersion = await migrationCount(tx);
        await fh.write(`{"app":"bytesize","format":${FORMAT},"schema":${schemaVersion},"createdAt":${JSON.stringify(createdAt)},"tables":{`);
        for (const [i, t] of TABLES.entries()) {
          const r = await tx.execute<{ rows: string }>(sql`select coalesce(json_agg(x), '[]'::json)::text as rows from ${sql.identifier(t.name)} x ${keptRows(t.name)}`);
          await fh.write(`${i ? "," : ""}${JSON.stringify(t.name)}:${r.rows[0].rows}`);
        }
        await fh.write("}}\n");
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  } finally {
    await fh.close();
  }
}

/** Hard links (copies where the disk won't) of every photo file into `to`; returns how many. */
async function gatherPhotos(from: string, to: string): Promise<number> {
  let count = 0;
  const people = await fs.readdir(from, { withFileTypes: true }).catch(() => []);
  for (const p of people) {
    if (!p.isDirectory() || !/^\d{1,10}$/.test(p.name)) continue;
    const files = await fs.readdir(path.join(from, p.name), { withFileTypes: true });
    for (const f of files) {
      if (!f.isFile() || !PHOTO_ENTRY.test(`uploads/${p.name}/${f.name}`)) continue;
      await fs.mkdir(path.join(to, p.name), { recursive: true });
      const [src, dst] = [path.join(from, p.name, f.name), path.join(to, p.name, f.name)];
      await fs.link(src, dst).catch(() => fs.copyFile(src, dst));
      count++;
    }
  }
  return count;
}

const mb = (bytes: number) => String(Math.round((bytes / 1024 / 1024) * 10) / 10);
const tooLargeToRestore = (bytes: number) => `The backup is too large for ByteSize to restore (${mb(bytes)} MB of data; the limit is ${mb(backupHooks.maxJsonBytes)} MB).`;

async function createBackup(app: FastifyInstance, label?: string) {
  const now = app.now();
  const dir = backupsDir(app);
  await fs.mkdir(dir, { recursive: true });
  // Never over an existing backup: one made in the same second gets the next free second
  const nameAt = (d: Date) => `bytesize-${stamp(d)}${label ? `-${label}` : ""}.tar.gz`;
  let at = now;
  while (await exists(path.join(dir, nameAt(at)))) at = new Date(at.getTime() + 1000);
  const name = nameAt(at);
  if (!BACKUP_NAME.test(name)) throw new Error(`Not a backup name: ${name}`);
  const tmp = path.join(dir, `.${name}.tmp`);
  // The work folder sits in the data folder, so photos are hard-linked (instant), not copied
  const work = await fs.mkdtemp(path.join(dir, ".work-"));
  try {
    await writeData(app, path.join(work, DATA_FILE), now.toISOString());
    // Never keep a backup a restore would refuse
    const { size: dataBytes } = await fs.stat(path.join(work, DATA_FILE));
    if (dataBytes > backupHooks.maxJsonBytes) throw new HttpError(507, tooLargeToRestore(dataBytes));
    const photos = await gatherPhotos(uploadsDir(app), path.join(work, "uploads"));
    await tar.c({ gzip: true, cwd: work, file: tmp, portable: true }, photos ? [DATA_FILE, "uploads"] : [DATA_FILE]);
    await fs.rename(tmp, path.join(dir, name)); // a half-written backup is never listed
    const { size } = await fs.stat(path.join(dir, name));
    return { name, size, createdAt: createdAtOf(name), photos };
  } finally {
    await fs.rm(work, { recursive: true, force: true });
    await fs.rm(tmp, { force: true });
  }
}

/** Writes a backup of the whole server (one at a time: another running → 409). */
export function writeBackup(app: FastifyInstance, label?: string): Promise<{ name: string; size: number; createdAt: string; photos: number }> {
  return exclusive(() => createBackup(app, label));
}

// ---------- reading a backup file ----------

const backupShape = z.object({
  app: z.literal("bytesize"),
  format: z.number().int().min(1),
  schema: z.number().int().min(0),
  createdAt: z.string().optional(),
  tables: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
});
type BackupData = z.infer<typeof backupShape>;

/**
 * Takes bytesize.json and uploads/<user id>/<file> regular files out of a backup into a new work folder
 * in the data folder (anything else — links, devices, absolute or ".." paths — is ignored), and checks the
 * data. Not a backup → 400; a newer one → 400. The caller removes the work folder.
 */
async function openBackup(app: FastifyInstance, file: string): Promise<{ data: BackupData; work: string }> {
  const fh = await fs.open(file, "r");
  const head = Buffer.alloc(2);
  try {
    await fh.read(head, 0, 2, 0);
  } finally {
    await fh.close();
  }
  if (head[0] !== 0x1f || head[1] !== 0x8b) throw badRequest(NOT_A_BACKUP); // not gzip
  const work = await fs.mkdtemp(path.join(app.dataDir, ".restore-"));
  try {
    let total = 0;
    let tooLarge = false;
    const maxJson = backupHooks.maxJsonBytes;
    try {
      await tar.x({
        file,
        cwd: work,
        strict: true,
        preservePaths: false,
        preserveOwner: false,
        noChmod: true,
        filter: (p, entry) => {
          if (!("type" in entry) || entry.type !== "File") return false;
          const size = entry.size ?? 0;
          if (p === DATA_FILE && size > maxJson) tooLarge = true;
          const keep = (p === DATA_FILE && size <= maxJson) || (PHOTO_ENTRY.test(p) && size <= MAX_PHOTO_BYTES);
          if (keep && (total += size) > MAX_EXTRACT_BYTES) tooLarge = true;
          return keep && !tooLarge;
        },
      });
    } catch {
      throw badRequest(NOT_A_BACKUP); // a gzip that isn't a tar, or a damaged one
    }
    if (tooLarge) throw badRequest(TOO_LARGE);
    let raw: unknown;
    try {
      raw = JSON.parse(await fs.readFile(path.join(work, DATA_FILE), "utf8"));
    } catch {
      throw badRequest(NOT_A_BACKUP); // no bytesize.json, or not JSON
    }
    const parsed = backupShape.safeParse(raw);
    if (!parsed.success) throw badRequest(NOT_A_BACKUP);
    if (parsed.data.format > FORMAT || parsed.data.schema > (await migrationCount(app.db))) throw badRequest(NEWER_BACKUP);
    return { data: parsed.data, work };
  } catch (err) {
    await fs.rm(work, { recursive: true, force: true });
    throw err;
  }
}

// ---------- restoring ----------

/** Empties every backed-up table (and every sign-in) and loads the backup's rows, in one transaction. */
async function loadTables(app: FastifyInstance, data: BackupData) {
  await app.db.transaction(async (tx) => {
    await tx.execute(sql.raw(`set local lock_timeout = ${Math.max(1, Math.floor(backupHooks.lockTimeoutMs))}`));
    const emptied = [...TABLES.map((t) => t.name).filter((n) => n !== "app_settings"), "sessions"];
    await tx.execute(sql`truncate ${sql.join(emptied.map((n) => sql.identifier(n)), sql`, `)} cascade`);
    await tx.delete(appSettings).where(sql`${appSettings.key} not in (${sql.join(SKIP_SETTINGS.map((k) => sql`${k}`), sql`, `)})`);
    for (const t of TABLES) {
      let rows = data.tables[t.name] ?? [];
      if (t.name === "app_settings") rows = rows.filter((r) => !SKIP_SETTINGS.includes(r.key as string));
      if (!rows.length) continue;
      if (t.nullOnRestore.length) rows = rows.map((r) => ({ ...r, ...Object.fromEntries(t.nullOnRestore.map((c) => [c, null])) }));
      // Columns matched by name: ones the backup lacks take their defaults, ones this server lacks are dropped
      const present = new Set(rows.flatMap((r) => Object.keys(r)));
      const cols = t.columns.filter((c) => present.has(c));
      if (!cols.length) continue;
      const list = sql.join(cols.map((c) => sql.identifier(c)), sql`, `);
      for (let i = 0; i < rows.length; i += INSERT_BATCH) {
        const batch = JSON.stringify(rows.slice(i, i + INSERT_BATCH));
        await tx.execute(sql`insert into ${sql.identifier(t.name)} (${list}) select ${list} from json_populate_recordset(null::${sql.identifier(t.name)}, ${batch}::json)`);
      }
    }
    // Id counters carry on after the highest id restored
    for (const t of TABLES) {
      for (const c of t.serials) {
        await tx.execute(
          sql`select setval(pg_get_serial_sequence(${`"${t.name}"`}, ${c}), coalesce((select max(${sql.identifier(c)}) from ${sql.identifier(t.name)}), 0) + 1, false)`,
        );
      }
    }
  });
}

async function countPhotos(dir: string): Promise<number> {
  let n = 0;
  for (const p of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (p.isDirectory()) n += (await fs.readdir(path.join(dir, p.name))).length;
  }
  return n;
}

/** Puts the backup's photo folder in place of the current one (the old one is removed once that worked). */
async function swapUploads(app: FastifyInstance, from: string, safety: string) {
  await fs.mkdir(from, { recursive: true }); // a backup without photos: an empty folder
  const live = uploadsDir(app);
  const old = path.join(app.dataDir, `.uploads-old-${randomBytes(6).toString("hex")}`);
  let moved = false;
  try {
    await backupHooks.rename(live, old).then(
      () => (moved = true),
      (err) => {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      },
    );
    await backupHooks.rename(from, live);
  } catch (err) {
    let oldAt = "";
    if (moved) {
      try {
        await backupHooks.rename(old, live);
      } catch (backErr) {
        oldAt = ` They couldn't be moved back either (${(backErr as Error).message}): they are in the folder ${path.basename(old)} in the data folder.`;
        await logEvent(app.db, { category: "api", level: "error", source: "Restore", event: "The old photos couldn't be moved back after a restore", detail: `They are in ${old}, and in the safety backup ${safety}. ${(backErr as Error).message}` });
      }
    }
    const detail = `The data was restored, but the photos weren't swapped in. The photos from before are in ${safety}.${oldAt} ${(err as Error).message}`;
    await logEvent(app.db, { category: "api", level: "error", source: "Restore", event: "A restore's photos couldn't be put in place", detail });
    throw new HttpError(500, `The data was restored, but its photos couldn't be put in place. The photos from before are in the backup ${safety}; see Settings › Logs. Sign in again to continue.`, { restored: true });
  }
  await fs.rm(old, { recursive: true, force: true });
}

/** A person's username, for activity-log lines. */
export async function whoIs(app: FastifyInstance, userId: number) {
  const [u] = await app.db.select({ username: users.username }).from(users).where(eq(users.id, userId));
  return u?.username ?? `user ${userId}`;
}

/**
 * Replaces everything on the server with a backup file's contents. The file is fully checked first (a bad
 * one changes nothing), then a "before-restore" safety backup is written, then every table is emptied and
 * loaded in one transaction (every session ends), then the photo folder is swapped.
 * `from` names the file in the activity log (default: the file's name).
 */
export function restoreBackup(app: FastifyInstance, file: string, by: { userId: number; from?: string }): Promise<{ schema: number; users: number; photos: number }> {
  return exclusive(async () => {
    const who = await whoIs(app, by.userId);
    const from = by.from ?? path.basename(file);
    const { data, work } = await openBackup(app, file);
    try {
      // With no admin, an empty server would offer its first-run setup to anyone
      if (!(data.tables.users ?? []).some((u) => u.is_admin === true)) throw badRequest(NO_ADMIN);
      const safety = await createBackup(app, "before-restore");
      try {
        await loadTables(app, data);
      } catch (err) {
        // Table, column, constraint and (not for bad values) PostgreSQL's message only: the query's text and its
        // detail ("Failing row contains (...)") would carry the rows themselves (password hashes, saved keys)
        const pg = ((err as { cause?: unknown }).cause ?? err) as { message?: string; code?: string; table?: string; column?: string; constraint?: string };
        // SQLSTATE class 22 (bad data): PostgreSQL's message can quote the value itself, so only where it was
        const badValue = /^22/.test(pg.code ?? "");
        const where = [pg.table && `table ${pg.table}`, pg.column && `column ${pg.column}`, !badValue && pg.constraint && `constraint ${pg.constraint}`].filter(Boolean).join(", ");
        const message = badValue ? "a value of the wrong kind" : pg.code ? (pg.message ?? "unknown error") : "unknown error";
        // Class 22 or 23 (a broken rule): the backup's data; anything else (a lock wait, a lost connection): try again
        const dataProblem = /^2[23]/.test(pg.code ?? "");
        await logEvent(app.db, { category: "api", level: "error", source: "Restore", event: "A restore failed; nothing was changed", detail: `${from}: ${where ? `${where}: ` : ""}${message}${pg.code ? ` [${pg.code}]` : ""}`, userId: by.userId });
        throw badRequest(dataProblem ? DOESNT_FIT : DIDNT_FINISH);
      }
      await swapUploads(app, path.join(work, "uploads"), safety.name);
      const photos = await countPhotos(uploadsDir(app));
      const stillThere = (await app.db.select({ id: users.id }).from(users).where(eq(users.id, by.userId))).length > 0;
      await logEvent(app.db, {
        category: "api",
        level: "info",
        source: "Restore",
        event: "Server restored from a backup",
        detail: `${from} by ${who}: ${data.tables.users?.length ?? 0} people, ${photos} photos. Safety backup first: ${safety.name}. Everyone signs in again.`,
        userId: stillThere ? by.userId : null,
      });
      return { schema: data.schema, users: data.tables.users?.length ?? 0, photos };
    } finally {
      await fs.rm(work, { recursive: true, force: true });
    }
  });
}

// ---------- leftovers of a backup or restore the server stopped in the middle of ----------

/**
 * On start: removes the work folders and half-written files an interrupted backup, upload or restore left
 * (backups/.work-*, backups/.*.tmp, .restore-*). The photos moved aside by a restore (.uploads-old-*) are
 * never touched: a warning says where they are.
 */
// On start: tidy up, but a leftover that can't be removed must never keep the server from starting
export async function cleanLeftoversOnStart(app: Pick<FastifyInstance, "db" | "dataDir" | "log">) {
  try {
    await cleanLeftovers(app);
  } catch (err) {
    app.log.error(err);
  }
}

export async function cleanLeftovers(app: Pick<FastifyInstance, "db" | "dataDir">) {
  const dir = path.join(app.dataDir, "backups");
  for (const n of await fs.readdir(dir).catch(() => [] as string[])) {
    if (n.startsWith(".work-") || (n.startsWith(".") && n.endsWith(".tmp"))) await fs.rm(path.join(dir, n), { recursive: true, force: true });
  }
  const top = await fs.readdir(app.dataDir).catch(() => [] as string[]);
  for (const n of top) if (n.startsWith(".restore-")) await fs.rm(path.join(app.dataDir, n), { recursive: true, force: true });
  const old = top.filter((n) => n.startsWith(".uploads-old-"));
  if (old.length) {
    await logEvent(app.db, {
      category: "api",
      level: "warning",
      source: "Restore",
      event: "Photos from before an interrupted restore are still in the data folder",
      detail: `They are in ${old.join(", ")} in the data folder (${app.dataDir}). Move back any you need, then delete the folder.`,
    });
  }
}

// ---------- keys that a different JWT_SECRET can't open ----------

/** Plain names of the saved secrets the current JWT_SECRET can't open (they need entering again). */
export async function unreadableKeys(app: FastifyInstance): Promise<string[]> {
  const bad = (enc: unknown) => typeof enc === "string" && enc !== "" && decryptSecret(enc, app.jwtSecret) === null;
  const out: string[] = [];
  for (const sv of (await app.ai.stored())?.services ?? []) if (bad(sv.apiKeyEnc)) out.push(`${sv.name} key`);
  const [sources] = await app.db.select().from(appSettings).where(eq(appSettings.key, "food_sources"));
  const s = (sources?.value ?? {}) as Record<string, unknown>;
  const labels: [string, string][] = [
    ["usdaApiKey", "USDA key"],
    ["spoonacularApiKey", "Spoonacular key"],
    ["fatsecretClientId", "FatSecret client ID"],
    ["fatsecretClientSecret", "FatSecret secret"],
  ];
  for (const [field, label] of labels) if (bad(s[field])) out.push(label);
  const culury = await app.db
    .select({ name: users.displayName, username: users.username, enc: userSettings.culuryKeyEnc })
    .from(userSettings)
    .innerJoin(users, eq(users.id, userSettings.userId))
    .orderBy(users.id);
  for (const c of culury) if (bad(c.enc)) out.push(`Culury key for ${c.name || c.username}`);
  return out;
}

// ---------- the daily backup ----------

const envInt = (name: string, fallback: number) => {
  const n = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) ? n : fallback;
};
/** How many backups are kept (BACKUP_KEEP, default 14; 0 turns the daily backup off). */
export const backupKeep = () => Math.max(0, envInt("BACKUP_KEEP", 14));
const backupHour = () => Math.min(23, Math.max(0, envInt("BACKUP_HOUR", 3)));

/**
 * The hourly check: once the server's local time is past BACKUP_HOUR and no daily (unlabelled) backup has
 * been made since today's BACKUP_HOUR, writes one and keeps the newest BACKUP_KEEP. Returns its name, or null.
 */
export async function dailyBackupCheck(app: FastifyInstance): Promise<string | null> {
  const keep = backupKeep();
  if (keep === 0) return null;
  const now = app.now();
  const since = new Date(now);
  since.setHours(backupHour(), 0, 0, 0);
  if (now < since) return null;
  const done = (await listBackups(app)).some((b) => !labelled(b.name) && new Date(b.createdAt) >= since);
  if (done) return null;
  try {
    // The prune runs under the same lock: a restore never reads a file being deleted
    const { b, removed } = await exclusive(async () => {
      const b = await createBackup(app);
      return { b, removed: await pruneBackups(app, keep) };
    });
    dailyStatus.failure = null;
    await logEvent(app.db, {
      category: "schedule",
      level: "info",
      source: "Daily backup",
      event: "Daily backup saved",
      detail: `${b.name} (${formatSize(b.size)}, ${b.photos} photos)${removed.length ? `; removed ${removed.length} older: ${removed.join(", ")}` : ""}`,
    });
    return b.name;
  } catch (err) {
    if (err instanceof HttpError && err.statusCode === 409) return null; // another one is running: next hour
    const message = (err as Error).message;
    // Logged when it starts failing or the reason changes, not every hour
    if (dailyStatus.failure !== message) await logEvent(app.db, { category: "schedule", level: "error", source: "Daily backup", event: "The daily backup failed", detail: message });
    dailyStatus.failure = message;
    return null;
  }
}

/** The last daily backup's failure (in memory: cleared by the next one that works). */
export const dailyStatus = { failure: null as string | null };

const STALE_MS = 36 * 60 * 60 * 1000;
// Nov 15, 2026, 3:00 AM (server local time, like the backups' names)
const whenText = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }).replace(/\s/g, " ");

/** What's wrong with the daily backup, for Settings › Data; null when nothing is. */
export async function backupProblem(app: FastifyInstance): Promise<string | null> {
  if (backupKeep() === 0) return null;
  if (dailyStatus.failure) return `The last backup failed: ${dailyStatus.failure}`;
  const newest = (await listBackups(app)).find((b) => !labelled(b.name));
  if (newest && app.now().getTime() - new Date(newest.createdAt).getTime() > STALE_MS) return `No backup has been saved since ${whenText(newest.createdAt)}.`;
  return null;
}

/** Checks when the server starts, then every hour (a server that was off at BACKUP_HOUR still gets its backup). */
// Closing the server waits for a check still running (a backup half written would be left behind, and its
// queries would run on against a database the server has let go of)
export function scheduleBackups(app: FastifyInstance) {
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<unknown> = Promise.resolve();
  const check = () => (running = dailyBackupCheck(app).catch(() => null));
  app.addHook("onReady", async () => {
    void check();
    timer = setInterval(() => void check(), CHECK_EVERY_MS);
    timer.unref();
  });
  app.addHook("onClose", async () => {
    clearInterval(timer);
    await waitOnClose(app, "daily backup", running);
  });
}

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
