import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { setupTestApp, TEST_SECRET, type TestApp } from "./helpers.js";
import { asUser } from "./isolation.js";
import { buildApp } from "../src/app.js";
import { resetForgotLimits } from "../src/routes/password-reset.js";
import { passwordResetCodes, users } from "../src/db/schema.js";

// Forgot password on the sign-in screen: an emailed 6-digit code, then a new password
let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
afterAll(async () => t.close());

const gmail = { enabled: true, host: "smtp.gmail.com", port: 587, security: "starttls", username: "alex@gmail.com", password: "app-password-123", fromName: "ByteSize", fromAddress: "alex@gmail.com", appUrl: "https://bytesize.example.com" };
const SAME_ANSWER = "If an account uses that email, we've sent a 6-digit code.";

async function setUpEmail() {
  await t.api("POST", "/api/settings/email/test", { settings: gmail });
  expect((await t.api("PUT", "/api/settings/email", gmail)).status).toBe(200);
  t.mail.sent.length = 0;
}

let sam: { id: number; token: string };
beforeEach(async () => {
  await t.reset();
  await t.login();
  await setUpEmail();
  sam = await t.createUser("sam");
  await asUser(t, sam.token)("PATCH", "/api/profile", { email: "Sam@Example.com" });
  t.setToken("");
});

// Asks for a code, then waits for the email that goes out in the background
const forgot = async (email: string) => {
  const r = await t.api("POST", "/api/auth/forgot", { email });
  await t.app.mail.idle();
  return r;
};
const reset = (email: string, code: string, newPassword = "brand-new-pass") => t.api("POST", "/api/auth/reset", { email, code, newPassword });
const codeIn = (i = -1) => /\b(\d{6})\b/.exec(t.mail.sent.at(i)!.subject)![1];
const login = (username: string, password: string) => t.api("POST", "/api/auth/login", { username, password });

describe("forgot password", () => {
  it("same answer whether or not an account uses the email; a code is mailed only when one does", async () => {
    const none = await forgot("nobody@example.com");
    expect(none).toMatchObject({ status: 200, body: { ok: true, message: SAME_ANSWER } });
    expect(t.mail.sent).toHaveLength(0);
    const found = await forgot("  sam@EXAMPLE.com ");
    expect(found).toMatchObject({ status: 200, body: { ok: true, message: SAME_ANSWER } });
    expect(t.mail.sent).toHaveLength(1);
    const m = t.mail.sent[0];
    expect(m.to).toBe("Sam@Example.com");
    expect(m.subject).toMatch(/^Your ByteSize code: \d{6}$/);
    expect(m.text).toContain(codeIn());
    expect(m.text).toContain("If you didn't ask, ignore this");
    expect(m.text).toContain("15 minutes");
    expect(m.text).toContain("sam");
  });

  it("the code is random and stored only as a hash", async () => {
    await forgot("sam@example.com");
    await forgot("sam@example.com");
    expect(codeIn(0)).not.toBe(codeIn(1)); // (1 in a million to fail)
    const rows = await t.db.select().from(passwordResetCodes);
    expect(rows).toHaveLength(1); // the new one replaced the old
    expect(JSON.stringify(rows)).not.toContain(codeIn(1));
  });

  it("the code sets a new password and signs in; other sessions end; the old password stops working", async () => {
    await forgot("sam@example.com");
    const r = await reset("sam@example.com", codeIn());
    expect(r.status).toBe(200);
    expect(r.body.user.username).toBe("sam");
    expect((await asUser(t, r.body.token)("GET", "/api/auth/me")).status).toBe(200);
    expect((await asUser(t, sam.token)("GET", "/api/auth/me")).status).toBe(401); // the earlier sign-in
    expect((await login("sam", "password123")).status).toBe(401);
    expect((await login("sam", "brand-new-pass")).status).toBe(200);
  });

  it("works once", async () => {
    await forgot("sam@example.com");
    const code = codeIn();
    expect((await reset("sam@example.com", code)).status).toBe(200);
    const again = await reset("sam@example.com", code, "another-pass-1");
    expect(again.status).toBe(400);
    expect(again.body.error).toMatch(/wrong or has expired/);
  });

  it("lasts 15 minutes by the app's clock", async () => {
    t.clock.date = new Date("2026-11-18T12:00:00Z");
    await forgot("sam@example.com");
    const code = codeIn();
    t.clock.date = new Date("2026-11-18T12:15:01Z");
    expect((await reset("sam@example.com", code)).status).toBe(400);
    t.clock.date = new Date("2026-11-18T12:20:00Z");
    await forgot("sam@example.com");
    t.clock.date = new Date("2026-11-18T12:34:59Z");
    expect((await reset("sam@example.com", codeIn())).status).toBe(200);
  });

  it("5 wrong tries kill the code", async () => {
    await forgot("sam@example.com");
    const code = codeIn();
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) expect((await reset("sam@example.com", wrong)).status).toBe(400);
    expect((await reset("sam@example.com", code)).status).toBe(400);
    expect((await login("sam", "password123")).status).toBe(200);
  });

  it("a new request replaces the old code", async () => {
    await forgot("sam@example.com");
    const first = codeIn();
    await forgot("sam@example.com");
    const second = codeIn();
    if (first !== second) expect((await reset("sam@example.com", first)).status).toBe(400);
    expect((await reset("sam@example.com", second)).status).toBe(200);
  });

  it("a code only works with its own email", async () => {
    await t.db.update(users).set({ email: "alex@example.com" }).where(eq(users.username, "alex"));
    await forgot("sam@example.com");
    expect((await reset("alex@example.com", codeIn())).status).toBe(400);
    expect((await login("alex", "password123")).status).toBe(200);
  });

  it("checks the new password like everywhere else", async () => {
    await forgot("sam@example.com");
    const r = await reset("sam@example.com", codeIn(), "short");
    expect(r.status).toBe(400);
    expect(r.body.details[0].message).toMatch(/at least 8 characters/);
    expect((await reset("sam@example.com", codeIn())).status).toBe(200); // the code wasn't used up
  });

  it("a turned-off account gets no code, and can't use one it already has", async () => {
    await forgot("sam@example.com");
    const code = codeIn();
    await t.db.update(users).set({ disabled: true }).where(eq(users.id, sam.id));
    expect((await reset("sam@example.com", code)).status).toBe(400);
    t.mail.sent.length = 0;
    expect((await forgot("sam@example.com")).body.message).toBe(SAME_ANSWER);
    expect(t.mail.sent).toHaveLength(0);
  });

  it("an account without an email never gets a code", async () => {
    await t.db.update(users).set({ email: null }).where(eq(users.id, sam.id));
    await forgot("");
    await forgot("sam");
    expect(t.mail.sent).toHaveLength(0);
    expect(await t.db.select().from(passwordResetCodes)).toHaveLength(0);
  });

  it("goes in the activity log: who, never the code", async () => {
    await forgot("sam@example.com");
    const code = codeIn();
    await reset("sam@example.com", code);
    const rows = await t.db.execute<{ category: string; event: string; detail: string | null; user_id: number | null }>(sql`select category, event, detail, user_id from app_log order by id`);
    expect(JSON.stringify(rows.rows)).not.toContain(code);
    expect(rows.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "auth", event: "Password reset code sent", detail: "sam", user_id: sam.id }),
        expect.objectContaining({ category: "auth", event: "Password reset with an emailed code", detail: "sam", user_id: sam.id }),
        expect.objectContaining({ category: "email", event: 'Sent "Your ByteSize code" to Sam@Example.com' }),
      ])
    );
    const logins = await t.db.execute<{ reason: string }>(sql`select reason from login_events where username = 'sam' order by id desc limit 1`);
    expect(logins.rows[0].reason).toBe("Reset the password with an emailed code");
  });

  it("a mail problem gives the same answer (and is logged)", async () => {
    t.mail.failNext = "connection refused";
    expect((await forgot("sam@example.com")).body).toEqual({ ok: true, message: SAME_ANSWER });
    const rows = await t.db.execute<{ level: string; category: string }>(sql`select level, category from app_log where level = 'error'`);
    expect(rows.rows.map((r) => r.category)).toContain("email");
  });

  it("hidden, and refused, when email isn't set up", async () => {
    await t.db.execute(sql`delete from app_settings where key = 'email'`);
    expect((await t.api("GET", "/api/auth/status")).body.forgotPassword).toBe(false);
    expect((await forgot("sam@example.com")).status).toBe(404);
    expect(t.mail.sent).toHaveLength(0);
  });

  it("5 an hour per email", async () => {
    t.clock.date = new Date("2026-11-18T12:00:00Z");
    for (let i = 0; i < 5; i++) expect((await forgot("sam@example.com")).status).toBe(200);
    const sixth = await forgot("Sam@example.com");
    expect(sixth.status).toBe(429);
    // the same for an email no account uses (says nothing about who has an account)
    for (let i = 0; i < 5; i++) await forgot("nobody@example.com");
    expect((await forgot("nobody@example.com")).status).toBe(429);
    t.clock.date = new Date("2026-11-18T13:00:01Z");
    expect((await forgot("sam@example.com")).status).toBe(200);
  });

  it("5 an hour per address; checking codes is limited per address too", async () => {
    const app2 = buildApp({ db: t.db, jwtSecret: TEST_SECRET, rateLimit: { max: 10, windowMs: 60_000 }, dataDir: t.app.dataDir, backupSchedule: false, mailTransport: () => ({ sendMail: async () => ({}) }), emailEnv: null });
    await app2.ready();
    try {
      const post = (url: string, payload: object) => app2.inject({ method: "POST", url, payload, remoteAddress: "198.51.100.7" });
      for (let i = 0; i < 5; i++) expect((await post("/api/auth/forgot", { email: `n${i}@example.com` })).statusCode).toBe(200);
      expect((await post("/api/auth/forgot", { email: "n9@example.com" })).statusCode).toBe(429);
      expect((await app2.inject({ method: "POST", url: "/api/auth/forgot", payload: { email: "x@example.com" }, remoteAddress: "198.51.100.8" })).statusCode).toBe(200);
      for (let i = 0; i < 10; i++) await post("/api/auth/reset", { email: "sam@example.com", code: "123456", newPassword: "brand-new-pass" });
      expect((await post("/api/auth/reset", { email: "sam@example.com", code: "123456", newPassword: "brand-new-pass" })).statusCode).toBe(429);
    } finally {
      await app2.close();
    }
  });
  it("answers at once: the code is made and mailed in the background, so a match takes no longer than a miss", async () => {
    let release!: () => void;
    t.mail.gate = new Promise<void>((r) => (release = r));
    const r = await t.api("POST", "/api/auth/forgot", { email: "sam@example.com" });
    expect(r.body).toEqual({ ok: true, message: SAME_ANSWER });
    expect(t.mail.sent).toHaveLength(0); // still on its way
    release();
    await t.app.mail.idle();
    expect(t.mail.sent).toHaveLength(1);
    expect((await reset("sam@example.com", codeIn())).status).toBe(200);
  });

  it("5 wrong tries can't be beaten by trying many at once", async () => {
    await forgot("sam@example.com");
    const code = codeIn();
    const wrong = Array.from({ length: 40 }, (_, i) => String((Number(code) + 1 + i) % 1_000_000).padStart(6, "0"));
    const results = await Promise.all(wrong.map((c) => reset("sam@example.com", c)));
    expect(results.every((r) => r.status === 400 || r.status === 429)).toBe(true);
    const [row] = await t.db.select().from(passwordResetCodes);
    expect(row.wrongTries).toBeLessThanOrEqual(5);
    resetForgotLimits(); // only the code's own limit is left
    expect((await reset("sam@example.com", code)).status).toBe(400);
    expect((await login("sam", "password123")).status).toBe(200);
  });

  it("10 code checks an hour per email, for an email no account uses too", async () => {
    t.clock.date = new Date("2026-11-18T12:00:00Z");
    for (const email of ["sam@example.com", "nobody@example.com"]) {
      for (let i = 0; i < 10; i++) expect((await reset(email, "000000")).status).toBe(400);
      expect((await reset(email, "000000")).status).toBe(429);
    }
    t.clock.date = new Date("2026-11-18T13:00:01Z");
    expect((await reset("sam@example.com", "000000")).status).toBe(400);
  });
});
