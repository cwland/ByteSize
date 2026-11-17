import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";
import { twoUsers } from "./isolation.js";
import { softPasskey } from "./softPasskey.js";
import { aiSettings, offKnows, offProduct } from "./foodFakes.js";
import { labelPhoto, photoUpload } from "./photoFakes.js";
import { CULURY, culuryCalls, culuryKnows, culuryRecipe, fakeDns } from "./culuryFakes.js";
import { restaurantWeb, setRestaurantKeys, spoonItem } from "./restaurantFakes.js";

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
    expect((await b.as("GET", "/api/glp1")).body).toEqual({ settings: null, lastShot: null, nextDue: null, status: "none", overdueDays: 0, suggestedSite: "abdomen_left", shots: [], doseHistory: [] });
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
    expect(annas.settings).toEqual({ medication: "Mounjaro", doseMg: 2.5, injectionWeekday: 5 });
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

  it("a person's Culury link (address and key) is only ever used for their own requests", async () => {
    const { a, b } = await twoUsers(t);
    const BENS = "http://bens-culury.lan:4000";
    culuryKnows(t, { key: "annas-key", recipes: [culuryRecipe(7, "Anna's chili")], plan: [{ date: "2026-11-17", slot: "dinner", recipeId: 7, title: "Anna's chili" }] });
    culuryKnows(t, { base: BENS, key: "bens-key", recipes: [culuryRecipe(7, "Ben's curry")] });
    expect((await a.as("PUT", "/api/settings/culury", { url: CULURY, apiKey: "annas-key" })).status).toBe(200);
    expect((await a.as("POST", "/api/log", { day: "2026-11-17", meal: "dinner", food: { kind: "culury", id: 7 }, unit: "serving", quantity: 1 })).status).toBe(200);
    t.foodWeb.calls.length = 0;

    // ben, not linked: nothing of anna's link, and her Culury is never called for him
    expect((await b.as("GET", "/api/settings/culury")).body).toEqual({ url: null, hasKey: false });
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
    expect((await a.as("GET", "/api/settings/culury")).body).toEqual({ url: CULURY, hasKey: true });

    // with his Culury unreachable, re-logging never falls back to anna's snapshot of "her" recipe 7
    fakeDns["bens-down.lan"] = [];
    expect((await b.as("PUT", "/api/settings/culury", { url: "http://bens-down.lan", apiKey: "bens-key" })).status).toBe(200);
    expect((await b.as("POST", "/api/log", { day: "2026-11-17", meal: "dinner", food: { kind: "culury", id: 7 }, unit: "serving", quantity: 1 })).status).toBe(502);
    await b.as("DELETE", "/api/settings/culury");
    expect((await b.as("POST", "/api/log", { day: "2026-11-17", meal: "dinner", food: { kind: "culury", id: 7 }, unit: "serving", quantity: 1 })).status).toBe(400);
    expect((await b.as("GET", "/api/day/2026-11-17")).body.entries).toEqual([]);
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
});
