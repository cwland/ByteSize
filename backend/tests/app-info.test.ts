// §29 GET /api/app-info: a person's own numbers, the admin's totals for everyone, counting since, the version.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { strFromU8, unzipSync } from "fflate";
import { setupTestApp, TEST_SECRET, type TestApp } from "./helpers.js";
import { twoUsers } from "./isolation.js";
import { appSettings, usageCounts, users } from "../src/db/schema.js";
import { buildApp } from "../src/app.js";
import { APP_VERSION } from "../src/lib/version.js";
import { countUsage, usageSettled } from "../src/lib/usage.js";

let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
beforeEach(async () => {
  await t.reset();
  await t.login(); // admin "alex", America/Denver
  t.clock.date = new Date("2026-11-17T19:00:00Z"); // noon Tuesday Nov 17 in Denver
});
afterAll(async () => t.close());

const toast = { name: "Toast", servings: [{ label: "2 slices", grams: 60 }], nutrients: { calories: 160 } };
const egg = { name: "Egg", servings: [{ label: "1 egg", grams: 50 }], nutrients: { calories: 70 } };
const logFood = async (day: string, id: number) =>
  expect((await t.api("POST", "/api/log", { day, meal: "breakfast", food: { kind: "user_food", id }, servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 })).status).toBe(200);
const info = async () => {
  await usageSettled();
  return t.api("GET", "/api/app-info");
};

/** Days 10, 11, 12, (13 on vacation), 14, 15 and 17 with food; an egg and water too; two weigh-ins. */
async function history() {
  const toastId = (await t.api("POST", "/api/my-foods", toast)).body.food.id;
  const eggId = (await t.api("POST", "/api/my-foods", egg)).body.food.id;
  for (const d of ["10", "11", "12", "14", "15", "17"]) await logFood(`2026-11-${d}`, toastId);
  await logFood("2026-11-10", eggId);
  expect((await t.api("POST", "/api/log", { day: "2026-11-10", meal: "supplements", water_ml: 500 })).status).toBe(200);
  expect((await t.api("POST", "/api/vacations", { from: "2026-11-13", to: "2026-11-13" })).status).toBe(200);
  expect((await t.api("PUT", "/api/weigh-ins/2026-11-01", { weightKg: 100 })).status).toBe(200);
  expect((await t.api("PUT", "/api/weigh-ins/2026-11-10", { weightKg: 98 })).status).toBe(200);
}

describe("GET /api/app-info", () => {
  it("needs a login", async () => {
    t.setToken("");
    expect((await t.api("GET", "/api/app-info")).status).toBe(401);
  });

  it("a person with nothing yet: zeros, nothing hidden that should show, and the version", async () => {
    const r = await info();
    expect(r.status).toBe(200);
    expect(r.body.you).toEqual({
      daysLogged: 0, foodsLogged: 0, differentFoods: 0, myFoods: 0, weighIns: 0, weightLost: null, weightLostTrend: null, shots: null, longestStreak: 0,
      memberSince: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      barcodesScanned: 0, photosRead: 0, aiEstimates: 0, aiInsights: 0, lookupsSaved: 0,
      outsideLookups: { total: 0, off: 0, usda: 0, fatsecret: 0, spoonacular: 0, culury: 0 },
    });
    expect(r.body.version).toBe(APP_VERSION);
  });

  it("counts what ByteSize already keeps: days, foods, different foods, My foods, weigh-ins, the longest streak (a vacation day doesn't break it), water not counted", async () => {
    await history();
    const { you } = (await info()).body;
    expect(you).toMatchObject({ daysLogged: 6, foodsLogged: 7, differentFoods: 2, myFoods: 2, weighIns: 2, longestStreak: 5 });
  });

  it("pounds lost: first to latest weigh-in in the person's units; hidden when there's no loss", async () => {
    await history();
    expect((await info()).body.you.weightLost).toEqual({ amount: 4.4, unit: "lb" }); // 2 kg
    await t.db.update(users).set({ units: "metric" }).where(eq(users.id, 1));
    expect((await info()).body.you.weightLost).toEqual({ amount: 2, unit: "kg" });
    await t.api("PUT", "/api/weigh-ins/2026-11-16", { weightKg: 101 });
    expect((await info()).body.you.weightLost).toBeNull(); // gained since the first weigh-in
  });

  it("pounds lost by the trend sits beside the scale figure", async () => {
    await t.api("PUT", "/api/weigh-ins/2026-11-01", { weightKg: 100 });
    await t.api("PUT", "/api/weigh-ins/2026-11-02", { weightKg: 98 }); // the trend: 100 − 2 × 0.1 = 99.8
    expect((await info()).body.you).toMatchObject({ weightLost: { amount: 4.4, unit: "lb" }, weightLostTrend: { amount: 0.4, unit: "lb" } });
  });

  it("one weigh-in is no loss", async () => {
    await t.api("PUT", "/api/weigh-ins/2026-11-01", { weightKg: 100 });
    expect((await info()).body.you.weightLost).toBeNull();
  });

  it("shots logged: shown (even at 0) only with GLP-1 on", async () => {
    expect((await info()).body.you.shots).toBeNull();
    await t.api("PUT", "/api/body", { sex: "male", birthDate: "1986-01-01", heightCm: 177.8, weightKg: 100, goalWeightKg: 80, activity: "sitting", glp1: true });
    expect((await info()).body.you.shots).toBe(0);
    await t.api("PUT", "/api/glp1/settings", { medication: "Mounjaro", doseMg: 2.5, injectionWeekday: 5 });
    await t.api("PUT", "/api/glp1/shots/2026-11-12", { site: "abdomen_left" });
    await t.api("PUT", "/api/glp1/shots/2026-11-05", { site: "abdomen_right" });
    expect((await info()).body.you.shots).toBe(2);
  });

  it("member since is the day the account was made, in their timezone", async () => {
    await t.db.update(users).set({ createdAt: new Date("2026-03-05T03:00:00Z") }).where(eq(users.id, 1)); // still Mar 4 evening in Denver
    expect((await info()).body.you.memberSince).toBe("2026-03-04");
  });

  it("the counted numbers: barcodes, photos, AI estimates, lookups saved, outside lookups with a total", async () => {
    for (const [key, n] of [["barcodes_scanned", 4], ["photos_read", 2], ["ai_estimates", 3], ["ai_insights", 6], ["lookups_saved", 7], ["outside_off", 2], ["outside_usda", 1], ["outside_culury", 5]] as const) countUsage(t.app, 1, key, n);
    expect((await info()).body.you).toMatchObject({
      barcodesScanned: 4, photosRead: 2, aiEstimates: 3, aiInsights: 6, lookupsSaved: 7,
      outsideLookups: { total: 8, off: 2, usda: 1, fatsecret: 0, spoonacular: 0, culury: 5 },
    });
  });

  it("counting since: the day it was first needed (app clock, UTC), kept after that", async () => {
    expect((await info()).body.countingSince).toBe("2026-11-17");
    t.clock.date = new Date("2027-01-02T12:00:00Z");
    expect((await info()).body.countingSince).toBe("2026-11-17");
    const [row] = await t.db.select().from(appSettings).where(eq(appSettings.key, "usage_counting_since"));
    expect(row.value).toBe("2026-11-17");
  });

  it("counting since is set when the server starts, not when someone first looks", async () => {
    await t.db.delete(appSettings).where(eq(appSettings.key, "usage_counting_since"));
    t.clock.date = new Date("2026-12-01T12:00:00Z");
    const app2 = buildApp({ db: t.db, jwtSecret: TEST_SECRET, rateLimit: false, dataDir: t.app.dataDir, foodFetch: t.app.foodFetch, now: () => t.clock.date!, backupSchedule: false });
    await app2.ready();
    await app2.close();
    const [row] = await t.db.select().from(appSettings).where(eq(appSettings.key, "usage_counting_since"));
    expect(row.value).toBe("2026-12-01");
  });
});

describe("everyone on this server (admin only)", () => {
  it("the admin gets totals across every person; people, days, foods, barcodes, outside lookups, lookups saved", async () => {
    const { a, b } = await twoUsers(t);
    const food = async (token: string, day: string) => {
      const id = (await t.app.inject({ method: "POST", url: "/api/my-foods", payload: toast, headers: { authorization: `Bearer ${token}` } })).json().food.id;
      await t.app.inject({ method: "POST", url: "/api/log", payload: { day, meal: "breakfast", food: { kind: "user_food", id }, servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 }, headers: { authorization: `Bearer ${token}` } });
      await t.app.inject({ method: "POST", url: "/api/log", payload: { day, meal: "lunch", food: { kind: "user_food", id }, servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 }, headers: { authorization: `Bearer ${token}` } });
    };
    await food(a.token, "2026-11-16");
    await food(b.token, "2026-11-16"); // the same day as anna: two people's days, not one
    await food(b.token, "2026-11-17");
    countUsage(t.app, a.id, "barcodes_scanned", 2);
    countUsage(t.app, b.id, "barcodes_scanned", 3);
    countUsage(t.app, a.id, "outside_off", 1);
    countUsage(t.app, b.id, "outside_usda", 4);
    countUsage(t.app, 1, "outside_culury", 2);
    countUsage(t.app, b.id, "lookups_saved", 6);
    const r = await info();
    expect(r.body.everyone).toEqual({ people: 3, daysLogged: 3, foodsLogged: 6, barcodesScanned: 5, outsideLookups: 7, lookupsSaved: 6 });
    // ...and the admin's own numbers are still only theirs
    expect(r.body.you).toMatchObject({ foodsLogged: 0, barcodesScanned: 0, outsideLookups: { total: 2 } });
  });

  it("a member never gets it, not even an empty one", async () => {
    const { a, b } = await twoUsers(t);
    countUsage(t.app, b.id, "barcodes_scanned", 9);
    await usageSettled();
    const r = await a.as("GET", "/api/app-info");
    expect(r.status).toBe(200);
    expect("everyone" in r.body).toBe(false);
    expect(JSON.stringify(r.body)).not.toContain('"people"');
    expect(r.body.you.barcodesScanned).toBe(0); // nothing of ben's
  });

  it("each person's numbers are only theirs", async () => {
    const { a, b } = await twoUsers(t);
    countUsage(t.app, a.id, "photos_read", 2);
    countUsage(t.app, b.id, "photos_read", 5);
    await usageSettled();
    expect((await a.as("GET", "/api/app-info")).body.you.photosRead).toBe(2);
    expect((await b.as("GET", "/api/app-info")).body.you.photosRead).toBe(5);
  });
});

describe("Download my data includes the person's counts", () => {
  it("only their own rows", async () => {
    const { a } = await twoUsers(t);
    countUsage(t.app, 1, "barcodes_scanned", 4);
    countUsage(t.app, a.id, "barcodes_scanned", 9);
    await usageSettled();
    const res = await t.app.inject({ method: "GET", url: "/api/export", headers: { authorization: `Bearer ${t.getToken()}` } });
    const json = JSON.parse(strFromU8(unzipSync(new Uint8Array(res.rawPayload))["bytesize-export.json"]));
    expect(json.tables.usage_counts).toEqual([{ userId: 1, key: "barcodes_scanned", count: 4 }]);
    expect(await t.db.select().from(usageCounts)).toHaveLength(2);
  });
});
