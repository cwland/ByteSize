// Photos (barcodes and nutrition labels): normalised with sharp, kept per person under
// <data dir>/uploads/<user_id>/<id>.jpg, served only to their owner, linked from the food saved
// with them. Photos never linked are deleted after 24 h (on start, then hourly).
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { and, eq, inArray, isNull, lt } from "drizzle-orm";
import sharp from "sharp";
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
import type { Db } from "../db/index.js";
import { uploads, users } from "../db/schema.js";
import { scheduleHooks, waitOnClose } from "./schedule.js";
import { logEvent } from "./appLog.js";
import { normalizeBarcode } from "./barcode.js";
import { HttpError, badRequest } from "./errors.js";

export const MAX_PHOTO_BYTES = 12 * 1024 * 1024; // each image as sent
export const MAX_PHOTOS = 2;
export const MAX_REQUEST_BYTES = 25 * 1024 * 1024;
const MAX_SIDE = 1600; // px, longest side of the kept copy
const MAX_INPUT_PIXELS = 60_000_000; // a 48 MP phone photo fits; a "decompression bomb" doesn't
const KEEP_UNLINKED_MS = 24 * 60 * 60 * 1000;
const CLEANUP_EVERY_MS = 60 * 60 * 1000;
export const NOT_A_PHOTO = "Use a JPEG or PNG photo";
export const PHOTO_TOO_LARGE = "That photo is too large. Try a smaller one.";
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

let readerReady = false; // set only once the decoder has loaded
let readerProblemLogged = false; // the decoder's first load or read failure is logged, once

/** Where a photo problem is logged (Settings › Logs, category food), and whose upload it was. */
export type PhotoLog = { db: Db; userId?: number | null };

/** The URL a food's photo is stored as (unsigned), from its stored path ("<user_id>/<id>.jpg"). */
export const photoUrl = (imagePath: string) => `/api/photos/${path.basename(imagePath, ".jpg")}`;

// Signed photo URLs: an <img> can't send the login token, so each URL handed out carries
// sig = HMAC-SHA256(photo id) under a key derived from the server's secret. Only the plain form is
// stored (foods, log entries); it is signed on the way out.
let signingKey: Buffer | null = null;
const SIG_LENGTH = 22; // base64url characters (132 bits)
const PHOTO_PATH = /^\/api\/photos\/([0-9a-f-]{36})(?:\?.*)?$/i;

/** Set once from the server's secret (the one that signs login tokens). */
export function setPhotoSecret(secret: string) {
  signingKey = createHmac("sha256", secret).update("bytesize photo urls").digest();
}

export function photoSig(id: string): string {
  if (!signingKey) throw new Error("Photo signing key isn't set");
  return createHmac("sha256", signingKey).update(id.toLowerCase()).digest("base64url").slice(0, SIG_LENGTH);
}

/** Whether sig is this photo's signature (timing-safe). */
export function validPhotoSig(id: string, sig: unknown): boolean {
  if (typeof sig !== "string" || sig.length !== SIG_LENGTH || !UUID.test(id)) return false;
  return timingSafeEqual(Buffer.from(sig), Buffer.from(photoSig(id)));
}

/** An image URL as handed out: our photos signed, anything else (Open Food Facts...) as it is. */
export function signImageUrl(url: string | null): string | null {
  const m = url ? PHOTO_PATH.exec(url) : null;
  return m ? `/api/photos/${m[1]}?sig=${photoSig(m[1])}` : url;
}

/** An image URL as stored: our photos without a signature. */
export function unsignImageUrl(url: string | null): string | null {
  const m = url ? PHOTO_PATH.exec(url) : null;
  return m ? `/api/photos/${m[1]}` : url;
}

/** Upright (EXIF rotation applied), at most 1600 px on its longest side, JPEG, metadata (GPS...) dropped. Not an image → 400. */
export async function normalisePhoto(input: Buffer, log?: PhotoLog): Promise<Buffer> {
  let meta: sharp.Metadata;
  try {
    meta = await sharp(input, { limitInputPixels: false }).metadata(); // the header only
  } catch {
    throw badRequest(NOT_A_PHOTO); // not an image sharp knows
  }
  if (!meta.format || !READABLE.has(meta.format)) throw badRequest(NOT_A_PHOTO);
  if ((meta.width ?? 0) * (meta.height ?? 0) > MAX_INPUT_PIXELS) throw new HttpError(413, PHOTO_TOO_LARGE);
  try {
    return await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).rotate().resize(MAX_SIDE, MAX_SIDE, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    if (/pixel limit/i.test(message)) throw new HttpError(413, PHOTO_TOO_LARGE);
    // Anything else: the picture's data couldn't be converted (cut short, corrupt, a codec sharp lacks
    // such as HEIC...). The person is told plainly; the cause is kept in the log.
    if (log) await logEvent(log.db, { category: "food", level: "warning", source: "Photo upload", event: "A photo couldn't be converted", detail: `${meta.format} ${meta.width ?? "?"}×${meta.height ?? "?"}: ${message}`, userId: log.userId ?? null });
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

async function logReaderProblem(log: PhotoLog | undefined, level: "warning" | "error", event: string, err: unknown) {
  if (readerProblemLogged || !log) return;
  readerProblemLogged = true;
  await logEvent(log.db, { category: "food", level, source: "Barcode reader", event, detail: (err as Error)?.message ?? String(err), userId: log.userId ?? null });
}

/** The first retail barcode (EAN-13/8, UPC-A/E) in a picture, normalised; null when there's none. */
export async function decodeBarcode(jpeg: Buffer, log?: PhotoLog): Promise<string | null> {
  if (!readerReady) {
    try {
      await prepareZXingModule({ overrides: { wasmBinary: wasmBinary("reader") }, fireImmediately: true });
      readerReady = true;
    } catch (err) {
      // Without the decoder no photo has a barcode: logged so that has a visible cause; tried again next time
      await logReaderProblem(log, "error", "The barcode reader couldn't start", err);
      return null;
    }
  }
  try {
    const found = await readBarcodes(new Uint8Array(jpeg), { formats: ["EAN13", "EAN8", "UPCA", "UPCE"], tryHarder: true, maxNumberOfSymbols: 1 });
    for (const r of found) {
      if (!r.isValid) continue;
      const code = normalizeBarcode(r.format === "UPCE" ? (expandUpcE(r.text) ?? r.text) : r.text);
      if (code) return code;
    }
  } catch (err) {
    // an unreadable picture just has no barcode (the first such failure is logged)
    await logReaderProblem(log, "warning", "The barcode reader couldn't read a photo", err);
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

/**
 * A photo as JPEG bytes, for its owner (userId) or for a request carrying the photo's signature
 * (an <img>); null for anyone else, a made-up id or a missing file.
 */
export async function readPhoto(app: FastifyInstance, who: { userId: number | null; sig?: unknown }, id: string): Promise<Buffer | null> {
  if (!UUID.test(id)) return null;
  const signed = validPhotoSig(id, who.sig);
  if (!signed && who.userId === null) return null;
  const [row] = await app.db.select().from(uploads).where(and(eq(uploads.id, id), signed ? undefined : eq(uploads.userId, who.userId!)));
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
  await removeDeletedUsersFiles(app);
  if (deleted) await logEvent(app.db, { category: "schedule", level: "info", source: "Photo cleanup", event: `Deleted ${deleted} unused photo${deleted === 1 ? "" : "s"}`, detail: "Photos no food was saved with, after 24 hours" });
  return deleted;
}

/** A person's whole photo folder (when they are deleted). */
export async function deleteUserPhotos(app: FastifyInstance, userId: number) {
  await rm(path.join(app.dataDir, "uploads", String(userId)), { recursive: true, force: true });
}

/** Photo folders of people who no longer exist (their rows went by cascade): removed. */
async function removeDeletedUsersFiles(app: FastifyInstance) {
  let names: string[];
  try {
    names = (await readdir(path.join(app.dataDir, "uploads"), { withFileTypes: true })).filter((d) => d.isDirectory() && /^\d+$/.test(d.name)).map((d) => d.name);
  } catch {
    return; // no uploads yet
  }
  const ids = names.map(Number).filter((n) => n <= 2147483647);
  if (!ids.length) return;
  const alive = new Set((await app.db.select({ id: users.id }).from(users).where(inArray(users.id, ids))).map((u) => u.id));
  for (const id of ids) if (!alive.has(id)) await deleteUserPhotos(app, id);
}

/** Runs the cleanup when the server starts, then every hour (never stops the server). */
export function scheduleUploadCleanup(app: FastifyInstance) {
  const run = () =>
    scheduleHooks
      .photoCleanupStarted()
      .then(() => cleanupUploads(app))
      .catch((err) =>
      logEvent(app.db, { category: "schedule", level: "error", source: "Photo cleanup", event: "The photo cleanup failed", detail: (err as Error).message })
    );
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<unknown> = Promise.resolve();
  const start = () => (running = run());
  app.addHook("onReady", async () => {
    void start(); // in the background: starting the server never waits for it (the health check's start period)
    timer = setInterval(start, CLEANUP_EVERY_MS);
    timer.unref();
  });
  // Closing waits for a run still going (nothing runs on against a database the server has let go of)
  app.addHook("onClose", async () => {
    clearInterval(timer);
    await waitOnClose(app, "photo cleanup", running);
  });
}
