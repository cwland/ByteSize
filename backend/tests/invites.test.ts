import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestApp, TEST_SECRET, type TestApp } from "./helpers.js";
import { asUser } from "./isolation.js";
import { buildApp } from "../src/app.js";
import { appLog, invites, users } from "../src/db/schema.js";
import { hashApiKey } from "../src/lib/auth.js";
import { resetForgotLimits } from "../src/routes/password-reset.js";

// Invite someone by email (§36): Settings › Users (admin), only with email set up; the person picks their password
let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
afterAll(async () => t.close());

const gmail = { enabled: true, host: "smtp.gmail.com", port: 587, security: "starttls", username: "cory@gmail.com", password: "app-password-123", fromName: "ByteSize", fromAddress: "cory@gmail.com", appUrl: "https://bytesize.example.com" };
const EXPIRED = (admin: string) => `This invite link has expired or was already used. Ask ${admin} for a new one.`;
const DAY = 24 * 60 * 60 * 1000;

async function setUpEmail() {
  await t.api("POST", "/api/settings/email/test", { settings: gmail });
  expect((await t.api("PUT", "/api/settings/email", gmail)).status).toBe(200);
  t.mail.sent.length = 0;
}

beforeEach(async () => {
  await t.reset();
  resetForgotLimits();
  await t.login(); // admin "cory"
  await t.api("PATCH", "/api/profile", { displayName: "Cory Landers" });
  await setUpEmail();
});

const invite = (over: Record<string, unknown> = {}) => t.api("POST", "/api/admin/invites", { name: "Dana Smith", username: "dana", email: "dana@example.com", ...over });
// The token from the last invite email's link
const tokenIn = (i = -1) => /#\/invite\/([A-Za-z0-9_-]+)/.exec(t.mail.sent.at(i)!.text)![1];
const anon = (method: string, url: string, payload?: object) => t.app.inject({ method: method as "POST", url, payload }).then((r) => ({ status: r.statusCode, body: r.body ? r.json() : null }));
const check = (token: string) => anon("POST", "/api/invites/check", { token });
const accept = (token: string, password = "dana-password-1") => anon("POST", "/api/invites/accept", { token, password });

describe("inviting", () => {
  it("adds the person as Invited and emails them a link to #/invite/<token> on the app's address", async () => {
    const r = await invite();
    expect(r.status).toBe(200);
    expect(r.body.user).toMatchObject({ username: "dana", displayName: "Dana Smith", email: "dana@example.com", isAdmin: false, invited: true, inviteSentAt: expect.any(String), setupDone: false });
    expect(r.body.emailError).toBeUndefined();
    expect(t.mail.sent).toHaveLength(1);
    const m = t.mail.sent[0];
    expect(m.to).toBe("dana@example.com");
    expect(m.subject).toBe("Cory Landers invited you to ByteSize");
    expect(m.text).toMatch(/https:\/\/bytesize\.example\.com\/#\/invite\/[A-Za-z0-9_-]{43}\b/);
    expect(m.text).toContain("7 days");
    expect(m.html).toContain(`href="https://bytesize.example.com/#/invite/${tokenIn()}"`);
    const list = (await t.api("GET", "/api/admin/users")).body.users;
    expect(list.find((u: any) => u.username === "dana")).toMatchObject({ invited: true, email: "dana@example.com" });
    expect(list.find((u: any) => u.username === "cory")).toMatchObject({ invited: false, inviteSentAt: null });
  });

  it("stores only a hash of the token, and the token never goes in the activity log", async () => {
    await invite();
    const token = tokenIn();
    const [row] = await t.db.select().from(invites);
    expect(row.tokenHash).toBe(hashApiKey(token));
    expect(JSON.stringify(row)).not.toContain(token);
    expect(JSON.stringify(await t.db.select().from(appLog))).not.toContain(token);
    expect(row.expiresAt.getTime() - row.sentAt.getTime()).toBe(7 * DAY);
  });

  it("uses Add person's rules for the username, and needs a name and an email", async () => {
    expect((await invite({ username: "Cory" })).status).toBe(409); // taken (any capitals)
    expect((await invite({ username: "  " })).status).toBe(400);
    expect((await invite({ email: "not-an-email" })).status).toBe(400);
    expect((await invite({ name: "" })).status).toBe(400);
    const ok = await invite({ username: "  Dana.S " });
    expect(ok.body.user.username).toBe("dana.s");
    expect(t.mail.sent).toHaveLength(1);
  });

  it("is admin only", async () => {
    const sam = await t.createUser("sam");
    const r = await asUser(t, sam.token)("POST", "/api/admin/invites", { name: "X", username: "x", email: "x@example.com" });
    expect(r.status).toBe(403);
    expect(t.mail.sent).toHaveLength(0);
  });

  it("needs email set up", async () => {
    await t.api("DELETE", "/api/settings/email");
    const r = await invite();
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("Set up email in Settings › Email to invite people");
    expect((await t.db.select().from(users)).map((u) => u.username)).toEqual(["cory"]);
  });

  it("an email that doesn't go through: the person stays Invited, the admin is told, and Resend tries again", async () => {
    t.mail.failNext = "Connection timed out";
    const r = await invite();
    expect(r.status).toBe(200);
    expect(r.body.user).toMatchObject({ username: "dana", invited: true });
    expect(r.body.emailError).toBe("The invite couldn't be emailed: Connection timed out. Press Resend to try again.");
    const resent = await t.api("POST", `/api/admin/invites/${r.body.user.id}/resend`);
    expect(resent.status).toBe(200);
    expect(t.mail.sent).toHaveLength(1);
  });

  it("Resend sends a new link; the old one stops working", async () => {
    const { body } = await invite();
    const first = tokenIn();
    t.clock.date = new Date(Date.now() + DAY);
    const r = await t.api("POST", `/api/admin/invites/${body.user.id}/resend`);
    expect(r.status).toBe(200);
    expect(new Date(r.body.user.inviteSentAt).getTime()).toBe(t.clock.date.getTime());
    const second = tokenIn();
    expect(second).not.toBe(first);
    expect(await check(first)).toEqual({ status: 410, body: { error: EXPIRED("your ByteSize admin") } }); // a replaced link is gone: no one to name
    expect((await check(second)).status).toBe(200);
  });

  it("Cancel invite removes the pending person; their link stops working", async () => {
    const { body } = await invite();
    const token = tokenIn();
    expect((await t.api("DELETE", `/api/admin/invites/${body.user.id}`)).status).toBe(204);
    expect((await t.api("GET", "/api/admin/users")).body.users.map((u: any) => u.username)).toEqual(["cory"]);
    expect((await accept(token)).status).toBe(410);
  });

  it("Resend and Cancel only work on someone still invited", async () => {
    const sam = await t.createUser("sam");
    expect((await t.api("POST", `/api/admin/invites/${sam.id}/resend`)).status).toBe(409);
    expect((await t.api("DELETE", `/api/admin/invites/${sam.id}`)).status).toBe(409);
    expect((await t.api("DELETE", `/api/admin/invites/9999`)).status).toBe(404);
    expect((await asUser(t, sam.token)("GET", "/api/auth/me")).status).toBe(200);
  });
});

describe("accepting", () => {
  it("the link shows the name and username; a new password signs the person in, to first-run setup", async () => {
    await invite();
    const token = tokenIn();
    expect(await check(token)).toEqual({ status: 200, body: { name: "Dana Smith", username: "dana" } });
    const r = await accept(token);
    expect(r.status).toBe(200);
    expect(r.body.user).toMatchObject({ username: "dana", setupDone: false });
    expect((await asUser(t, r.body.token)("GET", "/api/auth/me")).body.user.username).toBe("dana");
    // the password works from now on, and the person is no longer Invited
    expect((await anon("POST", "/api/auth/login", { username: "dana", password: "dana-password-1" })).status).toBe(200);
    expect((await t.api("GET", "/api/admin/users")).body.users.find((u: any) => u.username === "dana")).toMatchObject({ invited: false });
    const lines = JSON.stringify(await t.db.select().from(appLog));
    expect(lines).toContain("Accepted an invite");
    expect(lines).not.toContain(token);
  });

  it("is single use", async () => {
    await invite();
    const token = tokenIn();
    expect((await accept(token)).status).toBe(200);
    expect(await accept(token, "another-pass-2")).toEqual({ status: 410, body: { error: EXPIRED("your ByteSize admin") } });
    expect((await anon("POST", "/api/auth/login", { username: "dana", password: "dana-password-1" })).status).toBe(200);
  });

  it("two accepts at the same moment: only one wins", async () => {
    await invite();
    const token = tokenIn();
    const results = await Promise.all([accept(token, "first-pass-11"), accept(token, "second-pass-22")]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 410]);
  });

  it("expires after 7 days", async () => {
    await invite();
    const token = tokenIn();
    t.clock.date = new Date(Date.now() + 7 * DAY + 60_000);
    expect(await check(token)).toEqual({ status: 410, body: { error: EXPIRED("Cory Landers") } });
    expect((await accept(token)).status).toBe(410);
  });

  it("a made-up or malformed token gets the same answer", async () => {
    await invite();
    for (const bad of ["A".repeat(43), "short", ""]) {
      const r = await accept(bad);
      expect([r.status, r.body.error]).toEqual([410, EXPIRED("your ByteSize admin")]);
    }
  });

  it("uses the same password rules as everywhere", async () => {
    await invite();
    const r = await accept(tokenIn(), "short");
    expect(r.status).toBe(400);
    expect((await check(tokenIn())).status).toBe(200); // still good
  });

  it("an invited person can't sign in, or get a reset code, before accepting", async () => {
    await invite();
    const login = await anon("POST", "/api/auth/login", { username: "dana", password: "" });
    expect(login.status).toBe(401);
    expect((await anon("POST", "/api/auth/login", { username: "dana", password: "anything-at-all" })).status).toBe(401);
    t.mail.sent.length = 0;
    await anon("POST", "/api/auth/forgot", { email: "dana@example.com" });
    await t.app.mail.idle();
    expect(t.mail.sent).toHaveLength(0);
  });

  it("a turned-off invited person can't accept", async () => {
    const { body } = await invite();
    await t.api("PATCH", `/api/admin/users/${body.user.id}`, { disabled: true });
    expect((await accept(tokenIn())).status).toBe(410);
  });

  it("the accept route is rate-limited", async () => {
    const app2 = buildApp({ db: t.db, jwtSecret: TEST_SECRET, rateLimit: { max: 3, windowMs: 60_000 }, dataDir: t.app.dataDir, backupSchedule: false, appOrigins: [] });
    await app2.ready();
    try {
      const go = () => app2.inject({ method: "POST", url: "/api/invites/accept", payload: { token: "A".repeat(43), password: "password123" } });
      for (let i = 0; i < 3; i++) expect((await go()).statusCode).toBe(410);
      expect((await go()).statusCode).toBe(429);
    } finally {
      await app2.close();
    }
  });

  it("an invited admin-to-be doesn't count as the last admin", async () => {
    const { body } = await invite();
    await t.api("PATCH", `/api/admin/users/${body.user.id}`, { isAdmin: true });
    const r = await t.api("PATCH", "/api/admin/users/1", { isAdmin: false });
    expect(r.status).toBe(409);
  });
});

describe("the invite link's address", () => {
  it("without an app address saved (here or APP_URL), uses the admin's own browser address", async () => {
    await t.api("PUT", "/api/settings/email", { ...gmail, appUrl: "" });
    t.mail.sent.length = 0;
    await t.api("POST", "/api/admin/invites", { name: "Dana", username: "dana", email: "dana@example.com" }, { origin: "http://192.168.1.20:3000" });
    expect(t.mail.sent[0].text).toContain("http://192.168.1.20:3000/#/invite/");
  });

  it("never takes the address from the Host header", async () => {
    await t.api("PUT", "/api/settings/email", { ...gmail, appUrl: "" });
    t.mail.sent.length = 0;
    const r = await t.api("POST", "/api/admin/invites", { name: "Dana", username: "dana", email: "dana@example.com" }, { host: "evil.example.com" });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("Set ByteSize's own address in Settings › Email so the invite link can point at it.");
    expect(t.mail.sent).toHaveLength(0);
    expect((await t.db.select().from(users).where(eq(users.username, "dana")))).toEqual([]);
  });
});
