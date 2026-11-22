import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";
import { never } from "./foodFakes.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { CULURY, CULURY_KEY, culuryCalls, culuryKnows, culuryRecipe, fakeDns, fullNutrition, resetFakeDns } from "./culuryFakes.js";
import { appLog, userSettings } from "../src/db/schema.js";
import { buildApp } from "../src/app.js";
import { servingGrams } from "../src/lib/culury.js";
import { TEST_SECRET } from "./helpers.js";

let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
beforeEach(async () => {
  await t.reset();
  resetFakeDns();
  await t.login();
});
afterAll(async () => t.close());

const link = (url = CULURY, apiKey: string | undefined = CULURY_KEY) => t.api("PUT", "/api/settings/culury", { url, ...(apiKey !== undefined ? { apiKey } : {}) });
const everythingSaid = async () => JSON.stringify((await t.db.select().from(appLog)).map((r) => [r.event, r.detail, r.source]));

describe("RecipeHub settings", () => {
  it("starts unlinked", async () => {
    expect((await t.api("GET", "/api/settings/culury")).body).toEqual({ url: null, hasKey: false, enabled: false });
  });

  it("saves the address and key; the key is stored encrypted and never sent back", async () => {
    const saved = await link(CULURY + "/");
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ url: CULURY, hasKey: true, enabled: true }); // trailing slash trimmed
    const got = await t.api("GET", "/api/settings/culury");
    expect(got.body).toEqual({ url: CULURY, hasKey: true, enabled: true });
    expect(JSON.stringify(got.body)).not.toContain(CULURY_KEY);
    const [row] = await t.db.select().from(userSettings);
    expect(row.culuryUrl).toBe(CULURY);
    expect(row.culuryKeyEnc).toBeTruthy();
    expect(row.culuryKeyEnc).not.toContain(CULURY_KEY);
  });

  it("keeps the saved key when only the address's form changes, but wants the key again for a new address", async () => {
    await link();
    expect((await t.api("PUT", "/api/settings/culury", { url: CULURY + "/" })).body).toEqual({ url: CULURY, hasKey: true, enabled: true });
    const moved = await t.api("PUT", "/api/settings/culury", { url: "http://elsewhere.example:4000" });
    expect(moved.status).toBe(400);
    expect(moved.body.error).toMatch(/API key/);
    expect((await t.api("GET", "/api/settings/culury")).body).toEqual({ url: CULURY, hasKey: true, enabled: true });
  });

  it("keeps a path but drops a query and fragment", async () => {
    expect((await link("https://home.example/culury/?x=1#top")).body).toEqual({ url: "https://home.example/culury", hasKey: true, enabled: true });
  });

  it.each([
    ["file:///etc/passwd"],
    ["ftp://culury.lan"],
    ["javascript:alert(1)"],
    ["http://user:pass@culury.lan:4000"],
    ["http://user@culury.lan"],
    ["culury.lan:4000"],
    ["http://169.254.169.254"],
    ["http://[::ffff:169.254.169.254]"],
    ["http://2852039166"],
    ["http://[fe80::1]"],
    ["http://metadata.google.internal."],
    ["http://169.254.169.254."],
    ["http://100.100.100.200"],
    ["http://[::169.254.169.254]"],
    ["http://[0:0:0:0:0:ffff:169.254.1.1]"],
    ["http://[::ffff:a9fe:1]"],
    ["http://metadata.google.internal"],
    ["not a url"],
  ])("refuses %s", async (url) => {
    const res = await link(url);
    expect(res.status).toBe(400);
    expect((await t.api("GET", "/api/settings/culury")).body).toEqual({ url: null, hasKey: false, enabled: false });
  });

  it("needs a key the first time", async () => {
    const res = await t.api("PUT", "/api/settings/culury", { url: CULURY });
    expect(res.status).toBe(400);
  });

  it("Remove forgets both", async () => {
    await link();
    expect((await t.api("DELETE", "/api/settings/culury")).body).toEqual({ url: null, hasKey: false, enabled: false });
    expect((await t.api("GET", "/api/settings/culury")).body).toEqual({ url: null, hasKey: false, enabled: false });
    const [row] = await t.db.select().from(userSettings);
    expect(row.culuryKeyEnc).toBeNull();
  });
});

describe("Test connection", () => {
  it("asks RecipeHub for today's plan with the key in X-API-Key", async () => {
    t.clock.date = new Date("2026-11-17T18:00:00Z");
    culuryKnows(t);
    await link();
    const res = await t.api("POST", "/api/settings/culury/test");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, message: expect.any(String) });
    const calls = culuryCalls(t);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].url).toBe(`${CULURY}/api/plan?from=2026-11-17&to=2026-11-17`);
    expect(calls[0].headers["x-api-key"]).toBe(CULURY_KEY);
  });

  it("can test an address and key before saving them", async () => {
    culuryKnows(t);
    const res = await t.api("POST", "/api/settings/culury/test", { url: CULURY, apiKey: CULURY_KEY });
    expect(res.status).toBe(200);
    expect((await t.api("GET", "/api/settings/culury")).body).toEqual({ url: null, hasKey: false, enabled: false });
  });

  it("a wrong key: a plain reason, never the key or RecipeHub's answer", async () => {
    culuryKnows(t, { key: "the-right-one" });
    await link();
    const res = await t.api("POST", "/api/settings/culury/test");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/key/i);
    expect(JSON.stringify(res.body)).not.toContain(CULURY_KEY);
    expect(JSON.stringify(res.body)).not.toContain("Not logged in");
    expect(await everythingSaid()).not.toContain(CULURY_KEY);
  });

  it("unreachable: a plain reason", async () => {
    await link();
    t.foodWeb.down = true;
    const res = await t.api("POST", "/api/settings/culury/test");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reach RecipeHub/);
  });

  it("too slow: gives up after 3 seconds", async () => {
    await link();
    t.foodWeb.respond = () => never();
    const started = Date.now();
    const res = await t.api("POST", "/api/settings/culury/test");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/too long/);
    expect(Date.now() - started).toBeLessThan(4500);
  }, 8000);

  it("a redirect or an odd answer is a failure, and its body is never echoed", async () => {
    await link();
    t.foodWeb.respond = () => ({ status: 302, json: { error: "go to http://169.254.169.254/" } });
    const res = await t.api("POST", "/api/settings/culury/test");
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain("169.254");
    t.foodWeb.respond = () => ({ status: 200, json: { secret: "internal stuff" } });
    const odd = await t.api("POST", "/api/settings/culury/test");
    expect(odd.status).toBe(400);
    expect(JSON.stringify(odd.body)).not.toContain("internal stuff");
  });

  it("not linked: says what to add", async () => {
    const res = await t.api("POST", "/api/settings/culury/test");
    expect(res.status).toBe(400);
    expect(culuryCalls(t)).toHaveLength(0);
  });
});

describe("Meal plan", () => {
  const plan = [
    { date: "2026-11-13", slot: "dinner", recipeId: 1, title: "Too early" }, // day-4: outside
    { date: "2026-11-14", slot: "dinner", recipeId: 2, title: "Chili", servings: 6 }, // day-3
    { date: "2026-11-17", slot: "breakfast", recipeId: 3, title: "Oats" },
    { date: "2026-11-17", slot: "dinner", recipeId: 4, title: "Salmon bowls" },
    { date: "2026-11-17", slot: "lunch", recipeId: null, title: "Leftovers", note: "Chili from Friday" },
    { date: "2026-11-21", slot: "snack", recipeId: 5, title: "Energy bites" }, // day+4
    { date: "2026-11-22", slot: "dinner", recipeId: 6, title: "Too late" }, // day+5: outside
  ];

  it("not linked: says so, and calls nothing", async () => {
    const res = await t.api("GET", "/api/culury/plan?day=2026-11-17&meal=dinner");
    expect(res.body).toEqual({ linked: false, days: [], errors: [] });
    expect(culuryCalls(t)).toHaveLength(0);
  });

  it("asks for day-3 to day+4; the selected day first, its matching meal first", async () => {
    culuryKnows(t, { plan });
    await link();
    const res = await t.api("GET", "/api/culury/plan?day=2026-11-17&meal=dinner");
    expect(res.status).toBe(200);
    expect(culuryCalls(t).map((c) => c.url)).toEqual([`${CULURY}/api/plan?from=2026-11-14&to=2026-11-21`]);
    expect(res.body).toEqual({
      linked: true,
      errors: [],
      days: [
        {
          day: "2026-11-17",
          items: [
            { slot: "dinner", title: "Salmon bowls", recipeId: 4, servings: null, note: null },
            { slot: "breakfast", title: "Oats", recipeId: 3, servings: null, note: null },
            { slot: "lunch", title: "Leftovers", recipeId: null, servings: null, note: "Chili from Friday" },
          ],
        },
        { day: "2026-11-14", items: [{ slot: "dinner", title: "Chili", recipeId: 2, servings: 6, note: null }] },
        { day: "2026-11-21", items: [{ slot: "snack", title: "Energy bites", recipeId: 5, servings: null, note: null }] },
      ],
    });
  });

  it("ByteSize's snacks matches RecipeHub's snack slot", async () => {
    culuryKnows(t, { plan });
    await link();
    const res = await t.api("GET", "/api/culury/plan?day=2026-11-21&meal=snacks");
    expect(res.body.days[0]).toEqual({ day: "2026-11-21", items: [{ slot: "snack", title: "Energy bites", recipeId: 5, servings: null, note: null }] });
  });

  it("RecipeHub down: a plain message, no days, never a 500", async () => {
    await link();
    t.foodWeb.down = true;
    const res = await t.api("GET", "/api/culury/plan?day=2026-11-17");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ linked: true, days: [], errors: [{ source: "culury", message: expect.stringMatching(/reach RecipeHub/) }] });
  });

  it("malformed rows are skipped", async () => {
    await link();
    t.foodWeb.respond = () => ({ status: 200, json: [{ date: "2026-11-17", slot: "dinner", title: "Fine", recipeId: 8 }, { date: 5, title: null }, "junk"] });
    const res = await t.api("GET", "/api/culury/plan?day=2026-11-17");
    expect(res.body.days).toEqual([{ day: "2026-11-17", items: [{ slot: "dinner", title: "Fine", recipeId: 8, servings: null, note: null }] }]);
  });

  it("needs a real day", async () => {
    await link();
    expect((await t.api("GET", "/api/culury/plan?day=tomorrow")).status).toBe(400);
  });
});

describe("RecipeHub recipes as foods", () => {
  it("maps nutrition per serving and the serving's grams", async () => {
    culuryKnows(t, { recipes: [culuryRecipe(7, "Turkey chili")] });
    await link();
    const res = await t.api("GET", "/api/culury/recipes/7");
    expect(res.status).toBe(200);
    expect(culuryCalls(t).map((c) => c.url)).toEqual([`${CULURY}/api/recipes/7`]);
    expect(res.body).toEqual({
      hasNutrition: true,
      outdated: false,
      food: expect.objectContaining({
        kind: "culury",
        id: 7,
        name: "Turkey chili",
        brand: null,
        barcode: null,
        servings: [{ label: "1 serving", grams: 340 }],
        nutrients: { calories: 520, fat_g: 18, saturated_fat_g: 6, carbs_g: 48, fiber_g: 7, sugar_g: 9, added_sugar_g: 2, protein_g: 41, sodium_mg: 880 },
        aiFields: [],
        imageUrl: null,
        override: false,
        source: "culury",
        foodKind: "recipe",
      }),
    });
  });

  it("no grams in the serving note: servings only", async () => {
    culuryKnows(t, { recipes: [culuryRecipe(7, "Soup", fullNutrition({ servingSize: "1 bowl" }))] });
    await link();
    expect((await t.api("GET", "/api/culury/recipes/7")).body.food.servings).toEqual([{ label: "1 serving" }]);
  });

  it("partial nutrition: unknown stays unknown (never 0)", async () => {
    const partial = fullNutrition({ fiber: null, sugar: null, addedSugar: undefined, saturatedFat: null, sodium: null, servingSize: null, outdated: true });
    culuryKnows(t, { recipes: [culuryRecipe(7, "Soup", partial)] });
    await link();
    const res = await t.api("GET", "/api/culury/recipes/7");
    expect(res.body.food.nutrients).toEqual({ calories: 520, fat_g: 18, carbs_g: 48, protein_g: 41 });
    expect(res.body.hasNutrition).toBe(true);
    expect(res.body.outdated).toBe(true);
  });

  it("no nutrition: hasNutrition false, nutrients empty", async () => {
    culuryKnows(t, { recipes: [culuryRecipe(7, "Grandma's stew", null)] });
    await link();
    const res = await t.api("GET", "/api/culury/recipes/7");
    expect(res.body.hasNutrition).toBe(false);
    expect(res.body.food.nutrients).toEqual({});
  });

  it("RecipeHub's own AI estimate is flagged as AI", async () => {
    culuryKnows(t, { recipes: [culuryRecipe(7, "Soup", fullNutrition({ source: "ai" }))] });
    await link();
    const res = await t.api("GET", "/api/culury/recipes/7");
    expect(res.body.food.aiFields).toHaveLength(9);
  });

  it("not found in RecipeHub: 404; down: a plain 502; not linked: 400", async () => {
    culuryKnows(t, { recipes: [] });
    expect((await t.api("GET", "/api/culury/recipes/7")).status).toBe(400);
    await link();
    expect((await t.api("GET", "/api/culury/recipes/7")).status).toBe(404);
    t.foodWeb.down = true;
    const down = await t.api("GET", "/api/culury/recipes/7");
    expect(down.status).toBe(502);
    expect(down.body.error).toMatch(/reach RecipeHub/);
  });
});

describe("RecipeHub in food search", () => {
  it("a RecipeHub group after My foods when linked", async () => {
    culuryKnows(t, { recipes: [culuryRecipe(7, "Turkey chili"), culuryRecipe(8, "Chicken chili verde", null), culuryRecipe(9, "Pancakes")] });
    await link();
    const res = await t.api("GET", "/api/foods/search?q=chili");
    expect(res.status).toBe(200);
    const listCall = culuryCalls(t).find((c) => c.url.startsWith(`${CULURY}/api/recipes?`))!;
    expect(new URL(listCall.url).searchParams.get("q")).toBe("chili");
    expect(listCall.headers["x-api-key"]).toBe(CULURY_KEY);
    const group = res.body.groups.find((g: any) => g.source === "culury");
    expect(group.label).toBe("RecipeHub");
    expect(group.foods.map((f: any) => [f.kind, f.id, f.name])).toEqual([
      ["culury", 7, "Turkey chili"],
      ["culury", 8, "Chicken chili verde"],
    ]);
    expect(group.foods[0].nutrients.calories).toBe(520);
    expect(group.foods[1].nutrients).toEqual({});
    expect(res.body.errors).toEqual([]);
  });

  it("no group when not linked, and nothing is asked of RecipeHub", async () => {
    culuryKnows(t, { recipes: [culuryRecipe(7, "Turkey chili")] });
    const res = await t.api("GET", "/api/foods/search?q=chili");
    expect(res.body.groups.some((g: any) => g.source === "culury")).toBe(false);
    expect(culuryCalls(t)).toHaveLength(0);
  });

  it("RecipeHub down: a plain error, the rest of search still works", async () => {
    culuryKnows(t, { key: "other" }); // refuses our key
    await link();
    const res = await t.api("GET", "/api/foods/search?q=chili");
    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([{ source: "culury", message: expect.stringMatching(/key/i) }]);
    expect(JSON.stringify(res.body)).not.toContain(CULURY_KEY);
    expect(await everythingSaid()).not.toContain(CULURY_KEY);
  });
});

describe("Logging a RecipeHub recipe", () => {
  const log = (body: object) => t.api("POST", "/api/log", { day: "2026-11-17", meal: "dinner", ...body });

  it("snapshots it (source culury, ref culury:<id>); a later RecipeHub edit never changes it; shows in recents", async () => {
    culuryKnows(t, { recipes: [culuryRecipe(7, "Turkey chili")] });
    await link();
    const res = await log({ food: { kind: "culury", id: 7 }, unit: "serving", quantity: 1.5 });
    expect(res.status).toBe(200);
    expect(res.body.entry).toMatchObject({ name: "Turkey chili", source: "culury", sourceRef: "culury:7", aiEstimated: false, servings: [{ label: "1 serving", grams: 340 }] });
    expect(res.body.entry.nutrients).toMatchObject({ calories: 780, protein_g: 61.5, sodium_mg: 1320 });

    // RecipeHub changes the recipe: the logged day doesn't move
    culuryKnows(t, { recipes: [culuryRecipe(7, "Turkey chili", fullNutrition({ calories: 9999 }))] });
    const day = await t.api("GET", "/api/day/2026-11-17");
    expect(day.body.entries[0].nutrients.calories).toBe(780);

    // Recents come from the snapshot (no call to RecipeHub)
    t.foodWeb.calls.length = 0;
    const recent = await t.api("GET", "/api/foods/recent");
    expect(recent.body.foods).toEqual([
      expect.objectContaining({ kind: "culury", id: 7, name: "Turkey chili", source: "culury", foodKind: "recipe", nutrients: expect.objectContaining({ calories: 520 }), last: { servingIndex: 0, unit: "serving", quantity: 1.5, fraction: 1 } }),
    ]);
    expect(culuryCalls(t)).toHaveLength(0);
  });

  it("grams work when the serving has grams; a recipe without grams logs in servings only", async () => {
    culuryKnows(t, { recipes: [culuryRecipe(7, "Turkey chili"), culuryRecipe(8, "Soup", fullNutrition({ servingSize: "1 bowl" }))] });
    await link();
    const grams = await log({ food: { kind: "culury", id: 7 }, unit: "g", quantity: 170 });
    expect(grams.status).toBe(200);
    expect(grams.body.entry.nutrients.calories).toBe(260);
    expect((await log({ food: { kind: "culury", id: 8 }, unit: "g", quantity: 100 })).status).toBe(400);
    expect((await log({ food: { kind: "culury", id: 8 }, unit: "serving", quantity: 1, fraction: 0.5 })).body.entry.nutrients.calories).toBe(260);
  });

  it("no nutrition: logs with unknowns, or with an AI estimate sent along (flagged)", async () => {
    culuryKnows(t, { recipes: [culuryRecipe(8, "Grandma's stew", null)] });
    await link();
    const plain = await log({ food: { kind: "culury", id: 8 }, unit: "serving", quantity: 1 });
    expect(plain.status).toBe(200);
    expect(plain.body.entry.nutrients).toEqual({});
    expect(plain.body.entry.aiEstimated).toBe(false);

    const est = await log({ food: { kind: "culury", id: 8 }, unit: "serving", quantity: 2, nutrients: { calories: 410, protein_g: 30 } });
    expect(est.status).toBe(200);
    expect(est.body.entry).toMatchObject({ aiEstimated: true, nutrients: { calories: 820, protein_g: 60 }, sourceRef: "culury:8" });
  });

  it("an estimate is refused when RecipeHub has nutrition, and for other foods", async () => {
    culuryKnows(t, { recipes: [culuryRecipe(7, "Turkey chili")] });
    await link();
    expect((await log({ food: { kind: "culury", id: 7 }, unit: "serving", quantity: 1, nutrients: { calories: 1 } })).status).toBe(400);
    const mine = await t.api("POST", "/api/my-foods", { name: "Toast", servings: [{ label: "1 slice", grams: 30 }], nutrients: { calories: 80 } });
    expect((await log({ food: { kind: "user_food", id: mine.body.food.id }, unit: "serving", quantity: 1, nutrients: { calories: 1 } })).status).toBe(400);
  });

  it("RecipeHub down or not linked: a plain refusal, nothing logged; other foods still log", async () => {
    expect((await log({ food: { kind: "culury", id: 7 }, unit: "serving", quantity: 1 })).status).toBe(400);
    await link();
    t.foodWeb.down = true;
    const down = await log({ food: { kind: "culury", id: 7 }, unit: "serving", quantity: 1 });
    expect(down.status).toBe(502);
    expect((await t.api("GET", "/api/day/2026-11-17")).body.entries).toEqual([]);
    expect((await t.api("POST", "/api/log", { day: "2026-11-17", water_ml: 250 })).status).toBe(200);
  });

  it("only ever calls the person's own RecipeHub paths", async () => {
    culuryKnows(t, { recipes: [culuryRecipe(7, "Turkey chili")] });
    await link("http://culury.lan:4000/sub/");
    culuryKnows(t, { recipes: [culuryRecipe(7, "Turkey chili")], base: "http://culury.lan:4000/sub" });
    expect((await t.api("GET", "/api/culury/recipes/7")).status).toBe(200);
    // ids are numbers: no path tricks
    expect((await t.api("GET", "/api/culury/recipes/..%2F..%2Fadmin")).status).toBe(400);
    for (const c of t.foodWeb.calls) expect(c.url).toMatch(/^http:\/\/culury\.lan:4000\/sub\/api\/(plan|recipes)/);
  });
});

describe("fix round 1", () => {
  const log = (body: object) => t.api("POST", "/api/log", { day: "2026-11-17", meal: "dinner", ...body });

  describe("re-logging from the last snapshot when RecipeHub can't be asked", () => {
    it("RecipeHub down, or the link removed: this person's last snapshot is used", async () => {
      culuryKnows(t, { recipes: [culuryRecipe(7, "Turkey chili")] });
      await link();
      expect((await log({ food: { kind: "culury", id: 7 }, unit: "serving", quantity: 1 })).status).toBe(200);
      t.foodWeb.down = true;
      const again = await log({ day: "2026-11-18", food: { kind: "culury", id: 7 }, unit: "serving", quantity: 2 }); // another day: not combined
      expect(again.status).toBe(200);
      expect(again.body.entry).toMatchObject({ name: "Turkey chili", sourceRef: "culury:7", source: "culury", nutrients: { calories: 1040 }, servings: [{ label: "1 serving", grams: 340 }] });
      // an estimate isn't taken over a snapshot that has nutrition
      expect((await log({ food: { kind: "culury", id: 7 }, unit: "serving", quantity: 1, nutrients: { calories: 1 } })).status).toBe(400);
      // never logged: still RecipeHub's failure
      expect((await log({ food: { kind: "culury", id: 9 }, unit: "serving", quantity: 1 })).status).toBe(502);
      await t.api("DELETE", "/api/settings/culury");
      expect((await log({ day: "2026-11-19", food: { kind: "culury", id: 7 }, unit: "serving", quantity: 0.5 })).body.entry.nutrients.calories).toBe(260);
      expect((await log({ food: { kind: "culury", id: 9 }, unit: "serving", quantity: 1 })).status).toBe(400);
    });

    it("a snapshot without nutrition still takes an AI estimate (flagged)", async () => {
      culuryKnows(t, { recipes: [culuryRecipe(8, "Grandma's stew", null)] });
      await link();
      await log({ food: { kind: "culury", id: 8 }, unit: "serving", quantity: 1 });
      t.foodWeb.down = true;
      const est = await log({ food: { kind: "culury", id: 8 }, unit: "serving", quantity: 1, nutrients: { calories: 400 } });
      expect(est.status).toBe(200);
      expect(est.body.entry).toMatchObject({ aiEstimated: true, nutrients: { calories: 400 } });
    });

    it("a recipe RecipeHub no longer has is not logged from an old snapshot", async () => {
      culuryKnows(t, { recipes: [culuryRecipe(7, "Turkey chili")] });
      await link();
      await log({ food: { kind: "culury", id: 7 }, unit: "serving", quantity: 1 });
      culuryKnows(t, { recipes: [] });
      expect((await log({ food: { kind: "culury", id: 7 }, unit: "serving", quantity: 1 })).status).toBe(404);
    });
  });

  describe("answer size", () => {
    const big = "x".repeat(600 * 1024);
    it("a recipe over 512 KB is refused", async () => {
      culuryKnows(t, { recipes: [{ ...culuryRecipe(7, "Turkey chili"), description: big } as any] });
      await link();
      const res = await t.api("GET", "/api/culury/recipes/7");
      expect(res.status).toBe(502);
      expect(res.body.error).toBe("RecipeHub's answer was too large");
    });

    it("a plan over 512 KB is refused", async () => {
      await link();
      t.foodWeb.respond = () => ({ status: 200, json: [{ date: "2026-11-17", slot: "dinner", title: "Big", recipeId: 1, note: big }] });
      const res = await t.api("GET", "/api/culury/plan?day=2026-11-17");
      expect(res.body.errors).toEqual([{ source: "culury", message: "RecipeHub's answer was too large" }]);
    });

    it("a list may be up to 1 MB, not more; only the first 8 are opened", async () => {
      const many = Array.from({ length: 40 }, (_, i) => culuryRecipe(i + 1, `Chili ${i + 1}`));
      culuryKnows(t, { recipes: many });
      await link();
      const res = await t.api("GET", "/api/foods/search?q=chili");
      expect(res.body.groups.find((g: any) => g.source === "culury").foods).toHaveLength(8);
      expect(culuryCalls(t).filter((c) => /\/api\/recipes\/\d+$/.test(c.url))).toHaveLength(8);

      const padded = Array.from({ length: 3 }, (_, i) => ({ ...culuryRecipe(i + 1, `Chili ${i + 1}`), description: "y".repeat(250 * 1024) }));
      culuryKnows(t, { recipes: padded });
      expect((await t.api("GET", "/api/foods/search?q=chili")).body.errors).toEqual([]);
      const huge = Array.from({ length: 5 }, (_, i) => ({ ...culuryRecipe(i + 1, `Chili ${i + 1}`), description: "y".repeat(250 * 1024) }));
      culuryKnows(t, { recipes: huge });
      expect((await t.api("GET", "/api/foods/search?q=chili")).body.errors).toEqual([{ source: "culury", message: "RecipeHub's answer was too large" }]);
    });
  });

  describe("host names are checked before each call", () => {
    it("a name that resolves to a metadata / link-local address is never called", async () => {
      for (const [host, addrs] of [
        ["169.254.169.254.nip.io", ["169.254.169.254"]],
        ["evil.example", ["fe80::1"]],
        ["evil2.example", ["::ffff:169.254.169.254"]],
        ["evil3.example", ["10.0.0.5", "100.100.100.200"]],
      ] as const) {
        fakeDns[host] = [...addrs];
        await t.api("DELETE", "/api/settings/culury");
        expect((await link(`http://${host}:4000`)).status).toBe(200);
        const res = await t.api("POST", "/api/settings/culury/test");
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("RecipeHub's address isn't allowed");
      }
      expect(t.foodWeb.calls).toHaveLength(0);
    });

    it("rebinding: checked again on every call", async () => {
      culuryKnows(t, { recipes: [culuryRecipe(7, "Turkey chili")] });
      await link();
      expect((await t.api("GET", "/api/culury/recipes/7")).status).toBe(200);
      fakeDns["culury.lan"] = ["169.254.169.254"];
      expect((await t.api("GET", "/api/culury/recipes/7")).status).toBe(502);
      expect(culuryCalls(t)).toHaveLength(1);
    });

    it("LAN and private addresses stay allowed", async () => {
      fakeDns["culury.lan"] = ["10.0.0.5", "fd12:3456::1"];
      culuryKnows(t, { recipes: [culuryRecipe(7, "Turkey chili")] });
      await link();
      expect((await t.api("GET", "/api/culury/recipes/7")).status).toBe(200);
      for (const url of ["http://192.168.1.20:4000", "http://10.0.0.5", "http://172.16.0.9", "http://100.64.0.1"]) expect((await link(url)).status).toBe(200);
    });

    it("a name that doesn't resolve can't be reached", async () => {
      fakeDns["nowhere.lan"] = [];
      await link("http://nowhere.lan");
      expect((await t.api("POST", "/api/settings/culury/test")).body.error).toBe("Couldn't reach RecipeHub");
    });
  });

  it("while RecipeHub is down, searches log a warning at most once per 10 minutes", async () => {
    await link();
    t.foodWeb.down = true;
    t.clock.date = new Date("2030-01-01T12:00:00Z");
    const culuryLines = async () => (await t.db.select().from(appLog).where(and(eq(appLog.source, "RecipeHub")))).length;
    for (let i = 0; i < 3; i++) expect((await t.api("GET", "/api/foods/search?q=chili")).body.errors.filter((e: any) => e.source === "culury")).toHaveLength(1);
    expect(await culuryLines()).toBe(1);
    t.clock.date = new Date("2030-01-01T12:09:00Z");
    await t.api("GET", "/api/foods/search?q=chili");
    expect(await culuryLines()).toBe(1);
    t.clock.date = new Date("2030-01-01T12:11:00Z");
    await t.api("GET", "/api/foods/search?q=chili");
    expect(await culuryLines()).toBe(2);
  });

  it("Test connection is rate-limited", async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), "bytesize-rl-"));
    const app2 = buildApp({ db: t.db, jwtSecret: TEST_SECRET, rateLimit: { max: 3, windowMs: 60_000 }, foodFetch: (async () => { throw new Error("no"); }) as any, dataDir });
    await app2.ready();
    try {
      const headers = { authorization: `Bearer ${t.getToken()}` };
      const statuses = [];
      for (let i = 0; i < 4; i++) statuses.push((await app2.inject({ method: "POST", url: "/api/settings/culury/test", headers })).statusCode);
      expect(statuses).toEqual([400, 400, 400, 429]);
    } finally {
      await app2.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it.each([
    ["About 1½ cups (340 g)", 340],
    ["(1,200 g)", 1200],
    ["2 cups (340 g / 12 oz)", 340],
    ["1 slice (85.5g)", 85.5],
    ["1 bowl", undefined],
    ["1 cup (8 oz)", undefined],
    [null, undefined],
  ])("serving grams from %s", (text, grams) => {
    expect(servingGrams(text)).toBe(grams);
  });
});
