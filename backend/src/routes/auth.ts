import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { and, count, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { checkPassword, hashPassword } from "../lib/auth.js";
import { describeDevice, logSignIn, pruneLoginLog, renewSession, revokeAll, startSession } from "../lib/sessions.js";
import { loginEvents, sessions, users } from "../db/schema.js";
import { HttpError } from "../lib/errors.js";
import { normalizeUsername, publicUser } from "../lib/users.js";
import { requireUser } from "../lib/guards.js";

const password = z.string().min(8, "Password must be at least 8 characters").max(200);
const credentials = z.object({ username: z.string().trim().min(1).max(100), password });

// Simple lockout: 5 failed logins from one address blocks it for 15 minutes
const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const failures = new Map<string, { count: number; until: number }>();

export function checkLockout(req: FastifyRequest) {
  const entry = failures.get(req.ip);
  if (entry && entry.count >= MAX_FAILURES && entry.until > Date.now()) {
    throw new HttpError(429, "Too many failed attempts. Try again in 15 minutes.");
  }
}
export function recordFailure(req: FastifyRequest) {
  const entry = failures.get(req.ip);
  const n = entry && entry.until > Date.now() ? entry.count + 1 : 1;
  failures.set(req.ip, { count: n, until: Date.now() + LOCKOUT_MS });
}

export function resetLoginLockouts() {
  failures.clear();
}

export const clearFailures = (req: FastifyRequest) => failures.delete(req.ip);


export default async function authRoutes(app: FastifyInstance) {
  const { db } = app;

  const userCount = async () => (await db.select({ n: count() }).from(users))[0].n;

  app.get("/api/auth/status", async () => {
    const [anyone] = await db.select({ id: users.id }).from(users).limit(1);
    return { setupRequired: !anyone, passwords: true };
  });

  // First run only: create the admin's account. There is no other way to sign up:
  // the admin adds everyone else in Settings › Users.
  app.post("/api/auth/setup", async (req) => {
    const body = credentials.extend({ email: z.string().trim().email("That doesn't look like an email address").max(200).optional() }).parse(req.body);
    if ((await userCount()) > 0) throw new HttpError(409, "Account already set up");
    const [user] = await db
      .insert(users)
      .values({ username: normalizeUsername(body.username), email: body.email ?? null, passwordHash: await hashPassword(body.password), isAdmin: true })
      .returning();
    const { token, session } = await startSession(db, app.jwtSecret, req, user, "account set up", app.now());
    await logSignIn(db, req, { username: user.username, success: true, reason: "Account set up", sessionId: session.id });
    return { token, user: publicUser(user) };
  });

  app.post("/api/auth/login", async (req) => {
    const body = z.object({ username: z.string(), password: z.string() }).parse(req.body);
    try {
      checkLockout(req);
    } catch (e) {
      await logSignIn(db, req, { username: body.username, success: false, reason: "Blocked: too many failed attempts" });
      throw e;
    }
    const [user] = await db.select().from(users).where(eq(users.username, normalizeUsername(body.username))); // usernames ignore capitalization
    if (!user || !(await checkPassword(body.password, user.passwordHash))) {
      recordFailure(req);
      await logSignIn(db, req, { username: body.username, success: false, reason: user ? "Wrong password" : "Unknown username" });
      throw new HttpError(401, "Wrong username or password");
    }
    if (user.disabled) {
      await logSignIn(db, req, { username: body.username, success: false, reason: "Account turned off" });
      throw new HttpError(401, "This account is turned off. Ask your ByteSize admin.");
    }
    failures.delete(req.ip);
    const { token, session } = await startSession(db, app.jwtSecret, req, user, "password", app.now());
    await logSignIn(db, req, { username: body.username, success: true, reason: "Signed in with password", sessionId: session.id });
    return { token, user: publicUser(user) };
  });

  app.get("/api/auth/me", async (req) => {
    const [user] = await db.select().from(users).where(eq(users.id, requireUser(req)));
    if (!user) throw new HttpError(401, "Not logged in");
    return { user: publicUser(user) };
  });

  // Change password. Signs out every other device; returns a fresh token for this one.
  app.post("/api/auth/password", async (req) => {
    requireUser(req);
    const body = z.object({ currentPassword: z.string(), newPassword: password }).parse(req.body);
    const [user] = await db.select().from(users).where(eq(users.id, req.auth!.userId));
    if (!user || !(await checkPassword(body.currentPassword, user.passwordHash))) {
      throw new HttpError(400, "Current password is wrong");
    }
    const [updated] = await db
      .update(users)
      .set({ passwordHash: await hashPassword(body.newPassword), tokenVersion: sql`${users.tokenVersion} + 1` })
      .where(eq(users.id, user.id))
      .returning();
    await revokeAll(db, user.id, req.auth!.sessionId, app.now());
    return { ok: true, token: await renewSession(db, app.jwtSecret, updated, req.auth!.sessionId, app.now()) };
  });

  // Sign out everywhere. With keepThisDevice, returns a fresh token so this browser stays in.
  app.post("/api/auth/logout-all", async (req) => {
    requireUser(req);
    const body = z.object({ keepThisDevice: z.boolean().default(false) }).parse(req.body ?? {});
    const [updated] = await db
      .update(users)
      .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
      .where(eq(users.id, req.auth!.userId))
      .returning();
    await revokeAll(db, updated.id, body.keepThisDevice ? req.auth!.sessionId : undefined, app.now());
    return { ok: true, token: body.keepThisDevice ? await renewSession(db, app.jwtSecret, updated, req.auth!.sessionId, app.now()) : undefined };
  });

  // Sign out this device
  app.post("/api/auth/logout", async (req) => {
    if (!req.auth) return { ok: true };
    await db.update(sessions).set({ revokedAt: app.now() }).where(eq(sessions.id, req.auth!.sessionId));
    return { ok: true };
  });

  // ---------- signed-in devices and sign-in history (Settings > Security) ----------

  app.get("/api/auth/sessions", async (req) => {
    requireUser(req);
    const auth = req.auth!;
    const [user] = await db.select({ tv: users.tokenVersion }).from(users).where(eq(users.id, auth.userId));
    const now = app.now();
    const rows = await db.select().from(sessions).where(eq(sessions.userId, auth.userId)).orderBy(desc(sessions.lastSeenAt)).limit(100);
    return rows.map((s) => {
      const status = s.revokedAt || s.tokenVersion !== user.tv ? "signed out" : s.expiresAt < now ? "expired" : "active";
      return {
        id: s.id,
        current: s.id === auth.sessionId,
        status,
        device: describeDevice(s.userAgent),
        userAgent: s.userAgent,
        how: s.how,
        ip: s.ip,
        lastIp: s.lastIp,
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
        expiresAt: s.expiresAt,
        signedOutAt: s.revokedAt,
      };
    });
  });

  // Sign out one device
  app.delete("/api/auth/sessions/:id", async (req, reply) => {
    requireUser(req);
    const id = z.coerce.number().int().positive().parse((req.params as { id: string }).id);
    const [row] = await db
      .update(sessions)
      .set({ revokedAt: app.now() })
      .where(and(eq(sessions.id, id), eq(sessions.userId, req.auth!.userId), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });
    if (!row) throw new HttpError(404, "That device isn't signed in");
    return reply.status(204).send();
  });

  app.get("/api/auth/logins", async (req) => {
    requireUser(req);
    // The last 60 days (older ones are deleted)
    await pruneLoginLog(db);
    // An admin sees every sign-in (and attempt); a member sees their own
    // (by username and their own sessions only: an email is self-chosen, so matching on it could show someone else's)
    const [me] = await db.select({ username: users.username }).from(users).where(eq(users.id, req.auth!.userId));
    const mine = req.auth!.isAdmin ? undefined : or(sql`lower(trim(${loginEvents.username})) = ${me.username}`, inArray(loginEvents.sessionId, db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, req.auth!.userId))));
    const rows = await db.select().from(loginEvents).where(mine).orderBy(desc(loginEvents.at), desc(loginEvents.id)).limit(5000);
    return rows.map((e) => ({ ...e, device: describeDevice(e.userAgent) }));
  });
}
