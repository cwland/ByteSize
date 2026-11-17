// Photos (barcodes and nutrition labels): normalised with sharp, kept per person under
// <data dir>/uploads/<user_id>/<id>.jpg, served only to their owner, linked from the food saved
// with them. Photos never linked are deleted after 24 h (on start, then hourly).
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { and, eq, isNull, lt } from "drizzle-orm";
import sharp from "sharp";
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
import { uploads } from "../db/schema.js";
import { logEvent } from "./appLog.js";
import { normalizeBarcode } from "./barcode.js";
import { badRequest } from "./errors.js";

export const MAX_PHOTO_BYTES = 12 * 1024 * 1024; // each image as sent
export const MAX_PHOTOS = 2;
export const MAX_REQUEST_BYTES = 25 * 1024 * 1024;
const MAX_SIDE = 1600; // px, longest side of the kept copy
const MAX_INPUT_PIXELS = 60_000_000; // a 48 MP phone photo fits; a "decompression bomb" doesn't
const KEEP_UNLINKED_MS = 24 * 60 * 60 * 1000;
const CLEANUP_EVERY_MS = 60 * 60 * 1000;
export const NOT_A_PHOTO = "Use a JPEG or PNG photo";
export const PHOTO_UNAVAILABLE = "That photo isn't available";
// What sharp may read (HEIC isn't in sharp's prebuilt libvips: it fails to decode and gets NOT_A_PHOTO)
const READABLE = new Set(["jpeg", "png", "webp", "gif", "tiff", "heif"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const require = createRequire(import.meta.url);

/** zxing-wasm's bundled .wasm, read from node_modules (by default it would fetch it from a CDN). */
export function wasmBinary(kind: "reader" | "writer"): ArrayBuffer {
  const b = readFileSync(require.resolve(`zxing-wasm/${kind}/zxing_${kind}.wasm`));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

let readerReady = false;

/** The URL a food's photo is served at, from its stored path ("<user_id>/<id>.jpg"). */
export const photoUrl = (imagePath: string) => `/api/photos/${path.basename(imagePath, ".jpg")}`;

/** Upright (EXIF rotation applied), at most 1600 px on its longest side, JPEG, metadata (GPS...) dropped. Not an image → 400. */
export async function normalisePhoto(input: Buffer): Promise<Buffer> {
  try {
    const img = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS });
    const { format } = await img.metadata();
    if (!format || !READABLE.has(format)) throw new Error(`unsupported format ${format}`);
    return await img.rotate().resize(MAX_SIDE, MAX_SIDE, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  } catch {
    throw badRequest(NOT_A_PHOTO);
  }
}

/** UPC-E (8 digits) → its UPC-A form (12), the way food databases list it. */
export function expandUpcE(code: string): string | null {
  if (!/^[01]\d{7}$/.test(code)) return null;
  const [ns, d, check] = [code[0], code.slice(1, 7), code[7]];
  const last = d[5];
  let body: string;
  if (last <= "2") body = d.slice(0, 2) + last + "0000" + d.slice(2, 5);
  else if (last === "3") body = d.slice(0, 3) + "00000" + d.slice(3, 5);
  else if (last === "4") body = d.slice(0, 4) + "00000" + d[4];
  else body = d.slice(0, 5) + "0000" + last;
  return ns + body + check;
}

/** The first retail barcode (EAN-13/8, UPC-A/E) in a picture, normalised; null when there's none. */
export async function decodeBarcode(jpeg: Buffer): Promise<string | null> {
  if (!readerReady) {
    prepareZXingModule({ overrides: { wasmBinary: wasmBinary("reader") } });
    readerReady = true;
  }
  try {
    const found = await readBarcodes(new Uint8Array(jpeg), { formats: ["EAN13", "EAN8", "UPCA", "UPCE"], tryHarder: true, maxNumberOfSymbols: 1 });
    for (const r of found) {
      if (!r.isValid) continue;
      const code = normalizeBarcode(r.format === "UPCE" ? (expandUpcE(r.text) ?? r.text) : r.text);
      if (code) return code;
    }
  } catch {
    // an unreadable picture just has no barcode
  }
  return null;
}

const absolute = (app: FastifyInstance, rel: string) => path.join(app.dataDir, "uploads", rel);

/** Keeps a normalised photo for a person; returns its id. */
export async function storePhoto(app: FastifyInstance, userId: number, jpeg: Buffer): Promise<{ id: string; path: string }> {
  const id = randomUUID();
  const rel = `${userId}/${id}.jpg`;
  await mkdir(path.dirname(absolute(app, rel)), { recursive: true });
  await writeFile(absolute(app, rel), jpeg);
  await app.db.insert(uploads).values({ id, userId, path: rel, createdAt: app.now() });
  return { id, path: rel };
}

/** A person's own photo as JPEG bytes; null for anyone else's, a made-up id or a missing file. */
export async function readPhoto(app: FastifyInstance, userId: number, id: string): Promise<Buffer | null> {
  if (!UUID.test(id)) return null;
  const [row] = await app.db.select().from(uploads).where(and(eq(uploads.id, id), eq(uploads.userId, userId)));
  if (!row) return null;
  try {
    return await readFile(absolute(app, row.path));
  } catch {
    return null;
  }
}

/**
 * The stored path of a photo a food may be saved with: the person's own, and not yet linked
 * (or already this food's photo, currentPath). Anything else → 400.
 */
export async function photoForFood(app: FastifyInstance, userId: number, id: string, currentPath: string | null): Promise<string> {
  const [row] = UUID.test(id) ? await app.db.select().from(uploads).where(and(eq(uploads.id, id), eq(uploads.userId, userId))) : [];
  if (!row || (row.linkedAt && row.path !== currentPath)) throw badRequest(PHOTO_UNAVAILABLE);
  return row.path;
}

/** Marks a photo as used by a food: it's kept from now on. */
export async function linkPhoto(app: FastifyInstance, userId: number, id: string) {
  await app.db.update(uploads).set({ linkedAt: app.now() }).where(and(eq(uploads.id, id), eq(uploads.userId, userId), isNull(uploads.linkedAt)));
}

/** Deletes photos no food was saved with, 24 h after upload (file and row). Returns how many. */
export async function cleanupUploads(app: FastifyInstance): Promise<number> {
  const cutoff = new Date(app.now().getTime() - KEEP_UNLINKED_MS);
  const old = await app.db.select().from(uploads).where(and(isNull(uploads.linkedAt), lt(uploads.createdAt, cutoff)));
  let deleted = 0;
  for (const row of old) {
    // The row first (unless a food was saved with it just now), then its file
    const gone = await app.db.delete(uploads).where(and(eq(uploads.id, row.id), isNull(uploads.linkedAt))).returning({ id: uploads.id });
    if (!gone.length) continue;
    deleted++;
    try {
      await unlink(absolute(app, row.path));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        await logEvent(app.db, { category: "schedule", level: "warning", source: "Photo cleanup", event: "An unused photo's file couldn't be deleted", detail: `${row.path}: ${(err as Error).message}` });
      }
    }
  }
  if (deleted) await logEvent(app.db, { category: "schedule", level: "info", source: "Photo cleanup", event: `Deleted ${deleted} unused photo${deleted === 1 ? "" : "s"}`, detail: "Photos no food was saved with, after 24 hours" });
  return deleted;
}

/** Runs the cleanup when the server starts, then every hour (never stops the server). */
export function scheduleUploadCleanup(app: FastifyInstance) {
  const run = () =>
    cleanupUploads(app).catch((err) =>
      logEvent(app.db, { category: "schedule", level: "error", source: "Photo cleanup", event: "The photo cleanup failed", detail: (err as Error).message })
    );
  let timer: NodeJS.Timeout | undefined;
  app.addHook("onReady", async () => {
    void run();
    timer = setInterval(run, CLEANUP_EVERY_MS);
    timer.unref();
  });
  app.addHook("onClose", async () => clearInterval(timer));
}
