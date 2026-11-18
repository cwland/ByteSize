import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { setupTestApp, TEST_SECRET, type TestApp } from "./helpers.js";
import { asUser } from "./isolation.js";
import { CULURY, CULURY_KEY, resetFakeDns } from "./culuryFakes.js";
import { setRestaurantKeys } from "./restaurantFakes.js";
import { appLog, userSettings } from "../src/db/schema.js";
import { buildApp } from "../src/app.js";
import { encryptSecret } from "../src/lib/secrets.js";

// Settings › Integrations: the eye and copy buttons fetch one saved key at a time, for the person who may see it
let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
beforeEach(async () => {
  await t.reset();
  resetFakeDns();
  await t.login(); // admin "cory"
});
afterAll(async () => t.close());

const UNREADABLE = "This key can't be read. Enter it again.";
const base = { enabled: true, mode: "auto", maxPerRun: 50 };
const logLines = async () => t.db.select().from(appLog);
const everythingLogged = async () => JSON.stringify(await logLines());
// A value encrypted with another JWT_SECRET: what's left after the server's secret changes
const foreign = (plain: string) => encryptSecret(plain, "a-different-secret-a-different-secret-12");

async function saveAi() {
  const r = await t.api("PUT", "/api/settings/ai", {
    ...base,
    services: [
      { name: "Main AI", provider: "openai", model: "m", apiKey: "sk-main-111" },
      { name: "Backup", provider: "anthropic", model: "c", apiKey: "sk-ant-222" },
    ],
  });
  expect(r.status).toBe(200);
  return r.body.settings.services as { id: string; name: string }[];
}

describe("GET /api/settings/ai/:id/key", () => {
  it("gives the admin the saved key of the service asked for, not cached, and logs who saw which key", async () => {
    const [main, backup] = await saveAi();
    const r = await t.api("GET", `/api/settings/ai/${main.id}/key`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ key: "sk-main-111" });
    expect(r.headers["cache-control"]).toBe("no-store");
    expect((await t.api("GET", `/api/settings/ai/${backup.id}/key`)).body).toEqual({ key: "sk-ant-222" });

    const lines = await logLines();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ category: "api", level: "info", event: "Saved key shown", detail: expect.stringContaining("OpenAI key for Main AI") });
    expect(lines[0].detail).toContain("cory");
    expect(lines[1].detail).toContain("Anthropic key for Backup");
    expect(lines[0].userId).toBe(1);
    const said = await everythingLogged();
    expect(said).not.toContain("sk-main-111");
    expect(said).not.toContain("sk-ant-222");
    const enc = JSON.stringify((await t.db.execute(sql`select value from app_settings where key = 'ai'`)).rows[0]);
    const cipher = /"apiKeyEnc":"(v1:[^"]+)"/.exec(enc)![1];
    expect(said).not.toContain(cipher.split(":")[3]);
  });

  it("the settings list still never contains a key", async () => {
    const [main] = await saveAi();
    await t.api("GET", `/api/settings/ai/${main.id}/key`);
    const got = JSON.stringify((await t.api("GET", "/api/settings/ai")).body);
    expect(got).not.toContain("sk-main-111");
    expect(got).not.toContain("sk-ant-222");
  });

  it("is admin-only", async () => {
    const [main] = await saveAi();
    const sam = await t.createUser("sam");
    const r = await asUser(t, sam.token)("GET", `/api/settings/ai/${main.id}/key`);
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).not.toContain("sk-main");
    t.setToken("");
    expect((await t.api("GET", `/api/settings/ai/${main.id}/key`)).status).toBe(401);
    expect(await everythingLogged()).not.toContain("Saved key shown");
  });

  it("404 when the service has no key or doesn't exist", async () => {
    const r = await t.api("PUT", "/api/settings/ai", { ...base, services: [{ name: "Home", provider: "local", model: "llama", baseUrl: "http://192.168.1.5:11434/v1" }] });
    const id = r.body.settings.services[0].id;
    expect((await t.api("GET", `/api/settings/ai/${id}/key`)).status).toBe(404);
    const missing = await t.api("GET", "/api/settings/ai/nope/key");
    expect(missing.status).toBe(404);
    expect(missing.headers["cache-control"]).toBe("no-store");
    expect(await everythingLogged()).not.toContain("Saved key shown");
  });

  it("409 when the saved key can't be read", async () => {
    const [main] = await saveAi();
    await t.db.execute(sql`update app_settings set value = jsonb_set(value, '{services,0,apiKeyEnc}', to_jsonb(${foreign("sk-main-111")}::text)) where key = 'ai'`);
    const r = await t.api("GET", `/api/settings/ai/${main.id}/key`);
    expect(r.status).toBe(409);
    expect(r.body.error).toBe(UNREADABLE);
  });
});

describe("GET /api/admin/food-sources/:source/key", () => {
  it("gives the admin the USDA key, the Spoonacular key and FatSecret's ID and secret", async () => {
    await t.api("PUT", "/api/admin/food-sources", { usdaApiKey: "usda-333" });
    await setRestaurantKeys(t, { spoonacular: "spoon-444", fatsecret: { id: "fs-id-555", secret: "fs-secret-666" } });
    const usda = await t.api("GET", "/api/admin/food-sources/usda/key");
    expect(usda.status).toBe(200);
    expect(usda.body).toEqual({ key: "usda-333" });
    expect(usda.headers["cache-control"]).toBe("no-store");
    expect((await t.api("GET", "/api/admin/food-sources/spoonacular/key")).body).toEqual({ key: "spoon-444" });
    const fs = await t.api("GET", "/api/admin/food-sources/fatsecret/key");
    expect(fs.body).toEqual({ clientId: "fs-id-555", clientSecret: "fs-secret-666" });
    expect(fs.headers["cache-control"]).toBe("no-store");

    const details = (await logLines()).map((l) => [l.category, l.event, l.detail]);
    expect(details).toEqual([
      ["api", "Saved key shown", expect.stringMatching(/^USDA key\b.*cory/)],
      ["api", "Saved key shown", expect.stringMatching(/^Spoonacular key\b.*cory/)],
      ["api", "Saved key shown", expect.stringMatching(/^FatSecret ID and secret\b.*cory/)],
    ]);
    const said = await everythingLogged();
    for (const k of ["usda-333", "spoon-444", "fs-id-555", "fs-secret-666"]) expect(said).not.toContain(k);
    const stored = (await t.db.execute<{ value: Record<string, string> }>(sql`select value from app_settings where key = 'food_sources'`)).rows[0].value;
    for (const enc of Object.values(stored)) if (enc) expect(said).not.toContain(enc.split(":")[3]);
  });

  it("the summary still never contains a key", async () => {
    await t.api("PUT", "/api/admin/food-sources", { usdaApiKey: "usda-333", spoonacularApiKey: "spoon-444" });
    await t.api("GET", "/api/admin/food-sources/usda/key");
    const got = JSON.stringify((await t.api("GET", "/api/admin/food-sources")).body);
    expect(got).not.toContain("usda-333");
    expect(got).not.toContain("spoon-444");
  });

  it("is admin-only", async () => {
    await t.api("PUT", "/api/admin/food-sources", { usdaApiKey: "usda-333" });
    const sam = await t.createUser("sam");
    const as = asUser(t, sam.token);
    for (const s of ["usda", "spoonacular", "fatsecret"]) {
      const r = await as("GET", `/api/admin/food-sources/${s}/key`);
      expect(r.status).toBe(403);
      expect(JSON.stringify(r.body)).not.toContain("usda-333");
    }
  });

  it("404 when none is saved (FatSecret needs both), 400 for an unknown source", async () => {
    expect((await t.api("GET", "/api/admin/food-sources/usda/key")).status).toBe(404);
    expect((await t.api("GET", "/api/admin/food-sources/spoonacular/key")).status).toBe(404);
    expect((await t.api("GET", "/api/admin/food-sources/fatsecret/key")).status).toBe(404);
    await t.api("PUT", "/api/admin/food-sources", { fatsecretClientId: "only-id" });
    expect((await t.api("GET", "/api/admin/food-sources/fatsecret/key")).status).toBe(404);
    expect((await t.api("GET", "/api/admin/food-sources/nutritionix/key")).status).toBe(400);
  });

  it("409 when the saved key can't be read", async () => {
    await t.db.execute(sql`insert into app_settings (key, value) values ('food_sources', ${JSON.stringify({ usdaApiKey: foreign("u"), fatsecretClientId: encryptSecret("id", TEST_SECRET), fatsecretClientSecret: foreign("s") })}::jsonb)`);
    for (const s of ["usda", "fatsecret"]) {
      const r = await t.api("GET", `/api/admin/food-sources/${s}/key`);
      expect(r.status).toBe(409);
      expect(r.body.error).toBe(UNREADABLE);
      expect(r.headers["cache-control"]).toBe("no-store");
    }
  });
});

describe("GET /api/settings/culury/key", () => {
  it("gives a person their own Culury key, not cached, and logs it without the key", async () => {
    const sam = await t.createUser("sam");
    const as = asUser(t, sam.token);
    expect((await as("PUT", "/api/settings/culury", { url: CULURY, apiKey: CULURY_KEY })).status).toBe(200);
    const r = await t.app.inject({ method: "GET", url: "/api/settings/culury/key", headers: { authorization: `Bearer ${sam.token}` } });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ key: CULURY_KEY });
    expect(r.headers["cache-control"]).toBe("no-store");
    const lines = await logLines();
    expect(lines.map((l) => [l.category, l.event, l.userId])).toEqual([["api", "Saved key shown", sam.id]]);
    expect(lines[0].detail).toMatch(/^Culury key\b.*sam/);
    const [row] = await t.db.select().from(userSettings).where(eq(userSettings.userId, sam.id));
    const said = await everythingLogged();
    expect(said).not.toContain(CULURY_KEY);
    expect(said).not.toContain(row.culuryKeyEnc!.split(":")[3]);
    // the summary still never has it
    expect(JSON.stringify((await as("GET", "/api/settings/culury")).body)).not.toContain(CULURY_KEY);
  });

  it("404 when none is saved, 409 when it can't be read (neither cached)", async () => {
    const none = await t.api("GET", "/api/settings/culury/key");
    expect(none.status).toBe(404);
    expect(none.headers["cache-control"]).toBe("no-store");
    await t.api("PUT", "/api/settings/culury", { url: CULURY, apiKey: CULURY_KEY });
    await t.db.update(userSettings).set({ culuryKeyEnc: foreign(CULURY_KEY) }).where(eq(userSettings.userId, 1));
    const r = await t.api("GET", "/api/settings/culury/key");
    expect(r.status).toBe(409);
    expect(r.body.error).toBe(UNREADABLE);
    expect(r.headers["cache-control"]).toBe("no-store");
    t.setToken("");
    expect((await t.api("GET", "/api/settings/culury/key")).status).toBe(401);
  });
});

describe("rate limit", () => {
  it("each reveal route allows 30 a minute per person", async () => {
    const [main] = await saveAi();
    await t.api("PUT", "/api/admin/food-sources", { usdaApiKey: "usda-333" });
    await t.api("PUT", "/api/settings/culury", { url: CULURY, apiKey: CULURY_KEY });
    const sam = await t.createUser("sam");
    await asUser(t, sam.token)("PUT", "/api/settings/culury", { url: CULURY, apiKey: "sams-key" });
    const app2 = buildApp({ db: t.db, jwtSecret: TEST_SECRET, rateLimit: { max: 100, windowMs: 60_000 }, dataDir: t.app.dataDir });
    await app2.ready();
    const get = (url: string, token = t.getToken()) => app2.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } });
    try {
      for (const url of [`/api/settings/ai/${main.id}/key`, "/api/admin/food-sources/usda/key", "/api/settings/culury/key"]) {
        for (let i = 0; i < 30; i++) expect((await get(url)).statusCode).toBe(200);
        expect((await get(url)).statusCode).toBe(429);
      }
      // another person has their own count
      expect((await get("/api/settings/culury/key", sam.token)).statusCode).toBe(200);
    } finally {
      await app2.close();
    }
  });
});
