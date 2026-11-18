import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { setupTestApp, type TestApp } from "./helpers.js";
import { asUser } from "./isolation.js";
import { parseResetArgs, resetPassword } from "../src/cli/reset-password.js";
import { authReset } from "../src/cli/auth-reset.js";
import { applyEmergencyOAuthSwitch, getOAuth, saveOAuth, OAUTH_DEFAULTS } from "../src/lib/oauth.js";

// Locked out? The command-line escapes: npm run reset-password, npm run auth:reset, EMERGENCY_DISABLE_OAUTH
let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
beforeEach(async () => {
  await t.reset();
  await t.login();
});
afterAll(async () => t.close());

const login = (username: string, password: string) => t.app.inject({ method: "POST", url: "/api/auth/login", payload: { username, password } });

describe("npm run reset-password", () => {
  it("without a username: the first admin gets a new random password, printed once; their sessions end", async () => {
    const sam = await t.createUser("sam", { isAdmin: true });
    const r = await resetPassword(t.db, {});
    expect(r.username).toBe("cory");
    expect(r.generated).toBe(true);
    expect(r.password).toMatch(/^\S{16,}$/);
    expect((await t.api("GET", "/api/auth/me")).status).toBe(401); // cory's sign-in ended
    expect((await asUser(t, sam.token)("GET", "/api/auth/me")).status).toBe(200); // not sam's
    expect((await login("cory", "password123")).statusCode).toBe(401);
    expect((await login("cory", r.password)).statusCode).toBe(200);
    expect((await resetPassword(t.db, {})).password).not.toBe(r.password);
  });

  it("with a username (any capitalization) and a typed password", async () => {
    await t.createUser("sam");
    const r = await resetPassword(t.db, { username: " Sam ", password: "typed-password-1" });
    expect(r).toEqual({ username: "sam", password: "typed-password-1", generated: false });
    expect((await login("sam", "typed-password-1")).statusCode).toBe(200);
  });

  it("says which accounts exist when the name is wrong, and checks the password", async () => {
    await expect(resetPassword(t.db, { username: "nobody" })).rejects.toThrow("No account has that username. Accounts: cory");
    await expect(resetPassword(t.db, { username: "cory", password: "short" })).rejects.toThrow(/at least 8 characters/);
  });

  it("takes one username and --password at most; a password is never an argument, and no argument is printed back", () => {
    expect(parseResetArgs([])).toEqual({ username: undefined, typePassword: false });
    expect(parseResetArgs(["sam"])).toEqual({ username: "sam", typePassword: false });
    expect(parseResetArgs(["sam", "--password"])).toEqual({ username: "sam", typePassword: true });
    for (const bad of [["sam", "hunter2-secret"], ["--password=hunter2-secret"], ["sam", "--pw", "hunter2-secret"]]) {
      let message = "";
      try {
        parseResetArgs(bad);
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toMatch(/never given as an argument/);
      expect(message).toMatch(/NEW_PASSWORD/);
      expect(message).not.toContain("hunter2");
    }
  });

  it("is logged (who, never the password)", async () => {
    const r = await resetPassword(t.db, { username: "cory" });
    const rows = await t.db.execute<{ category: string; event: string; detail: string }>(sql`select category, event, detail from app_log`);
    expect(rows.rows).toContainEqual({ category: "auth", event: "Password reset from the command line", detail: "cory" });
    expect(JSON.stringify(rows.rows)).not.toContain(r.password);
  });
});

describe("npm run auth:reset and EMERGENCY_DISABLE_OAUTH", () => {
  const oauthOnly = () => saveOAuth(t.db, { ...OAUTH_DEFAULTS, enabled: true, providerName: "Authentik", issuerUrl: "https://idp.test", clientId: "c", oauthOnly: true });

  it("auth:reset turns OAuth-only and OAuth sign-in off", async () => {
    await oauthOnly();
    expect((await login("cory", "password123")).statusCode).toBe(403);
    expect(await authReset(t.db)).toEqual({ was: { enabled: true, oauthOnly: true }, now: { enabled: false, oauthOnly: false } });
    expect(await getOAuth(t.db)).toMatchObject({ enabled: false, oauthOnly: false, clientId: "c" }); // the rest is kept
    expect((await login("cory", "password123")).statusCode).toBe(200);
    const rows = await t.db.execute<{ event: string }>(sql`select event from app_log where category = 'auth'`);
    expect(rows.rows.map((r) => r.event)).toContain("OAuth sign-in turned off from the command line");
  });

  it("EMERGENCY_DISABLE_OAUTH=true does the same at start; anything else leaves it alone", async () => {
    await oauthOnly();
    expect(await applyEmergencyOAuthSwitch(t.db, {})).toBeNull();
    expect(await applyEmergencyOAuthSwitch(t.db, { EMERGENCY_DISABLE_OAUTH: "false" })).toBeNull();
    expect((await getOAuth(t.db)).oauthOnly).toBe(true);
    expect(await applyEmergencyOAuthSwitch(t.db, { EMERGENCY_DISABLE_OAUTH: "true" })).toEqual({ was: { enabled: true, oauthOnly: true }, now: { enabled: false, oauthOnly: false } });
    expect((await login("cory", "password123")).statusCode).toBe(200);
    const rows = await t.db.execute<{ level: string; source: string }>(sql`select level, source from app_log where category = 'auth'`);
    expect(rows.rows).toContainEqual({ level: "warning", source: "EMERGENCY_DISABLE_OAUTH" });
  });
});
