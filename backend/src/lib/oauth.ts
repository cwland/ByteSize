import { eq } from "drizzle-orm";
import * as client from "openid-client";
import type { Db } from "../db/index.js";
import { appSettings } from "../db/schema.js";
import { logEvent } from "./appLog.js";
import { HttpError } from "./errors.js";
import { decryptSecret, encryptSecret } from "./secrets.js";

// Sign in with OAuth / OpenID Connect (Authentik, Keycloak, Google, Microsoft...). Copied from Culury.
// Settings live in app_settings under "oauth" (the client secret encrypted); an admin sets them in
// Settings › Security. oauthOnly hides the password form (the API refuses passwords too); passkeys still work.
// Locked out? `npm run auth:reset`, or EMERGENCY_DISABLE_OAUTH=true, turns OAuth only and OAuth off.

export interface StoredOAuth {
  enabled: boolean;
  providerName: string; // the button says "Sign in with {providerName}"
  issuerUrl: string | null; // the issuer, or its .well-known/openid-configuration address
  clientId: string;
  clientSecretEnc: string | null;
  oauthOnly: boolean;
}

export const OAUTH_DEFAULTS: StoredOAuth = { enabled: false, providerName: "OAuth", issuerUrl: null, clientId: "", clientSecretEnc: null, oauthOnly: false };
export const OAUTH_SCOPES = "openid email profile";

export async function getOAuth(db: Db): Promise<StoredOAuth> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, "oauth"));
  return { ...OAUTH_DEFAULTS, ...((row?.value as Partial<StoredOAuth>) ?? {}) };
}

export async function saveOAuth(db: Db, value: StoredOAuth) {
  await db
    .insert(appSettings)
    .values({ key: "oauth", value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
  configCache = null;
}

export const secretFor = (s: StoredOAuth, jwtSecret: string) => (s.clientSecretEnc ? decryptSecret(s.clientSecretEnc, jwtSecret) : null);
export const encryptOAuthSecret = (plain: string, jwtSecret: string) => encryptSecret(plain, jwtSecret);

// Ready to use: on, with a client ID and the issuer
export const oauthReady = (s: StoredOAuth) => s.enabled && !!s.clientId && !!s.issuerUrl;
// Password sign-in is refused only when OAuth only is chosen AND OAuth is actually on
export const passwordsAllowed = (s: StoredOAuth) => !(s.oauthOnly && oauthReady(s));

// The library's view of the provider (discovery is looked up once and kept for 10 minutes)
let configCache: { key: string; at: number; config: client.Configuration } | null = null;
export function resetOAuthCache() {
  configCache = null;
}

export async function providerConfig(s: StoredOAuth, jwtSecret: string, fetchImpl?: typeof fetch): Promise<client.Configuration> {
  if (!s.issuerUrl) throw new Error("No issuer is set");
  const secret = secretFor(s, jwtSecret) ?? undefined;
  const key = JSON.stringify([s.issuerUrl, s.clientId, s.clientSecretEnc]);
  if (configCache && configCache.key === key && Date.now() - configCache.at < 10 * 60 * 1000) return configCache.config;
  const url = new URL(s.issuerUrl.replace(/\/\.well-known\/openid-configuration\/?$/, ""));
  const config = await client.discovery(url, s.clientId, secret, undefined, {
    ...(url.protocol === "http:" ? { execute: [client.allowInsecureRequests] } : {}), // a provider on the home network
    ...(fetchImpl ? { [client.customFetch]: fetchImpl as never } : {}),
  });
  if (fetchImpl) config[client.customFetch] = fetchImpl as never;
  configCache = { key, at: Date.now(), config };
  return config;
}

/** Locked out: OAuth only off, and OAuth sign-in off (the rest of the settings are kept). */
export async function emergencyResetAuth(db: Db) {
  const s = await getOAuth(db);
  const next: StoredOAuth = { ...s, enabled: false, oauthOnly: false };
  await saveOAuth(db, next);
  return { was: { enabled: s.enabled, oauthOnly: s.oauthOnly }, now: { enabled: next.enabled, oauthOnly: next.oauthOnly } };
}

/** EMERGENCY_DISABLE_OAUTH=true in .env: the same, every time the server starts. null when it isn't set. */
export async function applyEmergencyOAuthSwitch(db: Db, env: NodeJS.ProcessEnv) {
  if (env.EMERGENCY_DISABLE_OAUTH !== "true") return null;
  const r = await emergencyResetAuth(db);
  await logEvent(db, { category: "auth", level: "warning", source: "EMERGENCY_DISABLE_OAUTH", event: "OAuth sign-in and OAuth only turned off at start", detail: "Remove EMERGENCY_DISABLE_OAUTH from .env once you're back in." });
  return r;
}

/** OAuth only: password sign-in (and resetting a password by email) is refused. */
export async function requirePasswords(db: Db) {
  if (!passwordsAllowed(await getOAuth(db))) throw new HttpError(403, "Password sign-in is turned off. Use the OAuth button or a passkey.");
}
