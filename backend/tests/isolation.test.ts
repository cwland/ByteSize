import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";
import { twoUsers } from "./isolation.js";
import { softPasskey } from "./softPasskey.js";
import { aiSettings, offKnows, offProduct } from "./foodFakes.js";
import { labelPhoto, multipart, photoUpload } from "./photoFakes.js";
import { CULURY, culuryCalls, culuryKnows, culuryRecipe, fakeDns } from "./culuryFakes.js";
import { restaurantWeb, setRestaurantKeys, spoonItem } from "./restaurantFakes.js";
import { strFromU8, unzipSync } from "fflate";
import { plainPhoto } from "./photoFakes.js";
import { storePhoto } from "../src/lib/photos.js";
import { fakeIdp } from "./fakeIdp.js";
import { countUsage, usageSettled } from "../src/lib/usage.js";

// Every route that reads or changes a person's data gets a case here (M2 adds foods, logs, targets...)
let t: TestApp;
const idp = fakeIdp(); // a pretend OAuth provider, for Link my account
beforeAll(async () => (t = await setupTestApp({ oauthFetch: idp.fetchImpl })));
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
    expect((await a.as("PUT", "/api/settings/me", { mealWindows: windows, waterButtonsMl: [300], weekStart: 2, dateFormat: "iso" })).status).toBe(200);

    expect((await b.as("GET", "/api/body")).body).toEqual({ body: null });
    expect((await b.as("GET", "/api/plans")).status).toBe(409);
    expect((await b.as("GET", "/api/targets")).body).toEqual({ targets: null });
    expect((await b.as("GET", "/api/settings/me")).body).toMatchObject({ waterButtonsMl: [237, 473], weekStart: 0, dateFormat: "weekday-long-month-short" }); // anna's date format is hers
    // ben's own changes don't touch anna's
    expect((await b.as("PUT", "/api/targets", { calories: { min: 1000, max: 1100 }, protein_g: { min: 1, max: 2 }, fiber_g: { min: 1, max: 2 }, water_ml: { min: 1, max: 2 } })).status).toBe(200);
    expect((await a.as("GET", "/api/targets")).body.targets.plan).toBe("steady");
    expect((await a.as("GET", "/api/body")).body).toEqual({ body: { ...body, needsReview: false } });
    expect((await a.as("GET", "/api/settings/me")).body).toEqual({ mealWindows: windows, waterButtonsMl: [300], weekStart: 2, dateFormat: "iso", glp1On: false });
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

  it("a user can't read, edit, recalculate, delete, log or build on another user's recipes and quick meals", async () => {
    const { a, b } = await twoUsers(t);
    const day = "2026-11-17";
    const portion = { servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 };
    const toast = (await a.as("POST", "/api/my-foods", { name: "Anna's toast", servings: [{ label: "1 slice", grams: 30 }], nutrients: { calories: 80 } })).body.food;
    const recipe = (await a.as("POST", "/api/my-foods/recipes", { name: "Anna's stew", items: [{ food: { kind: "user_food", id: toast.id }, ...portion }], servings: 2 })).body.food;
    const meal = (await a.as("POST", "/api/my-foods/meals", { name: "Anna's lunch", items: [{ food: { kind: "user_food", id: toast.id }, ...portion }] })).body.food;
    expect([recipe.foodKind, meal.foodKind]).toEqual(["recipe", "quick_meal"]);
    const logged = (await a.as("POST", "/api/log/meal", { day, meal: "lunch", foodId: meal.id })).body.entries;
    expect(logged).toHaveLength(1);

    for (const id of [toast.id, recipe.id, meal.id]) {
      expect((await b.as("GET", `/api/my-foods/${id}`)).status).toBe(404);
      expect((await b.as("POST", `/api/my-foods/${id}/recalculate`)).status).toBe(404);
      expect((await b.as("DELETE", `/api/my-foods/${id}`)).status).toBe(404);
      // anna's foods can't be ben's ingredients or meal items
      const items = [{ food: { kind: "user_food", id }, ...portion }];
      expect((await b.as("POST", "/api/my-foods/recipes", { name: "Ben's", items, servings: 1 })).status).toBe(404);
      expect((await b.as("POST", "/api/my-foods/meals", { name: "Ben's", items })).status).toBe(404);
    }
    expect((await b.as("PUT", `/api/my-foods/recipes/${recipe.id}`, { name: "Mine", items: [{ food: { kind: "user_food", id: toast.id }, ...portion }], servings: 1 })).status).toBe(404);
    expect((await b.as("PUT", `/api/my-foods/meals/${meal.id}`, { name: "Mine", items: [{ food: { kind: "user_food", id: toast.id }, ...portion }] })).status).toBe(404);
    expect((await b.as("POST", "/api/log/meal", { day, meal: "lunch", foodId: meal.id })).status).toBe(404);
    // ben's own meal can't log anna's food as an adjusted item
    const bens = (await b.as("POST", "/api/my-foods", { name: "Ben's egg", servings: [{ label: "1 egg", grams: 50 }], nutrients: { calories: 70 } })).body.food;
    const bensMeal = (await b.as("POST", "/api/my-foods/meals", { name: "Ben's meal", items: [{ food: { kind: "user_food", id: bens.id }, ...portion }] })).body.food;
    expect((await b.as("POST", "/api/log/meal", { day, meal: "lunch", foodId: bensMeal.id, items: [{ food: { kind: "user_food", id: toast.id }, ...portion }] })).status).toBe(404);
    // ...nor save anna's entries as a meal
    expect((await b.as("POST", "/api/my-foods/meals/from-entries", { name: "Stolen", ids: logged.map((e: any) => e.id) })).status).toBe(404);
    expect((await b.as("GET", "/api/my-foods?kind=recipes")).body.foods).toEqual([]);
    expect((await b.as("GET", "/api/my-foods?kind=meals")).body.foods.map((f: any) => f.id)).toEqual([bensMeal.id]);
    expect((await b.as("GET", "/api/my-foods?sort=recent")).body.foods.map((f: any) => f.id).sort()).toEqual([bens.id, bensMeal.id].sort());
    expect((await b.as("GET", "/api/foods/search?q=anna")).body.groups.flatMap((g: any) => g.foods.filter((f: any) => f.kind === "user_food"))).toEqual([]);
    expect((await b.as("GET", "/api/foods/recent")).body.foods).toEqual([]);
    expect((await b.as("GET", "/api/foods/frequent")).body.foods).toEqual([]);

    // ...and anna's are untouched
    expect((await a.as("GET", `/api/my-foods/${recipe.id}`)).body.food).toMatchObject({ name: "Anna's stew", items: [{ food: { id: toast.id } }] });
    expect((await a.as("GET", "/api/foods/recent")).body.foods.map((f: any) => f.id)).toEqual([meal.id]);
    expect((await a.as("GET", `/api/day/${day}`)).body.entries).toEqual(logged);
  });

  it("AI-estimated foods are logged into the logger's own day only", async () => {
    const { a, b } = await twoUsers(t);
    const item = { name: "Egg", servings: [{ label: "1 egg", grams: 50 }], nutrients: { calories: 78 }, servingIndex: 0, quantity: 1 };
    expect((await a.as("POST", "/api/log/estimates", { day: "2026-11-17", meal: "breakfast", items: [item] })).status).toBe(200);
    expect((await b.as("GET", "/api/day/2026-11-17")).body.entries).toEqual([]);
    expect((await a.as("GET", "/api/day/2026-11-17")).body.entries).toHaveLength(1);
  });

  it("a user's logged days never include another user's entries", async () => {
    const { a, b } = await twoUsers(t);
    const food = (await a.as("POST", "/api/my-foods", { name: "Anna's toast", servings: [{ label: "1 slice", grams: 30 }], nutrients: { calories: 80 } })).body.food;
    await a.as("POST", "/api/log", { day: "2026-11-17", meal: "breakfast", food: { kind: "user_food", id: food.id }, servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 });
    const range = "/api/days/logged?from=2026-11-10&to=2026-11-20";
    expect((await b.as("GET", range)).body).toEqual({ days: [] });
    expect((await a.as("GET", range)).body).toEqual({ days: ["2026-11-17"] });
  });
  it("a user can't see or use another user's photos, and their foods' photos aren't shown to others", async () => {
    const { a, b } = await twoUsers(t);
    const { payload, headers } = photoUpload([await labelPhoto()]);
    const up = await t.app.inject({ method: "POST", url: "/api/photos/analyze", payload, headers: { ...headers, authorization: `Bearer ${a.token}` } });
    const id = up.json().photoIds[0];
    expect((await a.as("GET", `/api/photos/${id}`)).status).toBe(200);
    expect((await b.as("GET", `/api/photos/${id}`)).status).toBe(404);
    const food = { name: "Anna's crackers", servings: [{ label: "2 crackers", grams: 30 }], nutrients: { calories: 140 } };
    expect((await b.as("POST", "/api/my-foods", { ...food, photoId: id })).body).toEqual({ error: "That photo isn't available" });
    const bens = (await b.as("POST", "/api/my-foods", food)).body.food;
    expect((await b.as("PATCH", `/api/my-foods/${bens.id}`, { photoId: id })).status).toBe(400);
    const annas = (await a.as("POST", "/api/my-foods", { ...food, photoId: id })).body.food;
    expect(annas.imageUrl).toMatch(new RegExp(`^/api/photos/${id}\\?sig=`));
    // ben can't open it from the plain path or with a made-up signature
    expect((await b.as("GET", `/api/photos/${id}?sig=AAAAAAAAAAAAAAAAAAAAAA`)).status).toBe(404);
    // Linked or not, still only anna's
    expect((await b.as("GET", `/api/photos/${id}`)).status).toBe(404);
    expect((await b.as("GET", "/api/my-foods")).body.foods.map((f: any) => f.imageUrl)).toEqual([null]);
  });
  it("a user can't read, replace or delete another user's weigh-ins, and theirs never move the other's body weight", async () => {
    const { a, b } = await twoUsers(t);
    t.clock.date = new Date("2026-11-18T05:30:00Z"); // Nov 17 in Boise
    const body = { sex: "female", birthDate: "1980-03-04", heightCm: 165, weightKg: 90, goalWeightKg: 70, activity: "some", glp1: false };
    await a.as("PUT", "/api/body", body);
    await a.as("POST", "/api/plans/select", { plan: "steady" });
    expect((await a.as("PUT", "/api/weigh-ins/2026-11-10", { weightKg: 89, note: "anna's" })).status).toBe(200);
    expect((await a.as("PUT", "/api/weigh-ins/2026-11-17", { weightKg: 85 })).status).toBe(200);

    expect((await b.as("GET", "/api/weight")).body).toMatchObject({ weighIns: [], start: null, latest: null, trendKg: null, lostKg: null, replanHint: false });
    expect((await b.as("DELETE", "/api/weigh-ins/2026-11-17")).status).toBe(404);
    await b.as("PUT", "/api/body", { ...body, weightKg: 120 }); // his own weigh-in today (120)
    // ben's weigh-in on the same day is his own and only moves his body weight
    expect((await b.as("PUT", "/api/weigh-ins/2026-11-17", { weightKg: 118 })).status).toBe(200);
    expect((await b.as("GET", "/api/body")).body.body.weightKg).toBe(118);
    expect((await b.as("GET", "/api/weight")).body.weighIns).toEqual([{ day: "2026-11-17", weightKg: 118, trendKg: 118, note: null }]);

    const annas = (await a.as("GET", "/api/weight")).body;
    expect(annas.weighIns.map((w: any) => [w.day, w.weightKg, w.note])).toEqual([["2026-11-10", 89, "anna's"], ["2026-11-17", 85, null]]);
    expect(annas.replanHint).toBe(true); // 90 → 85, her own plan weight
    expect((await a.as("GET", "/api/body")).body.body.weightKg).toBe(85);
  });

  it("a weight import goes into the importer's own history only, and only counts their own days", async () => {
    const { a, b } = await twoUsers(t);
    t.clock.date = new Date("2026-11-18T05:30:00Z"); // Nov 17 in Boise
    expect((await b.as("PUT", "/api/weigh-ins/2026-11-15", { weightKg: 120, note: "ben's" })).status).toBe(200);
    const upload = (token: string, url: string, fields: Record<string, string> = {}) => {
      const { payload, headers } = multipart([...Object.entries(fields).map(([name, value]) => ({ name, value })), { name: "file", filename: "w.csv", type: "text/csv", data: Buffer.from("Date,Weight (kg)\n2026-11-15,80\n2026-11-16,79") }]);
      return t.app.inject({ method: "POST", url, payload, headers: { ...headers, authorization: `Bearer ${token}` } }).then((r) => r.json());
    };
    expect(await upload(a.token, "/api/weight/import/preview")).toMatchObject({ count: 2, existingDays: 0 });
    expect(await upload(a.token, "/api/weight/import", { existing: "replace" })).toMatchObject({ imported: 2, replaced: 0 });
    expect((await b.as("GET", "/api/weight")).body.weighIns).toEqual([{ day: "2026-11-15", weightKg: 120, trendKg: 120, note: "ben's" }]);
    expect((await a.as("GET", "/api/weight")).body.weighIns.map((w: any) => [w.day, w.weightKg])).toEqual([["2026-11-15", 80], ["2026-11-16", 79]]);
    expect(await upload(b.token, "/api/weight/import/preview")).toMatchObject({ existingDays: 1 });
  });

  it("a user can't see, change or count another user's GLP-1 settings, shots or side effects", async () => {
    t.clock.date = new Date("2026-11-17T19:00:00Z");
    const { a, b } = await twoUsers(t);
    const effects = { day: "2026-11-16", effects: { nausea: 2 }, note: "Anna's note" };
    expect((await a.as("PUT", "/api/glp1/settings", { medication: "Mounjaro", doseMg: 2.5, injectionWeekday: 5 })).status).toBe(200);
    for (const day of ["2026-11-03", "2026-11-10"]) expect((await a.as("PUT", `/api/glp1/shots/${day}`, { site: "thigh_left", note: "Anna's shot" })).status).toBe(200);
    expect((await a.as("PUT", "/api/side-effects/2026-11-16", { effects: effects.effects, note: effects.note })).status).toBe(200);
    const toast = (await a.as("POST", "/api/my-foods", { name: "Anna's toast", servings: [{ label: "1 slice", grams: 30 }], nutrients: { calories: 80, protein_g: 3 } })).body.food;
    expect((await a.as("POST", "/api/log", { day: "2026-11-10", meal: "lunch", food: { kind: "user_food", id: toast.id }, servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 })).status).toBe(200);
    const annas = (await a.as("GET", "/api/glp1")).body;

    // ben sees none of it
    expect((await b.as("GET", "/api/glp1")).body).toEqual({ settings: null, lastShot: null, nextDue: null, status: "none", overdueDays: 0, suggestedSite: "abdomen_left", shots: [], doseHistory: [], medications: expect.any(Array) }); // the medication list is the same for everyone
    expect((await b.as("GET", "/api/side-effects?from=2026-11-01&to=2026-11-17")).body).toEqual({ days: [] });
    const bensAfter = (await b.as("GET", "/api/glp1/after-injection")).body;
    expect(bensAfter.enough).toBe(false);
    expect(bensAfter.days.every((d: any) => d.daysCounted === 0)).toBe(true);
    // ...can't delete hers, and his own changes on the same days don't touch hers
    expect((await b.as("DELETE", "/api/glp1/shots/2026-11-10")).status).toBe(404);
    expect((await b.as("PUT", "/api/glp1/settings", { medication: "Ozempic", doseMg: 1, injectionWeekday: 1 })).status).toBe(200);
    expect((await b.as("PUT", "/api/glp1/shots/2026-11-10", { site: "arm_right", doseMg: 2 })).status).toBe(200);
    expect((await b.as("PUT", "/api/side-effects/2026-11-16", { effects: { headache: 1 } })).status).toBe(200);
    expect((await b.as("PUT", "/api/side-effects/2026-11-16", { effects: {} })).body).toEqual({ sideEffect: null });
    expect((await b.as("GET", "/api/glp1")).body.shots).toMatchObject([{ day: "2026-11-10", site: "arm_right", doseMg: 2, medication: "Ozempic" }]);
    // ...and anna's are untouched
    expect((await a.as("GET", "/api/glp1")).body).toEqual(annas);
    expect(annas.settings).toEqual({ medication: "Mounjaro", doseMg: 2.5, doseUnit: "mg", injectionWeekday: 5 });
    expect((await a.as("GET", "/api/side-effects?from=2026-11-01&to=2026-11-17")).body).toEqual({ days: [effects] });
    const annasAfter = (await a.as("GET", "/api/glp1/after-injection")).body;
    expect(annasAfter.enough).toBe(true);
    expect(annasAfter.days[0]).toEqual({ offset: 0, avgCalories: 80, avgProtein: 3, daysCounted: 1 });
  });


  it("a user's trends, badges and vacations never include another user's weigh-ins, shots, food or vacations", async () => {
    const { a, b } = await twoUsers(t);
    const { glp1Shots, weighIns } = await import("../src/db/schema.js");
    t.clock.date = new Date("2026-11-17T19:00:00Z");
    await t.db.insert(weighIns).values([
      { userId: a.id, day: "2026-11-01", weightKg: 100 },
      { userId: a.id, day: "2026-11-10", weightKg: 90 },
    ]);
    for (const day of ["2026-10-20", "2026-10-27", "2026-11-03", "2026-11-10"]) await t.db.insert(glp1Shots).values({ userId: a.id, day, medication: "Zepbound", doseMg: 2.5, site: "arm_left" });
    const food = (await a.as("POST", "/api/my-foods", { name: "Anna's toast", servings: [{ label: "1 slice", grams: 30 }], nutrients: { calories: 80 } })).body.food;
    for (const day of ["2026-11-14", "2026-11-17"]) await a.as("POST", "/api/log", { day, meal: "breakfast", food: { kind: "user_food", id: food.id }, servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 });
    const vacation = (await a.as("POST", "/api/vacations", { from: "2026-11-15", to: "2026-11-16" })).body.vacation;
    const annas = (await a.as("GET", "/api/badges")).body;
    expect(annas.new).toEqual(["first_weigh_in", "lost_5", "lost_10", "shots_on_time_4"]);
    expect((await a.as("GET", "/api/day/today")).body.streak).toBe(2);

    // ben sees nothing of anna's
    const bens = (await b.as("GET", "/api/badges")).body;
    expect(bens.new).toEqual([]);
    expect(bens.badges.every((x: any) => x.earnedOn === null)).toBe(true);
    expect((await b.as("GET", "/api/vacations")).body).toEqual({ vacations: [] });
    const [week] = (await b.as("GET", "/api/trends/weekly?weeks=1")).body.weeks;
    expect(week).toMatchObject({ daysLogged: 0, weightChangeKg: null, avg: { calories: null } });
    // ...can't remove anna's vacation or mark her badges seen, and her vacation doesn't help his streak
    expect((await b.as("DELETE", `/api/vacations/${vacation.id}`)).status).toBe(404);
    expect((await b.as("POST", "/api/badges/seen", { ids: ["first_weigh_in"] })).body).toEqual({ seen: [] });
    const bensFood = (await b.as("POST", "/api/my-foods", { name: "Ben's egg", servings: [{ label: "1 egg", grams: 50 }], nutrients: { calories: 70 } })).body.food;
    for (const day of ["2026-11-14", "2026-11-17"]) await b.as("POST", "/api/log", { day, meal: "breakfast", food: { kind: "user_food", id: bensFood.id }, servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 });
    expect((await b.as("GET", "/api/day/today")).body.streak).toBe(1);

    // ...and anna's are untouched
    expect((await a.as("GET", "/api/vacations")).body.vacations).toEqual([vacation]);
    expect((await a.as("GET", "/api/badges")).body).toEqual(annas);
    expect((await a.as("GET", "/api/trends/weekly?weeks=1")).body.weeks[0]).toMatchObject({ daysLogged: 1, avg: { calories: 80 } });
  });

  it("a person's Culury switch only turns their own Culury on or off", async () => {
    const { a, b } = await twoUsers(t);
    const BENS = "http://bens-culury.lan:4000";
    const plan = [{ date: "2026-11-17", slot: "dinner", recipeId: 7, title: "Chili" }];
    culuryKnows(t, { key: "annas-key", recipes: [culuryRecipe(7, "Anna's chili")], plan });
    culuryKnows(t, { base: BENS, key: "bens-key", recipes: [culuryRecipe(7, "Ben's chili")], plan });
    await a.as("PUT", "/api/settings/culury", { url: CULURY, apiKey: "annas-key" });
    await b.as("PUT", "/api/settings/culury", { url: BENS, apiKey: "bens-key" });
    t.foodWeb.calls.length = 0;

    expect((await b.as("PUT", "/api/settings/culury/enabled", { enabled: false })).body).toEqual({ url: BENS, hasKey: true, enabled: false });
    expect((await a.as("GET", "/api/settings/culury")).body).toEqual({ url: CULURY, hasKey: true, enabled: true });
    expect((await a.as("GET", "/api/culury/plan?day=2026-11-17")).body).toMatchObject({ linked: true, days: [{ day: "2026-11-17" }] });
    expect((await a.as("GET", "/api/foods/search?q=chili")).body.groups.map((g: any) => g.source)).toContain("culury");
    expect((await b.as("GET", "/api/culury/plan?day=2026-11-17")).body).toEqual({ linked: false, days: [], errors: [] });
    expect((await b.as("GET", "/api/foods/search?q=chili")).body.groups.map((g: any) => g.source)).not.toContain("culury");
    expect(culuryCalls(t, BENS)).toHaveLength(0);
    expect(culuryCalls(t).length).toBeGreaterThan(0);

    // anna turning hers off leaves ben's switch where he put it
    await a.as("PUT", "/api/settings/culury/enabled", { enabled: false });
    await b.as("PUT", "/api/settings/culury/enabled", { enabled: true });
    expect((await a.as("GET", "/api/settings/culury")).body.enabled).toBe(false);
    expect((await b.as("GET", "/api/culury/plan?day=2026-11-17")).body).toMatchObject({ linked: true });
  });

  it("a person's Culury link (address and key) is only ever used for their own requests", async () => {
    const { a, b } = await twoUsers(t);
    const BENS = "http://bens-culury.lan:4000";
    culuryKnows(t, { key: "annas-key", recipes: [culuryRecipe(7, "Anna's chili")], plan: [{ date: "2026-11-17", slot: "dinner", recipeId: 7, title: "Anna's chili" }] });
    culuryKnows(t, { base: BENS, key: "bens-key", recipes: [culuryRecipe(7, "Ben's curry")] });
    expect((await a.as("PUT", "/api/settings/culury", { url: CULURY, apiKey: "annas-key" })).status).toBe(200);
    expect((await a.as("POST", "/api/log", { day: "2026-11-17", meal: "dinner", food: { kind: "culury", id: 7 }, unit: "serving", quantity: 1 })).status).toBe(200);
    t.foodWeb.calls.length = 0;

    // ben, not linked: nothing of anna's link, and her Culury is never called for him
    expect((await b.as("GET", "/api/settings/culury")).body).toEqual({ url: null, hasKey: false, enabled: false });
    expect((await b.as("GET", "/api/culury/plan?day=2026-11-17")).body).toEqual({ linked: false, days: [], errors: [] });
    expect((await b.as("GET", "/api/culury/recipes/7")).status).toBe(400);
    expect((await b.as("POST", "/api/settings/culury/test")).status).toBe(400);
    expect((await b.as("GET", "/api/foods/search?q=chili")).body.groups.some((g: any) => g.source === "culury")).toBe(false);
    expect((await b.as("POST", "/api/log", { day: "2026-11-17", meal: "dinner", food: { kind: "culury", id: 7 }, unit: "serving", quantity: 1 })).status).toBe(400);
    expect((await b.as("GET", "/api/foods/recent")).body.foods).toEqual([]);
    // testing anna's address without a key of his own doesn't borrow hers
    expect((await b.as("POST", "/api/settings/culury/test", { url: CULURY })).status).toBe(400);
    expect(culuryCalls(t)).toHaveLength(0);

    // ben links his own: his requests go to his Culury with his key
    expect((await b.as("PUT", "/api/settings/culury", { url: BENS, apiKey: "bens-key" })).status).toBe(200);
    expect((await b.as("GET", "/api/culury/recipes/7")).body.food.name).toBe("Ben's curry");
    expect((await a.as("GET", "/api/culury/recipes/7")).body.food.name).toBe("Anna's chili");
    expect(culuryCalls(t, BENS).map((c) => c.headers["x-api-key"])).toEqual(["bens-key"]);
    expect(culuryCalls(t).map((c) => c.headers["x-api-key"])).toEqual(["annas-key"]);
    // removing his link leaves hers
    await b.as("DELETE", "/api/settings/culury");
    expect((await a.as("GET", "/api/settings/culury")).body).toEqual({ url: CULURY, hasKey: true, enabled: true });

    // with his Culury unreachable, re-logging never falls back to anna's snapshot of "her" recipe 7
    fakeDns["bens-down.lan"] = [];
    expect((await b.as("PUT", "/api/settings/culury", { url: "http://bens-down.lan", apiKey: "bens-key" })).status).toBe(200);
    expect((await b.as("POST", "/api/log", { day: "2026-11-17", meal: "dinner", food: { kind: "culury", id: 7 }, unit: "serving", quantity: 1 })).status).toBe(502);
    await b.as("DELETE", "/api/settings/culury");
    expect((await b.as("POST", "/api/log", { day: "2026-11-17", meal: "dinner", food: { kind: "culury", id: 7 }, unit: "serving", quantity: 1 })).status).toBe(400);
    expect((await b.as("GET", "/api/day/2026-11-17")).body.entries).toEqual([]);
  });

  it("a person can only fetch their own saved Culury key", async () => {
    const { a, b } = await twoUsers(t);
    expect((await a.as("PUT", "/api/settings/culury", { url: CULURY, apiKey: "annas-key" })).status).toBe(200);
    const bens = await b.as("GET", "/api/settings/culury/key");
    expect(bens.status).toBe(404); // ben has none; anna's is never his
    expect(JSON.stringify(bens.body)).not.toContain("annas-key");
    expect((await b.as("GET", "/api/settings/culury/key?userId=" + a.id)).status).toBe(404);
    expect((await a.as("GET", "/api/settings/culury/key")).body).toEqual({ key: "annas-key" });
    expect((await b.as("PUT", "/api/settings/culury", { url: CULURY, apiKey: "bens-key" })).status).toBe(200);
    expect((await b.as("GET", "/api/settings/culury/key")).body).toEqual({ key: "bens-key" });
    expect((await a.as("GET", "/api/settings/culury/key")).body).toEqual({ key: "annas-key" });
    // and neither member can fetch a server-wide key
    expect((await b.as("GET", "/api/admin/food-sources/usda/key")).status).toBe(403);
  });

  it("a user's restaurant favourites and recent chains are their own", async () => {
    await setRestaurantKeys(t, { spoonacular: "spoon-key" });
    restaurantWeb(t, { spoonItem: (id) => ({ status: 200, json: spoonItem(Number(id), "Chicken Bowl", "Chipotle", 655) }) });
    const { a, b } = await twoUsers(t);
    const food = (await a.as("POST", "/api/restaurants/item", { source: "spoonacular", sourceId: "1" })).body.food;
    expect((await a.as("POST", "/api/restaurants/favourites", { cacheId: food.id })).status).toBe(200);
    expect((await a.as("POST", "/api/log", { day: "2026-11-17", meal: "lunch", food: { kind: "cache", id: food.id }, unit: "serving", quantity: 1 })).status).toBe(200);
    expect((await b.as("GET", "/api/restaurants/favourites")).body).toEqual({ chains: [] });
    expect((await b.as("GET", "/api/restaurants/recent-chains")).body).toEqual({ chains: [] });
    expect((await b.as("DELETE", "/api/restaurants/favourites", { cacheId: food.id })).status).toBe(404);
    expect((await a.as("GET", "/api/restaurants/favourites")).body.chains.map((c: any) => c.chain)).toEqual(["Chipotle"]);
    expect((await a.as("GET", "/api/restaurants/recent-chains")).body).toEqual({ chains: ["Chipotle"] });
  });

  it("a user can't undo another user's combine", async () => {
    const { a, b } = await twoUsers(t);
    const f = (await a.as("POST", "/api/my-foods", { name: "Egg", servings: [{ label: "1 large", grams: 50 }], nutrients: { calories: 70 } })).body.food;
    const add = () => a.as("POST", "/api/log", { day: "2026-11-17", meal: "breakfast", food: { kind: "user_food", id: f.id }, servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 });
    await add();
    const { combined } = (await add()).body;
    expect((await b.as("POST", `/api/log/combines/${combined.id}/undo`)).status).toBe(404);
    expect((await a.as("GET", "/api/day/2026-11-17")).body.entries.map((e: any) => e.quantity)).toEqual([2]);
    expect((await b.as("GET", "/api/day/2026-11-17")).body.entries).toEqual([]);
  });

  it("insights (§43): a person's recaps, protein help, answers, limits and weekly switch are their own, and the AI sees only their data", async () => {
    const { a, b } = await twoUsers(t);
    await t.api("PUT", "/api/settings/ai", aiSettings);
    t.clock.date = new Date("2026-11-18T19:00:00Z");
    const today = "2026-11-18"; // in Boise
    const { logEntries } = await import("../src/db/schema.js");
    await t.db.insert(logEntries).values({ userId: a.id, day: today, meal: "lunch", name: "Anna's salmon", icon: "🐟", source: "cache", unit: "g", quantity: 100, perServing: {}, servings: [], nutrients: { calories: 200, protein_g: 22 } });
    t.ai.respond = (_url: string, body: any) => {
      const text: string = body.messages[1].content;
      const json = text.includes("Write a recap") ? { summary: "s", wentWell: ["w"], slipped: [], tryNext: "t" } : { answer: "a" };
      return { status: 200, json: { choices: [{ message: { content: JSON.stringify(json) } }] } };
    };
    expect((await a.as("POST", "/api/insights/refresh", { kind: "recap" })).status).toBe(200);
    expect((await a.as("POST", "/api/insights/ask", { question: "How's my protein?" })).status).toBe(200);
    expect(JSON.stringify(t.ai.calls[0].body)).toContain("Anna's salmon");
    // Ben: nothing of Anna's, and her limits aren't his
    const bens = (await b.as("GET", "/api/insights")).body;
    expect(bens).toMatchObject({ recaps: [], protein: null, answers: [], limits: { questionsLeft: 20, recapRefreshIn: 0 } });
    expect((await b.as("GET", "/api/insights/latest")).body.recap).toBeNull();
    expect((await b.as("POST", "/api/insights/refresh", { kind: "recap" })).status).toBe(200);
    expect((await b.as("POST", "/api/insights/ask", { question: "What did I eat?" })).status).toBe(200);
    for (const call of t.ai.calls.slice(2)) expect(JSON.stringify(call.body)).not.toContain("Anna's salmon");
    expect((await a.as("GET", "/api/insights")).body.answers.map((x: any) => x.question)).toEqual(["How's my protein?"]);
    // The weekly switch
    expect((await b.as("PUT", "/api/insights/settings", { weeklyOn: false })).status).toBe(200);
    expect((await a.as("GET", "/api/insights")).body.weeklyOn).toBe(true);
    expect((await b.as("GET", "/api/insights")).body.weeklyOn).toBe(false);
  });

  it("a person's Dashboard layout is their own", async () => {
    const { a, b } = await twoUsers(t);
    const annas = { version: 1, columns: [["streak"], ["food"], []] };
    expect((await a.as("PUT", "/api/dashboard/layout", annas)).status).toBe(200);
    expect((await b.as("GET", "/api/dashboard/layout")).body).toEqual({ layout: null });
    const bens = { version: 1, columns: [["budget"]] };
    expect((await b.as("PUT", "/api/dashboard/layout", bens)).status).toBe(200);
    expect((await a.as("GET", "/api/dashboard/layout")).body).toEqual({ layout: annas });
    expect((await b.as("GET", "/api/dashboard/layout")).body).toEqual({ layout: bens });
  });

  it("a person's Goals layout is their own, and apart from their Dashboard's", async () => {
    const { a, b } = await twoUsers(t);
    const annas = { version: 1, columns: [["badges"], ["your-plan"], []] };
    expect((await a.as("PUT", "/api/layouts/goals", annas)).status).toBe(200);
    expect((await b.as("GET", "/api/layouts/goals")).body).toEqual({ layout: null });
    expect((await a.as("GET", "/api/layouts/dashboard")).body).toEqual({ layout: null });
    const bens = { version: 1, columns: [["goal-date"]] };
    expect((await b.as("PUT", "/api/layouts/goals", bens)).status).toBe(200);
    expect((await a.as("GET", "/api/layouts/goals")).body).toEqual({ layout: annas });
    expect((await b.as("GET", "/api/layouts/goals")).body).toEqual({ layout: bens });
  });

  it("a user can't see, change or delete another user's steps, workouts or workout-calorie setting, and their bank is their own", async () => {
    t.clock.date = new Date("2026-11-18T19:00:00Z");
    const { a, b } = await twoUsers(t);
    const day = "2026-11-18"; // today, so the bank (set today) counts the run
    expect((await a.as("PUT", `/api/steps/${day}`, { steps: 9100 })).status).toBe(200);
    expect((await a.as("PUT", `/api/steps/${day}`, { steps: 9500, source: "health" })).status).toBe(200);
    const run = (await a.as("POST", "/api/workouts", { day, type: "run", minutes: 30, calories: 400, note: "Anna's run", source: "health", externalId: "HK-shared" })).body.workout;
    expect((await a.as("PUT", "/api/workout-calories", { mode: "bank", countPct: 100 })).status).toBe(200);
    const annas = await a.as("GET", `/api/activity/${day}`);

    // ben sees none of it
    expect((await b.as("GET", `/api/activity/${day}`)).body).toMatchObject({ steps: null, workouts: [], earned: 0 });
    expect((await b.as("GET", `/api/activity?from=${day}&to=${day}`)).body).toEqual({ days: [{ day, steps: null, stepsSource: null, workouts: 0, activeMinutes: 0, earned: 0 }], workouts: [] });
    expect((await b.as("GET", "/api/workout-calories")).body.settings.mode).toBe("show");
    expect((await b.as("GET", "/api/day/2026-11-18")).body.workoutCalories).toMatchObject({ mode: "show", earned: 0, bank: null });
    // ...can't change or delete hers
    expect((await b.as("PATCH", `/api/workouts/${run.id}`, { minutes: 1 })).status).toBe(404);
    expect((await b.as("DELETE", `/api/workouts/${run.id}`)).status).toBe(404);
    expect((await b.as("DELETE", `/api/steps/${day}`)).status).toBe(404);
    // ...and his own sends with the same day and the same Health id are his own rows
    expect((await b.as("PUT", `/api/steps/${day}`, { steps: 12, source: "health" })).status).toBe(200);
    const bens = (await b.as("POST", "/api/workouts", { day, type: "walk", minutes: 5, source: "health", externalId: "HK-shared" })).body.workout;
    expect(bens.id).not.toBe(run.id);
    expect((await a.as("GET", `/api/activity/${day}`)).body).toEqual(annas.body);
    expect(annas.body).toMatchObject({ steps: 9500, typedSteps: 9100, workouts: [{ id: run.id, minutes: 30, note: "Anna's run" }] });
    expect((await a.as("GET", "/api/day/2026-11-18")).body.workoutCalories.bank).toMatchObject({ balance: 400 });
  });

  it("a user can't see, change, end or delete another user's goals; progress and layouts use only their own data and goals", async () => {
    t.clock.date = new Date("2026-11-18T19:00:00Z");
    const { a, b } = await twoUsers(t);
    const day = "2026-11-18";
    // Anna has steps and a goal; Ben has a goal of the same type
    expect((await a.as("PUT", `/api/steps/${day}`, { steps: 9000 })).status).toBe(200);
    const annas = (await a.as("POST", "/api/goals", { type: "steps", target: 50000, period: "week", name: "Anna walks" })).body.goal;
    expect(annas.progress.current.value).toBe(9000);
    const bens = (await b.as("POST", "/api/goals", { type: "steps", target: 30000, period: "week" })).body;
    expect(bens.replaced).toBeNull(); // Anna's goal isn't his to replace
    expect(bens.goal.progress.current.value).toBe(0);
    expect((await b.as("GET", "/api/goals")).body).toMatchObject({ active: [{ id: bens.goal.id }], past: [] });
    expect((await b.as("GET", `/api/goals/${annas.id}`)).status).toBe(404);
    expect((await b.as("PATCH", `/api/goals/${annas.id}`, { target: 1 })).status).toBe(404);
    expect((await b.as("POST", `/api/goals/${annas.id}/end`)).status).toBe(404);
    expect((await b.as("DELETE", `/api/goals/${annas.id}`)).status).toBe(404);
    // Her goal's widget is no widget of his
    const put = await b.as("PUT", "/api/layouts/dashboard", { version: 1, columns: [[`goal:${annas.id}`, `goal:${bens.goal.id}`], [], []] });
    expect(put.body.layout.columns).toEqual([[`goal:${bens.goal.id}`], [], []]);
    // ...and hers is unchanged
    expect((await a.as("GET", "/api/goals")).body).toMatchObject({ active: [{ id: annas.id, name: "Anna walks", target: 50000, progress: { current: { value: 9000 } } }], past: [] });
    expect((await a.as("GET", `/api/activity/${day}`)).body.stepGoal).toBeNull();
  });

  it("a person's data download holds none of anyone else's rows, photos or Culury address", async () => {
    const { a, b } = await twoUsers(t);
    const food = (who: typeof a, name: string) => who.as("POST", "/api/my-foods", { name, servings: [{ label: "1", grams: 10 }], nutrients: { calories: 100 } }).then((r) => r.body.food);
    const annas = await food(a, "Anna's Oatmeal");
    const bens = await food(b, "Ben's Brisket");
    for (const [who, f] of [[a, annas], [b, bens]] as const) {
      expect((await who.as("POST", "/api/log", { day: "2026-11-17", meal: "lunch", food: { kind: "user_food", id: f.id }, servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 })).status).toBe(200);
    }
    expect((await a.as("PUT", "/api/weigh-ins/2026-11-17", { weightKg: 71.1, note: "anna note" })).status).toBe(200);
    expect((await b.as("PUT", "/api/weigh-ins/2026-11-17", { weightKg: 98.7, note: "ben note" })).status).toBe(200);
    expect((await b.as("PUT", "/api/settings/culury", { url: "http://bens-culury.lan:4000", apiKey: "bens-key" })).status).toBe(200);
    const photo = (who: typeof a) => storePhoto(t.app, who.id, Buffer.from("jpeg")).then((p) => p.id);
    const annasPhoto = await photo(a);
    const bensPhoto = await photo(b);

    const res = await t.app.inject({ method: "GET", url: "/api/export", headers: { authorization: `Bearer ${a.token}` } });
    expect(res.statusCode).toBe(200);
    const files = unzipSync(new Uint8Array(res.rawPayload));
    const everything = Object.entries(files).map(([name, bytes]) => name + "\n" + strFromU8(bytes)).join("\n");
    expect(everything).toContain("Anna's Oatmeal");
    expect(everything).toContain(annasPhoto);
    for (const theirs of ["Ben's Brisket", "ben note", "98.7", bensPhoto, "bens-culury", "bens-key", "ben@", "ben\""]) expect(everything).not.toContain(theirs);
    expect(Object.keys(files).filter((n) => n.startsWith("photos/"))).toEqual([`photos/${annasPhoto}.jpg`]);
  });

  it("accounts: a member can't see or change the server's email or OAuth settings; Link my account and unlink touch only your own account; a reset code only resets its own account", async () => {
    const gmail = { enabled: true, host: "smtp.gmail.com", port: 587, security: "starttls", username: "cory@gmail.com", password: "app-password-123", fromName: "ByteSize", fromAddress: "cory@gmail.com", appUrl: "https://bytesize.example.com" };
    await t.api("POST", "/api/settings/email/test", { settings: gmail });
    expect((await t.api("PUT", "/api/settings/email", gmail)).status).toBe(200);
    expect((await t.api("PUT", "/api/settings/oauth", { enabled: true, providerName: "Authentik", issuerUrl: idp.issuer, clientId: "bs-client", clientSecret: "bs-secret", oauthOnly: false })).status).toBe(200);
    const { a, b } = await twoUsers(t);
    for (const [m, u] of [["GET", "/api/settings/email"], ["GET", "/api/settings/email/password"], ["GET", "/api/settings/oauth"], ["GET", "/api/settings/oauth/secret"], ["POST", "/api/settings/oauth/test"]] as const) {
      const r = await a.as(m, u);
      expect(r.status, `${m} ${u}`).toBe(403);
      expect(JSON.stringify(r.body)).not.toMatch(/app-password-123|bs-secret/);
    }
    // anna links her account; ben's stays unlinked, and his unlink leaves hers alone
    const origin = "https://bytesize.example.com";
    const start = await t.app.inject({ method: "POST", url: "/api/auth/oauth/link/start", payload: {}, headers: { origin, authorization: `Bearer ${a.token}` } });
    const back = idp.approve(start.json().url, { sub: "anna-at-idp", email: "anna@corp.example" });
    await t.app.inject({ method: "GET", url: back.pathname + back.search, headers: { cookie: String(start.headers["set-cookie"]).split(";")[0] } });
    expect((await a.as("GET", "/api/auth/oauth")).body.linked).toMatchObject({ email: "anna@corp.example" });
    expect((await b.as("GET", "/api/auth/oauth")).body.linked).toBeNull();
    await b.as("POST", "/api/auth/oauth/unlink");
    expect((await a.as("GET", "/api/auth/oauth")).body.linked).toMatchObject({ email: "anna@corp.example" });
    // ben asks for a code; it can't reset anna's password, even with her email
    await a.as("PATCH", "/api/profile", { email: "anna@example.com" });
    await b.as("PATCH", "/api/profile", { email: "ben@example.com" });
    t.mail.sent.length = 0;
    await t.app.inject({ method: "POST", url: "/api/auth/forgot", payload: { email: "ben@example.com" } });
    await t.app.mail.idle();
    const code = /(\d{6})/.exec(t.mail.sent[0].subject)![1];
    const r = await t.app.inject({ method: "POST", url: "/api/auth/reset", payload: { email: "anna@example.com", code, newPassword: "taken-over-1" } });
    expect(r.statusCode).toBe(400);
    expect((await t.app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "anna", password: "password123" } })).statusCode).toBe(200);
  });

  it("App info: each person's usage counts are their own; only the admin gets totals for everyone; a member's data export holds only their rows", async () => {
    const { a, b } = await twoUsers(t);
    countUsage(t.app, a.id, "barcodes_scanned", 2);
    countUsage(t.app, b.id, "barcodes_scanned", 7);
    await usageSettled();
    const [mine, bens, admin] = [(await a.as("GET", "/api/app-info")).body, (await b.as("GET", "/api/app-info")).body, (await t.api("GET", "/api/app-info")).body];
    expect([mine.you.barcodesScanned, bens.you.barcodesScanned, admin.you.barcodesScanned]).toEqual([2, 7, 0]);
    expect(mine.everyone).toBeUndefined();
    expect(bens.everyone).toBeUndefined();
    expect(admin.everyone).toMatchObject({ people: 3, barcodesScanned: 9 });
    const zip = await t.app.inject({ method: "GET", url: "/api/export", headers: { authorization: `Bearer ${a.token}` } });
    const json = JSON.parse(strFromU8(unzipSync(new Uint8Array(zip.rawPayload))["bytesize-export.json"]));
    expect(json.tables.usage_counts).toEqual([{ userId: a.id, key: "barcodes_scanned", count: 2 }]);
  });
  it("API keys: a person can't list, show, rename, delete or use another's key, and a key reaches only its owner's data", async () => {
    const { a, b } = await twoUsers(t);
    const bens = (await b.as("POST", "/api/keys", { name: "Ben's n8n", access: "log" })).body;
    const annas = (await a.as("POST", "/api/keys", { name: "Anna's HA", access: "log" })).body;
    expect((await a.as("GET", "/api/keys")).body.keys.map((k: any) => k.name)).toEqual(["Anna's HA"]);
    expect((await a.as("GET", `/api/keys/${bens.id}/key`)).status).toBe(404);
    expect((await a.as("PATCH", `/api/keys/${bens.id}`, { name: "Mine now", access: "read" })).status).toBe(404);
    expect((await a.as("DELETE", `/api/keys/${bens.id}`)).status).toBe(404);
    expect((await b.as("GET", "/api/keys")).body.keys).toMatchObject([{ name: "Ben's n8n", access: "log" }]);
    expect((await t.api("GET", "/api/keys")).body.keys).toEqual([]); // not even the admin sees them
    expect((await t.api("GET", `/api/keys/${bens.id}/key`)).status).toBe(404);

    // ben logs water; anna's key sees and changes only anna's
    const day = "2026-11-10";
    await b.as("POST", "/api/log", { day, water_ml: 400 });
    const bensEntry = (await b.as("GET", `/api/day/${day}`)).body.entries[0];
    const withKey = (key: string, method: string, url: string, payload?: object) =>
      t.app.inject({ method: method as "GET", url, payload, headers: { authorization: `Bearer ${key}` } }).then((r) => ({ status: r.statusCode, body: r.body ? r.json() : null }));
    expect((await withKey(annas.key, "GET", `/api/day/${day}`)).body.entries).toEqual([]);
    expect((await withKey(annas.key, "PATCH", `/api/log/${bensEntry.id}`, { quantity: 1 })).status).toBe(404);
    expect((await withKey(annas.key, "DELETE", `/api/log/${bensEntry.id}`)).status).toBe(404);
    expect((await withKey(annas.key, "POST", "/api/log", { day, water_ml: 100 })).status).toBe(200);
    expect((await b.as("GET", `/api/day/${day}`)).body.entries).toMatchObject([{ id: bensEntry.id, quantity: 400 }]);
    expect((await a.as("GET", `/api/day/${day}`)).body.entries).toMatchObject([{ quantity: 100 }]);
    // ben's key is ben, never anna
    expect((await withKey(bens.key, "GET", `/api/day/${day}`)).body.entries).toMatchObject([{ id: bensEntry.id }]);
  });
  it("Invites: a member can't invite, resend or cancel; an invite link signs in only the invited person, who sees only their own data", async () => {
    const { a, b } = await twoUsers(t);
    const gmail = { enabled: true, host: "smtp.gmail.com", port: 587, security: "starttls", username: "c@gmail.com", password: "pw", fromName: null, fromAddress: "c@gmail.com", appUrl: "https://bytesize.example.com" };
    await t.api("POST", "/api/settings/email/test", { settings: gmail });
    expect((await t.api("PUT", "/api/settings/email", gmail)).status).toBe(200);
    t.mail.sent.length = 0;
    expect((await a.as("POST", "/api/admin/invites", { name: "Eve", username: "eve", email: "eve@example.com" })).status).toBe(403);
    const dana = (await t.api("POST", "/api/admin/invites", { name: "Dana", username: "dana", email: "dana@example.com" })).body.user;
    expect((await a.as("POST", `/api/admin/invites/${dana.id}/resend`)).status).toBe(403);
    expect((await a.as("DELETE", `/api/admin/invites/${dana.id}`)).status).toBe(403);
    expect((await a.as("DELETE", `/api/admin/invites/${b.id}`)).status).toBe(403);
    expect(t.mail.sent).toHaveLength(1); // only the admin's invite went out
    const token = /#\/invite\/([A-Za-z0-9_-]+)/.exec(t.mail.sent[0].text)![1];
    // a signed-in member can't use the link to become dana, or change their own password with it
    const r = await a.as("POST", "/api/invites/accept", { token, password: "password-of-anna" });
    expect(r.status).toBe(200);
    expect(r.body.user.username).toBe("dana"); // the link is dana's, whoever presses it
    expect((await a.as("GET", "/api/auth/me")).body.user.username).toBe("anna"); // anna's own sign-in is untouched
    expect((await t.app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "anna", password: "password123" } })).statusCode).toBe(200);
    const danaAs = (await import("./isolation.js")).asUser(t, r.body.token);
    await a.as("POST", "/api/log", { day: "2026-11-10", water_ml: 300 });
    expect((await danaAs("GET", "/api/day/2026-11-10")).body.entries).toEqual([]);
    expect((await danaAs("GET", "/api/admin/users")).status).toBe(403);
  });
});
