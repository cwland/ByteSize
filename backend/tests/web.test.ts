import { APP_VERSION } from "../src/lib/version.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";
import { serveWeb } from "../src/web.js";

const HTML = "<!doctype html><html><head><title>ByteSize</title></head><body>app</body></html>";
let t: TestApp;
let dir: string;
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bytesize-web-"));
  fs.writeFileSync(path.join(dir, "index.html"), HTML);
  fs.mkdirSync(path.join(dir, "assets"));
  fs.writeFileSync(path.join(dir, "assets", "app-abc123.js"), "console.log(1)");
  t = await setupTestApp({}, (app) => serveWeb(app, dir));
});
afterAll(async () => {
  await t.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("web app serving", () => {
  it("serves index.html at / and for app pages", async () => {
    for (const url of ["/", "/settings/profile"]) {
      const res = await t.app.inject({ method: "GET", url });
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toMatch(/text\/html/);
      expect(res.body).toBe(HTML);
      expect(res.headers["cache-control"]).toBe("no-cache");
    }
  });

  it("serves built files, hashed assets cached for good", async () => {
    const res = await t.app.inject({ method: "GET", url: "/assets/app-abc123.js" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("console.log(1)");
    expect(res.headers["cache-control"]).toContain("immutable");
  });

  it("unknown api routes are still 404 json", async () => {
    const res = await t.api("GET", "/api/nope");
    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(typeof res.body.error).toBe("string");
    await t.reset();
    await t.login();
    const signedIn = await t.api("GET", "/api/nope");
    expect(signedIn.status).toBe(404);
    expect(typeof signedIn.body.error).toBe("string");
  });

  it("health is still json", async () => {
    const res = await t.api("GET", "/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, db: true, version: APP_VERSION });
  });

  it("doesn't serve files outside the web folder", async () => {
    const res = await t.app.inject({ method: "GET", url: "/..%2f..%2fetc%2fpasswd" });
    expect(res.body).not.toContain("root:");
  });
});
