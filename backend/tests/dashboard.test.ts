import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";
import { dashboardLayouts, userSettings } from "../src/db/schema.js";
import { WIDGET_IDS } from "../src/lib/widgets.js";

// The Dashboard's widget layout (§28): saved per person, { version: 1, columns: string[][] }
let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
beforeEach(async () => {
  await t.reset();
  await t.login();
});
afterAll(async () => t.close());

const layout = { version: 1, columns: [["food"], ["budget", "water"], ["day-totals", "weight", "next-shot", "streak"]] };

describe("dashboard layout", () => {
  it("knows today's widgets", () => {
    expect([...WIDGET_IDS].sort()).toEqual(["activity", "budget", "day-totals", "food", "goal-date", "goals", "insights", "next-shot", "streak", "water", "weight"]);
  });

  it("is null until saved, then comes back as saved", async () => {
    expect((await t.api("GET", "/api/dashboard/layout")).body).toEqual({ layout: null });
    const mine = { version: 1, columns: [["budget", "food"], [], ["streak"]] };
    const put = await t.api("PUT", "/api/dashboard/layout", mine);
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ layout: mine });
    expect((await t.api("GET", "/api/dashboard/layout")).body).toEqual({ layout: mine });
    // saving again replaces it
    expect((await t.api("PUT", "/api/dashboard/layout", layout)).status).toBe(200);
    expect((await t.api("GET", "/api/dashboard/layout")).body).toEqual({ layout });
    expect(await t.db.select().from(dashboardLayouts)).toHaveLength(1);
  });

  it("Insights (§43) joins a Dashboard saved before it, once: below Day totals; taken off later, it stays off", async () => {
    const old = [["food"], ["budget", "water"], ["day-totals", "weight", "streak"]];
    await t.db.insert(dashboardLayouts).values({ userId: 1, columns: old }); // saved before Insights
    const withIt = { version: 1, columns: [["food"], ["budget", "water"], ["day-totals", "insights", "weight", "streak"]] };
    expect((await t.api("GET", "/api/dashboard/layout")).body).toEqual({ layout: withIt });
    expect((await t.api("GET", "/api/layouts/dashboard")).body).toEqual({ layout: withIt }); // kept, and only once
    expect((await t.db.select().from(userSettings))[0].insightsWidgetOffered).toBe(true);
    expect((await t.api("PUT", "/api/dashboard/layout", { version: 1, columns: old })).status).toBe(200);
    expect((await t.api("GET", "/api/dashboard/layout")).body).toEqual({ layout: { version: 1, columns: old } });
  });

  it("Insights joins a saved Dashboard without Day totals at the bottom of the right column; one saved after it is left alone", async () => {
    await t.db.insert(dashboardLayouts).values({ userId: 1, columns: [["food"]] });
    expect((await t.api("GET", "/api/dashboard/layout")).body.layout.columns).toEqual([["food"], [], ["insights"]]);
    // Ben saves his own layout (without Insights) before ever reading one: never added
    const ben = await t.createUser("ben");
    const as = (m: string, url: string, body?: unknown) => t.app.inject({ method: m as any, url, payload: body as any, headers: { authorization: `Bearer ${ben.token}` } });
    await as("PUT", "/api/dashboard/layout", { version: 1, columns: [["streak"]] });
    expect(JSON.parse((await as("GET", "/api/dashboard/layout")).body).layout.columns).toEqual([["streak"]]);
  });

  it("refuses more than 3 columns, unknown widgets and a widget twice", async () => {
    const bad = [
      { version: 1, columns: [[], [], [], ["food"]] },
      { version: 1, columns: [["food", "horoscope"]] },
      { version: 1, columns: [["food"], ["food"]] },
      { version: 2, columns: [["food"]] },
      { columns: [["food"]] },
      { version: 1, columns: "food" },
    ];
    for (const b of bad) expect((await t.api("PUT", "/api/dashboard/layout", b)).status, JSON.stringify(b)).toBe(400);
    expect((await t.api("PUT", "/api/dashboard/layout", { version: 1, columns: [["food"], ["food"]] })).body.details[0].message).toMatch(/once/);
    expect((await t.api("GET", "/api/dashboard/layout")).body).toEqual({ layout: null });
  });

  it("drops widgets ByteSize no longer has from a saved layout", async () => {
    const me = (await t.api("GET", "/api/auth/me")).body.user;
    await t.db.insert(dashboardLayouts).values({ userId: me.id, columns: [["food", "old-widget"], ["budget"]] });
    await t.db.insert(userSettings).values({ userId: me.id, insightsWidgetOffered: true }); // (Insights already offered)
    expect((await t.api("GET", "/api/dashboard/layout")).body).toEqual({ layout: { version: 1, columns: [["food"], ["budget"]] } });
  });

  it("needs a sign-in", async () => {
    t.setToken("");
    expect((await t.api("GET", "/api/dashboard/layout")).status).toBe(401);
    expect((await t.api("PUT", "/api/dashboard/layout", layout)).status).toBe(401);
  });
});
