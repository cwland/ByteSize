import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";
import { aiAnswers, aiSettings, HOME_AI, lastAiPrompt } from "./foodFakes.js";

// Describe Food in the iPhone app (iOS design §6.7 change 5): one description can hold several foods,
// each a draft with how much of it. Nothing is saved.
let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
beforeEach(async () => {
  await t.reset();
  await t.login();
});
afterAll(async () => t.close());

const egg = { name: "Egg, large", category: "eggs", servings: [{ label: "1 large egg", grams: 50 }], nutrients: { calories: 72, protein_g: 6.3 }, quantity: 2 };
const toast = { name: "Toast", category: "bread", servings: [{ label: "1 slice", grams: 30 }], nutrients: { calories: 80, carbs_g: 15 }, quantity: 1 };
const coffee = { name: "Black coffee", category: "coffee", servings: [{ label: "1 cup", ml: 240 }], nutrients: { calories: 2 }, quantity: 1 };
const estimate = (text: string) => t.api("POST", "/api/ai/estimate-items", { text });

describe("estimate several foods", () => {
  it("a breakfast description becomes one draft per food, with amounts", async () => {
    await t.api("PUT", "/api/settings/ai", aiSettings);
    aiAnswers(t, { items: [egg, toast, coffee], assumed: false });
    const r = await estimate("2 eggs, toast and coffee");
    expect(r.status).toBe(200);
    expect(r.body.items.map((i: { food: { name: string } }) => i.food.name)).toEqual(["Egg, large", "Toast", "Black coffee"]);
    expect(r.body.items[0]).toMatchObject({ servingIndex: 0, quantity: 2, food: { icon: expect.any(String), source: "ai" } });
    expect(r.body.assumed).toBe(false);
    expect(lastAiPrompt(t)).toContain("2 eggs, toast and coffee");
    expect(lastAiPrompt(t)).toMatch(/each separate food/i);
  });

  it("several foods come with a short name for them together (One meal)", async () => {
    await t.api("PUT", "/api/settings/ai", aiSettings);
    aiAnswers(t, { items: [egg, toast, coffee], mealName: "Egg and toast breakfast", assumed: false });
    const r = await estimate("2 eggs, toast and coffee");
    expect(r.status).toBe(200);
    expect(r.body.mealName).toBe("Egg and toast breakfast");
    expect(lastAiPrompt(t)).toMatch(/mealName/);
  });

  it("one food has no meal name, so there is nothing to switch between", async () => {
    await t.api("PUT", "/api/settings/ai", aiSettings);
    aiAnswers(t, { items: [toast], mealName: "Toast", assumed: false });
    const r = await estimate("a slice of toast");
    expect(r.body.mealName).toBeNull();
  });

  it("several foods without a usable meal name are named after their foods", async () => {
    await t.api("PUT", "/api/settings/ai", aiSettings);
    aiAnswers(t, { items: [egg, toast], mealName: "   ", assumed: false });
    expect((await estimate("2 eggs and toast")).body.mealName).toBe("Egg, large and Toast");
    aiAnswers(t, { items: [egg, toast, coffee], assumed: false });
    expect((await estimate("2 eggs, toast and coffee")).body.mealName).toBe("Egg, large, Toast and Black coffee");
  });

  it("asked for as lines, it says how it's going and ends with the answer or an error (the web's Describe)", async () => {
    await t.api("PUT", "/api/settings/ai", { ...aiSettings, services: [...aiSettings.services, { name: "Cloud", provider: "openrouter", apiKey: "or-key", model: "small" }] });
    t.ai.respond = (url: string) =>
      url.startsWith(HOME_AI) ? { status: 503, json: { error: { message: "loading model" } } } : { status: 200, json: { choices: [{ message: { content: JSON.stringify({ items: [egg, toast], mealName: "Eggs on toast", assumed: false }) } }] } };
    const r = await t.api("POST", "/api/ai/estimate-items", { text: "2 eggs and toast" }, { accept: "application/x-ndjson" });
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(/application\/x-ndjson/);
    expect(r.headers["x-accel-buffering"]).toBe("no");
    const lines = String(r.body).trim().split("\n").map((l) => JSON.parse(l));
    expect(lines[0]).toEqual({ progress: "another" });
    expect(lines[1]).toMatchObject({ mealName: "Eggs on toast", assumed: false, items: [{ food: { name: "Egg, large" } }, { food: { name: "Toast" } }] });
    expect(String(r.body)).not.toMatch(/Home AI|Cloud/);
    t.ai.down = true;
    const bad = await t.api("POST", "/api/ai/estimate-items", { text: "2 eggs and toast" }, { accept: "application/x-ndjson" });
    expect(String(bad.body).trim().split("\n").map((l) => JSON.parse(l)).at(-1)).toEqual({ error: "The AI couldn't estimate that. Try again, or describe it differently.", status: 502 });
  });

  it("a long serving name from the AI is shortened, and the AI is asked for short ones", async () => {
    await t.api("PUT", "/api/settings/ai", aiSettings);
    const label = "1 sandwich (2 eggs, 1 tbsp light mayo, 1 light English muffin)";
    aiAnswers(t, { items: [{ ...egg, name: "Egg and mayo English muffin", servings: [{ label, grams: 171 }], nutrients: { calories: 268, protein_g: 18 }, quantity: 1 }], assumed: false });
    const r = await estimate("2 eggs with 1 tbsp low-calorie mayo on a low-calorie English muffin");
    expect(r.status).toBe(200);
    expect(r.body.items[0].food.servings[0]).toEqual({ label: "1 sandwich (2 eggs, 1 tbsp light mayo, 1 light English…", grams: 171 });
    expect(lastAiPrompt(t)).toMatch(/serving label short/i);
  });

  it("one food works too, and a guess comes back to confirm", async () => {
    await t.api("PUT", "/api/settings/ai", aiSettings);
    aiAnswers(t, { items: [{ ...toast, name: "Cheerios" }], assumed: true, interpretedAs: "Cheerios" });
    const r = await estimate("cherios");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ items: [{ food: { name: "Cheerios" }, quantity: 1 }], assumed: true, interpretedAs: "Cheerios" });
  });

  it("the AI has no idea: 422 with the same words as one food", async () => {
    await t.api("PUT", "/api/settings/ai", aiSettings);
    aiAnswers(t, { unknown: true });
    const r = await estimate("zxqv blorp");
    expect(r.status).toBe(422);
    expect(r.body.error).toBe("Couldn't work out what that is. Try describing it differently.");
  });

  it("an answer it can't use: 502", async () => {
    await t.api("PUT", "/api/settings/ai", aiSettings);
    aiAnswers(t, { items: [{ name: "Nothing", servings: [], nutrients: {} }] });
    expect((await estimate("a sandwich")).status).toBe(502);
  });

  it("AI off: 503 as for one food", async () => {
    expect((await estimate("2 eggs and toast")).status).toBe(503);
  });

  it("too short: 400", async () => {
    await t.api("PUT", "/api/settings/ai", aiSettings);
    expect((await estimate("a")).status).toBe(400);
  });

  it("keeps at most 12 foods", async () => {
    await t.api("PUT", "/api/settings/ai", aiSettings);
    aiAnswers(t, { items: Array.from({ length: 14 }, (_, i) => ({ ...toast, name: `Food ${i}` })) });
    expect((await estimate("a big buffet plate")).body.items).toHaveLength(12);
  });
});

describe("what the AI sends is kept within what can be logged (I3 review)", () => {
  it("at most 20 servings, each at most 100,000 g or ml, so Log all never fails on them", async () => {
    await t.api("PUT", "/api/settings/ai", aiSettings);
    const servings = Array.from({ length: 25 }, (_, i) => ({ label: `size ${i}`, grams: i === 0 ? 50 : 2_000_000 }));
    aiAnswers(t, { items: [{ ...egg, servings }] });
    const r = await estimate("a giant egg");
    expect(r.status).toBe(200);
    const s = r.body.items[0].food.servings;
    expect(s).toHaveLength(20);
    expect(s[0]).toEqual({ label: "size 0", grams: 50 });
    expect(s[1]).toEqual({ label: "size 1" }); // an impossible weight is dropped, the serving kept
    const logged = await t.api("POST", "/api/log/estimates", { day: "2026-11-19", meal: "lunch", items: [{ ...r.body.items[0].food, servingIndex: 0, quantity: 1 }] });
    expect(logged.status).toBe(200);
  });
});
