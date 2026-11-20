import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";
import { aiAnswers, aiSettings } from "./foodFakes.js";
import { plainPhoto, photoUpload } from "./photoFakes.js";

// A photo of a plate of food (iOS design §6.7 change 5): the photo AI lists the foods on it, as drafts with
// an amount each, for the person to adjust before logging. Nothing is saved but the photo.
let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
beforeEach(async () => {
  await t.reset();
  await t.login();
});
afterAll(async () => t.close());

const photoAi = { ...aiSettings, services: [{ ...aiSettings.services[0], photos: true }] };
const plate = {
  items: [
    { name: "Grilled chicken breast", category: "poultry", servings: [{ label: "1 breast", grams: 170 }], nutrients: { calories: 280, protein_g: 53, fat_g: 6 }, quantity: 1 },
    { name: "Steamed broccoli", category: "vegetables", servings: [{ label: "1 cup", grams: 90 }], nutrients: { calories: 30, protein_g: 2.5, fiber_g: 2.4 }, quantity: 1.5 },
  ],
};

async function analyzePlate() {
  const { payload, headers } = photoUpload([await plainPhoto(800, 600)], "plate");
  return t.api("POST", "/api/photos/analyze", payload, headers);
}

describe("plate photos", () => {
  it("lists the foods on the plate with how much of each", async () => {
    await t.api("PUT", "/api/settings/ai", photoAi);
    aiAnswers(t, plate);
    const r = await analyzePlate();
    expect(r.status).toBe(200);
    expect(r.body.photoIds).toHaveLength(1);
    expect(r.body.labelReading).toBe(true);
    expect(r.body.plate.items).toHaveLength(2);
    expect(r.body.plate.items[0]).toMatchObject({
      servingIndex: 0,
      quantity: 1,
      food: { name: "Grilled chicken breast", icon: expect.any(String), servings: [{ label: "1 breast", grams: 170 }], nutrients: { calories: 280, protein_g: 53, fat_g: 6 } },
    });
    expect(r.body.plate.items[1].quantity).toBe(1.5);
    expect(t.ai.calls).toHaveLength(1);
    expect(JSON.stringify(t.ai.calls[0].body)).toMatch(/foods on (this|the) plate/i);
    expect(JSON.stringify(t.ai.calls[0].body)).toMatch(/data:image\/jpeg;base64,/);
  });

  it("a missing amount is one serving", async () => {
    await t.api("PUT", "/api/settings/ai", photoAi);
    aiAnswers(t, { items: [{ ...plate.items[0], quantity: undefined }] });
    expect((await analyzePlate()).body.plate.items[0].quantity).toBe(1);
  });

  it("an answer it can't use: no items and a plain message", async () => {
    await t.api("PUT", "/api/settings/ai", photoAi);
    aiAnswers(t, { items: [{ name: "Mystery", servings: [], nutrients: {} }] });
    const r = await analyzePlate();
    expect(r.status).toBe(200);
    expect(r.body.plate.items).toEqual([]);
    expect(r.body.errors).toContainEqual({ source: "ai", message: "Couldn't make out the food in that photo" });
  });

  it("keeps at most 12 foods", async () => {
    await t.api("PUT", "/api/settings/ai", photoAi);
    aiAnswers(t, { items: Array.from({ length: 15 }, (_, i) => ({ ...plate.items[0], name: `Food ${i}` })) });
    expect((await analyzePlate()).body.plate.items).toHaveLength(12);
  });

  it("no photo AI: nothing asked, no plate", async () => {
    const r = await analyzePlate();
    expect(r.status).toBe(200);
    expect(r.body.labelReading).toBe(false);
    expect(r.body.plate).toBeUndefined();
    expect(t.ai.calls).toHaveLength(0);
  });
});
