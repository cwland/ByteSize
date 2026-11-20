import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";
import { PAGE_WIDGETS } from "../src/lib/widgets.js";

// The iPhone app's Dashboard layout (iOS design §6.7 change 1): its own page "ios", one column, its own widgets.
let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
beforeEach(async () => {
  await t.reset();
  await t.login();
});
afterAll(async () => t.close());

// Swift cases look like `case calendar, overview, water, …` in the DashboardWidget enum
function swiftWidgetIds(): string[] {
  const swift = readFileSync(fileURLToPath(new URL("../../ios/ByteSizeKit/Sources/ByteSizeKit/Features/DashboardWidget.swift", import.meta.url)), "utf8");
  const body = /enum DashboardWidget[^{]*\{([\s\S]*?)\n\}/.exec(swift)?.[1] ?? "";
  return [...body.matchAll(/^\s*case ([a-z, ]+)$/gm)].flatMap((m) => m[1].split(",").map((s) => s.trim()));
}

describe("ios layout page", () => {
  it("is null until saved, then comes back as saved", async () => {
    expect((await t.api("GET", "/api/layouts/ios")).body).toEqual({ layout: null });
    const mine = { version: 1, columns: [["overview", "water", "calendar"]] };
    const put = await t.api("PUT", "/api/layouts/ios", mine);
    expect(put.status).toBe(200);
    expect((await t.api("GET", "/api/layouts/ios")).body).toEqual({ layout: mine });
  });

  it("keeps the phone's layout apart from the web Dashboard's", async () => {
    await t.api("PUT", "/api/layouts/ios", { version: 1, columns: [["streak"]] });
    expect((await t.api("GET", "/api/layouts/dashboard")).body).toEqual({ layout: null });
  });

  it("refuses web widgets and goal widgets", async () => {
    expect((await t.api("PUT", "/api/layouts/ios", { version: 1, columns: [["food"]] })).status).toBe(400);
    expect((await t.api("PUT", "/api/layouts/ios", { version: 1, columns: [["goal:1"]] })).status).toBe(400);
  });

  it("offers the widgets the iPhone app knows, in its default order", () => {
    expect(PAGE_WIDGETS.ios).toEqual(["calendar", "overview", "water", "weight", "streak", "badges", "shots"]);
    expect(swiftWidgetIds()).toEqual([...PAGE_WIDGETS.ios]);
  });
});
