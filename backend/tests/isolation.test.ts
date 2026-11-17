import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";
import { twoUsers } from "./isolation.js";
import { softPasskey } from "./softPasskey.js";
import { aiSettings, offKnows, offProduct } from "./foodFakes.js";

// Every route that reads or changes a person's data gets a case here (M2 adds foods, logs, targets...)
let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
beforeEach(async () => {
  await t.reset();
  await t.login();
});
afterAll(async () => t.close());

describe("per-user isolation", () => {
  it("a user only sees their own sessions", async () => {
    const { a, b } = await twoUsers(t);
    const mine = (await a.as("GET", "/api/auth/sessions")).body;
    const bens = (await b.as("GET", "/api/auth/sessions")).body;
    expect(mine.length).toBeGreaterThan(0);
    const bensIds = new Set(bens.map((s: any) => s.id));
    expect(mine.some((s: any) => bensIds.has(s.id))).toBe(false);
    expect((await a.as("DELETE", `/api/auth/sessions/${bens[0].id}`)).status).toBe(404);
    expect((await b.as("GET", "/api/auth/me")).status).toBe(200); // ben is still signed in
  });

  it("a member's sign-in history shows only their own attempts", async () => {
    const { a } = await twoUsers(t);
    const names = (await a.as("GET", "/api/auth/logins")).body.map((e: any) => e.username.toLowerCase());
    expect(names.length).toBeGreaterThan(0);
    expect(new Set(names)).toEqual(new Set(["anna"]));
  });

  it("a user can't list, rename or delete another user's passkeys", async () => {
    const { a, b } = await twoUsers(t);
    const origin = "http://localhost:5173";
    const key = softPasskey();
    const as = (token: string, method: string, url: string, payload?: object) =>
      t.app.inject({ method: method as "POST", url, payload, headers: { origin, authorization: `Bearer ${token}` } }).then((r) => ({ status: r.statusCode, body: r.body ? r.json() : undefined }));
    const o = await as(b.token, "POST", "/api/passkeys/register/options", {});
    const added = await as(b.token, "POST", "/api/passkeys/register/verify", { challengeId: o.body.challengeId, response: key.create(o.body.options, origin), name: "Ben's phone" });
    expect(added.status).toBe(200);
    expect((await a.as("GET", "/api/passkeys")).body).toEqual([]);
    expect((await a.as("PATCH", `/api/passkeys/${added.body.id}`, { name: "Mine now" })).status).toBe(404);
    expect((await a.as("DELETE", `/api/passkeys/${added.body.id}`)).status).toBe(404);
    expect((await b.as("GET", "/api/passkeys")).body).toMatchObject([{ id: added.body.id, name: "Ben's phone" }]);
  });

  it("a member can't see someone else's sign-ins by setting their email to that username", async () => {
    await t.createUser("alice@example.com");
    const mallory = await t.createUser("mallory");
    const as = (await import("./isolation.js")).asUser(t, mallory.token);
    expect((await as("PATCH", "/api/profile", { email: "Alice@example.com" })).status).toBe(200);
    const names = (await as("GET", "/api/auth/logins")).body.map((e: any) => e.username.toLowerCase());
    expect(names).not.toContain("alice@example.com");
    expect(names).toContain("mallory");
  });
  it("a user can't see another's body, plans or targets", async () => {
    const { a, b } = await twoUsers(t);
    const body = { sex: "female", birthDate: "1980-03-04", heightCm: 165, weightKg: 90, goalWeightKg: 70, activity: "some", glp1: false };
    expect((await a.as("PUT", "/api/body", body)).status).toBe(200);
    expect((await a.as("POST", "/api/plans/select", { plan: "steady" })).status).toBe(200);
    const windows = { breakfast: "08:00", lunch: "12:00", snacks: "15:00", dinner: "19:00" };
    expect((await a.as("PUT", "/api/settings/me", { mealWindows: windows, waterButtonsMl: [300], weekStart: 2 })).status).toBe(200);

    expect((await b.as("GET", "/api/body")).body).toEqual({ body: null });
    expect((await b.as("GET", "/api/plans")).status).toBe(409);
    expect((await b.as("GET", "/api/targets")).body).toEqual({ targets: null });
    expect((await b.as("GET", "/api/settings/me")).body).toMatchObject({ waterButtonsMl: [237, 473], weekStart: 0 });
    // ben's own changes don't touch anna's
    expect((await b.as("PUT", "/api/targets", { calories: { min: 1000, max: 1100 }, protein_g: { min: 1, max: 2 }, fiber_g: { min: 1, max: 2 }, water_ml: { min: 1, max: 2 } })).status).toBe(200);
    expect((await a.as("GET", "/api/targets")).body.targets.plan).toBe("steady");
    expect((await a.as("GET", "/api/body")).body).toEqual({ body: { ...body, needsReview: false } });
    expect((await a.as("GET", "/api/settings/me")).body).toEqual({ mealWindows: windows, waterButtonsMl: [300], weekStart: 2 });
  });

  it("a user can't see, edit or archive another user's foods or overrides, and lookups never return them", async () => {
    const { a, b } = await twoUsers(t);
    await t.api("PUT", "/api/settings/ai", aiSettings); // so fill-gaps gets past "set up AI"
    offKnows(t, { "0012345678905": offProduct("0012345678905", "Crunchy bar", 400) });
    const cached = (await a.as("GET", "/api/foods/barcode/012345678905")).body.food;
    const override = (await a.as("POST", "/api/my-foods/override", { cacheId: cached.id, name: "Anna's bar", nutrients: { calories: 1 } })).body.food;
    const custom = (await a.as("POST", "/api/my-foods", { name: "Anna's secret smoothie", barcode: "4006381333931", servings: [{ label: "1 cup", ml: 240 }], nutrients: { calories: 200 } })).body.food;
    expect(override.override).toBe(true);

    expect((await b.as("GET", "/api/my-foods")).body.foods).toEqual([]);
    expect((await b.as("GET", "/api/my-foods?q=smoothie")).body.foods).toEqual([]);
    for (const id of [override.id, custom.id]) {
      expect((await b.as("PATCH", `/api/my-foods/${id}`, { name: "Mine now" })).status).toBe(404);
      expect((await b.as("DELETE", `/api/my-foods/${id}`)).status).toBe(404);
      expect((await b.as("POST", "/api/ai/fill-gaps", { food: { kind: "user_food", id } })).status).toBe(404);
    }
    // Lookups: ben gets the shared cache row, never anna's correction or custom food
    expect((await b.as("GET", "/api/foods/barcode/0012345678905")).body.food).toMatchObject({ kind: "cache", id: cached.id, name: "Crunchy bar" });
    expect((await b.as("GET", "/api/foods/barcode/4006381333931")).body.food).toBeNull();
    const s1 = (await b.as("GET", "/api/foods/search?q=smoothie")).body;
    const s2 = (await b.as("GET", "/api/foods/search?q=bar")).body;
    const seen = [...s1.groups, ...s2.groups].flatMap((g: any) => g.foods.map((f: any) => `${f.kind}:${f.id}`));
    expect(seen).not.toContain(`user_food:${override.id}`);
    expect(seen).not.toContain(`user_food:${custom.id}`);
    expect((await b.as("GET", "/api/foods/search?q=0012345678905")).body.groups).toMatchObject([{ source: "cache", foods: [{ id: cached.id }] }]);
    // "Did you mean" draws on anna's own food names for anna only
    expect((await a.as("GET", "/api/foods/search?q=smoothy")).body.suggestion).toBe("smoothie");
    expect((await b.as("GET", "/api/foods/search?q=smoothy")).body).not.toHaveProperty("suggestion");
    // ...and anna's are untouched
    expect((await a.as("GET", "/api/my-foods")).body.foods.map((f: any) => f.name).sort()).toEqual(["Anna's bar", "Anna's secret smoothie"]);
  });
  it("a user can't read, edit, delete, move or copy another user's entries, or log another user's custom food", async () => {
    const { a, b } = await twoUsers(t);
    const day = "2026-11-17";
    const food = (await a.as("POST", "/api/my-foods", { name: "Anna's toast", servings: [{ label: "1 slice", grams: 30 }], nutrients: { calories: 80 } })).body.food;
    const logBody = { day, meal: "breakfast", food: { kind: "user_food", id: food.id }, servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 };
    const entry = (await a.as("POST", "/api/log", logBody)).body.entry;
    const water = (await a.as("POST", "/api/log", { day, meal: "supplements", water_ml: 237 })).body.entry;

    // ben can't log anna's food, and sees none of her day, recents or frequents
    expect((await b.as("POST", "/api/log", logBody)).status).toBe(404);
    const bensDay = (await b.as("GET", `/api/day/${day}`)).body;
    expect(bensDay.entries).toEqual([]);
    expect(bensDay.totals.calories).toBe(0);
    expect(bensDay.streak).toBe(0);
    expect((await b.as("GET", "/api/foods/recent")).body.foods).toEqual([]);
    expect((await b.as("GET", "/api/foods/frequent")).body.foods).toEqual([]);
    expect((await b.as("GET", "/api/foods/recent?meal=breakfast")).body.foods).toEqual([]);
    expect((await b.as("GET", "/api/foods/frequent?meal=breakfast")).body.foods).toEqual([]);
    for (const id of [entry.id, water.id]) {
      expect((await b.as("PATCH", `/api/log/${id}`, { servingIndex: 0, unit: "serving", quantity: 3, fraction: 1 })).status).toBe(404);
      expect((await b.as("DELETE", `/api/log/${id}`)).status).toBe(404);
      for (const copy of [false, true]) expect((await b.as("POST", "/api/log/move", { ids: [id], day: "2026-11-18", meal: "dinner", copy })).status).toBe(404);
    }
    expect((await b.as("GET", "/api/day/2026-11-18")).body.entries).toEqual([]);
    // ...and anna's entries are untouched
    expect((await a.as("GET", `/api/day/${day}`)).body.entries).toEqual([entry, water]);
    expect((await a.as("GET", "/api/day/2026-11-18")).body.entries).toEqual([]);
  });

  it("a user's logged days never include another user's entries", async () => {
    const { a, b } = await twoUsers(t);
    const food = (await a.as("POST", "/api/my-foods", { name: "Anna's toast", servings: [{ label: "1 slice", grams: 30 }], nutrients: { calories: 80 } })).body.food;
    await a.as("POST", "/api/log", { day: "2026-11-17", meal: "breakfast", food: { kind: "user_food", id: food.id }, servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 });
    const range = "/api/days/logged?from=2026-11-10&to=2026-11-20";
    expect((await b.as("GET", range)).body).toEqual({ days: [] });
    expect((await a.as("GET", range)).body).toEqual({ days: ["2026-11-17"] });
  });
});
