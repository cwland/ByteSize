import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import * as client from "openid-client";
import { oauthFlows, oauthTickets, sessions, users } from "../db/schema.js";
import { signToken } from "../lib/auth.js";
import { logEvent } from "../lib/appLog.js";
import { HttpError } from "../lib/errors.js";
import { requireAdmin, requireUser } from "../lib/guards.js";
import { OAUTH_SCOPES, encryptOAuthSecret, getOAuth, oauthReady, providerConfig, resetOAuthCache, saveOAuth, secretFor, type StoredOAuth } from "../lib/oauth.js";
import { openSaved, revealRateLimit, sendSavedKey } from "../lib/savedKeys.js";
import { logSignIn, startSession } from "../lib/sessions.js";
import { publicUser } from "../lib/users.js";
import { checkLockout, clearFailures, recordFailure } from "./auth.js";

// OAuth / OpenID Connect sign-in (authorization code flow with PKCE, state and nonce), copied from Culury:
//  1. POST /api/auth/oauth/start (or /link/start, signed in): the page gets the provider's address
//  2. the provider sends the browser back to GET /api/auth/oauth/callback
//  3. that redirects into the app with a one-time ticket (never the login token itself),
//     which the page swaps for its token at POST /api/auth/oauth/finish
// The redirect URI to register at the provider: {app address}/api/auth/oauth/callback
// OAuth never makes an account: it signs in a linked account, or one whose email matches a verified email.

const FLOW_MS = 10 * 60 * 1000;
const TICKET_MS = 60 * 1000;
const hashTicket = (t: string) => crypto.createHash("sha256").update(t).digest("hex");

// The address the browser is on (the page calls /start with fetch, so Origin is set)
function appOrigin(req: FastifyRequest) {
  const o = req.headers.origin;
  try {
    if (typeof o === "string" && o) return new URL(o).origin;
  } catch {
    // below
  }
  throw new HttpError(400, "Start OAuth sign-in from ByteSize in a browser.");
}
export const callbackUri = (origin: string) => `${origin}/api/auth/oauth/callback`;

// The settings as Settings › Security sees them (the secret only as "saved or not")
const view = (s: StoredOAuth, jwtSecret: string) => {
  const { clientSecretEnc, ...rest } = s;
  return { ...rest, clientSecretSet: !!clientSecretEnc, clientSecretUnreadable: !!clientSecretEnc && secretFor(s, jwtSecret) === null, ready: oauthReady(s) };
};

const url = z.string().trim().url("Enter a full address, starting with https://").max(500).nullable().optional().or(z.literal("").transform(() => null));

export default async function oauthRoutes(app: FastifyInstance) {
  const { db } = app;
  const fetchImpl = app.oauthFetch; // tests use a pretend provider

  // ---------- Settings › Security (admin) ----------

  app.get("/api/settings/oauth", async (req) => {
    requireAdmin(req);
    return { settings: view(await getOAuth(db), app.jwtSecret) };
  });

  app.put("/api/settings/oauth", async (req) => {
    const userId = requireAdmin(req);
    const body = z
      .object({
        enabled: z.boolean(),
        providerName: z.string().trim().min(1, "Give the button a name, like Authentik").max(40),
        issuerUrl: url,
        clientId: z.string().trim().max(300),
        clientSecret: z.string().max(1000).optional(), // left out: keep the saved one; "": remove it
        oauthOnly: z.boolean().default(false),
      })
      .parse(req.body ?? {});
    const current = await getOAuth(db);
    const next: StoredOAuth = {
      enabled: body.enabled,
      providerName: body.providerName,
      issuerUrl: body.issuerUrl ?? null,
      clientId: body.clientId,
      clientSecretEnc: body.clientSecret === undefined ? current.clientSecretEnc : body.clientSecret ? encryptOAuthSecret(body.clientSecret, app.jwtSecret) : null,
      oauthOnly: body.oauthOnly,
    };
    if (next.enabled && !next.clientId) throw new HttpError(400, "Enter the Client ID");
    if (next.enabled && !next.issuerUrl) throw new HttpError(400, "Enter the provider's issuer (discovery) URL");
    // Lockout prevention: OAuth only needs OAuth on, and this admin's account linked (which proves it works)
    if (next.oauthOnly) {
      if (!next.enabled) throw new HttpError(400, "Turn OAuth on before choosing OAuth only.");
      const [me] = await db.select({ linked: users.oauthSubject }).from(users).where(eq(users.id, userId));
      if (!me?.linked) throw new HttpError(400, "Link your account first (Link my account): that signs in with the provider once, so you know it works before passwords are turned off.");
    }
    await saveOAuth(db, next);
    return { settings: view(next, app.jwtSecret) };
  });

  // The eye and copy buttons
  app.get("/api/settings/oauth/secret", { config: revealRateLimit }, async (req, reply) => {
    const userId = requireAdmin(req);
    const s = await getOAuth(db);
    return sendSavedKey(app, reply, userId, "OAuth client secret", { key: openSaved(s.clientSecretEnc, app.jwtSecret) });
  });

  // Test connection: reach the provider with the saved settings
  app.post("/api/settings/oauth/test", async (req) => {
    requireAdmin(req);
    const s = await getOAuth(db);
    if (!s.clientId || !s.issuerUrl) throw new HttpError(400, "Save the provider's details first.");
    resetOAuthCache();
    try {
      const m = (await providerConfig(s, app.jwtSecret, fetchImpl)).serverMetadata();
      return { ok: true, issuer: m.issuer, message: `Reached ${m.issuer}. Next, use Link my account to sign in with it once.` };
    } catch (e) {
      throw new HttpError(400, `Couldn't reach the provider: ${(e as Error).message}`);
    }
  });

  // ---------- Link my account (everyone, when OAuth is on) ----------

  app.get("/api/auth/oauth", async (req) => {
    const userId = requireUser(req);
    const s = await getOAuth(db);
    const [u] = await db.select({ subject: users.oauthSubject, email: users.oauthEmail }).from(users).where(eq(users.id, userId));
    return { available: oauthReady(s), providerName: s.providerName, linked: u?.subject ? { email: u.email } : null };
  });

  app.post("/api/auth/oauth/unlink", async (req) => {
    const userId = requireUser(req);
    const s = await getOAuth(db);
    if (s.oauthOnly && oauthReady(s)) throw new HttpError(400, "Turn off OAuth only before unlinking, or you could be locked out.");
    const [u] = await db.update(users).set({ oauthIssuer: null, oauthSubject: null, oauthEmail: null }).where(eq(users.id, userId)).returning();
    await logEvent(db, { category: "auth", level: "info", source: s.providerName, event: "OAuth sign-in unlinked", detail: u.username, userId });
    return { ok: true };
  });

  // ---------- the flow ----------

  async function begin(req: FastifyRequest, purpose: "login" | "link", userId?: number) {
    const s = await getOAuth(db);
    if (!oauthReady(s)) throw new HttpError(400, "OAuth sign-in isn't set up.");
    const origin = appOrigin(req);
    const now = app.now();
    await db.delete(oauthFlows).where(lt(oauthFlows.expiresAt, now));
    let config;
    try {
      config = await providerConfig(s, app.jwtSecret, fetchImpl);
    } catch (e) {
      await logEvent(db, { category: "auth", level: "error", source: s.providerName, event: `Couldn't reach ${s.providerName} to sign in`, detail: (e as Error).message, userId: userId ?? null });
      throw new HttpError(502, `Couldn't reach ${s.providerName}. Try again, or sign in another way.`);
    }
    const verifier = client.randomPKCECodeVerifier();
    const state = client.randomState();
    const nonce = client.randomNonce();
    const redirectUri = callbackUri(origin);
    const authUrl = client.buildAuthorizationUrl(config, {
      redirect_uri: redirectUri,
      scope: OAUTH_SCOPES,
      code_challenge: await client.calculatePKCECodeChallenge(verifier),
      code_challenge_method: "S256",
      state,
      nonce,
      ...(purpose === "link" ? { prompt: "login" } : {}),
    });
    await db.insert(oauthFlows).values({ state, purpose, userId: userId ?? null, verifier, nonce, redirectUri, appOrigin: origin, expiresAt: new Date(now.getTime() + FLOW_MS) });
    return { url: authUrl.href };
  }

  app.post("/api/auth/oauth/start", async (req) => {
    checkLockout(req);
    return begin(req, "login");
  });
  app.post("/api/auth/oauth/link/start", async (req) => begin(req, "link", requireUser(req)));

  // Where the provider sends the browser back. Always ends with a redirect into the app.
  app.get("/api/auth/oauth/callback", async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const now = app.now();
    // A state works once
    const [flow] = q.state ? await db.delete(oauthFlows).where(eq(oauthFlows.state, q.state)).returning() : [];
    const back = (origin: string, path: string, params: Record<string, string>) => reply.redirect(`${origin}/#${path}?${new URLSearchParams(params)}`);
    if (!flow || flow.expiresAt <= now) return reply.redirect(`/#/?${new URLSearchParams({ oauth_error: "That sign-in took too long or was already used. Try again." })}`);
    const fail = async (message: string, logReason: string): Promise<FastifyReply> => {
      if (flow.purpose === "login") {
        recordFailure(req);
        await logSignIn(db, req, { username: null, success: false, reason: logReason });
        return back(flow.appOrigin, "/", { oauth_error: message });
      }
      return back(flow.appOrigin, "/settings/security", { oauth_error: message });
    };
    if (q.error) return fail(q.error_description || q.error, `OAuth: ${q.error}`);

    const s = await getOAuth(db);
    let claims: { sub: string; iss: string; email?: string; email_verified?: boolean };
    try {
      const config = await providerConfig(s, app.jwtSecret, fetchImpl);
      const current = new URL(flow.redirectUri);
      for (const [k, v] of Object.entries(q)) if (typeof v === "string") current.searchParams.set(k, v);
      const tokens = await client.authorizationCodeGrant(config, current, { pkceCodeVerifier: flow.verifier, expectedState: flow.state, expectedNonce: flow.nonce, idTokenExpected: true });
      const idClaims = tokens.claims()!;
      // The ID token is enough; user info may add the email
      const info = (await client.fetchUserInfo(config, tokens.access_token, idClaims.sub).catch(() => ({}))) as Record<string, unknown>;
      claims = {
        sub: String(idClaims.sub),
        iss: String(idClaims.iss),
        email: (info.email ?? idClaims.email) as string | undefined,
        email_verified: (info.email_verified ?? idClaims.email_verified) as boolean | undefined,
      };
    } catch (e) {
      await logEvent(db, { category: "auth", level: "error", source: s.providerName, event: `${s.providerName} sign-in failed`, detail: (e as Error).message, userId: flow.userId });
      return fail(`${s.providerName} sign-in didn't work: ${(e as Error).message}`, `OAuth failed: ${(e as Error).message.slice(0, 100)}`);
    }
    const identity = and(eq(users.oauthIssuer, claims.iss), eq(users.oauthSubject, claims.sub));

    if (flow.purpose === "link") {
      const [taken] = await db.select({ id: users.id }).from(users).where(identity);
      if (taken && taken.id !== flow.userId) return fail("That identity is linked to another account.", "");
      const [u] = await db.update(users).set({ oauthIssuer: claims.iss, oauthSubject: claims.sub, oauthEmail: claims.email ?? null }).where(eq(users.id, flow.userId!)).returning();
      await logEvent(db, { category: "auth", level: "info", source: s.providerName, event: "OAuth sign-in linked", detail: u.username, userId: u.id });
      return back(flow.appOrigin, "/settings/security", { oauth: "linked" });
    }

    // Sign in: the linked identity, or the one profile whose email matches a verified email (which then links it)
    let [user] = await db.select().from(users).where(identity);
    if (!user && claims.email && claims.email_verified === true) {
      const same = await db.select().from(users).where(sql`lower(trim(${users.email})) = ${claims.email.trim().toLowerCase()}`);
      // Two profiles with that email, or one already linked to another identity: not a match
      if (same.length === 1 && !same[0].oauthSubject) {
        [user] = await db.update(users).set({ oauthIssuer: claims.iss, oauthSubject: claims.sub, oauthEmail: claims.email }).where(eq(users.id, same[0].id)).returning();
      }
    }
    if (!user) {
      return fail(
        `This ${s.providerName} account isn't linked to ByteSize. Sign in another way, then use Settings › Security › Link my account.`,
        `OAuth: no matching account (${claims.email ?? claims.sub})`
      );
    }
    if (user.disabled) return fail("This account is turned off. Ask your ByteSize admin.", `OAuth: account turned off (${user.username})`);
    clearFailures(req);
    const { session } = await startSession(db, app.jwtSecret, req, user, s.providerName, now); // "Authentik" in Signed-in devices
    await logSignIn(db, req, { username: user.username, success: true, reason: `Signed in with ${s.providerName}`, sessionId: session.id });
    const ticket = crypto.randomBytes(24).toString("base64url");
    await db.delete(oauthTickets).where(lt(oauthTickets.expiresAt, now));
    await db.insert(oauthTickets).values({ ticketHash: hashTicket(ticket), sessionId: session.id, expiresAt: new Date(now.getTime() + TICKET_MS) });
    return back(flow.appOrigin, "/oauth", { ticket });
  });

  // The page swaps the one-time ticket for its login token
  app.post("/api/auth/oauth/finish", async (req) => {
    const { ticket } = z.object({ ticket: z.string().max(200) }).parse(req.body ?? {});
    const [t] = await db.delete(oauthTickets).where(and(eq(oauthTickets.ticketHash, hashTicket(ticket)), gt(oauthTickets.expiresAt, app.now()))).returning();
    const [row] = t ? await db.select({ session: sessions, user: users }).from(sessions).innerJoin(users, eq(users.id, sessions.userId)).where(eq(sessions.id, t.sessionId)) : [];
    if (!row || row.session.revokedAt || row.user.disabled) throw new HttpError(400, "That sign-in expired. Try again.");
    return { token: signToken(row.user.id, row.user.tokenVersion, app.jwtSecret, row.session.tokenId), user: publicUser(row.user) };
  });
}
