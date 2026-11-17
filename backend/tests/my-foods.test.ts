import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";
import { asUser } from "./isolation.js";
import { aiAnswers, aiSettings, lastAiPrompt, offKnows, offProduct } from "./foodFakes.js";

let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
beforeEach(async () => {
  await t.reset();
  await t.login(); // admin "cory"
});
afterAll(async () => t.close());

const shake = { name: "Morning protein shake", brand: "Fairlife", servings: [{ label: "1 bottle", ml: 340 }], nutrients: { calories: 150, protein_g: 30 } };

describe("my foods", () => {
  it("custom foods: create, find by a word from the middle of the name, edit, remove", async () => {
    const made = await t.api("POST", "/api/my-foods", shake);
    expect(made.status).toBe(200);
    expect(made.body.food).toEqual({
      kind: "user_food",
      id: expect.any(Number),
      name: "Morning protein shake",
      brand: "Fairlife",
      icon: "🥤",
      barcode: null,
      servings: [{ label: "1 bottle", ml: 340 }],
      nutrients: { calories: 150, protein_g: 30 },
      aiFields: [],
      imageUrl: null,
      override: false,
      source: "mine",
      foodKind: "custom",
    });
    const id = made.body.food.id;

    const found = await t.api("GET", "/api/my-foods?q=protein");
    expect(found.body.foods.map((f: any) => f.id)).toEqual([id]);
    expect((await t.api("GET", "/api/my-foods?q=lasagna")).body.foods).toEqual([]);
    expect((await t.api("GET", "/api/my-foods")).body.foods.map((f: any) => f.id)).toEqual([id]);
    const s = await t.api("GET", "/api/foods/search?q=protein");
    expect(s.body.groups[0]).toMatchObject({ source: "mine", foods: [{ id }] });

    const edited = await t.api("PATCH", `/api/my-foods/${id}`, { nutrients: { calories: 160, protein_g: 30, fiber_g: 1 }, brand: null });
    expect(edited.status).toBe(200);
    expect(edited.body.food).toMatchObject({ id, brand: null, nutrients: { calories: 160, protein_g: 30, fiber_g: 1 } });

    expect((await t.api("DELETE", `/api/my-foods/${id}`)).status).toBe(204);
    expect((await t.api("GET", "/api/my-foods")).body.foods).toEqual([]);
    expect((await t.api("GET", "/api/foods/search?q=protein")).body.groups).toEqual([]);
    expect((await t.api("PATCH", `/api/my-foods/${id}`, { name: "Back" })).status).toBe(404);
  });

  it("rejects foods without a serving or with made-up nutrients", async () => {
    expect((await t.api("POST", "/api/my-foods", { ...shake, servings: [] })).status).toBe(400);
    expect((await t.api("POST", "/api/my-foods", { ...shake, nutrients: { calories: -5 } })).status).toBe(400);
    expect((await t.api("POST", "/api/my-foods", { ...shake, nutrients: { vitamin_q: 5 } })).status).toBe(400);
    expect((await t.api("POST", "/api/my-foods", { ...shake, name: " " })).status).toBe(400);
    const bad = await t.api("POST", "/api/my-foods", { ...shake, barcode: "12ab" });
    expect([bad.status, bad.body.error]).toEqual([400, "That doesn't look like a barcode"]);
  });

  it("same barcode twice for one user is 409, but two users may each have one", async () => {
    const first = await t.api("POST", "/api/my-foods", { ...shake, barcode: "012345678905" });
    expect(first.body.food.barcode).toBe("0012345678905");
    const dup = await t.api("POST", "/api/my-foods", { ...shake, name: "Other", barcode: "0012345678905" });
    expect([dup.status, dup.body.error]).toEqual([409, "You already have a food with this barcode"]);
    const other = await t.api("POST", "/api/my-foods", { ...shake, name: "Other" });
    const patch = await t.api("PATCH", `/api/my-foods/${other.body.food.id}`, { barcode: "0 12345 67890 5" });
    expect([patch.status, patch.body.error]).toEqual([409, "You already have a food with this barcode"]);
    // Keeping its own barcode isn't a conflict
    expect((await t.api("PATCH", `/api/my-foods/${first.body.food.id}`, { barcode: "012345678905", name: "Shake" })).status).toBe(200);

    const ben = asUser(t, (await t.createUser("ben")).token);
    expect((await ben("POST", "/api/my-foods", { ...shake, barcode: "012345678905" })).status).toBe(200);

    // Once archived, the barcode is free again
    await t.api("DELETE", `/api/my-foods/${first.body.food.id}`);
    expect((await t.api("POST", "/api/my-foods", { ...shake, barcode: "012345678905" })).status).toBe(200);
  });

  it("an override copies the cached food and keeps the rest", async () => {
    offKnows(t, { "0012345678905": offProduct("0012345678905", "Crunchy bar", 400) });
    const cached = (await t.api("GET", "/api/foods/barcode/012345678905")).body.food;
    const o = await t.api("POST", "/api/my-foods/override", { cacheId: cached.id, name: "Crunchy bar (real)", servings: [{ label: "1 bar", grams: 45 }] });
    expect(o.body.food).toMatchObject({ kind: "user_food", override: true, foodKind: "override", name: "Crunchy bar (real)", brand: "Acme", barcode: "0012345678905", icon: "🍿", servings: [{ label: "1 bar", grams: 45 }], nutrients: cached.nutrients });
    expect((await t.api("GET", "/api/my-foods")).body.foods.map((f: any) => f.id)).toEqual([o.body.food.id]);
    expect((await t.api("POST", "/api/my-foods/override", { cacheId: 999999 })).status).toBe(404);
  });
});

describe("AI estimate", () => {
  const burrito = {
    name: "Chicken burrito",
    brand: null,
    category: "burrito",
    servings: [{ label: "1 burrito", grams: 300 }],
    nutrients: { calories: 650, protein_g: 35, fiber_g: 8, carbs_g: 70, fat_g: 22, sodium_mg: 1400 },
  };

  it("AI estimate drafts a food and flags every value", async () => {
    await t.api("PUT", "/api/settings/ai", aiSettings);
    aiAnswers(t, burrito);
    const r = await t.api("POST", "/api/ai/estimate", { text: "a chicken burrito from the food truck" });
    expect(r.status).toBe(200);
    expect(r.body.food).toEqual({
      name: "Chicken burrito",
      brand: null,
      category: "burrito",
      icon: "🍗", // no rule for burritos, so the name decides
      barcode: null,
      servings: [{ label: "1 burrito", grams: 300 }],
      nutrients: burrito.nutrients,
      aiFields: ["calories", "protein_g", "fiber_g", "carbs_g", "fat_g", "sodium_mg"],
      imageUrl: null,
      override: false,
      source: "ai",
    });
    expect(lastAiPrompt(t)).toContain("a chicken burrito from the food truck");
    expect(lastAiPrompt(t)).toMatch(/nutrition label/i);

    // Saved as is it stays "ai"; once a value is edited, it's the person's and that value isn't flagged
    const d = r.body.food;
    const saved = await t.api("POST", "/api/my-foods", { name: d.name, brand: d.brand, barcode: null, servings: d.servings, nutrients: d.nutrients, category: d.category, aiFields: d.aiFields });
    expect(saved.body.food).toMatchObject({ source: "ai", aiFields: r.body.food.aiFields, foodKind: "custom" }); // an AI estimate is one of my foods
    const edited = await t.api("PATCH", `/api/my-foods/${saved.body.food.id}`, { nutrients: { ...burrito.nutrients, calories: 700 } });
    expect(edited.body.food.source).toBe("mine");
    expect(edited.body.food.aiFields).toEqual(["protein_g", "fiber_g", "carbs_g", "fat_g", "sodium_mg"]);
    // The web app sends the subset itself (fields the person edited removed), with blank brand/barcode as null
    const web = await t.api("PATCH", `/api/my-foods/${saved.body.food.id}`, { name: "Burrito", brand: null, barcode: null, servings: burrito.servings, nutrients: { ...burrito.nutrients, calories: 700, fat_g: 25 }, aiFields: ["protein_g", "fiber_g"] });
    expect(web.status).toBe(200);
    expect(web.body.food).toMatchObject({ brand: null, barcode: null, aiFields: ["protein_g", "fiber_g"], source: "mine" });
  });

  it("an AI answer that isn't a food is a clear error", async () => {
    await t.api("PUT", "/api/settings/ai", aiSettings);
    aiAnswers(t, { hello: "there" });
    const r = await t.api("POST", "/api/ai/estimate", { text: "a chicken burrito" });
    expect(r.status).toBe(502);
    expect(r.body.error).toMatch(/AI/);
  });

  it("AI off → 503 'Set up an AI service first'", async () => {
    const r = await t.api("POST", "/api/ai/estimate", { text: "a chicken burrito" });
    expect(r).toMatchObject({ status: 503, body: { error: "Set up an AI service first" } });
    const food = (await t.api("POST", "/api/my-foods", shake)).body.food;
    const g = await t.api("POST", "/api/ai/fill-gaps", { food: { kind: "user_food", id: food.id } });
    expect(g).toMatchObject({ status: 503, body: { error: "Set up an AI service first" } });
    expect(t.ai.calls).toEqual([]);
  });

  it("fill gaps returns only the missing nutrients", async () => {
    await t.api("PUT", "/api/settings/ai", aiSettings);
    const food = (await t.api("POST", "/api/my-foods", shake)).body.food; // calories and protein known
    aiAnswers(t, { nutrients: { calories: 999, protein_g: 1, fiber_g: 0.5, sodium_mg: 230, potassium_mg: null } });
    const r = await t.api("POST", "/api/ai/fill-gaps", { food: { kind: "user_food", id: food.id } });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ nutrients: { fiber_g: 0.5, sodium_mg: 230 }, aiFields: ["fiber_g", "sodium_mg"] });
    expect(lastAiPrompt(t)).toContain("fiber_g");
    expect(lastAiPrompt(t)).toContain("Morning protein shake");
    // A draft: nothing is saved
    expect((await t.api("GET", "/api/my-foods")).body.foods[0].nutrients).toEqual({ calories: 150, protein_g: 30 });

    // Cached foods can be filled too
    offKnows(t, { "0012345678905": offProduct("0012345678905", "Crunchy bar", 400) });
    const cached = (await t.api("GET", "/api/foods/barcode/0012345678905")).body.food;
    aiAnswers(t, { nutrients: { fiber_g: 3, calories: 1 } });
    const c = await t.api("POST", "/api/ai/fill-gaps", { food: { kind: "cache", id: cached.id } });
    expect(c.body).toEqual({ nutrients: { fiber_g: 3 }, aiFields: ["fiber_g"] });
    expect((await t.api("POST", "/api/ai/fill-gaps", { food: { kind: "cache", id: 999999 } })).status).toBe(404);
  });
});
