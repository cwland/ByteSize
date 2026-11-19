import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { setupTestApp, type TestApp } from "./helpers.js";
import { asUser } from "./isolation.js";
import { emailConfigFromEnv, smtpOptions } from "../src/lib/mail.js";
import { logUnhandledRejection } from "../src/lib/startup.js";

// Settings › Email (admin): the server's email account, used for forgot-password codes
let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
beforeEach(async () => {
  await t.reset();
  await t.login(); // alex, alex@example.com, admin
});
afterAll(async () => t.close());

export const gmail = {
  enabled: true,
  host: "smtp.gmail.com",
  port: 587,
  security: "starttls",
  username: "alex@gmail.com",
  password: "app-password-123",
  fromName: "ByteSize",
  fromAddress: "alex@gmail.com",
  appUrl: "https://bytesize.example.com/",
};

// The form's test button, then Save (Save needs a test that went through with the same settings)
async function testThenSave(settings: object = gmail) {
  const test = await t.api("POST", "/api/settings/email/test", { settings });
  expect(test.status, JSON.stringify(test.body)).toBe(200);
  return t.api("PUT", "/api/settings/email", settings);
}

describe("Settings › Email", () => {
  it("nothing set up: email is off and the sign-in screen has no Forgot password", async () => {
    expect((await t.api("GET", "/api/settings/email")).body).toMatchObject({ source: "none", active: false, settings: null, env: { available: false } });
    expect((await t.api("GET", "/api/auth/status")).body).toMatchObject({ forgotPassword: false });
  });

  it("Send test email sends with the form's values, to the admin's own address unless another is given", async () => {
    const r = await t.api("POST", "/api/settings/email/test", { settings: gmail });
    expect(r.body).toEqual({ ok: true, to: "alex@example.com" });
    expect(t.mail.sent).toHaveLength(1);
    expect(t.mail.sent[0]).toMatchObject({ to: "alex@example.com", from: '"ByteSize" <alex@gmail.com>', subject: "ByteSize test email" });
    expect(t.mail.sent[0].config).toMatchObject({ host: "smtp.gmail.com", port: 587, security: "starttls", username: "alex@gmail.com", password: "app-password-123" });
    await t.api("POST", "/api/settings/email/test", { settings: gmail, to: "other@example.com" });
    expect(t.mail.sent[1].to).toBe("other@example.com");
    // testing saves nothing
    expect((await t.api("GET", "/api/settings/email")).body.settings).toBeNull();
  });

  it("Save needs a test email that went through with the same settings first", async () => {
    const before = await t.api("PUT", "/api/settings/email", gmail);
    expect(before.status).toBe(400);
    expect(before.body.error).toMatch(/Send a test email/);
    // a test that failed doesn't count
    t.mail.failNext = "Invalid login: 535 Username and Password not accepted";
    const failed = await t.api("POST", "/api/settings/email/test", { settings: gmail });
    expect(failed.status).toBe(502);
    expect(failed.body.error).toContain("Username and Password not accepted");
    expect((await t.api("PUT", "/api/settings/email", gmail)).status).toBe(400);
    // a test of other settings doesn't count either
    await t.api("POST", "/api/settings/email/test", { settings: { ...gmail, password: "something-else" } });
    expect((await t.api("PUT", "/api/settings/email", gmail)).status).toBe(400);
    // the same settings, tested: saves
    expect((await testThenSave()).status).toBe(200);
    // the app address and from name aren't part of the connection: no new test needed
    expect((await t.api("PUT", "/api/settings/email", { ...gmail, password: undefined, appUrl: "https://food.example.com", fromName: "Food" })).status).toBe(200);
    // a new server is
    expect((await t.api("PUT", "/api/settings/email", { ...gmail, host: "smtp.fastmail.com" })).status).toBe(400);
    // turning email off never needs a test
    expect((await t.api("PUT", "/api/settings/email", { ...gmail, enabled: false })).status).toBe(200);
  });

  it("saves; the password is encrypted at rest and never sent back", async () => {
    expect((await testThenSave()).status).toBe(200);
    const res = (await t.api("GET", "/api/settings/email")).body;
    expect(res).toMatchObject({ source: "app", active: true });
    expect(res.settings).toMatchObject({ enabled: true, host: "smtp.gmail.com", security: "starttls", username: "alex@gmail.com", passwordSet: true, passwordUnreadable: false, appUrl: "https://bytesize.example.com" });
    expect(JSON.stringify(res)).not.toContain("app-password-123");
    const row = await t.db.execute<{ v: string }>(sql`select value::text as v from app_settings where key = 'email'`);
    expect(row.rows[0].v).not.toContain("app-password-123");
    expect(row.rows[0].v).toContain("v1:");
    expect((await t.api("GET", "/api/auth/status")).body).toMatchObject({ forgotPassword: true });
  });

  it("a blank password keeps the saved one; an empty string removes it", async () => {
    await testThenSave();
    const { password: _p, ...noPassword } = gmail;
    expect((await t.api("PUT", "/api/settings/email", { ...noPassword, fromName: "Food log" })).status).toBe(200);
    await t.api("POST", "/api/settings/email/test", {});
    expect(t.mail.sent.at(-1)!.config.password).toBe("app-password-123");
    expect(t.mail.sent.at(-1)!.from).toBe('"Food log" <alex@gmail.com>');
    // the form's test with the box left blank uses the saved password too
    await t.api("POST", "/api/settings/email/test", { settings: noPassword });
    expect(t.mail.sent.at(-1)!.config.password).toBe("app-password-123");
    await t.api("PUT", "/api/settings/email", { ...gmail, enabled: false, password: "" });
    expect((await t.api("GET", "/api/settings/email")).body.settings.passwordSet).toBe(false);
  });

  it("the eye and copy buttons fetch the saved password (logged, never cached)", async () => {
    await testThenSave();
    const r = await t.api("GET", "/api/settings/email/password");
    expect(r.body).toEqual({ key: "app-password-123" });
    expect(r.headers["cache-control"]).toBe("no-store");
    const logs = (await t.api("GET", "/api/logs?category=api")).body;
    expect(logs[0]).toMatchObject({ event: "Saved key shown", detail: "Email password, shown to alex" });
    expect(JSON.stringify(logs)).not.toContain("app-password-123");
  });

  it("a changed server secret makes the saved password unreadable, and says so", async () => {
    await testThenSave();
    await t.db.execute(sql`update app_settings set value = jsonb_set(value, '{passwordEnc}', '"v1:AAAA:BBBB:CCCC"') where key = 'email'`);
    expect((await t.api("GET", "/api/settings/email")).body.settings).toMatchObject({ passwordSet: true, passwordUnreadable: true });
    expect((await t.api("GET", "/api/settings/email/password")).status).toBe(409);
  });

  it("checks the fields when email is on", async () => {
    const bad = await t.api("POST", "/api/settings/email/test", { settings: { ...gmail, host: "", fromAddress: "nope", appUrl: "bytesize.local" } });
    expect(bad.status).toBe(400);
    expect(bad.body.details.map((d: { path: string }) => d.path)).toEqual(expect.arrayContaining(["settings.host", "settings.fromAddress", "settings.appUrl"]));
    // turned off, it can be saved half filled in
    expect((await t.api("PUT", "/api/settings/email", { enabled: false })).status).toBe(200);
  });

  it("turned off in the app: no email, even when .env has some; removing the app's settings brings .env back", async () => {
    await t.close();
    t = await setupTestApp({ emailEnv: emailConfigFromEnv({ SMTP_HOST: "env.smtp", SMTP_PORT: "25", MAIL_FROM: "server@example.com", APP_URL: "https://env.example.com/" }) });
    await t.login();
    expect((await t.api("GET", "/api/settings/email")).body).toMatchObject({ source: "env", active: true, env: { available: true, host: "env.smtp:25" } });
    expect((await t.api("GET", "/api/auth/status")).body.forgotPassword).toBe(true);
    await t.api("PUT", "/api/settings/email", { ...gmail, enabled: false });
    expect((await t.api("GET", "/api/auth/status")).body.forgotPassword).toBe(false);
    expect((await t.api("DELETE", "/api/settings/email")).status).toBe(204);
    expect((await t.api("GET", "/api/auth/status")).body.forgotPassword).toBe(true);
  });

  it("only an admin can see, test or change email settings", async () => {
    await testThenSave();
    const sam = await t.createUser("sam");
    const as = asUser(t, sam.token);
    expect((await as("GET", "/api/settings/email")).status).toBe(403);
    expect((await as("GET", "/api/settings/email/password")).status).toBe(403);
    expect((await as("PUT", "/api/settings/email", { enabled: false })).status).toBe(403);
    expect((await as("POST", "/api/settings/email/test", { settings: gmail })).status).toBe(403);
    expect((await as("DELETE", "/api/settings/email")).status).toBe(403);
    t.setToken("");
    expect((await t.api("GET", "/api/settings/email")).status).toBe(401);
    expect((await t.api("GET", "/api/settings/email/password")).status).toBe(401);
  });

  it("each email sent is in Settings › Logs (only the subject)", async () => {
    await t.api("POST", "/api/settings/email/test", { settings: gmail });
    const logs = (await t.api("GET", "/api/logs?category=email")).body;
    expect(logs[0]).toMatchObject({ level: "info", source: "Test email", event: 'Sent "ByteSize test email" to alex@example.com' });
  });
});

describe("work done after answering", () => {
  it("never rejects, even when the work and its error handler both fail (a database that's down); idle() still resolves", async () => {
    const unhandled: unknown[] = [];
    const note = (e: unknown) => unhandled.push(e);
    process.on("unhandledRejection", note);
    try {
      t.app.mail.background(
        async () => {
          throw new Error("send failed");
        },
        async () => {
          throw new Error("logging failed too");
        }
      );
      t.app.mail.background(
        async () => {
          throw new Error("send failed");
        },
        () => {
          throw new Error("a handler that throws at once");
        }
      );
      // nobody waits for it in the server: give Node a turn to report an unhandled rejection
      await new Promise((r) => setTimeout(r, 50));
      expect(unhandled).toEqual([]);
      await t.app.mail.idle();
    } finally {
      process.off("unhandledRejection", note);
    }
  });

  it("the server's last resort logs an unhandled rejection and keeps running", () => {
    const lines: string[] = [];
    logUnhandledRejection((m) => lines.push(m))(new Error("boom"));
    expect(lines[0]).toMatch(/Unhandled rejection: .*boom/);
  });
});

describe("SMTP", () => {
  it("gives up on a mail server that doesn't answer (connection 10 s, greeting 10 s, socket 20 s)", () => {
    const o = smtpOptions({ host: "smtp.example.com", port: 587, security: "starttls", username: "me", password: "pw", fromName: null, fromAddress: "me@example.com", appUrl: null });
    expect(o).toMatchObject({ host: "smtp.example.com", port: 587, secure: false, requireTLS: true, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000 });
  });
});

describe("email settings from .env", () => {
  it("SMTP_*, MAIL_FROM and APP_URL", () => {
    expect(emailConfigFromEnv({})).toBeNull();
    expect(emailConfigFromEnv({ SMTP_HOST: "mail.example.com", SMTP_PORT: "465", SMTP_USER: "me", SMTP_PASS: "pw", MAIL_FROM: "me@example.com", APP_URL: "https://x.example.com/" })).toEqual({
      host: "mail.example.com",
      port: 465,
      security: "ssl",
      username: "me",
      password: "pw",
      fromName: null,
      fromAddress: "me@example.com",
      appUrl: "https://x.example.com",
    });
  });
});
