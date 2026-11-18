import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, asc, eq, isNotNull, max, ne, sql } from "drizzle-orm";
import { invites, sessions, users } from "../db/schema.js";
import { hashPassword } from "../lib/auth.js";
import { revokeAll } from "../lib/sessions.js";
import { HttpError, notFound } from "../lib/errors.js";
import { requireAdmin } from "../lib/guards.js";
import { normalizeUsername, publicUser } from "../lib/users.js";

export const password = z.string().min(8, "Password must be at least 8 characters").max(200);
export const email = z.string().trim().email("That doesn't look like an email address").max(200);
export const usernameField = z.string().trim().min(1, "Enter a username").max(100);
export const USERNAME_TAKEN = "That username is taken";

// Postgres unique_violation (drizzle may wrap the driver's error in .cause)
export const isUniqueViolation = (err: unknown): boolean =>
  !!err && typeof err === "object" && ((err as { code?: unknown }).code === "23505" || isUniqueViolation((err as { cause?: unknown }).cause));

// invited: added by Invite by email and hasn't accepted yet (no password); inviteSentAt: when the link went out
// (null for someone invited before a restore: backups skip invites, so Resend sends a new one)
export const adminRow = (u: typeof users.$inferSelect, lastSeenAt: Date | null, invite: { sentAt: Date } | null = null) => ({
  ...publicUser(u),
  disabled: u.disabled,
  createdAt: u.createdAt,
  lastSeenAt,
  invited: !u.passwordHash,
  inviteSentAt: !u.passwordHash ? (invite?.sentAt ?? null) : null,
});

/** A person as Settings › Users lists them. */
export async function adminRowFor(db: FastifyInstance["db"], id: number) {
  const [u] = await db.select().from(users).where(eq(users.id, id));
  if (!u) throw notFound("User");
  const [seen] = await db.select({ at: max(sessions.lastSeenAt) }).from(sessions).where(eq(sessions.userId, id));
  const [invite] = await db.select({ sentAt: invites.sentAt }).from(invites).where(eq(invites.userId, id));
  return adminRow(u, seen?.at ?? null, invite ?? null);
}

// Settings › Users: the admin adds people (there is no sign-up page) and turns accounts off.
export default async function adminUserRoutes(app: FastifyInstance) {
  const { db } = app;

  const getRow = (id: number) => adminRowFor(db, id);

  app.get("/api/admin/users", async (req) => {
    requireAdmin(req);
    const rows = await db
      .select({ user: users, lastSeenAt: max(sessions.lastSeenAt), inviteSentAt: invites.sentAt })
      .from(users)
      .leftJoin(sessions, eq(sessions.userId, users.id))
      .leftJoin(invites, eq(invites.userId, users.id))
      .groupBy(users.id, invites.id)
      .orderBy(asc(users.id));
    return { users: rows.map((r) => adminRow(r.user, r.lastSeenAt, r.inviteSentAt ? { sentAt: r.inviteSentAt } : null)) };
  });

  app.post("/api/admin/users", async (req) => {
    requireAdmin(req);
    const body = z
      .object({
        username: usernameField,
        password,
        displayName: z.string().trim().max(100).optional(),
        email: email.optional(),
        isAdmin: z.boolean().default(false),
      })
      .parse(req.body);
    const username = normalizeUsername(body.username);
    const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.username, username));
    if (taken) throw new HttpError(409, "That username is taken");
    const passwordHash = await hashPassword(body.password);
    let u: typeof users.$inferSelect;
    try {
      [u] = await db
        .insert(users)
        .values({ username, passwordHash, displayName: body.displayName || null, email: body.email ?? null, isAdmin: body.isAdmin })
        .returning();
    } catch (err) {
      // Someone else took the name between the check above and this insert
      if (isUniqueViolation(err)) throw new HttpError(409, "That username is taken");
      throw err;
    }
    return { user: adminRow(u, null) };
  });

  app.patch("/api/admin/users/:id", async (req) => {
    requireAdmin(req);
    const id = z.coerce.number().int().positive().parse((req.params as { id: string }).id);
    const body = z
      .object({
        displayName: z.string().trim().max(100).nullable().optional(),
        email: email.nullable().optional(),
        isAdmin: z.boolean().optional(),
        disabled: z.boolean().optional(),
        password: password.optional(),
      })
      .parse(req.body);
    const [u] = await db.select().from(users).where(eq(users.id, id));
    if (!u) throw notFound("User");

    // Removing an active admin (demoting or turning off) must leave at least one active admin
    const losesAdmin = u.isAdmin && !u.disabled && (body.isAdmin === false || body.disabled === true);
    if (losesAdmin) {
      const [others] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(users)
        .where(and(eq(users.isAdmin, true), eq(users.disabled, false), isNotNull(users.passwordHash), ne(users.id, id))); // an invited person can't sign in yet
      if (others.n === 0) throw new HttpError(409, "ByteSize needs at least one admin");
    }

    const signOut = body.disabled === true || body.password !== undefined;
    await db
      .update(users)
      .set({
        ...(body.displayName !== undefined ? { displayName: body.displayName || null } : {}),
        ...(body.email !== undefined ? { email: body.email } : {}),
        ...(body.isAdmin !== undefined ? { isAdmin: body.isAdmin } : {}),
        ...(body.disabled !== undefined ? { disabled: body.disabled } : {}),
        ...(body.password !== undefined ? { passwordHash: await hashPassword(body.password) } : {}),
        ...(signOut ? { tokenVersion: sql`${users.tokenVersion} + 1` } : {}),
      })
      .where(eq(users.id, id));
    if (signOut) await revokeAll(db, id, undefined, app.now());
    if (body.password !== undefined) await db.delete(invites).where(eq(invites.userId, id)); // has a password now: the invite is done
    return { user: await getRow(id) };
  });
}
