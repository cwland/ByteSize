import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { setupTestApp, type TestApp } from "./helpers.js";
import { OFF_PRODUCT, offProduct, USDA, usdaFood } from "./foodFakes.js";

// A scanned barcode asks every source (2026-11-22 design): the sources disagreeing gives a short list to pick
// from; a pick is remembered for that barcode, for that person.

let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
beforeEach(async () => {
  await t.reset();
  await t.login(); // admin "alex"
  await t.api("PUT", "/api/admin/food-sources", { usdaApiKey: "usda-key" });
});
afterAll(async () => t.close());

const CODE = "0018400312944";
const barcode = (code = CODE) => t.api("GET", `/api/foods/barcode/${code}`);

/** Open Food Facts and USDA each know these products for the barcode (null: not found there). */
function sources(
  off: ReturnType<typeof offProduct> | null,
  usda: ReturnType<typeof usdaFood> | null,
) {
  t.foodWeb.respond = (url) => {
    if (url.startsWith(OFF_PRODUCT))
      return off
        ? { status: 200, json: { code: CODE, status: 1, product: off } }
        : { status: 404, json: { status: 0 } };
    if (url.startsWith(USDA))
      return { status: 200, json: { foods: usda ? [usda] : [] } };
    return { status: 404, json: {} };
  };
}
// Cory's scan: Open Food Facts files the code under a bare brand name, per 100 g only; USDA has the real product
const offVague = offProduct(CODE, "Hills bros", 417, {
  brands: "Hills Bros.",
  serving_size: undefined,
  serving_quantity: undefined,
});
const usdaReal = usdaFood(
  901,
  "HILLS BROS, CAPPUCCINO, FRENCH VANILLA",
  433,
  "018400312944",
);

describe("a barcode asks every source", () => {
  it("they disagree: a short list, the more complete entry first, and food is that first one", async () => {
    sources(offVague, usdaReal);
    const r = await barcode();
    expect(r.status).toBe(200);
    expect(r.body.choices.map((c: any) => [c.source, c.name])).toEqual([
      ["usda", "HILLS BROS, CAPPUCCINO, FRENCH VANILLA"],
      ["off", "Hills bros"],
    ]);
    expect(r.body.food).toMatchObject({
      source: "usda",
      name: "HILLS BROS, CAPPUCCINO, FRENCH VANILLA",
    });
    expect(
      t.foodWeb.calls
        .map((c) => (c.url.startsWith(USDA) ? "usda" : "off"))
        .sort(),
    ).toEqual(["off", "usda"]);
  });

  it("they agree (the same product in both): no list, just the food", async () => {
    sources(
      offProduct(CODE, "Greek yogurt", 59, { brands: "Farm Co" }),
      usdaFood(77, "GREEK YOGURT, PLAIN", 61, "018400312944"),
    );
    const r = await barcode();
    expect(r.body.choices).toEqual([]);
    expect(r.body.food).toBeTruthy();
  });

  it("only one source knows it: that food, no list", async () => {
    sources(null, usdaReal);
    const r = await barcode();
    expect(r.body.choices).toEqual([]);
    expect(r.body.food).toMatchObject({ source: "usda" });
  });

  it("each source's fresh kept copy is used instead of asking it again", async () => {
    sources(offVague, usdaReal);
    await barcode();
    const before = t.foodWeb.calls.length;
    const again = await barcode();
    expect(t.foodWeb.calls.length).toBe(before);
    expect(again.body.choices).toHaveLength(2);
  });

  it("a source that fails is listed in errors; the others still answer", async () => {
    t.foodWeb.respond = (url) =>
      url.startsWith(OFF_PRODUCT)
        ? { status: 500, json: {} }
        : { status: 200, json: { foods: [usdaReal] } };
    const r = await barcode();
    expect(r.body.food).toMatchObject({ source: "usda" });
    expect(r.body.errors).toEqual([
      { source: "off", message: expect.stringMatching(/Open Food Facts/) },
    ]);
  });

  it("my own food with the barcode still wins outright, without asking anyone", async () => {
    await t.api("POST", "/api/my-foods", {
      name: "My cappuccino",
      barcode: CODE,
      servings: [{ label: "1 packet", grams: 28 }],
      nutrients: { calories: 120 },
    });
    sources(offVague, usdaReal);
    const r = await barcode();
    expect(r.body.food).toMatchObject({
      kind: "user_food",
      name: "My cappuccino",
    });
    expect(r.body.choices).toEqual([]);
    expect(t.foodWeb.calls).toHaveLength(0);
  });
});

describe("picking one", () => {
  it("is remembered for that barcode: the next scan opens it straight away", async () => {
    sources(offVague, usdaReal);
    const first = await barcode();
    const off = first.body.choices.find((c: any) => c.source === "off");
    expect(
      (await t.api("POST", `/api/foods/barcode/${CODE}/pick`, { id: off.id }))
        .status,
    ).toBe(204);
    const again = await barcode("018400312944"); // any spelling of the code
    expect(again.body.food).toMatchObject({ id: off.id, source: "off" });
    expect(again.body.choices).toEqual([]);
  });

  it("is per person", async () => {
    sources(offVague, usdaReal);
    const first = await barcode();
    await t.api("POST", `/api/foods/barcode/${CODE}/pick`, {
      id: first.body.choices[1].id,
    });
    const sam = await t.createUser("sam");
    const theirs = await t.api("GET", `/api/foods/barcode/${CODE}`, undefined, {
      authorization: `Bearer ${sam.token}`,
    });
    expect(theirs.body.choices).toHaveLength(2);
  });

  it("only a kept food with that barcode can be picked", async () => {
    sources(offVague, usdaReal);
    const first = await barcode();
    const other = await t.db.execute<{ id: number }>(
      sql`insert into food_cache (source, source_id, barcode, name, servings, nutrients) values ('off', 'x1', '4006381333931', 'Other', '[]', '{}') returning id`,
    );
    expect(
      (
        await t.api("POST", `/api/foods/barcode/${CODE}/pick`, {
          id: other.rows[0].id,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await t.api("POST", `/api/foods/barcode/12ab/pick`, {
          id: first.body.food.id,
        })
      ).status,
    ).toBe(400);
  });
});
