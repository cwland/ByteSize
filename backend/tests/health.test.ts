import { APP_VERSION } from "../src/lib/version.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";

let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
afterAll(async () => t.close());

describe("health", () => {
  it("health is public and reports the database", async () => {
    for (const path of ["/health", "/api/health"]) {
      const res = await t.api("GET", path);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, db: true, version: APP_VERSION });
    }
  });

  it("unknown api routes are 404 json", async () => {
    const res = await t.api("GET", "/api/nope");
    expect(res.status).toBe(404);
    expect(typeof res.body.error).toBe("string");
  });
});
