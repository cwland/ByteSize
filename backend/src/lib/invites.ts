// Invite links (§36) that can never be used again: expired ones, and any left for someone who has a password now
// (accepting or an admin's Set password already removes the link; this catches the rest). The invited person
// stays (listed as Invited, with Resend). Part of the hourly cleanup (lookups.ts runCleanups).
import type { FastifyInstance } from "fastify";
import { inArray, isNotNull, lte, or } from "drizzle-orm";
import { invites, users } from "../db/schema.js";
import { logEvent } from "./appLog.js";

export async function cleanupInvites(app: FastifyInstance): Promise<number> {
  const withPassword = app.db.select({ id: users.id }).from(users).where(isNotNull(users.passwordHash));
  const gone = await app.db
    .delete(invites)
    .where(or(lte(invites.expiresAt, app.now()), inArray(invites.userId, withPassword)))
    .returning({ id: invites.id });
  if (gone.length) {
    await logEvent(app.db, { category: "schedule", level: "info", source: "Invite cleanup", event: `Removed ${gone.length} old invite link${gone.length === 1 ? "" : "s"}`, detail: "Expired or already used" });
  }
  return gone.length;
}
