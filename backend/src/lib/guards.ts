import type { FastifyRequest } from "fastify";
import { HttpError } from "./errors.js";

// The only way a route learns who is calling. Never take a user id from the body or query.
export function requireUser(req: FastifyRequest): number {
  if (!req.auth) throw new HttpError(401, "Not logged in");
  return req.auth.userId;
}

export function requireAdmin(req: FastifyRequest): number {
  const id = requireUser(req);
  if (!req.auth!.isAdmin) throw new HttpError(403, "Only an admin can do this");
  return id;
}

// Signed in on a device, not calling with a personal API key. lib/apiKeys.ts already keeps keys off every
// route that uses this; this is the second lock on the routes that manage keys.
export function requireSignedIn(req: FastifyRequest): number {
  const id = requireUser(req);
  if (req.auth!.keyId !== undefined) throw new HttpError(403, "Keys can't do that");
  return id;
}
