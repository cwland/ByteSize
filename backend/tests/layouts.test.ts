import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";
import { dashboardLayouts } from "../src/db/schema.js";
import { LAYOUT_PAGES, PAGE_WIDGETS } from "../src/lib/widgets.js";

// Widget layouts per page (§40a): GET/PUT /api/layouts/:page, page ∈ {dashboard, goals}; /api/dashboard/layout
// is the same as /api/layouts/dashboard. Each page's layout is its own.
let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
beforeEach(async () => {
  await t.reset();
  await t.login();
});
afterAll(async () => t.close());

const goals = { version: 1, columns: [["your-plan", "goal-date"], ["weight-chart", "weekly-trends", "badges"], []] };

describe("layouts per page", () => {
  it("knows the pages and each page's widgets; Goal date, Activity, the Goals list and Insights are offered on both", () => {
    expect([...LAYOUT_PAGES]).toEqual(["dashboard", "goals"]);
    expect([...PAGE_WIDGETS.goals].sort()).toEqual(["activity", "badges", "goal-date", "goals", "insights", "past-goals", "weekly-trends", "weight-chart", "your-plan"]);
    expect(PAGE_WIDGETS.dashboard).toContain("goals");
    expect(PAGE_WIDGETS.dashboard).not.toContain("past-goals");
    expect(PAGE_WIDGETS.dashboard).toContain("activity");
    expect(PAGE_WIDGETS.dashboard).toContain("goal-date");
    expect(PAGE_WIDGETS.dashboard).toContain("insights"); // §43
    expect(PAGE_WIDGETS.dashboard).not.toContain("your-plan");
  });

  it("the Goals layout is null until saved, then comes back as saved, apart from the Dashboard's", async () => {
    expect((await t.api("GET", "/api/layouts/goals")).body).toEqual({ layout: null });
    const put = await t.api("PUT", "/api/layouts/goals", goals);
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ layout: goals });
    expect((await t.api("GET", "/api/layouts/goals")).body).toEqual({ layout: goals });
    expect((await t.api("GET", "/api/layouts/dashboard")).body).toEqual({ layout: null });

    const dash = { version: 1, columns: [["food", "goal-date"], ["budget"], []] };
    expect((await t.api("PUT", "/api/layouts/dashboard", dash)).status).toBe(200);
    expect((await t.api("GET", "/api/layouts/goals")).body).toEqual({ layout: goals });
    expect(await t.db.select().from(dashboardLayouts)).toHaveLength(2);
  });

  it("/api/dashboard/layout is the Dashboard's layout under its old name", async () => {
    const dash = { version: 1, columns: [["streak"], ["food"], []] };
    expect((await t.api("PUT", "/api/dashboard/layout", dash)).status).toBe(200);
    expect((await t.api("GET", "/api/layouts/dashboard")).body).toEqual({ layout: dash });
    const again = { version: 1, columns: [["budget"]] };
    expect((await t.api("PUT", "/api/layouts/dashboard", again)).status).toBe(200);
    expect((await t.api("GET", "/api/dashboard/layout")).body).toEqual({ layout: again });
  });

  it("a page only takes its own widgets", async () => {
    expect((await t.api("PUT", "/api/layouts/goals", { version: 1, columns: [["food"]] })).status).toBe(400);
    expect((await t.api("PUT", "/api/layouts/dashboard", { version: 1, columns: [["your-plan"]] })).status).toBe(400);
    expect((await t.api("PUT", "/api/layouts/goals", { version: 1, columns: [["badges"], ["badges"]] })).status).toBe(400);
    expect((await t.api("PUT", "/api/layouts/goals", { version: 1, columns: [[], [], [], ["badges"]] })).status).toBe(400);
    expect((await t.api("GET", "/api/layouts/goals")).body).toEqual({ layout: null });
  });

  it("an unknown page is refused", async () => {
    expect((await t.api("GET", "/api/layouts/settings")).status).toBe(400);
    expect((await t.api("PUT", "/api/layouts/settings", { version: 1, columns: [["food"]] })).status).toBe(400);
  });

  it("drops widgets a page no longer has", async () => {
    const me = (await t.api("GET", "/api/auth/me")).body.user;
    await t.db.insert(dashboardLayouts).values({ userId: me.id, page: "goals", columns: [["badges", "food", "old-widget"], ["your-plan"]] });
    expect((await t.api("GET", "/api/layouts/goals")).body).toEqual({ layout: { version: 1, columns: [["badges"], ["your-plan"]] } });
  });

  it("needs a sign-in", async () => {
    t.setToken("");
    expect((await t.api("GET", "/api/layouts/goals")).status).toBe(401);
    expect((await t.api("PUT", "/api/layouts/goals", goals)).status).toBe(401);
  });
});
