import { readFileSync } from "node:fs";
import path from "node:path";
import { eq, is } from "drizzle-orm";
import { PgTable as PgTableClass, getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { strFromU8, unzipSync } from "fflate";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";
import { plainPhoto } from "./photoFakes.js";
import * as schema from "../src/db/schema.js";
import { appLog, uploads } from "../src/db/schema.js";
import { storePhoto } from "../src/lib/photos.js";
import { toCsv } from "../src/lib/exportData.js";

let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
beforeEach(async () => {
  await t.reset();
  await t.login(); // admin "cory", America/Boise
  t.clock.date = new Date("2026-11-17T19:00:00Z"); // noon in Boise
});
afterAll(async () => t.close());

const DAY = "2026-11-17";
const toast = { name: "Toast", servings: [{ label: "2 slices", grams: 60 }], nutrients: { calories: 160, protein_g: 6, carbs_g: 30, fat_g: 2, fiber_g: 4 } };
const mystery = { name: 'Mystery, "bar"', brand: "=Acme", servings: [{ label: "1 bar", grams: 40 }], nutrients: { calories: 200 } };

/** Everything one person can have, through the API (and one uploaded photo). */
async function seed() {
  const food = (await t.api("POST", "/api/my-foods", toast)).body.food;
  const odd = (await t.api("POST", "/api/my-foods", mystery)).body.food;
  const log = (f: { id: number }, day: string, meal: string) => t.api("POST", "/api/log", { day, meal, food: { kind: "user_food", id: f.id }, servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 });
  expect((await log(food, "2026-11-16", "breakfast")).status).toBe(200);
  expect((await log(odd, DAY, "lunch")).status).toBe(200);
  expect((await log(food, DAY, "breakfast")).status).toBe(200);
  expect((await t.api("POST", "/api/log", { day: DAY, meal: "supplements", water_ml: 500 })).status).toBe(200);
  expect((await t.api("PUT", `/api/weigh-ins/${DAY}`, { weightKg: 90.5, note: "after a walk" })).status).toBe(200);
  expect((await t.api("PUT", "/api/glp1/settings", { medication: "Mounjaro", doseMg: 2.5, injectionWeekday: 5 })).status).toBe(200);
  expect((await t.api("PUT", "/api/glp1/shots/2026-11-12", { site: "abdomen_left", note: "fine" })).status).toBe(200);
  expect((await t.api("PUT", `/api/side-effects/${DAY}`, { effects: { nausea: 2 }, note: "mild" })).status).toBe(200);
  const me = (await t.api("GET", "/api/auth/me")).body;
  const photo = await storePhoto(t.app, me.id ?? me.user?.id, await plainPhoto(40, 30));
  return { photo, userId: (me.id ?? me.user?.id) as number };
}

async function download(token?: string) {
  const res = await t.app.inject({ method: "GET", url: "/api/export", headers: { authorization: `Bearer ${token ?? t.getToken()}` } });
  const files = res.statusCode === 200 ? unzipSync(new Uint8Array(res.rawPayload)) : {};
  return { res, files, text: (name: string) => strFromU8(files[name]) };
}

describe("toCsv", () => {
  it("quotes commas, quotes and line breaks, with \\r\\n lines", () => {
    expect(toCsv([["a", "b,c", 'say "hi"', "two\nlines"], [1, null, undefined, 2.5]])).toBe('a,"b,c","say ""hi""","two\nlines"\r\n1,,,2.5\r\n');
  });
  it("defuses cells a spreadsheet would run, but leaves numbers alone", () => {
    const out = toCsv([["=SUM(A1)", "@cmd", "+1", "-1+1", "\tx", "\rx", -5, "plain"]]);
    expect(out).toBe("'=SUM(A1),'@cmd,'+1,'-1+1,'\tx,\"'\rx\",-5,plain\r\n");
  });
});

describe("GET /api/export", () => {
  it("needs a login", async () => {
    const res = await t.app.inject({ method: "GET", url: "/api/export" });
    expect(res.statusCode).toBe(401);
  });

  it("sends a zip named for the person and their day", async () => {
    const { res } = await download();
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/zip");
    expect(res.headers["content-disposition"]).toBe('attachment; filename="bytesize-cory-2026-11-17.zip"');
  });

  it("holds the seven kinds of files, with one food-log line per entry in day order", async () => {
    const { photo } = await seed();
    const { files, text } = await download();
    expect(Object.keys(files).sort()).toEqual(["bytesize-export.json", "food-log.csv", "my-foods.csv", "photos/" + path.basename(photo.path), "shots.csv", "side-effects.csv", "weigh-ins.csv"].sort());
    const lines = text("food-log.csv").split("\r\n");
    expect(lines.pop()).toBe("");
    expect(lines[0]).toBe("Day,Meal,Food,Brand,Amount,Calories,Protein (g),Carbs (g),Fat (g),Fiber (g),Sugar (g),Sodium (mg),Saturated fat (g),Added sugar (g),Sugar alcohol (g),Potassium (mg),Magnesium (mg),Water (ml),AI estimated");
    expect(lines.length).toBe(1 + 4);
    expect(lines.slice(1).map((l) => l.slice(0, 10))).toEqual(["2026-11-16", DAY, DAY, DAY]);
    expect(lines[1]).toBe("2026-11-16,breakfast,Toast,,1 × 2 slices,160,6,30,2,4,,,,,,,,,No");
  });

  it("leaves unknown nutrients blank, never 0, and defuses odd names", async () => {
    await seed();
    const { text } = await download();
    const row = text("food-log.csv").split("\r\n").find((l) => l.includes("Mystery"))!;
    expect(row).toBe(`${DAY},lunch,"Mystery, ""bar""",'=Acme,1 × 1 bar,200,,,,,,,,,,,,,No`);
    expect(row.split(",").length).toBe(20); // the comma in the name is quoted
  });

  it("writes the other sheets", async () => {
    await seed();
    const { text } = await download();
    expect(text("weigh-ins.csv")).toBe(`Day,Weight (kg),Weight (lb),Note\r\n${DAY},90.5,199.5,after a walk\r\n`);
    expect(text("shots.csv")).toBe("Day,Medication,Dose,Site,Note\r\n2026-11-12,Mounjaro,2.5 mg,Abdomen left,fine\r\n");
    expect(text("side-effects.csv")).toBe(`Day,Effect,Severity,Note\r\n${DAY},Nausea,2,mild\r\n`);
    const foods = text("my-foods.csv").split("\r\n");
    expect(foods[0]).toBe("Name,Brand,Kind,Serving,Calories,Protein (g),Carbs (g),Fat (g),Fiber (g)");
    expect(foods).toContain("Toast,,custom,2 slices,160,6,30,2,4");
  });

  it("the json holds every per-person table (and no secrets)", async () => {
    await seed();
    expect((await t.api("PUT", "/api/settings/culury", { url: "http://culury.lan:4000", apiKey: "SECRET-KEY-123" })).status).toBeLessThan(500);
    const { text } = await download();
    const raw = text("bytesize-export.json");
    const json = JSON.parse(raw);
    expect(json).toMatchObject({ app: "bytesize", format: 1, exportedAt: "2026-11-17T19:00:00.000Z", user: { name: "cory", email: "cory@example.com", timezone: "America/Boise", units: "imperial" } });
    const perUser = (Object.values(schema) as unknown[])
      .filter((x: unknown): x is PgTable => is(x, PgTableClass))
      .map((tbl) => getTableConfig(tbl))
      .filter((c) => c.columns.some((col) => col.name === "user_id"))
      .map((c) => c.name)
      .filter((n) => !["sessions", "passkeys", "password_reset_codes", "oauth_flows", "invites", "log_combines"].includes(n)); // sign-in material; Undo state
    expect(Object.keys(json.tables).sort()).toEqual([...perUser, "recipe_items"].sort());
    expect(json.tables.log_entries).toHaveLength(4);
    expect(json.tables.weigh_ins).toHaveLength(1);
    expect(json.tables.uploads).toHaveLength(1);
    expect(json.culury).toEqual({ url: "http://culury.lan:4000" });
    expect(raw).not.toMatch(/SECRET-KEY-123/);
    expect(raw).not.toMatch(/"[^"]*(password|hash|apiKey|secret|token)[^"]*"\s*:/i);
    expect(raw).not.toMatch(/key_?enc/i);
    expect(json.tables.sessions).toBeUndefined();
    expect(json.tables.passkeys).toBeUndefined();
  });

  it("API keys go out as name, first characters, access and dates only: never the key, its hash or its encrypted copy", async () => {
    await seed();
    const made = (await t.api("POST", "/api/keys", { name: "Home Assistant", access: "log" })).body;
    const { text } = await download();
    const raw = text("bytesize-export.json");
    expect(JSON.parse(raw).tables.api_keys).toEqual([{ id: made.id, userId: 1, name: "Home Assistant", prefix: made.prefix, access: "log", createdAt: expect.any(String), lastUsedAt: null }]);
    expect(raw).not.toContain(made.key);
    expect(raw).not.toContain(made.key.slice(11));
  });

  it("includes the person's Dashboard layout", async () => {
    const layout = { version: 1, columns: [["budget"], ["food"], ["streak"]] };
    expect((await t.api("PUT", "/api/dashboard/layout", layout)).status).toBe(200);
    const { text } = await download();
    expect(JSON.parse(text("bytesize-export.json")).tables.dashboard_layouts).toEqual([expect.objectContaining({ columns: layout.columns })]);
  });

  it("the json carries the date format choice with the rest of the person's settings", async () => {
    await t.api("PUT", "/api/settings/me", { mealWindows: { breakfast: "10:30", lunch: "14:30", snacks: "17:00", dinner: "21:00" }, waterButtonsMl: [237], dateFormat: "dmy-dot" });
    const json = JSON.parse((await download()).text("bytesize-export.json"));
    expect(json.tables.user_settings).toMatchObject([{ dateFormat: "dmy-dot" }]);
  });

  it("includes the person's photo, byte for byte", async () => {
    const { photo, userId } = await seed();
    const { files } = await download();
    const [row] = await t.db.select().from(uploads).where(eq(uploads.userId, userId));
    const disk = readFileSync(path.join(t.app.dataDir, "uploads", row.path));
    expect(Buffer.from(files["photos/" + path.basename(photo.path)]).equals(disk)).toBe(true);
  });

  it("writes an activity-log line without file contents", async () => {
    await seed();
    await download();
    const lines = await t.db.select().from(appLog).where(eq(appLog.event, "Downloaded their data"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ category: "api", level: "info", source: "Download my data" });
    expect(lines[0].userId).not.toBeNull();
    expect(lines[0].detail).not.toMatch(/Toast/);
  });

  it("is limited to 5 an hour per person", async () => {
    const { buildApp } = await import("../src/app.js");
    const { TEST_SECRET } = await import("./helpers.js");
    const app2 = buildApp({ db: t.db, jwtSecret: TEST_SECRET, rateLimit: { max: 100, windowMs: 60_000 }, dataDir: t.app.dataDir });
    await app2.ready();
    const get = () => app2.inject({ method: "GET", url: "/api/export", headers: { authorization: `Bearer ${t.getToken()}` } });
    for (let i = 0; i < 5; i++) expect((await get()).statusCode).toBe(200);
    expect((await get()).statusCode).toBe(429);
    await app2.close();
  });

  it("leaves out what combines did (short-lived Undo state), though the entries are there", async () => {
    await seed();
    const food = (await t.api("POST", "/api/my-foods", { name: "Egg", servings: [{ label: "1 large", grams: 50 }], nutrients: { calories: 70 } })).body.food;
    const add = { day: "2026-11-17", meal: "breakfast", food: { kind: "user_food", id: food.id }, servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 };
    await t.api("POST", "/api/log", add);
    expect((await t.api("POST", "/api/log", add)).body.combined).toBeDefined();
    const json = JSON.parse((await download()).text("bytesize-export.json"));
    expect(json.tables.log_combines).toBeUndefined();
    expect(json.tables.log_entries.some((e: any) => e.name === "Egg" && e.quantity === 2)).toBe(true);
  });
});
