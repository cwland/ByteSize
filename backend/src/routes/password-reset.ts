import crypto from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { and, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { passwordResetCodes, users } from "../db/schema.js";
import { hashPassword } from "../lib/auth.js";
import { logEvent } from "../lib/appLog.js";
import { HttpError } from "../lib/errors.js";
import { requirePasswords } from "../lib/oauth.js";
import { logSignIn, revokeAll, startSession } from "../lib/sessions.js";
import { publicUser } from "../lib/users.js";

// Forgot password (sign-in screen, only when email is set up): enter your email; if an account uses it,
// a 6-digit code is emailed; the code and a new password sign you in. The answer is the same whether or
// not an account matched, and comes at once: the code is made and mailed after answering, so a match
// doesn't take longer than a miss. A code: random, kept only as a keyed hash, 15 minutes, once, 5 wrong
// tries (each try is spent before the code is compared, so tries made at the same moment can't beat it).

export const SAME_ANSWER = "If an account uses that email, we've sent a 6-digit code.";
const WRONG_CODE = "That code is wrong or has expired. Ask for a new one.";
const CODE_MS = 15 * 60 * 1000;
const MAX_WRONG = 5;
const PER_HOUR = 5; // codes asked for, per email and per address
const CHECKS_PER_HOUR = 10; // codes tried, per email
const HOUR = 60 * 60 * 1000;

const password = z.string().min(8, "Password must be at least 8 characters").max(200);
const email = z.string({ error: "Enter your email" }).trim().toLowerCase().email("That doesn't look like an email address").max(200);
const sameEmail = (e: string) => sql`lower(trim(${users.email})) = ${e}`;

// Codes asked for, and codes tried, per email (lowercased) in the last hour. Counted for every email,
// matched or not, so a limit says nothing about who has an account.
const asked = new Map<string, number[]>();
const tried = new Map<string, number[]>();
export const resetForgotLimits = () => {
  asked.clear();
  tried.clear();
};
function count(map: Map<string, number[]>, email: string, now: number, max: number, message: string) {
  if (map.size > 10_000) for (const [k, times] of map) if (now - times[times.length - 1] >= HOUR) map.delete(k);
  const recent = (map.get(email) ?? []).filter((at) => now - at < HOUR);
  if (recent.length >= max) throw new HttpError(429, message);
  map.set(email, [...recent, now]);
}

// Per address: on top of the per-email count (only when rate limits are on)
const perAddress = { rateLimit: { max: PER_HOUR, timeWindow: HOUR, keyGenerator: (req: FastifyRequest) => `forgot|${req.ip}` } };

export default async function passwordResetRoutes(app: FastifyInstance) {
  const { db } = app;
  const hashCode = (userId: number, code: string) => crypto.createHmac("sha256", app.jwtSecret).update(`reset-code:${userId}:${code}`).digest("hex");
  const sameHash = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

  async function sendCodes(email: string, now: number, appUrl: string | null) {
    const matches = await db.select().from(users).where(and(sameEmail(email), eq(users.disabled, false)));
    let problem: unknown = null; // one account's email failing doesn't stop the others
    for (const user of matches) {
      const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
      const values = { codeHash: hashCode(user.id, code), wrongTries: 0, expiresAt: new Date(now + CODE_MS), createdAt: new Date(now) };
      // A new request replaces the old code
      await db.insert(passwordResetCodes).values({ userId: user.id, ...values }).onConflictDoUpdate({ target: passwordResetCodes.userId, set: values });
      await logEvent(db, { category: "auth", level: "info", source: "Forgot password", event: "Password reset code sent", detail: user.username, userId: user.id });
      const text = `Your ByteSize code is ${code}.\n\nEnter it on the sign-in screen to choose a new password for "${user.username}". It works once, for 15 minutes.\n\nIf you didn't ask, ignore this. Your password won't change.${appUrl ? `\n\n${appUrl}` : ""}`;
      try {
        await app.mail.send({ to: user.email!, subject: `Your ByteSize code: ${code}`, text }, "reset-code", { logSubject: "Your ByteSize code", userId: user.id });
      } catch (err) {
        problem ??= err;
      }
    }
    if (problem) throw problem;
  }

  app.post("/api/auth/forgot", { config: perAddress }, async (req) => {
    await requirePasswords(db);
    const active = await app.mail.active();
    if (!active) throw new HttpError(404, "Email isn't set up on this server. Ask your ByteSize admin to reset your password.");
    const body = z.object({ email }).parse(req.body ?? {});
    const now = app.now().getTime();
    count(asked, body.email, now, PER_HOUR, "Too many codes asked for. Try again in an hour.");
    // After answering: whether an account matches, making its code and the email (errors go to Settings › Logs)
    app.mail.background(
      () => sendCodes(body.email, now, active.config.appUrl),
      async (err) => {
        req.log.error(err);
        await logEvent(db, { category: "auth", level: "error", source: "Forgot password", event: "Couldn't send a password reset code", detail: (err as Error).message });
      }
    );
    return { ok: true, message: SAME_ANSWER };
  });

  // The code and a new password: signs in here and ends every other sign-in
  app.post("/api/auth/reset", async (req) => {
    await requirePasswords(db);
    const body = z.object({ email, code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code from the email"), newPassword: password }).parse(req.body ?? {});
    const now = app.now();
    count(tried, body.email, now.getTime(), CHECKS_PER_HOUR, "Too many tries. Ask for a new code in an hour.");
    // Spend a try on every live code for this email first (one statement: tries made at the same moment
    // queue on the row, and each sees the count the one before left), then compare only those
    const spent = await db
      .update(passwordResetCodes)
      .set({ wrongTries: sql`${passwordResetCodes.wrongTries} + 1` })
      .where(
        and(
          inArray(passwordResetCodes.userId, db.select({ id: users.id }).from(users).where(sameEmail(body.email))),
          gt(passwordResetCodes.expiresAt, now),
          lt(passwordResetCodes.wrongTries, MAX_WRONG)
        )
      )
      .returning();
    const hit = spent.find((r) => sameHash(r.codeHash, hashCode(r.userId, body.code)));
    if (!hit) throw new HttpError(400, WRONG_CODE);
    // Once: whoever deletes the row uses it
    const [used] = await db.delete(passwordResetCodes).where(and(eq(passwordResetCodes.id, hit.id), eq(passwordResetCodes.codeHash, hit.codeHash))).returning();
    const [owner] = used ? await db.select().from(users).where(eq(users.id, hit.userId)) : [];
    if (!owner || owner.disabled) throw new HttpError(400, WRONG_CODE);
    const [user] = await db
      .update(users)
      .set({ passwordHash: await hashPassword(body.newPassword), tokenVersion: sql`${users.tokenVersion} + 1` })
      .where(eq(users.id, owner.id))
      .returning();
    await revokeAll(db, user.id, undefined, now);
    const { token, session } = await startSession(db, app.jwtSecret, req, user, "password reset code", now);
    await logSignIn(db, req, { username: user.username, success: true, reason: "Reset the password with an emailed code", sessionId: session.id });
    await logEvent(db, { category: "auth", level: "info", source: "Forgot password", event: "Password reset with an emailed code", detail: user.username, userId: user.id });
    return { token, user: publicUser(user) };
  });
}
