import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";

let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
beforeEach(async () => {
  await t.reset();
  await t.login();
});
afterAll(async () => t.close());

const windows = { breakfast: "10:30", lunch: "14:30", snacks: "17:00", dinner: "21:00" };

describe("week start setting", () => {
  it("week start defaults to Sunday (0) and saves Monday (1)", async () => {
    expect((await t.api("GET", "/api/settings/me")).body.weekStart).toBe(0);
    const put = await t.api("PUT", "/api/settings/me", { mealWindows: windows, waterButtonsMl: [237], weekStart: 1 });
    expect(put.status).toBe(200);
    expect(put.body.weekStart).toBe(1);
    expect((await t.api("GET", "/api/settings/me")).body).toEqual({ mealWindows: windows, waterButtonsMl: [237], weekStart: 1, dateFormat: "weekday-long-month-short" });
    // leaving weekStart out keeps what was saved
    const again = await t.api("PUT", "/api/settings/me", { mealWindows: windows, waterButtonsMl: [300] });
    expect(again.body.weekStart).toBe(1);
    expect((await t.api("GET", "/api/settings/me")).body.weekStart).toBe(1);
  });

  it("weekStart 7 is 400", async () => {
    for (const weekStart of [7, -1, 1.5]) {
      expect((await t.api("PUT", "/api/settings/me", { mealWindows: windows, waterButtonsMl: [237], weekStart })).status, String(weekStart)).toBe(400);
    }
    expect((await t.api("GET", "/api/settings/me")).body.weekStart).toBe(0);
  });
});

describe("date format setting (§33)", () => {
  const KEYS = [
    "weekday-long-month-short", "weekday-short-month-short", "weekday-long-month-long", "mdy-slash", "weekday-long-day-month-short",
    "weekday-short-day-month-short", "weekday-long-day-month-long", "dmy-slash", "dmy-dot", "iso",
  ];
  const put = (body: Record<string, unknown>) => t.api("PUT", "/api/settings/me", { mealWindows: windows, waterButtonsMl: [237], ...body });

  it("is today's look ('Wednesday, Nov 18') until someone chooses", async () => {
    expect((await t.api("GET", "/api/settings/me")).body.dateFormat).toBe("weekday-long-month-short");
    expect((await put({})).body.dateFormat).toBe("weekday-long-month-short"); // saving other settings first doesn't change it
  });

  it.each(KEYS)("saves %s, and leaving it out later keeps it", async (key) => {
    const saved = await put({ dateFormat: key });
    expect(saved.status).toBe(200);
    expect(saved.body.dateFormat).toBe(key);
    expect((await t.api("GET", "/api/settings/me")).body.dateFormat).toBe(key);
    expect((await put({ weekStart: 3 })).body.dateFormat).toBe(key);
  });

  it("an unknown key is a 400 and changes nothing", async () => {
    await put({ dateFormat: "iso" });
    for (const bad of ["", "ISO", "yyyy-mm-dd", "weekday-long", 5, null]) expect((await put({ dateFormat: bad })).status, String(bad)).toBe(400);
    expect((await t.api("GET", "/api/settings/me")).body.dateFormat).toBe("iso");
  });
});
