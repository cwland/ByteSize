import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";
import { aiAnswers, aiSettings, lastAiPrompt } from "./foodFakes.js";

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
