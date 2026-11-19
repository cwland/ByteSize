import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import { users } from "../db/schema.js";
import { logEvent } from "./appLog.js";
import { HttpError } from "./errors.js";
import { decryptSecret } from "./secrets.js";

// Settings › Integrations: the eye and copy buttons fetch one saved key at a time. A saved key is never
// sent with a page or a list, only from these routes, to the person who may see it. Each fetch is logged
// (who, which key — never the key), rate-limited, and never cached.

export const UNREADABLE_KEY = "This key can't be read. Enter it again.";

// 30 a minute per person on each route; tests without rate limits ignore this
export const revealRateLimit = {
  rateLimit: { max: 30, timeWindow: 60_000, keyGenerator: (req: FastifyRequest) => `${req.routeOptions.url}|${req.auth?.userId ?? req.ip}` },
};

/** A stored secret opened: undefined = none saved, null = saved but can't be read (JWT_SECRET changed). */
export function openSaved(enc: string | null | undefined, secret: string): string | null | undefined {
  return enc ? decryptSecret(enc, secret) : undefined;
}

/**
 * Answers with the saved key(s): 404 when none is saved, 409 when it can't be read.
 * what: the key in plain words for the activity log ("USDA key").
 */
export async function sendSavedKey(
  app: FastifyInstance,
  reply: FastifyReply,
  userId: number,
  what: string,
  value: Record<string, string | null | undefined>,
  log: { source: string; event: string; unreadable?: string } = { source: "Settings › Integrations", event: "Saved key shown" }
) {
  reply.header("cache-control", "no-store"); // the 404 and 409 answers too
  const parts = Object.values(value);
  if (parts.some((v) => v === undefined)) throw new HttpError(404, "No key is saved");
  if (parts.some((v) => v === null)) throw new HttpError(409, log.unreadable ?? UNREADABLE_KEY);
  const [who] = await app.db.select({ username: users.username }).from(users).where(eq(users.id, userId));
  await logEvent(app.db, { category: "api", level: "info", source: log.source, event: log.event, detail: `${what}, shown to ${who?.username ?? `user ${userId}`}`, userId });
  return reply.send(value);
}
