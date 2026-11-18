import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { setupTestApp, type TestApp } from "./helpers.js";
import { asUser } from "./isolation.js";
import { fakeIdp } from "./fakeIdp.js";
import { oauthFlows, oauthTickets, users } from "../src/db/schema.js";

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

// Click the button, approve at the provider, come back: where the app sends the browser, and its hash's parameters
async function oauth(who: { sub: string; email?: string; verified?: boolean }, path = "/api/auth/oauth/start", token: string | null = null) {
  const start = await req("POST", path, {}, token);
  expect(start.statusCode, start.body).toBe(200);
  const back = idp.approve(start.json().url, who);
  const cb = await t.app.inject({ method: "GET", url: back.pathname + back.search });
  expect(cb.statusCode).toBe(302);
  const to = new URL(cb.headers.location as string, ORIGIN);
  return { to, params: new URLSearchParams(to.hash.split("?")[1] ?? "") };
}
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

  it("signs in with a verified email that matches a profile (any capitalization), then links it; a one-time ticket, never the token, is in the address", async () => {
    await save();
    const { to, params } = await oauth({ sub: "ak-123", email: "CORY@Example.com", verified: true });
    expect(to.origin + to.hash.split("?")[0]).toBe(`${ORIGIN}#/oauth`);
    expect(to.href).not.toContain("eyJ");
    const fin = await finish(params.get("ticket"));
    expect(fin.statusCode).toBe(200);
    expect(fin.json().user.username).toBe("cory");
    expect((await req("GET", "/api/auth/me", undefined, fin.json().token)).statusCode).toBe(200);
    expect((await finish(params.get("ticket"))).statusCode).toBe(400); // used up
    expect((await t.api("GET", "/api/auth/oauth")).body.linked).toMatchObject({ email: "CORY@Example.com" });
    const logins = (await t.api("GET", "/api/auth/logins")).body;
    expect(logins[0]).toMatchObject({ success: true, reason: "Signed in with Authentik" });
    const devices = (await req("GET", "/api/auth/sessions", undefined, fin.json().token)).json();
    expect(devices.find((d: any) => d.current).how).toBe("Authentik");
    // next time it's found by its ID, whatever the email says
    expect((await oauth({ sub: "ak-123", email: "changed@else.com", verified: true })).params.get("ticket")).toBeTruthy();
  });

  it("tickets are stored hashed and expire after a minute", async () => {
    await save();
    t.clock.date = new Date();
    const { params } = await oauth({ sub: "ak-123", email: "cory@example.com", verified: true });
    const [row] = await t.db.select().from(oauthTickets);
    expect(JSON.stringify(row)).not.toContain(params.get("ticket"));
    t.clock.date = new Date(t.clock.date.getTime() + 61_000);
    expect((await finish(params.get("ticket"))).statusCode).toBe(400);
  });

  it("refuses an unverified email, an email no profile has, and an email two profiles share", async () => {
    await save();
    let r = await oauth({ sub: "sneaky", email: "cory@example.com", verified: false });
    expect(r.params.get("oauth_error")).toMatch(/isn't linked to ByteSize/);
    r = await oauth({ sub: "sneaky", email: "cory@example.com" }); // no email_verified claim at all
    expect(r.params.get("oauth_error")).toMatch(/isn't linked/);
    r = await oauth({ sub: "stranger", email: "someone@else.com", verified: true });
    expect(r.params.get("oauth_error")).toMatch(/isn't linked/);
    const sam = await t.createUser("sam");
    await asUser(t, sam.token)("PATCH", "/api/profile", { email: "Cory@example.com" });
    r = await oauth({ sub: "ak-new", email: "cory@example.com", verified: true });
    expect(r.params.get("oauth_error")).toMatch(/isn't linked/);
    const reasons = (await t.api("GET", "/api/auth/logins")).body.map((e: any) => e.reason);
    expect(reasons.filter((x: string) => x.startsWith("OAuth: no matching account"))).toHaveLength(4);
    expect((await t.db.select().from(users)).every((u) => u.oauthSubject === null)).toBe(true);
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
    const start = (await req("POST", "/api/auth/oauth/start", {}, null)).json();
    const st = new URL(start.url).searchParams.get("state");
    const no = await t.app.inject({ method: "GET", url: `/api/auth/oauth/callback?error=access_denied&state=${st}` });
    expect(err(no.headers.location)).toBe("access_denied");
    // the state works once
    const again = await t.app.inject({ method: "GET", url: `/api/auth/oauth/callback?code=x&state=${st}` });
    expect(err(again.headers.location)).toMatch(/already used/);
    // expired (10 minutes by the app's clock)
    t.clock.date = new Date();
    const late = (await req("POST", "/api/auth/oauth/start", {}, null)).json();
    const back = idp.approve(late.url, { sub: "x", email: "cory@example.com", verified: true });
    t.clock.date = new Date(t.clock.date.getTime() + 10 * 60 * 1000 + 1000);
    expect(err((await t.app.inject({ method: "GET", url: back.pathname + back.search })).headers.location)).toMatch(/took too long/);
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
    const a = (await req("POST", "/api/auth/oauth/start", {}, null)).json();
    const b = (await req("POST", "/api/auth/oauth/start", {}, null)).json();
    const backA = idp.approve(a.url, { sub: "x", email: "cory@example.com", verified: true });
    const stateB = new URL(b.url).searchParams.get("state")!;
    const r = await t.app.inject({ method: "GET", url: `/api/auth/oauth/callback?code=${backA.searchParams.get("code")}&state=${stateB}` });
    const params = new URLSearchParams(String(r.headers.location).split("?")[1]);
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

  it("needs OAuth on", async () => {
    await save();
    await link();
    expect((await t.api("PUT", "/api/settings/oauth", settings({ enabled: false, oauthOnly: true }))).body.error).toMatch(/Turn OAuth on/);
  });
});
