import crypto from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { and, eq, isNull, sql } from "drizzle-orm";
import { invites, users } from "../db/schema.js";
import { hashApiKey, hashPassword } from "../lib/auth.js";
import { sameHash } from "../lib/apiKeys.js";
import { logEvent } from "../lib/appLog.js";
import { HttpError, notFound } from "../lib/errors.js";
import { requireAdmin } from "../lib/guards.js";
import { logSignIn, startSession } from "../lib/sessions.js";
import { normalizeUsername, publicUser } from "../lib/users.js";
import { USERNAME_TAKEN, adminRowFor, email, isUniqueViolation, password, usernameField } from "./admin-users.js";
import { escapeHtml, originOf } from "../lib/mail.js";

// Invite by email (Settings › Users, admin, only with email set up). The invited person is a users row with
// no password, so nothing signs them in until they open the emailed link (#/invite/<token>) and choose one.
// A link: 32 random bytes, only its SHA-256 kept, 7 days, once; Resend replaces it, Cancel invite removes the
// person. The token travels only in request bodies (never an address the server logs).

export const INVITE_DAYS = 7;
const DAY = 24 * 60 * 60 * 1000;
export const NO_EMAIL = "Set up email in Settings › Email to invite people";
export const NO_ADDRESS = "Set ByteSize's own address in Settings › Email so the invite link can point at it.";
const NOT_INVITED = "This person has already accepted their invite";
export const expiredInvite = (admin: string | null) => `This invite link has expired or was already used. Ask ${admin || "your ByteSize admin"} for a new one.`;

const nameOf = (u: { displayName: string | null; username: string }) => u.displayName?.trim() || u.username;

export default async function inviteRoutes(app: FastifyInstance) {
  const { db } = app;

  // Where the link points: the app's address (Settings › Email, else APP_URL / PASSKEY_ORIGINS), else the
  // admin's own browser (the Origin it sent). Never the Host header, which anyone can set.
  async function ready(req: FastifyRequest) {
    const active = await app.mail.active();
    if (!active) throw new HttpError(409, NO_EMAIL);
    const base = originOf(active.config.appUrl) ?? app.appOrigins[0] ?? originOf(typeof req.headers.origin === "string" ? req.headers.origin : null);
    if (!base) throw new HttpError(409, NO_ADDRESS);
    return base;
  }

  /** A new link for a person (replacing any old one); returns the token, which is only ever emailed. */
  async function newLink(tx: Pick<FastifyInstance["db"], "insert">, userId: number, adminId: number, now: Date) {
    const token = crypto.randomBytes(32).toString("base64url");
    const values = { tokenHash: hashApiKey(token), invitedBy: adminId, sentAt: now, expiresAt: new Date(now.getTime() + INVITE_DAYS * DAY) };
    await tx.insert(invites).values({ userId, ...values }).onConflictDoUpdate({ target: invites.userId, set: values });
    return token;
  }

  /** Emails the link. A mail server that fails or doesn't answer (SMTP timeouts) is reported, never thrown. */
  async function sendInvite(base: string, adminId: number, person: { id: number; username: string; displayName: string | null; email: string | null }, token: string) {
    const [admin] = await db.select().from(users).where(eq(users.id, adminId));
    const from = admin ? nameOf(admin) : "Your ByteSize admin";
    const link = `${base}/#/invite/${token}`;
    const subject = `${from} invited you to ByteSize`;
    const text = `Hi ${nameOf(person)},\n\n${from} invited you to ByteSize, a food and nutrition tracker. Your username is "${person.username}".\n\nOpen this link to choose your password:\n${link}\n\nThe link works once, for ${INVITE_DAYS} days. If you weren't expecting this, ignore this email.`;
    const html = `<p>Hi ${escapeHtml(nameOf(person))},</p><p>${escapeHtml(from)} invited you to ByteSize, a food and nutrition tracker. Your username is <b>${escapeHtml(person.username)}</b>.</p><p><a href="${escapeHtml(link)}" style="display:inline-block;padding:10px 20px;border-radius:999px;background:#3f7d3a;color:#fff;text-decoration:none;font-weight:bold">Choose your password</a></p><p>Or open this link: ${escapeHtml(link)}</p><p>The link works once, for ${INVITE_DAYS} days. If you weren't expecting this, ignore this email.</p>`;
    try {
      await app.mail.send({ to: person.email!, subject, text, html }, "invite", { userId: adminId });
      return undefined;
    } catch (err) {
      return `The invite couldn't be emailed: ${(err as Error).message}. Press Resend to try again.`;
    }
  }

  const pendingPerson = async (id: number) => {
    const [u] = await db.select().from(users).where(eq(users.id, id));
    if (!u) throw notFound("User");
    if (u.passwordHash) throw new HttpError(409, NOT_INVITED);
    return u;
  };
  const idParam = (req: FastifyRequest) => z.coerce.number().int().positive().max(2147483647).parse((req.params as { id: string }).id);

  // ---------- Settings › Users (admin) ----------

  app.post("/api/admin/invites", async (req) => {
    const adminId = requireAdmin(req);
    const body = z.object({ name: z.string().trim().min(1, "Enter their name").max(100), username: usernameField, email }).parse(req.body ?? {});
    const base = await ready(req);
    const username = normalizeUsername(body.username);
    const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.username, username));
    if (taken) throw new HttpError(409, USERNAME_TAKEN);
    const now = app.now();
    let made: { person: typeof users.$inferSelect; token: string };
    try {
      made = await db.transaction(async (tx) => {
        const [person] = await tx.insert(users).values({ username, displayName: body.name, email: body.email, passwordHash: null, createdAt: now }).returning();
        return { person, token: await newLink(tx, person.id, adminId, now) };
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new HttpError(409, USERNAME_TAKEN);
      throw err;
    }
    await logEvent(db, { category: "auth", level: "info", source: "Settings › Users", event: "Invited someone by email", detail: `${username} (${body.email})`, userId: adminId });
    const emailError = await sendInvite(base, adminId, made.person, made.token);
    return { user: await adminRowFor(db, made.person.id), ...(emailError ? { emailError } : {}) };
  });

  // A new link; the old one stops working
  app.post("/api/admin/invites/:id/resend", async (req) => {
    const adminId = requireAdmin(req);
    const id = idParam(req);
    const person = await pendingPerson(id);
    const base = await ready(req);
    const token = await newLink(db, id, adminId, app.now());
    await logEvent(db, { category: "auth", level: "info", source: "Settings › Users", event: "Sent a new invite link", detail: person.username, userId: adminId });
    const emailError = await sendInvite(base, adminId, person, token);
    return { user: await adminRowFor(db, id), ...(emailError ? { emailError } : {}) };
  });

  // Removes the invited person (only someone who hasn't accepted)
  app.delete("/api/admin/invites/:id", async (req, reply) => {
    const adminId = requireAdmin(req);
    const id = idParam(req);
    const person = await pendingPerson(id);
    const gone = await db.delete(users).where(and(eq(users.id, id), isNull(users.passwordHash))).returning({ id: users.id });
    if (!gone.length) throw new HttpError(409, NOT_INVITED); // accepted just now
    await logEvent(db, { category: "auth", level: "info", source: "Settings › Users", event: "Cancelled an invite", detail: person.username, userId: adminId });
    return reply.status(204).send();
  });

  // ---------- the invite page (anyone with the link) ----------

  const token = z.string().max(200);
  /** The live invite for a token: { invite, person, inviter } or an error naming who to ask. */
  async function liveInvite(raw: string) {
    const hash = hashApiKey(raw);
    const [row] = await db
      .select({ invite: invites, inviter: { displayName: users.displayName, username: users.username } })
      .from(invites)
      .leftJoin(users, eq(users.id, invites.invitedBy))
      .where(eq(invites.tokenHash, hash));
    if (!row || !sameHash(row.invite.tokenHash, hash)) throw new HttpError(410, expiredInvite(null));
    const inviter = row.inviter ? nameOf(row.inviter) : null;
    const [person] = await db.select().from(users).where(eq(users.id, row.invite.userId));
    if (row.invite.expiresAt <= app.now() || !person || person.passwordHash || person.disabled) throw new HttpError(410, expiredInvite(inviter));
    return { invite: row.invite, person, inviter, hash };
  }

  // "Welcome to ByteSize, <name>" and the username
  app.post("/api/invites/check", async (req) => {
    const body = z.object({ token }).parse(req.body ?? {});
    const { person } = await liveInvite(body.token);
    return { name: nameOf(person), username: person.username };
  });

  // The person's own password: signed in, then first-run setup like anyone the admin added
  app.post("/api/invites/accept", async (req) => {
    const body = z.object({ token, password }).parse(req.body ?? {});
    const { invite, person, inviter, hash } = await liveInvite(body.token);
    const passwordHash = await hashPassword(body.password);
    const now = app.now();
    const user = await db.transaction(async (tx) => {
      // Once: whoever deletes the row uses it (two at the same moment: the second finds nothing)
      const [used] = await tx.delete(invites).where(and(eq(invites.id, invite.id), eq(invites.tokenHash, hash))).returning();
      if (!used || used.expiresAt <= now) throw new HttpError(410, expiredInvite(inviter));
      const [u] = await tx
        .update(users)
        .set({ passwordHash, tokenVersion: sql`${users.tokenVersion} + 1` })
        .where(and(eq(users.id, person.id), isNull(users.passwordHash), eq(users.disabled, false)))
        .returning();
      if (!u) throw new HttpError(410, expiredInvite(inviter));
      return u;
    });
    const { token: loginToken, session } = await startSession(db, app.jwtSecret, req, user, "invite", now);
    await logSignIn(db, req, { username: user.username, success: true, reason: "Accepted an invite", sessionId: session.id });
    await logEvent(db, { category: "auth", level: "info", source: "Invite", event: "Accepted an invite", detail: user.username, userId: user.id });
    return { token: loginToken, user: publicUser(user) };
  });
}
