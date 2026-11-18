import type { FastifyInstance, FastifyRequest } from "fastify";
import multipart from "@fastify/multipart";
import { z } from "zod";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { users, weighIns } from "../db/schema.js";
import { requireUser } from "../lib/guards.js";
import { HttpError, badRequest } from "../lib/errors.js";
import { todayFor } from "../lib/days.js";
import { logEvent } from "../lib/appLog.js";
import { CsvError, decodeCsv, readWeightCsv, type CsvWeighIn, type WeightCsv } from "../lib/weightCsv.js";
import { latestWeighIn, syncBodyWeight, type DbOrTx } from "./weight.js";

// Settings › Data › Import weight history (design §19): a CSV from another app, previewed, then added to the
// caller's own weigh-ins in one transaction. Who is asking comes only from the login. The file is never kept.

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const TOO_BIG = "The file must be 5 MB or less.";
const NO_FILE = "Choose a CSV file.";
const UNREADABLE = "That upload couldn't be read.";
const NOTHING = "No weigh-ins could be read from that file.";
const PREVIEW_PROBLEMS = 5;
const PREVIEW_ROWS = 10;
const CHUNK = 1000; // rows per insert

const column = z.coerce.number({ error: "Choose a column" }).int().min(0).max(10_000);
const optionsSchema = z.object({
  dateColumn: column.optional(),
  weightColumn: column.optional(),
  units: z.enum(["lb", "kg"], { error: "Choose lb or kg" }).optional(),
  dateFormat: z.enum(["mdy", "dmy"], { error: "Choose Month/Day/Year or Day/Month/Year" }).optional(),
  existing: z.enum(["keep", "replace"], { error: "Choose keep or replace" }).default("keep"),
});
type Options = z.infer<typeof optionsSchema>;

// 10 a minute per person, each route counted on its own; tests without rate limits ignore this
const rateLimit = {
  rateLimit: { max: 10, timeWindow: 60_000, keyGenerator: (req: FastifyRequest) => `weight-import|${req.routeOptions.url}|${req.auth?.userId ?? req.ip}` },
};

/** The uploaded file and the chosen options (empty ones left out). */
async function readUpload(req: FastifyRequest): Promise<{ file: Buffer; options: Options }> {
  if (!req.isMultipart()) throw badRequest(NO_FILE);
  let file: Buffer | null = null;
  const fields: Record<string, string> = {};
  try {
    for await (const part of req.parts()) {
      if (part.type === "file") {
        if (part.fieldname !== "file" || file) {
          part.file.resume(); // not ours: skipped
          continue;
        }
        file = await part.toBuffer();
      } else if (String(part.value) !== "") {
        fields[part.fieldname] = String(part.value);
      }
    }
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "FST_REQ_FILE_TOO_LARGE") throw new HttpError(413, TOO_BIG);
    if (code === "FST_PARTS_LIMIT" || code === "FST_FIELDS_LIMIT" || code === "FST_FILES_LIMIT") throw badRequest("That upload has too many parts.");
    throw badRequest(UNREADABLE);
  }
  if (!file) throw badRequest(NO_FILE);
  return { file, options: optionsSchema.parse(fields) };
}

async function readFor(app: FastifyInstance, userId: number, file: Buffer, o: Options): Promise<WeightCsv> {
  const [user] = await app.db.select({ units: users.units }).from(users).where(eq(users.id, userId));
  try {
    return readWeightCsv(decodeCsv(file), { ...o, defaultUnits: user?.units === "metric" ? "kg" : "lb", today: await todayFor(app, userId) });
  } catch (err) {
    if (err instanceof CsvError) throw badRequest(err.message);
    throw err;
  }
}

const rangeOf = (rows: CsvWeighIn[]) => {
  const days = rows.map((w) => w.day).sort();
  return { from: days[0] ?? null, to: days[days.length - 1] ?? null };
};

/** The days of these weigh-ins that already have one in the person's history */
async function existingDays(db: DbOrTx, userId: number, rows: CsvWeighIn[]): Promise<Set<string>> {
  const { from, to } = rangeOf(rows);
  if (!from || !to) return new Set();
  const wanted = new Set(rows.map((w) => w.day));
  const there = await db
    .select({ day: weighIns.day })
    .from(weighIns)
    .where(and(eq(weighIns.userId, userId), gte(weighIns.day, from), lte(weighIns.day, to)));
  return new Set(there.map((r) => r.day).filter((d) => wanted.has(d)));
}

// "2025-01-03" -> "Jan 3, 2025"
const longDay = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default async function weightImportRoutes(app: FastifyInstance) {
  const { db } = app;
  await app.register(multipart, { limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 6, fieldSize: 100, parts: 7, headerPairs: 50 } });

  // What the file holds and what would be saved; nothing is saved
  app.post("/api/weight/import/preview", { config: rateLimit }, async (req) => {
    const userId = requireUser(req);
    const { file, options } = await readUpload(req);
    const read = await readFor(app, userId, file, options);
    const { columns, dateColumn, weightColumn, units, dateFormat, dateFormatMatters, weighIns: rows, problems } = read;
    return {
      columns,
      dateColumn,
      weightColumn,
      units,
      dateFormat,
      dateFormatMatters,
      count: rows.length,
      ...rangeOf(rows),
      existingDays: (await existingDays(db, userId, rows)).size,
      unreadable: problems.length,
      problems: problems.slice(0, PREVIEW_PROBLEMS),
      rows: rows.slice(0, PREVIEW_ROWS).map((w) => ({ day: w.day, weightKg: w.weightKg })),
    };
  });

  // The same file and the chosen options: every weigh-in saved, or none
  app.post("/api/weight/import", { config: rateLimit }, async (req) => {
    const userId = requireUser(req);
    const { file, options } = await readUpload(req);
    const read = await readFor(app, userId, file, options);
    if (!read.weighIns.length) throw badRequest(NOTHING);
    const replace = options.existing === "replace";
    const now = app.now();

    const result = await db.transaction(async (tx) => {
      const existing = await existingDays(tx, userId, read.weighIns);
      const rows = replace ? read.weighIns : read.weighIns.filter((w) => !existing.has(w.day));
      for (let i = 0; i < rows.length; i += CHUNK) {
        const insert = tx.insert(weighIns).values(rows.slice(i, i + CHUNK).map((w) => ({ userId, day: w.day, weightKg: w.weightKg, note: w.note })));
        // Replacing: the file's weight, and its note only when the file has notes (else the day keeps its note)
        const set = read.noteColumn === null ? { weightKg: sql`excluded.weight_kg` } : { weightKg: sql`excluded.weight_kg`, note: sql`excluded.note` };
        await (replace ? insert.onConflictDoUpdate({ target: [weighIns.userId, weighIns.day], set }) : insert.onConflictDoNothing());
      }
      // The body weight follows the latest weigh-in; an older history leaves it alone
      const latest = await latestWeighIn(tx, userId);
      if (latest && rows.some((w) => w.day === latest.day)) await syncBodyWeight(tx, userId, now);
      return { imported: rows.length, kept: replace ? 0 : existing.size, replaced: replace ? existing.size : 0, ...rangeOf(read.weighIns) };
    });

    const [who] = await db.select({ username: users.username }).from(users).where(eq(users.id, userId));
    await logEvent(db, {
      category: "api",
      level: "info",
      source: "Weight import",
      event: `Imported ${plural(result.imported, "weigh-in")}`,
      detail: `${longDay(result.from!)} to ${longDay(result.to!)}; ${plural(replace ? result.replaced : result.kept, "day")} already in ByteSize ${replace ? "replaced" : "kept"}; ${plural(read.problems.length, "row")} skipped; by ${who?.username ?? `user ${userId}`}`,
      userId,
    });
    return result;
  });
}
