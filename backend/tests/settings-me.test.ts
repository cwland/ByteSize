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
    expect((await t.api("GET", "/api/settings/me")).body).toEqual({ mealWindows: windows, waterButtonsMl: [237], weekStart: 1, dateFormat: "weekday-long-month-short", goalEstimateBasis: "scale", goalEstimateWeeks: 12, glp1On: false });
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

describe("glp1On (§46): whether the person tracks a GLP-1, so the side rail needn't ask twice", () => {
  const glp1On = async () => (await t.api("GET", "/api/settings/me")).body.glp1On;
  const body = { sex: "male", birthDate: "1986-01-01", heightCm: 177.8, weightKg: 100, goalWeightKg: 80, activity: "sitting" };

  it("is off until GLP-1 is set up", async () => {
    expect(await glp1On()).toBe(false);
    expect((await t.api("PUT", "/api/glp1/settings", { medication: "Mounjaro", doseMg: 2.5, injectionWeekday: 5 })).status).toBe(200);
    expect(await glp1On()).toBe(true);
  });

  it("is on when the body profile says they take one (the Next shot widget's rule)", async () => {
    expect((await t.api("PUT", "/api/body", { ...body, glp1: false })).status).toBe(200);
    expect(await glp1On()).toBe(false);
    await t.api("PUT", "/api/body", { ...body, glp1: true });
    expect(await glp1On()).toBe(true);
  });

  it("is each person's own", async () => {
    await t.api("PUT", "/api/glp1/settings", { medication: "Mounjaro", doseMg: 2.5, injectionWeekday: 5 });
    const sam = await t.createUser("sam");
    const r = await t.app.inject({ method: "GET", url: "/api/settings/me", headers: { authorization: `Bearer ${sam.token}` } });
    expect(r.json().glp1On).toBe(false);
  });
});

describe("goal estimate settings", () => {
  const put = (body: Record<string, unknown>) => t.api("PUT", "/api/settings/me", { mealWindows: windows, waterButtonsMl: [237], ...body });

  it("defaults to scale weigh-ins over 12 weeks; saves trend over 26; left out keeps what was saved", async () => {
    expect((await t.api("GET", "/api/settings/me")).body).toMatchObject({ goalEstimateBasis: "scale", goalEstimateWeeks: 12 });
    const saved = await put({ goalEstimateBasis: "trend", goalEstimateWeeks: 26 });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ goalEstimateBasis: "trend", goalEstimateWeeks: 26 });
    expect((await put({})).body).toMatchObject({ goalEstimateBasis: "trend", goalEstimateWeeks: 26 });
    expect((await t.api("GET", "/api/settings/me")).body).toMatchObject({ goalEstimateBasis: "trend", goalEstimateWeeks: 26 });
  });

  it("only 6, 12 or 26 weeks, and only scale or trend", async () => {
    for (const goalEstimateWeeks of [4, 13, 0, "12"]) {
      const res = await put({ goalEstimateWeeks });
      expect(res.status, String(goalEstimateWeeks)).toBe(400);
    }
    expect((await put({ goalEstimateWeeks: 13 })).body.details).toEqual([{ path: "goalEstimateWeeks", message: "Choose 6, 12 or 26 weeks" }]);
    expect((await put({ goalEstimateBasis: "average" })).status).toBe(400);
    expect((await t.api("GET", "/api/settings/me")).body).toMatchObject({ goalEstimateBasis: "scale", goalEstimateWeeks: 12 });
  });
});
