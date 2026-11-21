import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";
import { softPasskey } from "./softPasskey.js";

let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
afterAll(async () => t.close());
beforeEach(async () => {
  await t.reset();
  await t.login();
});

const LOCAL = "http://localhost:5173";
const SITE = "https://bytesize.example.com";
const call = (method: string, url: string, origin: string | null, payload?: object, token = t.getToken()) =>
  t.app
    .inject({ method: method as "POST", url, payload, headers: { ...(origin ? { origin } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36" } })
    .then((r) => ({ status: r.statusCode, body: r.body ? r.json() : undefined }));

async function addPasskey(key: ReturnType<typeof softPasskey>, origin = LOCAL, name?: string, token = t.getToken()) {
  const o = await call("POST", "/api/passkeys/register/options", origin, {}, token);
  expect(o.status).toBe(200);
  return call("POST", "/api/passkeys/register/verify", origin, { challengeId: o.body.challengeId, response: key.create(o.body.options, origin), name }, token);
}
async function signIn(key: ReturnType<typeof softPasskey>, origin = LOCAL, signAs?: string) {
  const o = await call("POST", "/api/passkeys/login/options", origin, {}, "");
  expect(o.status).toBe(200);
  return call("POST", "/api/passkeys/login/verify", origin, { challengeId: o.body.challengeId, response: key.get(o.body.options, origin, signAs) }, "");
}

describe("passkeys", () => {
  it("add one while signed in, then sign in with it (no password)", async () => {
    const key = softPasskey({ synced: true });
    const added = await addPasskey(key);
    expect(added.status).toBe(200);
    expect(added.body).toMatchObject({ name: "Passkey on Chrome on Mac", rpId: "localhost" });

    const r = await signIn(key);
    expect(r.status).toBe(200);
    expect(r.body.user).toMatchObject({ username: "alex", isAdmin: true });
    expect((await call("GET", "/api/auth/me", null, undefined, r.body.token)).status).toBe(200);

    const list = (await call("GET", "/api/passkeys", LOCAL)).body;
    expect(list[0]).toMatchObject({ name: "Passkey on Chrome on Mac", rpId: "localhost", synced: true });
    expect(list[0].lastUsedAt).toBeTruthy();
    // shows as a passkey sign-in in the devices list and history
    expect((await call("GET", "/api/auth/sessions", null)).body.find((s: any) => s.how === "passkey")).toBeTruthy();
    expect((await call("GET", "/api/auth/logins", null)).body[0]).toMatchObject({ success: true, reason: "Signed in with passkey (Passkey on Chrome on Mac)" });
  });

  it("each passkey belongs to the address it was made on", async () => {
    const key = softPasskey();
    expect((await addPasskey(key, SITE, "iPhone")).body.rpId).toBe("bytesize.example.com");
    expect((await signIn(key, SITE)).status).toBe(200);
    // the same passkey at another address isn't set up there
    const other = await signIn(key, LOCAL, "bytesize.example.com");
    expect(other.status).toBe(401);
    expect(other.body.error).toMatch(/isn't set up here/);
    expect((await call("GET", "/api/passkeys", LOCAL)).body[0]).toMatchObject({ rpId: "bytesize.example.com" });
  });

  it("needs https (or localhost), and PASSKEY_ORIGINS can limit the addresses", async () => {
    const r = await call("POST", "/api/passkeys/login/options", "http://192.168.1.20:5173", {}, "");
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/secure address/);
    expect((await call("POST", "/api/passkeys/login/options", null, {}, "")).status).toBe(400); // no browser
    process.env.PASSKEY_ORIGINS = "https://bytesize.example.com";
    try {
      expect((await call("POST", "/api/passkeys/login/options", "https://evil.example.net", {}, "")).body.error).toMatch(/aren't allowed/);
      expect((await call("POST", "/api/passkeys/login/options", SITE, {}, "")).status).toBe(200);
    } finally {
      delete process.env.PASSKEY_ORIGINS;
    }
  });

  it("refuses a forged or replayed sign-in, and an unknown passkey", async () => {
    const key = softPasskey();
    await addPasskey(key);
    const o = await call("POST", "/api/passkeys/login/options", LOCAL, {}, "");
    const good = key.get(o.body.options, LOCAL);
    const forged = { ...good, response: { ...good.response, signature: softPasskey().get(o.body.options, LOCAL).response.signature } };
    expect((await call("POST", "/api/passkeys/login/verify", LOCAL, { challengeId: o.body.challengeId, response: forged }, "")).status).toBe(401);
    // the challenge is used up either way
    expect((await call("POST", "/api/passkeys/login/verify", LOCAL, { challengeId: o.body.challengeId, response: good }, "")).body.error).toMatch(/too long/);
    expect((await signIn(softPasskey())).body.error).toMatch(/isn't set up here/);
    const history = (await call("GET", "/api/auth/logins", null)).body.map((e: any) => e.reason);
    expect(history).toContain("Unknown passkey");
    expect(history.some((r: string) => r.startsWith("Passkey check failed"))).toBe(true);
  });

  it("rename and remove; only when signed in; the same one can't be added twice", async () => {
    const key = softPasskey();
    const { id } = (await addPasskey(key)).body;
    expect((await addPasskey(key)).body.error).toMatch(/already added/); // (a real browser also refuses it up front)
    expect((await call("PATCH", `/api/passkeys/${id}`, LOCAL, { name: "MacBook Touch ID" })).body.name).toBe("MacBook Touch ID");
    expect((await call("GET", "/api/passkeys", LOCAL, undefined, "")).status).toBe(401);
    expect((await call("POST", "/api/passkeys/register/options", LOCAL, {}, "")).status).toBe(401);
    expect((await call("DELETE", `/api/passkeys/${id}`, LOCAL)).status).toBe(204);
    expect((await signIn(key)).status).toBe(401);
  });

  it("a disabled user can't sign in with a passkey", async () => {
    const sam = await t.createUser("sam");
    const key = softPasskey();
    expect((await addPasskey(key, LOCAL, "Sam's Mac", sam.token)).status).toBe(200);
    expect((await signIn(key)).status).toBe(200);
    expect((await t.api("PATCH", `/api/admin/users/${sam.id}`, { disabled: true })).status).toBe(200);
    const r = await signIn(key);
    expect(r.status).toBe(401);
    expect(r.body.token).toBeUndefined();
    expect(r.body.error).toMatch(/turned off/);
    const history = (await call("GET", "/api/auth/logins", null)).body;
    expect(history[0]).toMatchObject({ success: false, username: "sam", reason: "Account turned off" });
  });
});

// I6: Apple lets the iPhone app use this site's passkeys only when the site names the app
describe("apple-app-site-association", () => {
  const get = () => t.app.inject({ method: "GET", url: "/.well-known/apple-app-site-association" });
  it("isn't there until IOS_APP_ID is set", async () => {
    delete process.env.IOS_APP_ID;
    expect((await get()).statusCode).toBe(404);
  });
  it("names the app for passkeys (webcredentials)", async () => {
    process.env.IOS_APP_ID = "ABCDE12345.com.cwland.bytesize";
    try {
      const r = await get();
      expect(r.statusCode).toBe(200);
      expect(r.headers["content-type"]).toContain("application/json");
      expect(r.json()).toEqual({ webcredentials: { apps: ["ABCDE12345.com.cwland.bytesize"] } });
    } finally {
      delete process.env.IOS_APP_ID;
    }
  });
  it("refuses a malformed IOS_APP_ID rather than publishing it", async () => {
    process.env.IOS_APP_ID = "not an app id";
    try {
      expect((await get()).statusCode).toBe(404);
    } finally {
      delete process.env.IOS_APP_ID;
    }
  });
});
