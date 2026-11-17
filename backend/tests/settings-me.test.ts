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
    expect((await t.api("GET", "/api/settings/me")).body).toEqual({ mealWindows: windows, waterButtonsMl: [237], weekStart: 1 });
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
