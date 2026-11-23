import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";
import { foodCache } from "../src/db/schema.js";
import { startingAmount, withMeasures } from "../src/lib/measures.js";
import { amountFactor } from "../src/lib/nutrients.js";

// L1 (SPEC-01): a food offers the units people count in — 1 prune from "5 prunes", 1 slice from "4 slices (56g)",
// small / medium / large — added after its own servings so every stored servingIndex keeps its meaning.
describe("withMeasures", () => {
  it("a counted serving gives one of the thing, by weight", () => {
    expect(withMeasures([{ label: "5 prunes", grams: 40 }], "Prunes, dried")).toEqual([
      { label: "5 prunes", grams: 40 },
      { label: "1 prune", grams: 8, derived: true },
    ]);
    expect(withMeasures([{ label: "4 slices (56g)", grams: 56 }], "Bread")[1]).toEqual({ label: "1 slice", grams: 14, derived: true });
  });

  it("with no weight, one of the thing is a share of the serving", () => {
    expect(withMeasures([{ label: "12 crackers" }], "Crackers")[1]).toEqual({ label: "1 cracker", per: 1 / 12, derived: true });
  });

  it("a later serving counts too, as a share of the first", () => {
    const out = withMeasures([{ label: "1 package (80g)", grams: 80 }, { label: "10 chips", grams: 20 }], "Chips");
    expect(out[2]).toEqual({ label: "1 chip", grams: 2, derived: true });
  });

  it("measuring words aren't things to count", () => {
    expect(withMeasures([{ label: "1 cup (240 g)", grams: 240 }], "Milk")).toEqual([{ label: "1 cup (240 g)", grams: 240 }]);
    expect(withMeasures([{ label: "2 servings", grams: 60 }], "Mix")).toEqual([{ label: "2 servings", grams: 60 }]);
    expect(withMeasures([{ label: "3 oz", grams: 85 }], "Steak")).toEqual([{ label: "3 oz", grams: 85 }]);
  });

  it("plurals become one", () => {
    expect(withMeasures([{ label: "10 berries", grams: 50 }], "Strawberries")[1].label).toBe("1 berry");
    expect(withMeasures([{ label: "6 pieces", grams: 30 }], "Candy")[1].label).toBe("1 piece");
    expect(withMeasures([{ label: "8 wings", grams: 240 }], "Chicken wings")[1].label).toBe("1 wing");
  });

  it("whole produce gets small, medium and large", () => {
    const out = withMeasures([{ label: "1 cup slices", grams: 110 }], "Apple, raw");
    expect(out.slice(1)).toEqual([
      { label: "1 small", grams: 149, derived: true },
      { label: "1 medium", grams: 182, derived: true },
      { label: "1 large", grams: 223, derived: true },
    ]);
  });

  it("sizes the source already has are kept, not doubled", () => {
    const own = [{ label: "1 medium (182g)", grams: 182 }];
    expect(withMeasures(own, "Apples")).toEqual(own);
  });

  it("no sizes without a weight to scale by", () => {
    expect(withMeasures([{ label: "1 apple" }], "Apple")).toEqual([{ label: "1 apple" }]);
  });

  it("never changes or moves a food's own servings", () => {
    const own = [{ label: "5 prunes", grams: 40 }, { label: "100 g", grams: 100 }, { label: "1 cup", grams: 174 }];
    const out = withMeasures(own, "Prunes");
    expect(out.slice(0, 3)).toEqual(own);
    expect(out.length).toBeGreaterThan(3);
  });

  it("an already-derived list isn't derived again", () => {
    const once = withMeasures([{ label: "5 prunes", grams: 40 }], "Prunes");
    expect(withMeasures(once, "Prunes")).toEqual(once);
  });
});

describe("amountFactor with per", () => {
  it("a serving with no weight is measured by its share", () => {
    expect(amountFactor([{ label: "12 crackers" }, { label: "1 cracker", per: 1 / 12 }], 1, "serving", 6)).toBeCloseTo(0.5, 10);
  });
});

describe("in the API", () => {
  let t: TestApp;
  beforeAll(async () => (t = await setupTestApp()));
  beforeEach(async () => {
    await t.reset();
    await t.login();
  });
  afterAll(async () => t.close());

  const prunes = async () =>
    (await t.db.insert(foodCache).values({ source: "usda", sourceId: "prunes-1", name: "Prunes, dried", servings: [{ label: "5 prunes", grams: 40 }], nutrients: { calories: 150, fiber_g: 3 } }).returning())[0];

  it("a looked-up food offers its counted unit", async () => {
    const row = await prunes();
    const r = await t.api("GET", `/api/foods/cache/${row.id}`);
    expect(r.status).toBe(200);
    expect(r.body.food.servings).toEqual([{ label: "5 prunes", grams: 40 }, { label: "1 prune", grams: 8, derived: true }]);
  });

  it("6 prunes logs 1.2 times the 5-prune serving", async () => {
    const row = await prunes();
    const r = await t.api("POST", "/api/log", { day: "2026-11-19", meal: "snacks", food: { kind: "cache", id: row.id }, servingIndex: 1, unit: "serving", quantity: 6, fraction: 1 });
    expect(r.status).toBe(200);
    expect(r.body.entry.nutrients.calories).toBeCloseTo(180, 6);
    expect(r.body.entry.nutrients.fiber_g).toBeCloseTo(3.6, 6);
    expect(r.body.entry.servings[1]).toMatchObject({ label: "1 prune" }); // the entry keeps its units
  });

  it("saving a food never keeps a derived unit", async () => {
    const r = await t.api("POST", "/api/my-foods", {
      name: "Trail crackers",
      servings: [{ label: "12 crackers" }, { label: "1 cracker", per: 1 / 12, derived: true }],
      nutrients: { calories: 120 },
    });
    expect(r.status).toBe(200);
    const saved = (await t.api("GET", `/api/my-foods/${r.body.food.id}`)).body.food;
    expect(saved.servings.filter((s: { label: string }) => s.label === "1 cracker")).toHaveLength(1); // derived again on read, not stored twice
    expect(saved.servings[0]).toEqual({ label: "12 crackers" });
  });
});

// A food opens at its package serving, written its own way: "2 | Tbsp", "15 | g", "1 | slice" — never "1 × 100 g".
describe("spoon units", () => {
  it("a spoon serving by weight gives one spoon of it", () => {
    expect(withMeasures([{ label: "100 g", grams: 100 }, { label: "2 Tbsp", grams: 12 }], "Cappuccino mix")[2]).toEqual({ label: "1 tbsp", grams: 6, derived: true });
    expect(withMeasures([{ label: "2 tbsp (32g)", grams: 32 }], "Peanut butter")[1]).toEqual({ label: "1 tbsp", grams: 16, derived: true });
    expect(withMeasures([{ label: "2.5 tbsp", grams: 15 }], "Mix")[1]).toEqual({ label: "1 tbsp", grams: 6, derived: true });
    expect(withMeasures([{ label: "2½ tablespoons (15 g)", grams: 15 }], "Mix")[1]).toEqual({ label: "1 tbsp", grams: 6, derived: true });
    expect(withMeasures([{ label: "1/2 cup (40g)", grams: 40 }], "Oats")[1]).toEqual({ label: "1 cup", grams: 80, derived: true });
    expect(withMeasures([{ label: "1 tsp", grams: 4 }, { label: "3 tsp", grams: 12 }], "Sugar")).toHaveLength(2); // "1 tsp" already is one
  });

  it("a spoon serving with no weight gives one spoon as a share of it (FatSecret's 2.5 tbsp)", () => {
    const s = withMeasures([{ label: "2.5 tbsp" }], "Cappuccino mix");
    expect(s[1]).toEqual({ label: "1 tbsp", per: 0.4, derived: true });
    expect(startingAmount(s)).toEqual({ servingIndex: 1, unit: "serving", quantity: 2.5 });
  });

  it("a spoon serving by volume needs no spoon unit (the wheel has tbsp already)", () => {
    expect(withMeasures([{ label: "2 tbsp (30 ml)", ml: 30 }], "Syrup")).toHaveLength(1);
  });
});

describe("startingAmount", () => {
  const bread = [{ label: "100 g", grams: 100 }, { label: "1 SLICE (30 g)", grams: 30 }];
  it("starts at the package serving, not 100 g", () => {
    expect(startingAmount(withMeasures(bread, "Bread"))).toEqual({ servingIndex: 1, unit: "serving", quantity: 1 });
  });

  it("a spoon serving starts at that many spoons", () => {
    const s = withMeasures([{ label: "100 g", grams: 100 }, { label: "2 Tbsp", grams: 12 }], "Mix");
    expect(startingAmount(s)).toEqual({ servingIndex: 2, unit: "serving", quantity: 2 });
    expect(startingAmount(withMeasures([{ label: "2½ tbsp", grams: 15 }], "Mix"))).toEqual({ servingIndex: 1, unit: "serving", quantity: 2.5 });
    expect(startingAmount([{ label: "100 ml", ml: 100 }, { label: "2 tbsp (30 ml)", ml: 30 }])).toEqual({ servingIndex: 0, unit: "tbsp", quantity: 2 });
  });

  it("a bare weight or volume starts in that unit", () => {
    expect(startingAmount([{ label: "100 g", grams: 100 }, { label: "15 g", grams: 15 }])).toEqual({ servingIndex: 0, unit: "g", quantity: 15 });
    expect(startingAmount([{ label: "100 ml", ml: 100 }, { label: "240 ml", ml: 240 }])).toEqual({ servingIndex: 0, unit: "ml", quantity: 240 });
    expect(startingAmount([{ label: "100 g", grams: 100 }])).toEqual({ servingIndex: 0, unit: "g", quantity: 100 });
  });

  it("a counted serving starts at its count", () => {
    expect(startingAmount(withMeasures([{ label: "4 slices (56g)", grams: 56 }], "Bread"))).toEqual({ servingIndex: 1, unit: "serving", quantity: 4 });
    expect(startingAmount([{ label: "1 bar", grams: 40 }])).toEqual({ servingIndex: 0, unit: "serving", quantity: 1 });
  });

  it("a weighing base after the serving isn't the package serving (a recipe: 1 serving, not 100 g)", () => {
    expect(startingAmount([{ label: "1 serving (320 g)", grams: 320 }, { label: "100 g", grams: 100 }])).toEqual({ servingIndex: 0, unit: "serving", quantity: 1 });
  });

  it("a server-derived unit is never the start on its own", () => {
    expect(startingAmount(withMeasures([{ label: "1 medium", grams: 118 }], "Banana"))).toEqual({ servingIndex: 0, unit: "serving", quantity: 1 });
  });
});

describe("start sent with a food", () => {
  let t2: TestApp;
  beforeAll(async () => { t2 = await setupTestApp(); });
  afterAll(async () => { await t2.close(); });
  beforeEach(async () => {
    await t2.reset();
    await t2.login();
  });

  it("a looked-up food says where its amount starts", async () => {
    const row = (await t2.db.insert(foodCache).values({ source: "off", sourceId: "bread-1", name: "Wheat bread", servings: [{ label: "100 g", grams: 100 }, { label: "1 SLICE (30 g)", grams: 30 }], nutrients: { calories: 250 } }).returning())[0];
    const r = await t2.api("GET", `/api/foods/cache/${row.id}`);
    expect(r.body.food.start).toEqual({ servingIndex: 1, unit: "serving", quantity: 1 });
  });
});
