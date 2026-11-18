import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { setupTestApp, type TestApp } from "./helpers.js";
import { asUser } from "./isolation.js";
import { fakeIdp } from "./fakeIdp.js";
import { oauthFlows, oauthTickets, users } from "../src/db/schema.js";
import { appOriginsFromEnv } from "../src/routes/oauth.js";

// Sign in with OAuth / OpenID Connect (Settings › Security, admin config)
let t: TestApp;
const idp = fakeIdp();
beforeAll(async () => (t = await setupTestApp({ oauthFetch: idp.fetchImpl })));
beforeEach(async () => {
  await t.reset();
  await t.login(); // cory, cory@example.com, admin
  idp.state.down = false;
});
afterAll(async () => t.close());

const ORIGIN = "https://bytesize.example.com";
const settings = (over: object = {}) => ({ enabled: true, providerName: "Authentik", issuerUrl: idp.issuer, clientId: "bs-client", clientSecret: "bs-secret", oauthOnly: false, ...over });
const req = (method: string, url: string, payload?: object, token: string | null = t.getToken()) =>
  t.app.inject({ method: method as "POST", url, payload, headers: { origin: ORIGIN, ...(token ? { authorization: `Bearer ${token}` } : {}) } });
const save = async (over: object = {}) => {
  const r = await t.api("PUT", "/api/settings/oauth", settings(over));
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r;
};

// Click the button: the provider's address, and the cookie that ties the sign-in to this browser
async function begin(path = "/api/auth/oauth/start", token: string | null = null) {
  const start = await req("POST", path, {}, token);
  expect(start.statusCode, start.body).toBe(200);
  const setCookie = String(start.headers["set-cookie"] ?? "");
  return { url: start.json().url as string, cookie: setCookie.split(";")[0], setCookie };
}
// Back from the provider (with this browser's cookie, unless another is given)
async function callback(url: string, cookie: string | null) {
  const cb = await t.app.inject({ method: "GET", url, headers: cookie ? { cookie } : {} });
  expect(cb.statusCode).toBe(302);
  const to = new URL(cb.headers.location as string, ORIGIN);
  return { to, params: new URLSearchParams(to.hash.split("?")[1] ?? ""), res: cb };
}
// Click the button, approve at the provider, come back: where the app sends the browser, and its hash's parameters
async function oauth(who: { sub: string; email?: string; verified?: boolean }, path = "/api/auth/oauth/start", token: string | null = null, cookie?: string | null) {
  const b = await begin(path, token);
  const back = idp.approve(b.url, who);
  return callback(back.pathname + back.search, cookie === undefined ? b.cookie : cookie);
}
const NOT_LINKED = "This sign-in isn't linked to a ByteSize account yet. Sign in with your password, then use Link my account in Settings › Security.";
const finish = async (ticket: string | null) => req("POST", "/api/auth/oauth/finish", { ticket }, null);
const link = (token = t.getToken()) => oauth({ sub: "ak-cory", email: "cory@corp.example" }, "/api/auth/oauth/link/start", token);

describe("OAuth settings (admin)", () => {
  it("saved with the secret encrypted, never sent back; the eye fetches it; Test connection reaches the provider", async () => {
    const r = await save();
    expect(r.body.settings).toMatchObject({ enabled: true, providerName: "Authentik", issuerUrl: idp.issuer, clientId: "bs-client", clientSecretSet: true, clientSecretUnreadable: false, oauthOnly: false, ready: true });
    expect(JSON.stringify(r.body)).not.toContain("bs-secret");
    expect(JSON.stringify((await t.api("GET", "/api/settings/oauth")).body)).not.toContain("bs-secret");
    const row = await t.db.execute<{ v: string }>(sql`select value::text as v from app_settings where key = 'oauth'`);
    expect(row.rows[0].v).not.toContain("bs-secret");
    expect(row.rows[0].v).toContain("v1:");
    const shown = await t.api("GET", "/api/settings/oauth/secret");
    expect(shown.body).toEqual({ key: "bs-secret" });
    expect(shown.headers["cache-control"]).toBe("no-store");
    expect((await t.api("POST", "/api/settings/oauth/test")).body).toMatchObject({ ok: true, issuer: idp.issuer });
    expect((await t.api("GET", "/api/auth/status")).body).toMatchObject({ oauth: { label: "Authentik" }, passwords: true });
  });

  it("a blank secret keeps the saved one; Test connection says when the provider can't be reached", async () => {
    await save();
    const { clientSecret: _s, ...rest } = settings();
    await t.api("PUT", "/api/settings/oauth", { ...rest, providerName: "Work" });
    expect((await t.api("GET", "/api/settings/oauth/secret")).body).toEqual({ key: "bs-secret" });
    idp.state.down = true;
    const r = await t.api("POST", "/api/settings/oauth/test");
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Couldn't reach the provider/);
  });

  it("checks what's needed to turn it on", async () => {
    expect((await t.api("PUT", "/api/settings/oauth", settings({ clientId: "" }))).body.error).toMatch(/Client ID/);
    expect((await t.api("PUT", "/api/settings/oauth", settings({ issuerUrl: "" }))).body.error).toMatch(/issuer/);
    expect((await t.api("PUT", "/api/settings/oauth", settings({ issuerUrl: "not a url" }))).status).toBe(400);
    expect((await t.api("PUT", "/api/settings/oauth", settings({ enabled: false, clientId: "", issuerUrl: "" }))).status).toBe(200);
    expect((await t.api("GET", "/api/auth/status")).body.oauth).toBeNull();
  });

  it("only an admin can see, test or change the settings", async () => {
    await save();
    const sam = await t.createUser("sam");
    const as = asUser(t, sam.token);
    expect((await as("GET", "/api/settings/oauth")).status).toBe(403);
    expect((await as("PUT", "/api/settings/oauth", settings())).status).toBe(403);
    expect((await as("GET", "/api/settings/oauth/secret")).status).toBe(403);
    expect((await as("POST", "/api/settings/oauth/test")).status).toBe(403);
    // everyone sees whether they can link, and their own link
    expect((await as("GET", "/api/auth/oauth")).body).toEqual({ available: true, providerName: "Authentik", linked: null });
  });
});

describe("OAuth sign-in", () => {
  it("state, nonce and PKCE (S256) go to the provider; the redirect URI is this app's callback", async () => {
    await save();
    const start = (await req("POST", "/api/auth/oauth/start", {}, null)).json();
    const u = new URL(start.url);
    expect(u.origin + u.pathname).toBe(`${idp.issuer}/authorize`);
    expect(u.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/api/auth/oauth/callback`);
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("code_challenge")).toMatch(/^[\w-]{43}$/);
    expect(u.searchParams.get("state")).toMatch(/^[\w-]{20,}$/);
    expect(u.searchParams.get("nonce")).toMatch(/^[\w-]{20,}$/);
    expect(u.searchParams.get("scope")).toBe("openid email profile");
    // the flow is kept in the database, not the verifier in the address
    const [flow] = await t.db.select().from(oauthFlows);
    expect(flow).toMatchObject({ state: u.searchParams.get("state"), purpose: "login" });
    expect(start.url).not.toContain(flow.verifier);
  });

  it("signs in a linked account; a one-time ticket, never the token, is in the address", async () => {
    await save();
    await link();
    const { to, params } = await oauth({ sub: "ak-cory", email: "changed@else.com", verified: true });
    expect(to.origin + to.hash.split("?")[0]).toBe(`${ORIGIN}#/oauth`);
    expect(to.href).not.toContain("eyJ");
    const fin = await finish(params.get("ticket"));
    expect(fin.statusCode).toBe(200);
    expect(fin.json().user.username).toBe("cory");
    expect((await req("GET", "/api/auth/me", undefined, fin.json().token)).statusCode).toBe(200);
    expect((await finish(params.get("ticket"))).statusCode).toBe(400); // used up
    const logins = (await t.api("GET", "/api/auth/logins")).body;
    expect(logins[0]).toMatchObject({ success: true, reason: "Signed in with Authentik" });
    const devices = (await req("GET", "/api/auth/sessions", undefined, fin.json().token)).json();
    expect(devices.find((d: any) => d.current).how).toBe("Authentik");
  });

  it("tickets are stored hashed and expire after a minute", async () => {
    await save();
    await link();
    t.clock.date = new Date();
    const { params } = await oauth({ sub: "ak-cory" });
    const [row] = await t.db.select().from(oauthTickets);
    expect(JSON.stringify(row)).not.toContain(params.get("ticket"));
    t.clock.date = new Date(t.clock.date.getTime() + 61_000);
    expect((await finish(params.get("ticket"))).statusCode).toBe(400);
  });

  it("an identity nobody linked can't sign in, even with a verified email that matches a profile; nothing gets linked", async () => {
    await save();
    for (const who of [
      { sub: "ak-123", email: "cory@example.com", verified: true },
      { sub: "ak-123", email: "CORY@Example.com", verified: true },
      { sub: "sneaky", email: "cory@example.com", verified: false },
      { sub: "stranger", email: "someone@else.com", verified: true },
    ]) {
      const r = await oauth(who);
      expect(r.params.get("oauth_error")).toBe(NOT_LINKED);
      expect(r.params.get("ticket")).toBeNull();
    }
    expect((await t.db.select().from(users)).every((u) => u.oauthSubject === null)).toBe(true);
    const reasons = (await t.api("GET", "/api/auth/logins")).body.map((e: any) => e.reason);
    expect(reasons.filter((x: string) => x.startsWith("OAuth: no linked account"))).toHaveLength(4);
  });

  it("never creates an account", async () => {
    await save();
    await oauth({ sub: "new-person", email: "new@example.com", verified: true });
    expect(await t.db.select().from(users)).toHaveLength(1);
  });

  it("a turned-off account can't sign in with OAuth", async () => {
    await save();
    const sam = await t.createUser("sam");
    await link(sam.token);
    await t.db.update(users).set({ disabled: true }).where(eq(users.id, sam.id));
    const r = await oauth({ sub: "ak-cory" });
    expect(r.params.get("oauth_error")).toMatch(/turned off/);
    expect(r.params.get("ticket")).toBeNull();
  });

  it("a forged or expired state, a declined sign-in, the wrong secret and a provider that's down all fail safely", async () => {
    await save();
    const err = (loc: unknown) => new URLSearchParams(String(loc).split("?")[1]).get("oauth_error");
    const forged = await t.app.inject({ method: "GET", url: "/api/auth/oauth/callback?code=x&state=nope" });
    expect(err(forged.headers.location)).toMatch(/took too long or was already used/);
    // declined at the provider
    const start = await begin();
    const st = new URL(start.url).searchParams.get("state");
    const no = await callback(`/api/auth/oauth/callback?error=access_denied&state=${st}`, start.cookie);
    expect(no.params.get("oauth_error")).toBe("access_denied");
    // the state works once
    const again = await callback(`/api/auth/oauth/callback?code=x&state=${st}`, start.cookie);
    expect(again.params.get("oauth_error")).toMatch(/already used/);
    // expired (10 minutes by the app's clock)
    t.clock.date = new Date();
    const late = await begin();
    const back = idp.approve(late.url, { sub: "x" });
    t.clock.date = new Date(t.clock.date.getTime() + 10 * 60 * 1000 + 1000);
    expect((await callback(back.pathname + back.search, late.cookie)).params.get("oauth_error")).toMatch(/took too long/);
    t.clock.date = null;
    // wrong secret: the provider turns the code down
    await save({ clientSecret: "wrong" });
    expect((await oauth({ sub: "ak-1", email: "cory@example.com", verified: true })).params.get("oauth_error")).toMatch(/didn't work/);
    // down
    await save();
    idp.state.down = true;
    const down = await req("POST", "/api/auth/oauth/start", {}, null);
    expect(down.statusCode).toBe(502);
    expect((await t.api("GET", "/api/logs?category=auth")).body[0].event).toMatch(/Couldn't reach Authentik/);
  });

  it("the PKCE verifier must match: a code taken to another flow fails", async () => {
    await save();
    await link();
    const a = await begin();
    const b = await begin();
    const backA = idp.approve(a.url, { sub: "ak-cory" });
    const stateB = new URL(b.url).searchParams.get("state")!;
    const { params } = await callback(`/api/auth/oauth/callback?code=${backA.searchParams.get("code")}&state=${stateB}`, b.cookie);
    expect(params.get("ticket")).toBeNull();
    expect(params.get("oauth_error")).toBeTruthy();
  });

  it("isn't offered when it's off", async () => {
    await save({ enabled: false });
    expect((await req("POST", "/api/auth/oauth/start", {}, null)).statusCode).toBe(400);
    expect((await t.api("GET", "/api/auth/oauth")).body).toMatchObject({ available: false });
  });
});

describe("Link my account", () => {
  it("links any identity from the provider to the signed-in person; then it signs them in", async () => {
    await save();
    const { params, to } = await link();
    expect(to.hash).toMatch(/^#\/settings\/security\?/);
    expect(params.get("oauth")).toBe("linked");
    expect((await t.api("GET", "/api/auth/oauth")).body).toMatchObject({ available: true, linked: { email: "cory@corp.example" } });
    const fin = await finish((await oauth({ sub: "ak-cory" })).params.get("ticket"));
    expect(fin.json().user.username).toBe("cory");
  });

  it("an identity linked to someone else can't be linked again; unlink removes only your own", async () => {
    await save();
    await link();
    const sam = await t.createUser("sam");
    const r = await oauth({ sub: "ak-cory" }, "/api/auth/oauth/link/start", sam.token);
    expect(r.params.get("oauth_error")).toMatch(/linked to another account/);
    expect((await asUser(t, sam.token)("POST", "/api/auth/oauth/unlink")).status).toBe(200);
    expect((await t.api("GET", "/api/auth/oauth")).body.linked).not.toBeNull(); // cory's is still there
    expect((await t.api("POST", "/api/auth/oauth/unlink")).status).toBe(200);
    expect((await t.api("GET", "/api/auth/oauth")).body.linked).toBeNull();
  });

  it("an account turned off while linking isn't linked", async () => {
    await save();
    const sam = await t.createUser("sam");
    const b = await begin("/api/auth/oauth/link/start", sam.token);
    await t.db.update(users).set({ disabled: true }).where(eq(users.id, sam.id));
    const back = idp.approve(b.url, { sub: "ak-sam" });
    const r = await callback(back.pathname + back.search, b.cookie);
    expect(r.params.get("oauth_error")).toMatch(/turned off/);
    const [row] = await t.db.select().from(users).where(eq(users.id, sam.id));
    expect(row.oauthSubject).toBeNull();
  });

  it("needs a signed-in person", async () => {
    await save();
    expect((await req("POST", "/api/auth/oauth/link/start", {}, null)).statusCode).toBe(401);
  });
});

describe("OAuth only", () => {
  it("not allowed until the admin's own account is linked; then passwords (and forgot password) are refused, passkeys and OAuth still work", async () => {
    await save();
    expect((await t.api("PUT", "/api/settings/oauth", settings({ oauthOnly: true }))).body.error).toMatch(/Link your account first/);
    await link();
    expect((await t.api("PUT", "/api/settings/oauth", settings({ oauthOnly: true }))).status).toBe(200);
    expect((await t.api("GET", "/api/auth/status")).body).toMatchObject({ passwords: false, forgotPassword: false, oauth: { label: "Authentik" } });
    const pw = await req("POST", "/api/auth/login", { username: "cory", password: "password123" }, null);
    expect(pw.statusCode).toBe(403);
    expect(pw.json().error).toMatch(/Password sign-in is turned off/);
    expect((await req("POST", "/api/auth/forgot", { email: "cory@example.com" }, null)).statusCode).toBe(403);
    expect((await req("POST", "/api/auth/reset", { email: "cory@example.com", code: "123456", newPassword: "brand-new-pass" }, null)).statusCode).toBe(403);
    expect((await req("POST", "/api/passkeys/login/options", {}, null)).statusCode).toBe(200);
    expect((await oauth({ sub: "ak-cory" })).params.get("ticket")).toBeTruthy();
    expect((await t.api("POST", "/api/auth/oauth/unlink")).body.error).toMatch(/Turn off OAuth only/);
  });

  it("turns itself off when the provider changes; the admin must be linked at the new provider to turn it on again", async () => {
    await save();
    await link();
    await save({ oauthOnly: true });
    const moved = await t.api("PUT", "/api/settings/oauth", settings({ issuerUrl: "https://other-idp.test/o/bytesize", oauthOnly: true }));
    expect(moved.status).toBe(200);
    expect(moved.body.settings.oauthOnly).toBe(false);
    expect(moved.body.message).toMatch(/OAuth only is off/);
    expect((await t.api("GET", "/api/auth/status")).body.passwords).toBe(true);
    // cory's link is at the old provider
    expect((await t.api("PUT", "/api/settings/oauth", settings({ issuerUrl: "https://other-idp.test/o/bytesize", oauthOnly: true }))).body.error).toMatch(/Link your account first/);
    // back to the provider cory is linked at (its discovery address counts as the same issuer)
    expect((await t.api("PUT", "/api/settings/oauth", settings({ issuerUrl: `${idp.issuer}/.well-known/openid-configuration` }))).status).toBe(200);
    expect((await t.api("PUT", "/api/settings/oauth", settings({ issuerUrl: `${idp.issuer}/.well-known/openid-configuration`, oauthOnly: true }))).body.settings.oauthOnly).toBe(true);
  });

  it("needs OAuth on", async () => {
    await save();
    await link();
    expect((await t.api("PUT", "/api/settings/oauth", settings({ enabled: false, oauthOnly: true }))).body.error).toMatch(/Turn OAuth on/);
  });
});

describe("each sign-in belongs to the browser that started it", () => {
  it("the start sets a short-lived HttpOnly, SameSite=Lax cookie holding a hash of the state (not the state)", async () => {
    await save();
    const b = await begin();
    const state = new URL(b.url).searchParams.get("state")!;
    expect(b.setCookie).toMatch(/HttpOnly/i);
    expect(b.setCookie).toMatch(/SameSite=Lax/i);
    expect(b.setCookie).toMatch(/Max-Age=600/i);
    expect(b.setCookie).toMatch(/Path=\/api\/auth\/oauth/i);
    expect(b.setCookie).not.toContain(state);
  });

  it("coming back without the cookie, or with another sign-in's, fails (sign in and Link my account)", async () => {
    await save();
    await link();
    let r = await oauth({ sub: "ak-cory" }, "/api/auth/oauth/start", null, null);
    expect(r.params.get("oauth_error")).toMatch(/started in another browser/);
    expect(r.params.get("ticket")).toBeNull();
    const other = await begin();
    r = await oauth({ sub: "ak-cory" }, "/api/auth/oauth/start", null, other.cookie);
    expect(r.params.get("oauth_error")).toMatch(/started in another browser/);
    // Link my account: someone else's browser can't finish your link
    const sam = await t.createUser("sam");
    r = await oauth({ sub: "ak-sam" }, "/api/auth/oauth/link/start", sam.token, null);
    expect(r.params.get("oauth_error")).toMatch(/started in another browser/);
    expect((await asUser(t, sam.token)("GET", "/api/auth/oauth")).body.linked).toBeNull();
    // the right cookie still works, and is cleared on the way back
    const ok = await oauth({ sub: "ak-cory" });
    expect(ok.params.get("ticket")).toBeTruthy();
    expect(String(ok.res.headers["set-cookie"])).toMatch(/Max-Age=0/);
  });
});

describe("the app's own address", () => {
  const emailRow = (appUrl: string) =>
    sql`insert into app_settings (key, value) values ('email', ${JSON.stringify({ enabled: false, host: "", port: 587, security: "starttls", username: null, passwordEnc: null, fromName: null, fromAddress: "", appUrl })}::jsonb)`;

  it("with an address set (Settings › Email), the redirect URI uses it and another Origin is refused", async () => {
    await save();
    await t.db.execute(emailRow(ORIGIN));
    expect((await t.api("GET", "/api/settings/oauth")).body.redirectUri).toBe(`${ORIGIN}/api/auth/oauth/callback`);
    const evil = await t.app.inject({ method: "POST", url: "/api/auth/oauth/start", payload: {}, headers: { origin: "https://evil.example" } });
    expect(evil.statusCode).toBe(400);
    expect(evil.json().error).toContain(ORIGIN);
    const ok = await begin();
    expect(new URL(ok.url).searchParams.get("redirect_uri")).toBe(`${ORIGIN}/api/auth/oauth/callback`);
    // no Origin at all: the configured address
    const none = await t.app.inject({ method: "POST", url: "/api/auth/oauth/start", payload: {} });
    expect(new URL(none.json().url).searchParams.get("redirect_uri")).toBe(`${ORIGIN}/api/auth/oauth/callback`);
  });

  it("without one, the browser's own address is used, and the settings say so", async () => {
    await save();
    expect((await t.api("GET", "/api/settings/oauth")).body.redirectUri).toBeNull();
    expect(new URL((await begin()).url).searchParams.get("redirect_uri")).toBe(`${ORIGIN}/api/auth/oauth/callback`);
  });

  it("APP_URL and PASSKEY_ORIGINS in .env count as the app's address", () => {
    expect(appOriginsFromEnv({})).toEqual([]);
    expect(appOriginsFromEnv({ APP_URL: "https://food.example.com/", PASSKEY_ORIGINS: "https://a.example.com, https://b.example.com/" })).toEqual(["https://food.example.com", "https://a.example.com", "https://b.example.com"]);
  });
});
