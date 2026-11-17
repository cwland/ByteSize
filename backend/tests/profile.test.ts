import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";

let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
beforeEach(async () => {
  await t.reset();
  await t.login(); // admin "alex"
});
afterAll(async () => t.close());

describe("profile", () => {
  it("saves units, timezone and theme", async () => {
    const res = await t.api("PATCH", "/api/profile", {
      displayName: "Alex L",
      email: "c@example.com",
      theme: "harbor",
      colorMode: "dark",
      units: "metric",
      timezone: "Europe/London",
    });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ displayName: "Alex L", email: "c@example.com", theme: "harbor", colorMode: "dark", units: "metric", timezone: "Europe/London" });
    expect(res.body.user.passwordHash).toBeUndefined();
    const me = await t.api("GET", "/api/auth/me");
    expect(me.body.user).toMatchObject({ theme: "harbor", colorMode: "dark", units: "metric", timezone: "Europe/London" });
  });

  it("rejects an unknown timezone or units", async () => {
    expect((await t.api("PATCH", "/api/profile", { timezone: "Mars/Base" })).status).toBe(400);
    expect((await t.api("PATCH", "/api/profile", { units: "stone" })).status).toBe(400);
    expect((await t.api("PATCH", "/api/profile", { theme: "neon" })).status).toBe(400);
    // A bad field alongside a good one changes nothing
    expect((await t.api("PATCH", "/api/profile", { units: "metric", timezone: "Mars/Base" })).status).toBe(400);
    const me = await t.api("GET", "/api/auth/me");
    expect(me.body.user).toMatchObject({ units: "imperial", timezone: "America/Denver" });
  });

  it("setup-done marks the wizard finished", async () => {
    expect((await t.api("GET", "/api/auth/me")).body.user.setupDone).toBe(false);
    const res = await t.api("POST", "/api/profile/setup-done");
    expect(res.status).toBe(200);
    expect(res.body.user.setupDone).toBe(true);
    expect((await t.api("GET", "/api/auth/me")).body.user.setupDone).toBe(true);
  });

  it("needs a signed-in user", async () => {
    t.setToken("");
    expect((await t.api("PATCH", "/api/profile", { units: "metric" })).status).toBe(401);
    expect((await t.api("POST", "/api/profile/setup-done")).status).toBe(401);
  });
});
