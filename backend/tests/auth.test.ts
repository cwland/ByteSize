import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";

let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
beforeEach(async () => t.reset());
afterAll(async () => t.close());

describe("login", () => {
  it("health is public, everything else needs login", async () => {
    expect((await t.api("GET", "/api/health")).status).toBe(200);
    expect((await t.api("GET", "/api/auth/me")).status).toBe(401);
  });

  it("first run requires setup, then setup is locked", async () => {
    expect((await t.api("GET", "/api/auth/status")).body).toMatchObject({ setupRequired: true });
    const setup = await t.api("POST", "/api/auth/setup", { username: "alex", password: "password123", email: "alex@example.com" });
    expect(setup.status).toBe(200);
    expect(setup.body.token).toBeTruthy();
    expect((await t.api("GET", "/api/auth/status")).body).toMatchObject({ setupRequired: false });
    const again = await t.api("POST", "/api/auth/setup", { username: "other", password: "password123", email: "other@example.com" });
    expect(again.status).toBe(409);
  });

  it("rejects short passwords", async () => {
    const res = await t.api("POST", "/api/auth/setup", { username: "alex", password: "short", email: "alex@example.com" });
    expect(res.status).toBe(400);
  });

  it("logs in with the right password only", async () => {
    await t.login();
    t.setToken("");
    expect((await t.api("POST", "/api/auth/login", { username: "alex", password: "wrong-pass" })).status).toBe(401);
    const ok = await t.api("POST", "/api/auth/login", { username: "alex", password: "password123", email: "alex@example.com" });
    expect(ok.status).toBe(200);
    t.setToken(ok.body.token);
    expect((await t.api("GET", "/api/auth/me")).body.user.username).toBe("alex");
  });

  it("ignores capitalization in the username (but not the password)", async () => {
    await t.login();
    t.setToken("");
    for (const username of ["Alex", "ALEX", "  aLeX "]) {
      expect((await t.api("POST", "/api/auth/login", { username, password: "password123" })).status).toBe(200);
    }
    expect((await t.api("POST", "/api/auth/login", { username: "Alex", password: "PASSWORD123" })).status).toBe(401);
  });

  it("rejects a bad token", async () => {
    await t.login();
    t.setToken("not-a-real-token");
    expect((await t.api("GET", "/api/auth/me")).status).toBe(401);
  });

  it("locks out after 5 failed logins", async () => {
    await t.login();
    t.setToken("");
    for (let i = 0; i < 5; i++) {
      await t.api("POST", "/api/auth/login", { username: "alex", password: "wrong-pass" });
    }
    const res = await t.api("POST", "/api/auth/login", { username: "alex", password: "password123", email: "alex@example.com" });
    expect(res.status).toBe(429);
  });

  it("changes the password", async () => {
    await t.login();
    const res = await t.api("POST", "/api/auth/password", { currentPassword: "password123", newPassword: "newpassword456" });
    expect(res.status).toBe(200);
    t.setToken("");
    expect((await t.api("POST", "/api/auth/login", { username: "alex", password: "newpassword456" })).status).toBe(200);
  });
});

describe("bytesize accounts", () => {
  it("setup makes the first user an admin", async () => {
    await t.login();
    const me = await t.api("GET", "/api/auth/me");
    expect(me.body.user).toMatchObject({ username: "alex", isAdmin: true, units: "imperial", timezone: "America/Denver", setupDone: false });
  });

  it("setup works without an email address", async () => {
    const res = await t.api("POST", "/api/auth/setup", { username: "alex", password: "password123" });
    expect(res.status).toBe(200);
  });

  it("there is no sign-up route", async () => {
    await t.login();
    t.setToken("");
    expect((await t.api("POST", "/api/auth/register", { username: "eve", password: "password123" })).status).toBe(404);
  });
});
