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
