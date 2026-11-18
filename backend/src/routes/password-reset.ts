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
// not an account matched. A code: random, kept only as a keyed hash, 15 minutes, once, 5 wrong tries.

export const SAME_ANSWER = "If an account uses that email, we've sent a 6-digit code.";
const WRONG_CODE = "That code is wrong or has expired. Ask for a new one.";
const CODE_MS = 15 * 60 * 1000;
const MAX_WRONG = 5;
const PER_HOUR = 5; // codes asked for, per email and per address
const HOUR = 60 * 60 * 1000;

const password = z.string().min(8, "Password must be at least 8 characters").max(200);
const email = z.string({ error: "Enter your email" }).trim().toLowerCase().email("That doesn't look like an email address").max(200);
const sameEmail = (e: string) => sql`lower(trim(${users.email})) = ${e}`;

// Codes asked for, per email (lowercased), in the last hour
const asked = new Map<string, number[]>();
export const resetForgotLimits = () => asked.clear();

// Per address: on top of the per-email count (only when rate limits are on)
const perAddress = { rateLimit: { max: PER_HOUR, timeWindow: HOUR, keyGenerator: (req: FastifyRequest) => `forgot|${req.ip}` } };

export default async function passwordResetRoutes(app: FastifyInstance) {
  const { db } = app;
  const hashCode = (userId: number, code: string) => crypto.createHmac("sha256", app.jwtSecret).update(`reset-code:${userId}:${code}`).digest("hex");
  const sameHash = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

  app.post("/api/auth/forgot", { config: perAddress }, async (req) => {
    await requirePasswords(db);
    const active = await app.mail.active();
    if (!active) throw new HttpError(404, "Email isn't set up on this server. Ask your ByteSize admin to reset your password.");
    const body = z.object({ email }).parse(req.body ?? {});
    const now = app.now().getTime();
    if (asked.size > 10_000) for (const [k, times] of asked) if (now - times[times.length - 1] >= HOUR) asked.delete(k);
    // Counted for every email, matched or not, so the limit says nothing about who has an account
    const recent = (asked.get(body.email) ?? []).filter((at) => now - at < HOUR);
    if (recent.length >= PER_HOUR) throw new HttpError(429, "Too many codes asked for. Try again in an hour.");
    asked.set(body.email, [...recent, now]);

    const matches = await db.select().from(users).where(and(sameEmail(body.email), eq(users.disabled, false)));
    for (const user of matches) {
      const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
      const values = { codeHash: hashCode(user.id, code), wrongTries: 0, expiresAt: new Date(now + CODE_MS), createdAt: new Date(now) };
      // A new request replaces the old code
      await db.insert(passwordResetCodes).values({ userId: user.id, ...values }).onConflictDoUpdate({ target: passwordResetCodes.userId, set: values });
      await logEvent(db, { category: "auth", level: "info", source: "Forgot password", event: "Password reset code sent", detail: user.username, userId: user.id });
      const link = active.config.appUrl ? `\n\n${active.config.appUrl}` : "";
      try {
        await app.mail.send(
          {
            to: user.email!,
            subject: `Your ByteSize code: ${code}`,
            text: `Your ByteSize code is ${code}.\n\nEnter it on the sign-in screen to choose a new password for "${user.username}". It works once, for 15 minutes.\n\nIf you didn't ask, ignore this. Your password won't change.${link}`,
          },
          "reset-code",
          { logSubject: "Your ByteSize code", userId: user.id }
        );
      } catch (err) {
        // Already in Settings › Logs; the answer stays the same, so it can't tell anyone the account exists
        req.log.error(err);
      }
    }
    return { ok: true, message: SAME_ANSWER };
  });

  // The code and a new password: signs in here and ends every other sign-in
  app.post("/api/auth/reset", async (req) => {
    await requirePasswords(db);
    const body = z.object({ email, code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code from the email"), newPassword: password }).parse(req.body ?? {});
    const now = app.now();
    const rows = await db
      .select({ code: passwordResetCodes, user: users })
      .from(passwordResetCodes)
      .innerJoin(users, eq(users.id, passwordResetCodes.userId))
      .where(and(sameEmail(body.email), gt(passwordResetCodes.expiresAt, now), lt(passwordResetCodes.wrongTries, MAX_WRONG)));
    const hit = rows.find((r) => sameHash(r.code.codeHash, hashCode(r.user.id, body.code)));
    if (!hit) {
      if (rows.length) {
        await db
          .update(passwordResetCodes)
          .set({ wrongTries: sql`${passwordResetCodes.wrongTries} + 1` })
          .where(inArray(passwordResetCodes.id, rows.map((r) => r.code.id)));
      }
      throw new HttpError(400, WRONG_CODE);
    }
    if (hit.user.disabled) throw new HttpError(400, WRONG_CODE);
    // Once: whoever deletes the row uses it
    const [used] = await db.delete(passwordResetCodes).where(and(eq(passwordResetCodes.id, hit.code.id), eq(passwordResetCodes.codeHash, hit.code.codeHash))).returning();
    if (!used) throw new HttpError(400, WRONG_CODE);
    const [user] = await db
      .update(users)
      .set({ passwordHash: await hashPassword(body.newPassword), tokenVersion: sql`${users.tokenVersion} + 1` })
      .where(eq(users.id, hit.user.id))
      .returning();
    await revokeAll(db, user.id, undefined, now);
    const { token, session } = await startSession(db, app.jwtSecret, req, user, "password reset code", now);
    await logSignIn(db, req, { username: user.username, success: true, reason: "Reset the password with an emailed code", sessionId: session.id });
    await logEvent(db, { category: "auth", level: "info", source: "Forgot password", event: "Password reset with an emailed code", detail: user.username, userId: user.id });
    return { token, user: publicUser(user) };
  });
}
