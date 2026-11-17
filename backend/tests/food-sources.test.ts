import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { setupTestApp, type TestApp } from "./helpers.js";
import { asUser } from "./isolation.js";
import { usdaKey } from "../src/lib/foodSources/settings.js";

let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
beforeEach(async () => {
  await t.reset();
  await t.login(); // admin "alex"
});
afterAll(async () => t.close());

describe("admin food sources", () => {
  it("starts with no USDA key", async () => {
    expect((await t.api("GET", "/api/admin/food-sources")).body).toEqual({ usda: { hasKey: false } });
    expect(await usdaKey(t.app)).toBeNull();
  });

  it("saves the key encrypted and never sends it back", async () => {
    const put = await t.api("PUT", "/api/admin/food-sources", { usdaApiKey: "  my-usda-key  " });
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ usda: { hasKey: true } });
    const got = await t.api("GET", "/api/admin/food-sources");
    expect(got.body).toEqual({ usda: { hasKey: true } });
    expect(JSON.stringify(got.body)).not.toContain("my-usda-key");
    const rows = await t.db.execute<{ value: unknown }>(sql`select value from app_settings where key = 'food_sources'`);
    expect(JSON.stringify(rows.rows[0].value)).not.toContain("my-usda-key");
    expect(await usdaKey(t.app)).toBe("my-usda-key");
  });

  it("null or blank removes the key", async () => {
    await t.api("PUT", "/api/admin/food-sources", { usdaApiKey: "k1" });
    expect((await t.api("PUT", "/api/admin/food-sources", { usdaApiKey: null })).body).toEqual({ usda: { hasKey: false } });
    expect(await usdaKey(t.app)).toBeNull();
    await t.api("PUT", "/api/admin/food-sources", { usdaApiKey: "k2" });
    await t.api("PUT", "/api/admin/food-sources", { usdaApiKey: "   " });
    expect(await usdaKey(t.app)).toBeNull();
  });

  it("is admin-only", async () => {
    await t.api("PUT", "/api/admin/food-sources", { usdaApiKey: "k1" });
    const sam = await t.createUser("sam");
    const as = asUser(t, sam.token);
    expect((await as("GET", "/api/admin/food-sources")).status).toBe(403);
    expect((await as("PUT", "/api/admin/food-sources", { usdaApiKey: "evil" })).status).toBe(403);
    expect(await usdaKey(t.app)).toBe("k1");
    t.setToken("");
    expect((await t.api("GET", "/api/admin/food-sources")).status).toBe(401);
  });

  it("the app's food fetch is the test's fake food web", async () => {
    t.foodWeb.respond = () => ({ status: 200, json: { hello: "off" } });
    const res = await t.app.foodFetch("https://world.openfoodfacts.org/x", { headers: { "user-agent": "ua" } });
    expect(await res.json()).toEqual({ hello: "off" });
    expect(t.foodWeb.calls).toEqual([{ url: "https://world.openfoodfacts.org/x", method: "GET", headers: { "user-agent": "ua" }, body: undefined }]);
    t.foodWeb.down = true;
    await expect(t.app.foodFetch("https://api.nal.usda.gov/y")).rejects.toThrow();
  });
});
