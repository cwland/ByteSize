import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { setupTestApp, type TestApp } from "./helpers.js";
import { twoUsers } from "./isolation.js";
import { logEvent, recentLogs } from "../src/lib/appLog.js";

let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
afterAll(async () => t.close());
beforeEach(async () => {
  await t.reset();
  await t.login(); // admin "cory"
});

const logs = async (q = "") => (await t.api("GET", `/api/logs${q}`)).body as any[];

describe("logs", () => {
  it("filters by type and problems; All is everything, newest first", async () => {
    await logEvent(t.db, { category: "schedule", level: "info", source: "Daily backup", event: "Backup saved" });
    await logEvent(t.db, { category: "ai", level: "warning", source: "Home AI", event: "Home AI didn't answer, asking Cloud instead", detail: "timed out" });
    await logEvent(t.db, { category: "api", level: "error", source: "GET /api/x", event: "Server error" });
    expect((await logs()).map((r) => r.category)).toEqual(["api", "ai", "schedule"]);
    expect((await logs("?category=ai")).map((r) => r.source)).toEqual(["Home AI"]);
    expect((await logs("?problems=true")).map((r) => r.category)).toEqual(["api", "ai"]);
    expect((await t.api("GET", "/api/logs?category=nope")).status).toBe(400);
  });

  it("keeps 30 days, and only a signed-in user can read them", async () => {
    await t.db.execute(sql`insert into app_log (category, level, event, at) values
      ('schedule', 'info', 'old', ${new Date(Date.now() - 31 * 24 * 3600 * 1000)}), ('schedule', 'info', 'recent', ${new Date(Date.now() - 29 * 24 * 3600 * 1000)})`);
    expect((await logs()).map((r) => r.event)).toEqual(["recent"]);
    t.setToken("");
    expect((await t.api("GET", "/api/logs")).status).toBe(401);
  });

  it("a log problem never breaks what's being logged", async () => {
    await expect(logEvent(t.db, { category: "ai", level: "info", event: "x", userId: 999999 })).resolves.toBeUndefined(); // no such user
    expect(await recentLogs(t.db)).toEqual([]);
  });

  it("server errors are logged under API", async () => {
    await t.db.execute(sql`alter table app_settings rename to app_settings_away`);
    try {
      expect((await t.api("GET", "/api/settings/ai")).status).toBe(500);
    } finally {
      await t.db.execute(sql`alter table app_settings_away rename to app_settings`);
    }
    let rows: any[] = [];
    for (let i = 0; i < 20 && !rows.length; i++) {
      rows = await logs("?category=api");
      if (!rows.length) await new Promise((r) => setTimeout(r, 25)); // written in the background
    }
    expect(rows[0]).toMatchObject({ level: "error", source: "GET /api/settings/ai", event: "Server error", userId: 1 });
  });

  it("members see only their own log lines", async () => {
    const { a, b } = await twoUsers(t);
    await logEvent(t.db, { category: "food", level: "info", event: "anna's lookup", userId: a.id });
    await logEvent(t.db, { category: "ai", level: "warning", event: "anna's AI hiccup", userId: a.id });
    await logEvent(t.db, { category: "food", level: "info", event: "ben's lookup", userId: b.id });
    await logEvent(t.db, { category: "schedule", level: "error", event: "server's own task" });
    expect((await a.as("GET", "/api/logs")).body.map((r: any) => r.event)).toEqual(["anna's AI hiccup", "anna's lookup"]);
    expect((await a.as("GET", "/api/logs?category=food")).body.map((r: any) => r.event)).toEqual(["anna's lookup"]);
    expect((await a.as("GET", "/api/logs?problems=true")).body.map((r: any) => r.event)).toEqual(["anna's AI hiccup"]);
    expect((await b.as("GET", "/api/logs")).body.map((r: any) => r.event)).toEqual(["ben's lookup"]);
    // a user id in the query is ignored, never trusted
    expect((await b.as("GET", `/api/logs?userId=${a.id}`)).body.map((r: any) => r.event)).toEqual(["ben's lookup"]);
  });

  it("admin sees everything", async () => {
    const { a, b } = await twoUsers(t);
    await logEvent(t.db, { category: "food", level: "info", event: "anna's lookup", userId: a.id });
    await logEvent(t.db, { category: "food", level: "info", event: "ben's lookup", userId: b.id });
    await logEvent(t.db, { category: "schedule", level: "error", event: "server's own task" });
    const rows = await logs();
    expect(rows.map((r) => [r.event, r.userId])).toEqual([
      ["server's own task", null],
      ["ben's lookup", b.id],
      ["anna's lookup", a.id],
    ]);
  });
});
