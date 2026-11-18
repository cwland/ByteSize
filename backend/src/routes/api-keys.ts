import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, asc, count, eq } from "drizzle-orm";
import { apiKeys, users } from "../db/schema.js";
import { KEY_ACCESS, KEY_ACCESS_LABELS, MAX_KEYS, TOO_MANY_KEYS, UNREADABLE_API_KEY, generateApiKey } from "../lib/apiKeys.js";
import { logEvent } from "../lib/appLog.js";
import { HttpError } from "../lib/errors.js";
import { requireSignedIn } from "../lib/guards.js";
import { encryptSecret } from "../lib/secrets.js";
import { openSaved, revealRateLimit, sendSavedKey } from "../lib/savedKeys.js";

// Settings › API keys (everyone): a person's own keys. The key is in the answer when it's made and from the
// eye route (the owner only); never in a list. Only a person signed in on a device manages keys: no key can
// reach these routes (lib/apiKeys.ts), and requireSignedIn checks again.

const name = z.string({ error: "Give the key a name" }).trim().min(1, "Give the key a name").max(60, "Keep the name to 60 characters");
const access = z.enum(KEY_ACCESS, { error: "Choose Read only or Read and log" });
const idParam = z.object({ id: z.coerce.number().int().positive().max(2147483647) });
const NOT_FOUND = "API key not found";

const listed = { id: apiKeys.id, name: apiKeys.name, prefix: apiKeys.prefix, access: apiKeys.access, createdAt: apiKeys.createdAt, lastUsedAt: apiKeys.lastUsedAt };
const describe = (k: { name: string; prefix: string; access: "read" | "log" }) => `"${k.name}" (${k.prefix}…, ${KEY_ACCESS_LABELS[k.access]})`;

export default async function apiKeyRoutes(app: FastifyInstance) {
  const { db } = app;
  const note = (userId: number, event: string, detail: string) => logEvent(db, { category: "api", level: "info", source: "Settings › API keys", event, detail, userId });

  app.get("/api/keys", async (req) => {
    const userId = requireSignedIn(req);
    return { keys: await db.select(listed).from(apiKeys).where(eq(apiKeys.userId, userId)).orderBy(asc(apiKeys.id)) };
  });

  app.post("/api/keys", async (req, reply) => {
    const userId = requireSignedIn(req);
    const body = z.object({ name, access: access.default("read") }).parse(req.body ?? {});
    const { key, prefix, hash } = generateApiKey();
    const row = await db.transaction(async (tx) => {
      // One at a time per person, so two at once can't both be the 20th
      await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
      const [{ n }] = await tx.select({ n: count() }).from(apiKeys).where(eq(apiKeys.userId, userId));
      if (n >= MAX_KEYS) throw new HttpError(409, TOO_MANY_KEYS);
      const [made] = await tx
        .insert(apiKeys)
        .values({ userId, name: body.name, prefix, keyHash: hash, keyEnc: encryptSecret(key, app.jwtSecret), access: body.access, createdAt: app.now() })
        .returning(listed);
      return made;
    });
    await note(userId, "API key made", describe(row));
    return reply.status(201).header("cache-control", "no-store").send({ ...row, key });
  });

  // Rename and/or change access (the key itself stays the same)
  app.patch("/api/keys/:id", async (req) => {
    const userId = requireSignedIn(req);
    const { id } = idParam.parse(req.params);
    const body = z.object({ name: name.optional(), access: access.optional() }).parse(req.body ?? {});
    const [row] = await db
      .update(apiKeys)
      .set({ ...(body.name !== undefined ? { name: body.name } : {}), ...(body.access ? { access: body.access } : {}) })
      .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)))
      .returning(listed);
    if (!row) throw new HttpError(404, NOT_FOUND);
    await note(userId, "API key changed", describe(row));
    return { key: row };
  });

  // Takes effect at once: the next call with it gets 401
  app.delete("/api/keys/:id", async (req, reply) => {
    const userId = requireSignedIn(req);
    const { id } = idParam.parse(req.params);
    const [gone] = await db.delete(apiKeys).where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId))).returning(listed);
    if (!gone) throw new HttpError(404, NOT_FOUND);
    await note(userId, "API key deleted", describe(gone));
    return reply.status(204).send();
  });

  // The eye and copy: the owner's own key, one at a time (logged without the key, rate-limited, never cached)
  app.get("/api/keys/:id/key", { config: revealRateLimit }, async (req, reply) => {
    const userId = requireSignedIn(req);
    const { id } = idParam.parse(req.params);
    const [row] = await db.select().from(apiKeys).where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)));
    if (!row) {
      reply.header("cache-control", "no-store");
      throw new HttpError(404, NOT_FOUND);
    }
    return sendSavedKey(app, reply, userId, `API key ${describe(row)}`, { key: openSaved(row.keyEnc, app.jwtSecret) }, { source: "Settings › API keys", event: "API key shown", unreadable: UNREADABLE_API_KEY });
  });
}
