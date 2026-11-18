import { randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance, FastifyRequest } from "fastify";
import multipart from "@fastify/multipart";
import { z } from "zod";
import { logEvent } from "../lib/appLog.js";
import { backupFile, backupKeep, backupsDir, deleteBackup, formatSize, listBackups, restoreBackup, unreadableKeys, whoIs, writeBackup } from "../lib/backup.js";
import { HttpError, badRequest } from "../lib/errors.js";
import { requireAdmin } from "../lib/guards.js";

const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024; // 1 GB
const CONFIRM = "Type RESTORE to confirm.";
const NO_SUCH_BACKUP = "That backup wasn't found. Pick one from the list.";
const UPLOAD_TOO_LARGE = "That file is larger than 1 GB. Restore it from the backups folder instead.";
const UNREADABLE_UPLOAD = "That upload couldn't be read. Try choosing the file again.";

/** The uploaded backup, streamed to a temp file in the backups folder (never held in memory), and the confirm field. */
async function receiveUpload(app: FastifyInstance, req: FastifyRequest): Promise<{ file: string; filename: string; confirm: string }> {
  await mkdir(backupsDir(app), { recursive: true });
  const file = path.join(backupsDir(app), `.upload-${randomBytes(8).toString("hex")}.tmp`);
  let confirm = "";
  let filename = "";
  try {
    for await (const part of req.parts()) {
      if (part.type === "file") {
        if (part.fieldname !== "file" || filename) {
          part.file.resume(); // not ours: skipped
          continue;
        }
        await pipeline(part.file, createWriteStream(file));
        if (part.file.truncated) throw new HttpError(413, UPLOAD_TOO_LARGE);
        filename = part.filename || "uploaded file";
      } else if (part.fieldname === "confirm") {
        confirm = String(part.value);
      }
    }
  } catch (err) {
    await rm(file, { force: true });
    if (err instanceof HttpError) throw err;
    if ((err as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") throw new HttpError(413, UPLOAD_TOO_LARGE);
    throw badRequest(UNREADABLE_UPLOAD);
  }
  if (!filename) {
    await rm(file, { force: true });
    throw badRequest("Choose a backup file to restore.");
  }
  return { file, filename, confirm };
}

// Admin: whole-server backups (list, make, download, delete, restore). Every change goes to the activity log.
export default async function backupRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 2, fieldSize: 100, parts: 3, headerPairs: 50 } });

  const nameParam = (req: FastifyRequest) => (req.params as { name: string }).name;

  app.get("/api/admin/backups", async (req) => {
    requireAdmin(req);
    return { backups: await listBackups(app), keep: backupKeep(), unreadableKeys: await unreadableKeys(app) };
  });

  app.post("/api/admin/backups", async (req) => {
    const userId = requireAdmin(req);
    const b = await writeBackup(app);
    await logEvent(app.db, { category: "api", level: "info", source: "Backups", event: "Backup made", detail: `${b.name} (${formatSize(b.size)}, ${b.photos} photos) by ${await whoIs(app, userId)}`, userId });
    return { backup: { name: b.name, size: b.size, createdAt: b.createdAt } };
  });

  app.get("/api/admin/backups/:name", async (req, reply) => {
    requireAdmin(req);
    const name = nameParam(req);
    const file = await backupFile(app, name);
    if (!file) throw new HttpError(404, NO_SUCH_BACKUP);
    return reply.type("application/gzip").header("content-disposition", `attachment; filename="${name}"`).send(createReadStream(file));
  });

  app.delete("/api/admin/backups/:name", async (req) => {
    const userId = requireAdmin(req);
    const name = nameParam(req);
    if (!(await deleteBackup(app, name))) throw new HttpError(404, NO_SUCH_BACKUP);
    await logEvent(app.db, { category: "api", level: "info", source: "Backups", event: "Backup deleted", detail: `${name} by ${await whoIs(app, userId)}`, userId });
    return { ok: true };
  });

  // Replaces everything on the server: a backup from the list ({ name, confirm }) or an uploaded file (file, confirm)
  app.post("/api/admin/backups/restore", async (req) => {
    const userId = requireAdmin(req);
    let upload: Awaited<ReturnType<typeof receiveUpload>> | null = null;
    try {
      let file: string | null;
      let from: string;
      if (req.isMultipart()) {
        upload = await receiveUpload(app, req);
        if (upload.confirm !== "RESTORE") throw badRequest(CONFIRM);
        file = upload.file;
        from = `the uploaded file ${upload.filename}`;
      } else {
        const body = z.object({ name: z.unknown().optional(), confirm: z.unknown().optional() }).parse(req.body ?? {});
        if (body.confirm !== "RESTORE") throw badRequest(CONFIRM);
        file = await backupFile(app, body.name);
        if (!file) throw badRequest(NO_SUCH_BACKUP);
        from = String(body.name);
      }
      const restored = await restoreBackup(app, file, { userId, from });
      return { restored, unreadableKeys: await unreadableKeys(app) };
    } finally {
      if (upload) await rm(upload.file, { force: true });
    }
  });
}
