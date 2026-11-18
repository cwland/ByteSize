import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, asc, eq, sql } from "drizzle-orm";
import { setupTestApp, TEST_SECRET, type TestApp } from "./helpers.js";
import { multipart } from "./photoFakes.js";
import { appLog, userBody, weighIns } from "../src/db/schema.js";
import { buildApp } from "../src/app.js";

// Settings › Data › Import weight history (design §19): preview a CSV, then import it into your own weigh-ins.
let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
beforeEach(async () => {
  await t.reset();
  await t.login();
  t.clock.date = NOW;
});
afterAll(async () => t.close());

const KG_PER_LB = 0.45359237;
// Cory is in America/Boise (UTC−7): 05:30 UTC on Nov 18 is still Nov 17 there
const NOW = new Date("2026-11-18T05:30:00Z");
const BODY = { sex: "male", birthDate: "1986-01-01", heightCm: 177.8, weightKg: 100, goalWeightKg: 80, activity: "sitting", glp1: false } as const;

type Fields = Record<string, string>;
function form(csv: string | Buffer, fields: Fields = {}, filename = "weights.csv") {
  return multipart([...Object.entries(fields).map(([name, value]) => ({ name, value })), { name: "file", filename, type: "text/csv", data: Buffer.isBuffer(csv) ? csv : Buffer.from(csv) }]);
}
const send = (url: string, csv: string | Buffer, fields: Fields = {}) => {
  const { payload, headers } = form(csv, fields);
  return t.api("POST", url, payload, headers);
};
const preview = (csv: string | Buffer, fields: Fields = {}) => send("/api/weight/import/preview", csv, fields);
const importCsv = (csv: string | Buffer, fields: Fields = {}) => send("/api/weight/import", csv, fields);
const stored = async (userId = 1) =>
  (await t.db.select({ day: weighIns.day, weightKg: weighIns.weightKg, note: weighIns.note }).from(weighIns).where(eq(weighIns.userId, userId)).orderBy(asc(weighIns.day))).map((r) => ({
    ...r,
    lb: Math.round((r.weightKg / KG_PER_LB) * 10) / 10,
  }));
const weigh = (day: string, weightKg: number, note?: string) => t.api("PUT", `/api/weigh-ins/${day}`, note === undefined ? { weightKg } : { weightKg, note });

const LOSE_IT = "Date,Weight\n11/16/2026,214.2\n11/15/2026,214.8\n11/14/2026,abc\n01/03/2025,251.0\n";

describe("POST /api/weight/import/preview", () => {
  it("shows the guessed columns, units and date format, a summary, the unreadable rows and the first rows; saves nothing", async () => {
    await weigh("2026-11-15", 97);
    const res = await preview(LOSE_IT);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      columns: ["Date", "Weight"],
      dateColumn: 0,
      weightColumn: 1,
      units: "lb",
      dateFormat: "mdy",
      dateFormatMatters: true,
      count: 3,
      from: "2025-01-03",
      to: "2026-11-16",
      existingDays: 1,
      unreadable: 1,
      problems: [{ line: 4, reason: 'Can\'t read the weight "abc"' }],
      rows: [
        { day: "2026-11-16", weightKg: 214.2 * KG_PER_LB, existing: false },
        { day: "2026-11-15", weightKg: 214.8 * KG_PER_LB, existing: true },
        { day: "2025-01-03", weightKg: 251 * KG_PER_LB, existing: false },
      ],
    });
    expect((await stored()).map((w) => w.day)).toEqual(["2026-11-15"]);
  });

  it("guesses units from the person's setting when the file doesn't say", async () => {
    await t.api("PATCH", "/api/profile", { units: "metric" });
    expect((await preview("Date,Weight\n2025-01-03,98.4")).body).toMatchObject({ units: "kg", rows: [{ day: "2025-01-03", weightKg: 98.4, existing: false }] });
  });

  it("re-reads with the person's choices of columns, units and date format", async () => {
    const csv = "Day,Weight,Trend\n03/04/2025,180,179\n05/06/2025,181,180";
    const res = await preview(csv, { dateColumn: "0", weightColumn: "2", units: "kg", dateFormat: "dmy" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ weightColumn: 2, units: "kg", dateFormat: "dmy", rows: [{ day: "2025-04-03", weightKg: 179 }, { day: "2025-06-05", weightKg: 180 }] });
  });

  it("lists at most 5 unreadable rows and 10 rows to save, and counts them all", async () => {
    const good = Array.from({ length: 12 }, (_, i) => `2025-01-${String(i + 1).padStart(2, "0")},180`);
    const bad = Array.from({ length: 7 }, () => "2025-02-01,9999");
    const res = await preview(["Date,Weight", ...good, ...bad].join("\n"));
    expect(res.body).toMatchObject({ count: 12, unreadable: 7 });
    expect(res.body.rows).toHaveLength(10);
    expect(res.body.problems.map((p: any) => p.line)).toEqual([14, 15, 16, 17, 18]);
  });

  it("skips days after the person's today", async () => {
    const res = await preview("Date,Weight\n2026-11-17,180\n2026-11-18,181");
    expect(res.body).toMatchObject({ count: 1, to: "2026-11-17", problems: [{ line: 3, reason: "Date is in the future" }] });
  });

  it("a file with nothing readable still previews, so the person can pick other columns", async () => {
    const res = await preview("Date,Weight\nsoon,abc");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ count: 0, from: null, to: null, existingDays: 0, unreadable: 1, rows: [] });
  });

  it("refuses something that isn't a CSV file, with a plain message", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 0xff, 0xfe]);
    expect(await preview(png)).toMatchObject({ status: 400, body: { error: "That file isn't a CSV file. Choose the .csv file your old app exported." } });
    expect(await preview("just a sentence")).toMatchObject({ status: 400, body: { error: "Couldn't find a date column and a weight column in that file." } });
    expect(await preview("")).toMatchObject({ status: 400, body: { error: "That file is empty." } });
  });

  it("refuses a request without a file, or with options it doesn't know", async () => {
    const noFile = multipart([{ name: "units", value: "lb" }]);
    expect(await t.api("POST", "/api/weight/import/preview", noFile.payload, noFile.headers)).toMatchObject({ status: 400, body: { error: "Choose a CSV file." } });
    expect(await t.api("POST", "/api/weight/import/preview", { csv: "Date,Weight" })).toMatchObject({ status: 400, body: { error: "Choose a CSV file." } });
    expect((await preview(LOSE_IT, { units: "stone" })).status).toBe(400);
    expect((await preview(LOSE_IT, { dateColumn: "7" })).body).toEqual({ error: "That file doesn't have that column." });
  });

  it("takes files up to 5 MB", async () => {
    const line = "2025-01-03,180.0\n";
    const big = "Date,Weight\n" + line.repeat(Math.floor((5 * 1024 * 1024 - 12) / line.length));
    expect(Buffer.byteLength(big)).toBeLessThanOrEqual(5 * 1024 * 1024);
    expect((await preview(big)).status).toBe(200);
    const tooBig = Buffer.alloc(5 * 1024 * 1024 + 1, "1");
    expect(await preview(tooBig)).toMatchObject({ status: 413, body: { error: "The file must be 5 MB or less." } });
  });

  // Shapes that once took seconds per 100 KB: each must answer within 2 s at the full 5 MB
  describe("big or odd files answer quickly", () => {
    const MB5 = 5 * 1024 * 1024;
    const fill = (unit: string, head = "") => head + unit.repeat(Math.floor((MB5 - head.length) / unit.length));
    const timed = async (csv: string) => {
      expect(Buffer.byteLength(csv)).toBeLessThanOrEqual(MB5);
      const start = performance.now();
      const res = await preview(csv);
      return { ...res, ms: performance.now() - start };
    };
    it("a first row of only dates", async () => {
      const res = await timed(fill("2025-01-03,"));
      expect(res.ms).toBeLessThan(2000);
      expect(res.body.error).toMatch(/more than 50 columns/);
    });
    it("rows of only dates", async () => {
      const res = await timed(fill("2025-01-03,2025-01-04\n"));
      expect(res.ms).toBeLessThan(2000);
      expect(res.status).toBe(200);
    });
    it("a wide junk header with many short rows", async () => {
      const res = await timed(fill("1,2\n", Array.from({ length: 5000 }, (_, i) => `junk${i}`).join(",") + "\n"));
      expect(res.ms).toBeLessThan(2000);
      expect(res.body).toEqual({ error: "This file has more than 50 columns. Export just the date and weight, or remove extra columns." });
    });
    it("a 50-column junk header with many short rows", async () => {
      const res = await timed(fill("1,2\n", Array.from({ length: 50 }, (_, i) => `junk${i}`).join(",") + "\n"));
      expect(res.ms).toBeLessThan(2000);
      expect(res.status).toBe(200);
    });
    it("5 MB of commas", async () => {
      const res = await timed(fill(","));
      expect(res.ms).toBeLessThan(2000);
      expect(res.status).toBe(400);
    });
    it("one 5 MB line", async () => {
      const res = await timed(fill("a1b2c3"));
      expect(res.ms).toBeLessThan(2000);
      expect(res.status).toBe(400);
    });
  });

  it("reads a Windows-1252 file and a UTF-16 (Excel Unicode Text) file", async () => {
    const cp1252 = Buffer.concat([Buffer.from("Date,Weight,Note\n2025-01-03,180,caf"), Buffer.from([0xe9])]);
    expect((await importCsv(cp1252)).status).toBe(200);
    expect((await stored()).map((w) => w.note)).toEqual(["caf\u00e9"]);
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("Date\tWeight\n2025-01-04\t181\n", "utf16le")]);
    expect((await preview(utf16)).body).toMatchObject({ columns: ["Date", "Weight"], count: 1, rows: [{ day: "2025-01-04" }] });
  });

  it("names the line of a quote that is never closed", async () => {
    expect(await preview('Date,Weight,Note\n2025-01-03,180,"oops\n2025-01-04,181,')).toMatchObject({ status: 400, body: { error: "Line 2 has a quote that is never closed." } });
  });

  it("needs a login", async () => {
    t.setToken("");
    expect((await preview(LOSE_IT)).status).toBe(401);
  });
});

describe("POST /api/weight/import", () => {
  it("adds the file's weigh-ins in kg (exact lb conversion) and keeps days already in ByteSize by default", async () => {
    await weigh("2026-11-15", 97, "mine");
    const res = await importCsv(LOSE_IT);
    expect(res).toMatchObject({ status: 200, body: { imported: 2, kept: 1, replaced: 0, from: "2025-01-03", to: "2026-11-16" } });
    expect(await stored()).toEqual([
      { day: "2025-01-03", weightKg: 251 * KG_PER_LB, note: null, lb: 251 },
      { day: "2026-11-15", weightKg: 97, note: "mine", lb: 213.8 },
      { day: "2026-11-16", weightKg: 214.2 * KG_PER_LB, note: null, lb: 214.2 },
    ]);
  });

  it("replaces days already in ByteSize when asked; their notes stay unless the file has a note for that day", async () => {
    await weigh("2026-11-15", 97, "mine");
    await weigh("2026-11-16", 96, "keep me");
    const res = await importCsv(LOSE_IT, { existing: "replace" });
    expect(res.body).toEqual({ imported: 3, kept: 0, replaced: 2, from: "2025-01-03", to: "2026-11-16" });
    expect((await stored()).map((w) => [w.day, w.lb, w.note])).toEqual([
      ["2025-01-03", 251, null],
      ["2026-11-15", 214.8, "mine"],
      ["2026-11-16", 214.2, "keep me"],
    ]);
    await importCsv("Date,Weight,Notes\n2026-11-16,214,from the file\n2026-11-15,215,", { existing: "replace" });
    expect((await stored()).map((w) => [w.day, w.lb, w.note])).toEqual([
      ["2025-01-03", 251, null],
      ["2026-11-15", 215, "mine"], // an empty note cell keeps the note
      ["2026-11-16", 214, "from the file"],
    ]);
  });

  it("keeps kg as written and uses the chosen options", async () => {
    await importCsv("Datum;Gewicht\n03/04/2025;98,4", { dateColumn: "0", weightColumn: "1", units: "kg", dateFormat: "dmy" });
    expect(await stored()).toMatchObject([{ day: "2025-04-03", weightKg: 98.4 }]);
  });

  it("moves the body weight to the latest weigh-in, and leaves it for an older history", async () => {
    await t.api("PUT", "/api/body", BODY); // 100 kg today (Nov 17)
    await importCsv("Date,Weight (kg)\n2026-10-01,110\n2026-10-02,109");
    let [body] = await t.db.select({ w: userBody.weightKg }).from(userBody).where(eq(userBody.userId, 1));
    expect(body.w).toBe(100);
    await importCsv("Date,Weight (kg)\n2026-11-17,99.5", { existing: "replace" });
    [body] = await t.db.select({ w: userBody.weightKg }).from(userBody).where(eq(userBody.userId, 1));
    expect(body.w).toBe(99.5);
  });

  it("is one transaction: a failure part-way saves nothing", async () => {
    await weigh("2026-11-15", 97);
    await t.db.execute(sql`create or replace function fail_on_123() returns trigger language plpgsql as $$ begin if new.weight_kg = 123 then raise exception 'boom'; end if; return new; end $$`);
    await t.db.execute(sql`create trigger fail_on_123 before insert or update on weigh_ins for each row execute function fail_on_123()`);
    try {
      const res = await importCsv("Date,Weight (kg)\n2026-11-01,100\n2026-11-02,101\n2026-11-03,123\n2026-11-15,90", { existing: "replace" });
      expect(res.status).toBe(500);
    } finally {
      await t.db.execute(sql`drop trigger fail_on_123 on weigh_ins`);
      await t.db.execute(sql`drop function fail_on_123()`);
    }
    expect((await stored()).map((w) => [w.day, w.weightKg])).toEqual([["2026-11-15", 97]]);
    expect(await t.db.select().from(appLog).where(eq(appLog.source, "Weight import"))).toEqual([]);
  });

  it("imports a long history in one go", async () => {
    const lines = Array.from({ length: 1500 }, (_, i) => {
      const d = new Date(Date.UTC(2022, 0, 1 + i)).toISOString().slice(0, 10);
      return `${d},${(300 - i * 0.05).toFixed(1)}`;
    });
    const res = await importCsv(["Date,Weight", ...lines].join("\n"));
    expect(res.body).toMatchObject({ imported: 1500, from: "2022-01-01", to: "2026-02-08" });
    expect(await stored()).toHaveLength(1500);
  });

  it("refuses a file with nothing to import", async () => {
    expect(await importCsv("Date,Weight\nsoon,abc")).toMatchObject({ status: 400, body: { error: "No weigh-ins could be read from that file." } });
    expect((await importCsv(LOSE_IT, { existing: "merge" })).status).toBe(400);
  });

  it("writes who, how many and the date range to the activity log, never the file", async () => {
    await weigh("2026-11-15", 97);
    await importCsv("Date,Weight,Notes\n11/16/2026,214.2,secret note\n11/15/2026,214.8,\n01/03/2025,251.0,");
    const lines = await t.db.select().from(appLog).where(eq(appLog.source, "Weight import"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ category: "api", level: "info", userId: 1, event: "Imported 2 weigh-ins", detail: "Jan 3, 2025 to Nov 16, 2026; 1 day already in ByteSize kept; 0 rows skipped; by cory" });
    expect(JSON.stringify(lines[0])).not.toMatch(/secret|214|weights\.csv/);
  });

  it("previews and imports are limited to 10 a minute per person", async () => {
    const app2 = buildApp({ db: t.db, jwtSecret: TEST_SECRET, rateLimit: { max: 100, windowMs: 60_000 }, dataDir: t.app.dataDir, now: () => NOW });
    await app2.ready();
    try {
      const anna = await t.createUser("anna");
      const post = (url: string, token: string) => {
        const { payload, headers } = form("Date,Weight\n2025-01-03,180");
        return app2.inject({ method: "POST", url, payload, headers: { ...headers, authorization: `Bearer ${token}` } });
      };
      for (let i = 0; i < 10; i++) expect((await post("/api/weight/import", t.getToken())).statusCode).toBe(200);
      const limited = await post("/api/weight/import", t.getToken());
      expect(limited.statusCode).toBe(429);
      expect((await post("/api/weight/import", anna.token)).statusCode).toBe(200); // someone else isn't held up
      for (let i = 0; i < 10; i++) expect((await post("/api/weight/import/preview", t.getToken())).statusCode).toBe(200);
      expect((await post("/api/weight/import/preview", t.getToken())).statusCode).toBe(429);
    } finally {
      await app2.close();
    }
  });
});

describe("badges after an import", () => {
  it("a long losing history earns its badges once, dated on the history's days, in one list", async () => {
    await t.api("PUT", "/api/body", { ...BODY, weightKg: 120, goalWeightKg: 80 });
    const lines = Array.from({ length: 300 }, (_, i) => `${new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10)},${(130 - i * 0.15).toFixed(2)}`);
    await importCsv(["Date,Weight (kg)", ...lines].join("\n"));
    const first = await t.api("GET", "/api/badges");
    expect(first.body.new).toContain("first_weigh_in");
    expect(first.body.new.filter((id: string) => id.startsWith("lost_")).length).toBeGreaterThan(5);
    const earned = first.body.badges.find((b: any) => b.id === "first_weigh_in");
    expect(earned.earnedOn).toBe("2025-01-01");
    await t.api("POST", "/api/badges/seen", { ids: first.body.new });
    expect((await t.api("GET", "/api/badges")).body.new).toEqual([]);
  });
});

// Kept here as well as in isolation.test.ts: the replace mode never reaches someone else's day
describe("only your own history", () => {
  it("replace touches only the importer's days", async () => {
    const anna = await t.createUser("anna");
    await weigh("2026-11-15", 97);
    const { payload, headers } = form("Date,Weight (kg)\n2026-11-15,80", { existing: "replace" });
    const res = await t.app.inject({ method: "POST", url: "/api/weight/import", payload, headers: { ...headers, authorization: `Bearer ${anna.token}` } });
    expect(res.json()).toMatchObject({ imported: 1, replaced: 0 });
    expect((await stored(1)).map((w) => w.weightKg)).toEqual([97]);
    expect(await t.db.select({ w: weighIns.weightKg }).from(weighIns).where(and(eq(weighIns.userId, anna.id), eq(weighIns.day, "2026-11-15")))).toEqual([{ w: 80 }]);
  });
});
