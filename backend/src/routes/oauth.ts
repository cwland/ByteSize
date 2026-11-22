import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { and, eq, gt, lt } from "drizzle-orm";
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

// OAuth / OpenID Connect sign-in (authorization code flow with PKCE, state and nonce), copied from RecipeHub:
//  1. POST /api/auth/oauth/start (or /link/start, signed in): the page gets the provider's address
//  2. the provider sends the browser back to GET /api/auth/oauth/callback
//  3. that redirects into the app with a one-time ticket (never the login token itself),
//     which the page swaps for its token at POST /api/auth/oauth/finish
// The redirect URI to register at the provider: {app address}/api/auth/oauth/callback. The app address is
// the configured one (Settings › Email's app address, APP_URL, PASSKEY_ORIGINS) when there is one: a
// request from any other address is refused. Without one, the browser's own address (its Origin).
// Each flow belongs to the browser that started it: a short-lived HttpOnly cookie holds a hash of the state.
// OAuth never makes an account, and only signs in an account its owner linked (Link my account, signed in).
// Emails are never matched: profile emails aren't verified, and a provider may let people change theirs.

const FLOW_MS = 10 * 60 * 1000;
const TICKET_MS = 60 * 1000;
const sha256 = (t: string) => crypto.createHash("sha256").update(t).digest("hex");
const hashTicket = sha256;
const NOT_LINKED = "This sign-in isn't linked to a ByteSize account yet. Sign in with your password, then use Link my account in Settings › Security.";
const OTHER_BROWSER = "That sign-in was started in another browser (or its cookie is gone). Start again here.";

// Each flow's cookie: only sent back to the OAuth routes, gone after 10 minutes, unreadable by scripts.
// SameSite=Lax still comes along when the provider sends the browser back (a top-level GET). Its name
// carries a short hash of the state, so sign-ins started in two tabs each keep their own.
const cookieName = (state: string) => `bytesize_oauth_${sha256(`name:${state}`).slice(0, 12)}`;
const flowCookie = (state: string, value: string, origin: string, maxAge: number) =>
  `${cookieName(state)}=${value}; Path=/api/auth/oauth; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${origin.startsWith("https:") ? "; Secure" : ""}`;
function cookieOf(req: FastifyRequest, name: string) {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}
const same = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

const originOf = (u: string | null | undefined) => {
  try {
    return u ? new URL(u.trim()).origin : null;
  } catch {
    return null;
  }
};

/** APP_URL and PASSKEY_ORIGINS from .env, as origins. */
export function appOriginsFromEnv(env: NodeJS.ProcessEnv) {
  const all = [env.APP_URL ?? "", ...(env.PASSKEY_ORIGINS ?? "").split(",")].map(originOf).filter((o): o is string => !!o);
  return [...new Set(all)];
}

// The issuer as discovery sees it: its discovery address counts as the issuer, but a trailing slash matters
// ("…/bytesize/" and "…/bytesize" are different issuers, as openid-client requires the exact one)
const issuerHref = (u: string | null | undefined) => {
  if (!u) return null;
  const bare = u.trim().replace(/\/\.well-known\/openid-configuration\/?$/, "");
  try {
    return new URL(bare).href;
  } catch {
    return bare;
  }
};

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

  // The app's own addresses: Settings › Email's app address first, then .env's
  const configuredOrigins = async () => {
    const all = [originOf((await app.mail.stored())?.appUrl), ...app.appOrigins].filter((o): o is string => !!o);
    return [...new Set(all)];
  };
  // Where the browser comes back to: a configured address (the browser's, when it's one of them), else the browser's own
  async function appOrigin(req: FastifyRequest) {
    const allowed = await configuredOrigins();
    const o = typeof req.headers.origin === "string" ? originOf(req.headers.origin) : null;
    if (allowed.length) {
      if (!o) return allowed[0];
      if (allowed.includes(o)) return o;
      throw new HttpError(400, `Sign in from ByteSize's own address: ${allowed[0]}`);
    }
    if (!o) throw new HttpError(400, "Start OAuth sign-in from ByteSize in a browser.");
    return o;
  }

  // ---------- Settings › Security (admin) ----------

  app.get("/api/settings/oauth", async (req) => {
    requireAdmin(req);
    const [origin] = await configuredOrigins();
    return { settings: view(await getOAuth(db), app.jwtSecret), redirectUri: origin ? callbackUri(origin) : null }; // null: the browser's own address
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
    // A new provider or client: nobody's link is known to work there (a provider may give each client its
    // own subjects), so OAuth only goes off until it's chosen again
    let message: string | undefined;
    if (next.oauthOnly && (issuerHref(current.issuerUrl) !== issuerHref(next.issuerUrl) || current.clientId !== next.clientId)) {
      next.oauthOnly = false;
      message = "The provider changed, so OAuth only is off. Link your account there, then turn OAuth only on again.";
    }
    // Lockout prevention: OAuth only needs OAuth on, and this admin's account linked at this very provider
    // (which proves it works): the issuer the provider reports must be the one the link was made with
    if (next.oauthOnly) {
      if (!next.enabled) throw new HttpError(400, "Turn OAuth on before choosing OAuth only.");
      const linkFirst = new HttpError(400, "Link your account first (Link my account): that signs in with the provider once, so you know it works before passwords are turned off.");
      const [me] = await db.select({ subject: users.oauthSubject, issuer: users.oauthIssuer }).from(users).where(eq(users.id, userId));
      if (!me?.subject || me.issuer !== issuerHref(next.issuerUrl)) throw linkFirst;
      resetOAuthCache();
      let reported: string;
      try {
        reported = (await providerConfig(next, app.jwtSecret, fetchImpl)).serverMetadata().issuer;
      } catch (e) {
        throw new HttpError(400, `Couldn't reach the provider to check your link: ${(e as Error).message}`);
      }
      if (reported !== me.issuer) throw linkFirst;
    }
    await saveOAuth(db, next);
    return { settings: view(next, app.jwtSecret), ...(message ? { message } : {}) };
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

  async function begin(req: FastifyRequest, reply: FastifyReply, purpose: "login" | "link", userId?: number, phone?: { appKey: string }) {
    const s = await getOAuth(db);
    if (!oauthReady(s)) throw new HttpError(400, "OAuth sign-in isn't set up.");
    const origin = await appOrigin(req);
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
    await db.insert(oauthFlows).values({
      state,
      purpose,
      userId: userId ?? null,
      verifier,
      nonce,
      redirectUri,
      appOrigin: origin,
      client: phone ? "ios" : "web",
      appKeyHash: phone ? sha256(`appkey:${phone.appKey}`) : null,
      expiresAt: new Date(now.getTime() + FLOW_MS),
    });
    // The web page's flow belongs to its browser (a cookie); the iPhone app's to its key (Safari's sheet has no cookie)
    if (!phone) reply.header("set-cookie", flowCookie(state, sha256(state), origin, FLOW_MS / 1000));
    return { url: authUrl.href };
  }

  // client "ios" (I6): the iPhone app, with a random key of its own (43+ characters, e.g. 32 random bytes in base64url)
  const startBody = z.union([
    z.object({ client: z.literal("ios"), appKey: z.string().min(43, "The app's key is too short").max(200) }),
    z.object({ client: z.literal("web").optional() }).passthrough(),
  ]);
  app.post("/api/auth/oauth/start", async (req, reply) => {
    checkLockout(req);
    const body = startBody.parse(req.body ?? {});
    return begin(req, reply, "login", undefined, "appKey" in body && body.client === "ios" ? { appKey: body.appKey } : undefined);
  });
  app.post("/api/auth/oauth/link/start", async (req, reply) => begin(req, reply, "link", requireUser(req)));

  // Where the provider sends the browser back. Always ends with a redirect into the app.
  app.get("/api/auth/oauth/callback", async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const now = app.now();
    // A state works once
    const [flow] = q.state ? await db.delete(oauthFlows).where(eq(oauthFlows.state, q.state)).returning() : [];
    const back = (origin: string, path: string, params: Record<string, string>) =>
      flow?.client === "ios"
        ? // The iPhone app: Safari's sheet closes on bytesize://oauth (ticket, or the reason it failed)
          reply.redirect(`bytesize://oauth?${new URLSearchParams(params.oauth_error ? { error: params.oauth_error } : params)}`)
        : reply.redirect(`${origin}/#${path}?${new URLSearchParams(params)}`);
    const tooLong = "That sign-in took too long or was already used. Try again.";
    if (!flow) return reply.redirect(`/#/?${new URLSearchParams({ oauth_error: tooLong })}`);
    if (flow.expiresAt <= now) return back(flow.appOrigin, "/", { oauth_error: tooLong }); // the phone's goes back to the app
    const fromCookie = cookieOf(req, cookieName(flow.state));
    reply.header("set-cookie", flowCookie(flow.state, "", flow.appOrigin, 0)); // used: cleared
    const fail = async (message: string, logReason: string): Promise<FastifyReply> => {
      if (flow.purpose === "login") {
        recordFailure(req);
        await logSignIn(db, req, { username: null, success: false, reason: logReason });
        return back(flow.appOrigin, "/", { oauth_error: message });
      }
      return back(flow.appOrigin, "/settings/security", { oauth_error: message });
    };
    // Only the browser that started it may finish it (the iPhone app's flow is held by its key, checked at finish)
    if (flow.client !== "ios" && (!fromCookie || !same(fromCookie, sha256(flow.state)))) return fail(OTHER_BROWSER, "OAuth: started in another browser");
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
      const [owner] = await db.select({ disabled: users.disabled }).from(users).where(eq(users.id, flow.userId!));
      if (!owner || owner.disabled) return fail("This account is turned off. Ask your ByteSize admin.", "");
      const [taken] = await db.select({ id: users.id }).from(users).where(identity);
      if (taken && taken.id !== flow.userId) return fail("That identity is linked to another account.", "");
      const [u] = await db.update(users).set({ oauthIssuer: claims.iss, oauthSubject: claims.sub, oauthEmail: claims.email ?? null }).where(eq(users.id, flow.userId!)).returning();
      await logEvent(db, { category: "auth", level: "info", source: s.providerName, event: "OAuth sign-in linked", detail: u.username, userId: u.id });
      return back(flow.appOrigin, "/settings/security", { oauth: "linked" });
    }

    // Sign in: only the account linked to this identity
    const [user] = await db.select().from(users).where(identity);
    if (!user) return fail(NOT_LINKED, `OAuth: no linked account (${claims.email ?? claims.sub})`);
    if (user.disabled) return fail("This account is turned off. Ask your ByteSize admin.", `OAuth: account turned off (${user.username})`);
    clearFailures(req);
    const { session } = await startSession(db, app.jwtSecret, req, user, s.providerName, now); // "Authentik" in Signed-in devices
    await logSignIn(db, req, { username: user.username, success: true, reason: `Signed in with ${s.providerName}`, sessionId: session.id });
    const ticket = crypto.randomBytes(24).toString("base64url");
    await db.delete(oauthTickets).where(lt(oauthTickets.expiresAt, now));
    await db.insert(oauthTickets).values({ ticketHash: hashTicket(ticket), sessionId: session.id, appKeyHash: flow.appKeyHash, expiresAt: new Date(now.getTime() + TICKET_MS) });
    return back(flow.appOrigin, "/oauth", { ticket });
  });

  // The page swaps the one-time ticket for its login token
  app.post("/api/auth/oauth/finish", async (req) => {
    const { ticket, appKey } = z.object({ ticket: z.string().max(200), appKey: z.string().max(200).optional() }).parse(req.body ?? {});
    const live = and(eq(oauthTickets.ticketHash, hashTicket(ticket)), gt(oauthTickets.expiresAt, app.now()));
    // An iPhone app ticket swaps only with the app's own key; a wrong try doesn't use it up
    const [held] = await db.select({ appKeyHash: oauthTickets.appKeyHash }).from(oauthTickets).where(live);
    if (held?.appKeyHash && (!appKey || !same(held.appKeyHash, sha256(`appkey:${appKey}`)))) throw new HttpError(400, "That sign-in expired. Try again.");
    const [t] = await db.delete(oauthTickets).where(live).returning();
    const [row] = t ? await db.select({ session: sessions, user: users }).from(sessions).innerJoin(users, eq(users.id, sessions.userId)).where(eq(sessions.id, t.sessionId)) : [];
    if (!row || row.session.revokedAt || row.user.disabled) throw new HttpError(400, "That sign-in expired. Try again.");
    return { token: signToken(row.user.id, row.user.tokenVersion, app.jwtSecret, row.session.tokenId), user: publicUser(row.user) };
  });
}
