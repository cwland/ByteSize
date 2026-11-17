import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";
import { asUser } from "./isolation.js";

let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
beforeEach(async () => {
  await t.reset();
  await t.login(); // admin "cory"
});
afterAll(async () => t.close());

describe("admin user management", () => {
  it("members can't manage users", async () => {
    const sam = await t.createUser("sam");
    const as = asUser(t, sam.token);
    expect((await as("GET", "/api/admin/users")).status).toBe(403);
    expect((await as("POST", "/api/admin/users", { username: "eve", password: "password123" })).status).toBe(403);
    expect((await as("PATCH", `/api/admin/users/${sam.id}`, { isAdmin: true })).status).toBe(403);
  });

  it("admin creates a user who can sign in", async () => {
    const res = await t.api("POST", "/api/admin/users", { username: "Sam", password: "password123", displayName: "Sam" });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ username: "sam", isAdmin: false, disabled: false });
    const admin = t.getToken();
    t.setToken("");
    const login = await t.api("POST", "/api/auth/login", { username: "sam", password: "password123" });
    expect(login.status).toBe(200);
    expect(login.body.user.isAdmin).toBe(false);
    t.setToken(admin);
    const list = await t.api("GET", "/api/admin/users");
    expect(list.body.users.map((u: any) => u.username)).toEqual(["cory", "sam"]);
    expect(JSON.stringify(list.body)).not.toMatch(/passwordHash|password_hash/);
  });

  it("usernames are unique ignoring case and spaces", async () => {
    expect((await t.api("POST", "/api/admin/users", { username: "Sam", password: "password123" })).status).toBe(200);
    const dup = await t.api("POST", "/api/admin/users", { username: " sam ", password: "password123" });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe("That username is taken");
  });

  it("disabling a user cuts off their current token", async () => {
    const sam = await t.createUser("sam");
    const as = asUser(t, sam.token);
    expect((await as("GET", "/api/auth/me")).status).toBe(200);
    expect((await t.api("PATCH", `/api/admin/users/${sam.id}`, { disabled: true })).status).toBe(200);
    expect((await as("GET", "/api/auth/me")).status).toBe(401);
    t.setToken("");
    expect((await t.api("POST", "/api/auth/login", { username: "sam", password: "password123" })).status).toBe(401);
  });

  it("a new password from the admin signs the user out everywhere", async () => {
    const sam = await t.createUser("sam");
    expect((await t.api("PATCH", `/api/admin/users/${sam.id}`, { password: "brandnew123" })).status).toBe(200);
    expect((await asUser(t, sam.token)("GET", "/api/auth/me")).status).toBe(401);
    t.setToken("");
    expect((await t.api("POST", "/api/auth/login", { username: "sam", password: "brandnew123" })).status).toBe(200);
  });

  it("can't remove the last admin", async () => {
    const me = (await t.api("GET", "/api/auth/me")).body.user;
    for (const change of [{ isAdmin: false }, { disabled: true }]) {
      const res = await t.api("PATCH", `/api/admin/users/${me.id}`, change);
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("ByteSize needs at least one admin");
    }
    await t.createUser("ana", { isAdmin: true });
    expect((await t.api("PATCH", `/api/admin/users/${me.id}`, { isAdmin: false })).status).toBe(200);
  });

  it("a disabled admin doesn't count toward the last admin", async () => {
    const me = (await t.api("GET", "/api/auth/me")).body.user;
    const ana = await t.createUser("ana", { isAdmin: true });
    expect((await t.api("PATCH", `/api/admin/users/${ana.id}`, { disabled: true })).status).toBe(200);
    expect((await t.api("PATCH", `/api/admin/users/${me.id}`, { isAdmin: false })).status).toBe(409);
  });

  it("unknown user is 404", async () => {
    expect((await t.api("PATCH", "/api/admin/users/9999", { disabled: true })).status).toBe(404);
  });
});
