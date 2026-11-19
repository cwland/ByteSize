import { and, eq } from "drizzle-orm";
import { vi } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { glp1Shots, insights, logEntries, targets, userBody, userSettings, users, weighIns } from "../src/db/schema.js";
import { resetInsightRuns, weeklyInsightsCheck, writeRecap } from "../src/lib/insightsRun.js";
import { usageSettled } from "../src/lib/usage.js";
import { setupTestApp, type TestApp } from "./helpers.js";
import { asUser } from "./isolation.js";

// §45 Email me my weekly recap: the switch, when it goes out, what it holds, and what a failed send does.

let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
afterAll(async () => t.close());

const APP = "https://bytesize.example.com";
const gmail = { enabled: true, host: "smtp.gmail.com", port: 587, security: "starttls", username: "alex@gmail.com", password: "app-password-123", fromName: "ByteSize", fromAddress: "alex@gmail.com", appUrl: APP };
const NASTY = `Cheese <b>pizza</b> & "fries" <script>alert(1)</script>`;
const RECAP = { summary: `A solid week: ${NASTY}.`, wentWell: ["Logged 3 days", `Goal "Walk <more>" on track`], slipped: ["Tuesday was low"], tryNext: "Add Greek yogurt & eggs at breakfast." };

const userText = (body: any): string => body.messages?.[1]?.content ?? "";
const reply = (content: unknown) => ({ status: 200, json: { choices: [{ message: { content: JSON.stringify(content) }, finish_reason: "stop" }] } });
const aiServices = () => t.api("PUT", "/api/settings/ai", { enabled: true, mode: "auto", maxPerRun: 50, timeoutSec: 5, services: [{ name: "Home AI", provider: "openai", apiKey: "sk-home-ai", model: "gpt" }] });
const setUpEmail = async () => {
  await t.api("POST", "/api/settings/email/test", { settings: gmail });
  expect((await t.api("PUT", "/api/settings/email", gmail)).status).toBe(200);
  t.mail.sent.length = 0;
};
const at = (iso: string) => (t.clock.date = new Date(iso));
const SUN_6AM = "2026-11-15T13:05:00Z"; // 6:05 am in Denver, the day after the week of 8-14 Nov
const check = async () => {
  const written = await weeklyInsightsCheck(t.app);
  await t.app.mail.idle();
  return written;
};
const recapRow = async () => (await t.db.select().from(insights).where(and(eq(insights.kind, "recap"), eq(insights.source, "weekly"))))[0];

async function seed(userId = 1) {
  await t.db.insert(targets).values({ userId, effectiveFrom: "2026-11-01", plan: "steady", caloriesMin: 1600, caloriesMax: 1800, proteinMin: 120, proteinMax: 160, fiberMin: 25, fiberMax: 38, waterMin: 2000, waterMax: 3000 });
  await t.db.insert(userBody).values({ userId, sex: "male", birthDate: "1980-01-01", heightCm: 180, weightKg: 100, goalWeightKg: 85, activity: "some", glp1: false });
  const e = (day: string, meal: string, name: string, calories: number, protein_g: number) => ({ userId, day, meal, name, icon: "🍽", source: "cache", unit: "serving", quantity: 1, perServing: {}, servings: [{ label: "1 serving" }], nutrients: { calories, protein_g } });
  await t.db.insert(logEntries).values([e("2026-11-09", "dinner", "Cheese pizza", 1650, 70), e("2026-11-10", "lunch", "Chicken breast", 450, 80), e("2026-11-11", "lunch", "Chicken breast", 1700, 125)]);
  await t.db.insert(weighIns).values([{ userId, day: "2026-11-01", weightKg: 100 }, { userId, day: "2026-11-12", weightKg: 99 }]);
  await t.db.insert(glp1Shots).values({ userId, day: "2026-11-12", medication: "Mounjaro", doseMg: 5, site: "arm_left" });
}

beforeEach(async () => {
  await t.reset();
  resetInsightRuns(t.app);
  await t.login();
  fakeAi();
});
const fakeAi = () => {
  t.ai.respond = ((_u: string, body: any) => (userText(body).includes("Write a recap") ? reply(RECAP) : reply({ intro: "Protein fell short on 2 days.", additions: [{ suggestion: "Greek yogurt at breakfast", why: "closes the gap on 2 of 2 short days" }], swaps: [] }))) as any;
};

async function ready({ on = true } = {}) {
  fakeAi();
  await seed();
  await aiServices();
  await setUpEmail();
  if (on) expect((await t.api("PUT", "/api/insights/settings", { emailOn: true })).status).toBe(200);
}

describe("the switch", () => {
  beforeEach(async () => void (await aiServices())); // the switches need an AI service (see insights-no-ai.test.ts)

  it("is off by default, and the page says whether it can be turned on", async () => {
    const off = (await t.api("GET", "/api/insights")).body;
    expect(off.email).toEqual({ on: false, available: false, hasAddress: true });
    await setUpEmail();
    expect((await t.api("GET", "/api/insights")).body.email).toEqual({ on: false, available: true, hasAddress: true });
  });

  it("can't be turned on without email set up on the server, or an email on the account", async () => {
    const noServer = await t.api("PUT", "/api/insights/settings", { emailOn: true });
    expect(noServer.status).toBe(409);
    expect(noServer.body.error).toMatch(/email/i);
    await setUpEmail();
    await t.db.update(users).set({ email: null });
    const noAddress = await t.api("PUT", "/api/insights/settings", { emailOn: true });
    expect(noAddress.status).toBe(409);
    expect(noAddress.body.error).toBe("Add an email address in Settings › Profile");
    expect((await t.api("GET", "/api/insights")).body.email).toEqual({ on: false, available: true, hasAddress: false });
  });

  it("turns on and off, keeping the weekly recap switch as it was", async () => {
    await setUpEmail();
    expect((await t.api("PUT", "/api/insights/settings", { emailOn: true })).body).toMatchObject({ weeklyOn: true, emailOn: true });
    expect((await t.api("GET", "/api/insights")).body.email.on).toBe(true);
    expect((await t.api("PUT", "/api/insights/settings", { weeklyOn: false })).body).toMatchObject({ weeklyOn: false, emailOn: true });
    expect((await t.api("PUT", "/api/insights/settings", { emailOn: false })).body).toMatchObject({ weeklyOn: false, emailOn: false });
    expect((await t.api("PUT", "/api/insights/settings", {})).status).toBe(400);
  });

  it("is kept in the person's own settings, and turning it off needs no email setup", async () => {
    await setUpEmail();
    await t.api("PUT", "/api/insights/settings", { emailOn: true });
    await t.api("DELETE", "/api/settings/email");
    expect((await t.api("PUT", "/api/insights/settings", { emailOn: false })).status).toBe(200);
    expect((await t.db.select().from(userSettings))[0].insightsEmail).toBe(false);
  });
});

describe("sending", () => {
  it("nothing goes out while the switch is off (the default)", async () => {
    await ready({ on: false });
    at(SUN_6AM);
    expect(await check()).toEqual([1]);
    expect(t.mail.sent).toHaveLength(0);
  });

  it("emails the recap once, right after the weekly run writes it", async () => {
    await ready();
    at(SUN_6AM);
    expect(await check()).toEqual([1]);
    expect(t.mail.sent).toHaveLength(1);
    const m = t.mail.sent[0];
    expect(m.to).toBe("alex@example.com");
    expect(m.subject).toBe("Your ByteSize week: Nov 8–14");
    expect(m.config.fromAddress).toBe("alex@gmail.com");
    expect((await recapRow()).emailedAt).not.toBeNull();
    // later checks, the next day: still just the one
    at("2026-11-15T14:05:00Z");
    await check();
    at("2026-11-17T14:05:00Z");
    await check();
    expect(t.mail.sent).toHaveLength(1);
  });

  it("holds the recap and the app's numbers, in HTML and plain text", async () => {
    await ready();
    at(SUN_6AM);
    await check();
    const { html, text } = t.mail.sent[0];
    for (const part of [html!, text]) {
      expect(part).toContain("Tuesday was low");
      expect(part).toContain("Logged 3 days");
      expect(part).toMatch(/3 of 7/); // days logged
      expect(part).toMatch(/1,267/); // average calories
      expect(part).toMatch(/91\.7/); // average protein
      expect(part).toMatch(/down \d\.\d lb/); // trend change, in the person's unit
      expect(part).toMatch(/You(&#39;|')re getting this because you turned on weekly recap emails in ByteSize\. Turn them off in Insights\./);
      expect(part).not.toMatch(/Home AI|openai|gpt|OpenAI|Claude|Gemini/);
    }
    expect(html).toContain("Open Insights");
    expect(html).toContain(`href="${APP}/#/insights"`);
    expect(text).toContain(`${APP}/#/insights`);
    expect(text).not.toMatch(/<(div|p|h\d|table|ul|li|a|td)[ >]/);
  });

  it("escapes every value in the HTML (food and goal text, the person's name)", async () => {
    await ready();
    await t.db.update(users).set({ displayName: `Alex <img src=x onerror=alert(1)>` });
    at(SUN_6AM);
    await check();
    const { html, text } = t.mail.sent[0];
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<b>pizza");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<more>");
    expect(html).toContain("Cheese &lt;b&gt;pizza&lt;/b&gt; &amp; &quot;fries&quot; &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("Add Greek yogurt &amp; eggs at breakfast.");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(text).toContain(`Cheese <b>pizza</b> & "fries"`); // plain text isn't HTML: nothing to escape
  });

  it("the link keeps a sub-path of the app address, like invites (§46)", async () => {
    await ready();
    await t.api("PUT", "/api/settings/email", { ...gmail, appUrl: "https://home.example.com/bytesize/" });
    at(SUN_6AM);
    await check();
    expect(t.mail.sent[0].html).toContain(`href="https://home.example.com/bytesize/#/insights"`);
  });

  it("the link uses the configured app address, else APP_URL / PASSKEY_ORIGINS, else there's no link (the email still goes)", async () => {
    await ready();
    await t.api("PUT", "/api/settings/email", { ...gmail, appUrl: `${APP}/` });
    at(SUN_6AM);
    await check();
    expect(t.mail.sent[0].html).toContain(`href="${APP}/#/insights"`);
    expect(t.mail.sent[0].text).not.toContain("//#");

    await t.reset();
    resetInsightRuns(t.app);
    await t.login();
    await ready();
    await t.api("PUT", "/api/settings/email", { ...gmail, appUrl: null });
    t.mail.sent.length = 0;
    at(SUN_6AM);
    await check();
    expect(t.mail.sent).toHaveLength(1);
    expect(t.mail.sent[0].html).not.toContain("href=");
    expect(t.mail.sent[0].html).not.toContain("Open Insights");
  });

  it("is in the person's units and date format", async () => {
    await ready();
    await t.db.update(users).set({ units: "metric" });
    await t.db.insert(userSettings).values({ userId: 1, dateFormat: "weekday-long-day-month-short" }).onConflictDoUpdate({ target: userSettings.userId, set: { dateFormat: "weekday-long-day-month-short" } });
    at(SUN_6AM);
    await check();
    expect(t.mail.sent[0].subject).toBe("Your ByteSize week: 8–14 Nov");
    expect(t.mail.sent[0].text).toMatch(/kg/);
    expect(t.mail.sent[0].text).not.toMatch(/\blb\b/);
    await t.db.update(userSettings).set({ dateFormat: "iso" });
    await t.db.delete(insights);
    resetInsightRuns(t.app);
    at("2026-11-15T15:05:00Z");
    await check();
    expect(t.mail.sent[1].subject).toBe("Your ByteSize week: 2026-11-08–2026-11-14");
  });

  it("not for a 'so far' recap (Refresh), a seed-demo recap, or a recap that is rewritten", async () => {
    await ready();
    at("2026-11-18T19:00:00Z");
    expect((await t.api("POST", "/api/insights/refresh", { kind: "recap" })).status).toBe(200);
    await t.app.mail.idle();
    await t.db.insert(insights).values({ userId: 1, kind: "recap", source: "demo", periodStart: "2026-11-08", periodEnd: "2026-11-14", content: { summary: "demo", wentWell: [], slipped: [], tryNext: "x" } });
    await t.app.mail.idle();
    expect(t.mail.sent).toHaveLength(0);
    // the weekly run replaces the demo recap and sends once
    at(SUN_6AM);
    await check();
    expect(t.mail.sent).toHaveLength(1);
    // written again the same week (e.g. a repair): not sent again, now or at the next checks
    await writeRecap(t.app, 1, "weekly", { from: "2026-11-08", to: "2026-11-14" });
    at("2026-11-15T14:10:00Z");
    await check();
    await t.app.mail.idle();
    expect(t.mail.sent).toHaveLength(1);
    expect(await t.db.select().from(insights).where(eq(insights.periodStart, "2026-11-08"))).toHaveLength(1);
    expect((await recapRow()).emailedAt).not.toBeNull();
  });

  it("not for a week with no recap (under 3 days logged), or without an account email, or with email turned off on the server", async () => {
    await ready();
    await t.db.update(users).set({ email: null });
    at(SUN_6AM);
    expect(await check()).toEqual([1]); // the recap itself is unaffected
    expect(t.mail.sent).toHaveLength(0);
    expect((await recapRow()).emailedAt).toBeNull();
    await t.db.delete(insights);
    await t.db.update(users).set({ email: "alex@example.com" });
    await t.api("PUT", "/api/settings/email", { ...gmail, enabled: false });
    resetInsightRuns(t.app);
    at("2026-11-15T14:05:00Z");
    expect(await check()).toEqual([1]);
    expect(t.mail.sent).toHaveLength(0);
    await t.db.delete(logEntries).where(eq(logEntries.day, "2026-11-11"));
    await t.db.delete(insights);
    await t.api("PUT", "/api/settings/email", gmail);
    t.mail.sent.length = 0;
    at("2026-11-15T15:05:00Z");
    expect(await check()).toEqual([]);
    expect(t.mail.sent).toHaveLength(0);
  });

  it("turning it on later doesn't send an older recap", async () => {
    await ready({ on: false });
    at(SUN_6AM);
    await check();
    await t.api("PUT", "/api/insights/settings", { emailOn: true });
    at("2026-11-15T14:05:00Z");
    await check();
    expect(t.mail.sent).toHaveLength(0);
  });
});

describe("a failed send", () => {
  it("is logged and never blocks the recap (or the protein help)", async () => {
    await ready();
    t.mail.failNext = "SMTP down";
    at(SUN_6AM);
    expect(await check()).toEqual([1]);
    await usageSettled();
    const rows = await t.db.select().from(insights);
    expect(rows.map((r) => r.kind).sort()).toEqual(["protein", "recap"]);
    expect((await recapRow()).emailedAt).toBeNull();
    expect(t.mail.sent).toHaveLength(0);
    const logs = (await t.api("GET", "/api/logs")).body as { category: string; level: string; source: string; event: string; detail: string | null }[];
    expect(logs.find((l) => l.category === "email")).toMatchObject({ level: "error", source: "Weekly recap", event: `Couldn't send "Your ByteSize week: Nov 8–14" to alex@example.com`, detail: "SMTP down" });
    expect(logs.find((l) => l.category === "schedule" && l.source === "Weekly insights" && /recap email/.test(l.event))).toMatchObject({ level: "warning", event: "The recap email for 2026-11-08 couldn't be sent (try 1 of 4; trying again with the next hourly check)", detail: "SMTP down" });
  });

  it("is tried again with the next hourly check, and goes through", async () => {
    await ready();
    t.mail.failNext = "SMTP down";
    at(SUN_6AM);
    await check();
    at("2026-11-15T14:10:00Z");
    expect(await check()).toEqual([]);
    expect(t.mail.sent).toHaveLength(1);
    expect(t.mail.sent[0].subject).toBe("Your ByteSize week: Nov 8–14");
    expect((await recapRow()).emailedAt).not.toBeNull();
    at("2026-11-15T15:10:00Z");
    await check();
    expect(t.mail.sent).toHaveLength(1);
  });

  it("is given up on after the first try and 3 retries", async () => {
    await ready();
    const hours = ["13:05", "14:10", "15:10", "16:10", "17:10", "18:10"];
    for (const h of hours) {
      t.mail.failNext = "SMTP down";
      at(`2026-11-15T${h}:00Z`);
      await check();
    }
    expect(t.mail.sent).toHaveLength(0);
    expect((await recapRow()).emailTries).toBe(4);
    // even a working server isn't tried again for that recap
    at("2026-11-15T19:10:00Z");
    await check();
    expect(t.mail.sent).toHaveLength(0);
  });

  it("a retry stops if the person turned the email off meanwhile", async () => {
    await ready();
    t.mail.failNext = "SMTP down";
    at(SUN_6AM);
    await check();
    await t.api("PUT", "/api/insights/settings", { emailOn: false });
    at("2026-11-15T14:10:00Z");
    await check();
    expect(t.mail.sent).toHaveLength(0);
  });
  it("while no AI service is set up nothing runs, retries included; they carry on when one is back", async () => {
    await ready();
    t.mail.failNext = "SMTP down";
    at(SUN_6AM);
    await check();
    await t.api("PUT", "/api/settings/ai", { enabled: false, mode: "auto", maxPerRun: 50, timeoutSec: 5, services: [] });
    at("2026-11-15T14:10:00Z");
    await check();
    expect(t.mail.sent).toHaveLength(0);
    await aiServices();
    at("2026-11-15T15:10:00Z");
    await check();
    expect(t.mail.sent).toHaveLength(1);
  });

  it("a sent marker that can't be saved never causes a second send", async () => {
    await ready();
    let release!: () => void;
    t.mail.gate = new Promise<void>((r) => (release = r));
    at(SUN_6AM);
    await weeklyInsightsCheck(t.app); // the send is waiting on the mail server
    await vi.waitFor(async () => expect((await recapRow()).emailTries).toBe(1));
    vi.spyOn(t.app.db, "update").mockImplementationOnce(() => {
      throw new Error("database went away");
    });
    t.mail.gate = null;
    release();
    await t.app.mail.idle();
    vi.restoreAllMocks();
    expect(t.mail.sent).toHaveLength(1);
    for (const h of ["14:10", "15:10", "16:10"]) {
      at(`2026-11-15T${h}:00Z`);
      await check();
    }
    expect(t.mail.sent).toHaveLength(1);
    const logs = (await t.api("GET", "/api/logs")).body as { event: string }[];
    expect(logs.some((l) => /was sent but couldn't be marked/.test(l.event))).toBe(true);
    expect(logs.some((l) => /couldn't be sent/.test(l.event) && l.event.includes("recap email"))).toBe(false);
  });

  it("removing the account email turns the switch off (so adding one back doesn't start emails silently)", async () => {
    await ready();
    expect((await t.api("PATCH", "/api/profile", { email: null })).status).toBe(200);
    expect((await t.api("GET", "/api/insights")).body.email).toEqual({ on: false, available: true, hasAddress: false });
    await t.api("PATCH", "/api/profile", { email: "alex@example.com" });
    expect((await t.api("GET", "/api/insights")).body.email.on).toBe(false);
    at(SUN_6AM);
    await check();
    expect(t.mail.sent).toHaveLength(0);
  });

  it("an admin removing someone's email turns their switch off too", async () => {
    await aiServices();
    await setUpEmail();
    const sam = await t.createUser("sam");
    const as = asUser(t, sam.token);
    await as("PATCH", "/api/profile", { email: "sam@example.com" });
    expect((await as("PUT", "/api/insights/settings", { emailOn: true })).status).toBe(200);
    expect((await t.api("PATCH", `/api/admin/users/${sam.id}`, { email: null })).status).toBe(200);
    expect((await as("GET", "/api/insights")).body.email.on).toBe(false);
  });

  it("a bad app address gives no link (never 'null/#/insights')", async () => {
    await ready();
    await t.api("PUT", "/api/settings/email", { ...gmail, appUrl: null });
    t.app.appOrigins.splice(0, t.app.appOrigins.length, "javascript:alert(1)");
    at(SUN_6AM);
    await check();
    t.app.appOrigins.length = 0;
    expect(t.mail.sent).toHaveLength(1);
    expect(t.mail.sent[0].html).not.toMatch(/null|href=|javascript/);
    expect(t.mail.sent[0].text).not.toMatch(/null|#\/insights/);
  });
});

describe("kept data", () => {
  it("the switch and the sent marker are in Download my data", async () => {
    await ready();
    at(SUN_6AM);
    await check();
    const res = await t.app.inject({ method: "GET", url: "/api/export", headers: { authorization: `Bearer ${t.getToken()}` } });
    const json = JSON.parse(strFromU8(unzipSync(new Uint8Array(res.rawPayload))["bytesize-export.json"]));
    expect(json.tables.user_settings[0]).toMatchObject({ insightsEmail: true });
    expect(json.tables.insights.find((r: any) => r.kind === "recap")?.emailedAt).toBeTruthy();
  });
});
