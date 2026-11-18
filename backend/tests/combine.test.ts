import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";
import { offKnows, offProduct } from "./foodFakes.js";
import { logEntries } from "../src/db/schema.js";

// §28: adding the same food twice to a day and meal grows the entry already there (done here, in the
// log routes, so every way of adding follows it), and says so, with what Undo needs to split it back.
let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
beforeEach(async () => {
  await t.reset();
  await t.login(); // admin "cory", America/Boise
  t.clock.date = new Date("2026-11-17T19:00:00Z"); // noon in Boise
});
afterAll(async () => t.close());

const DAY = "2026-11-17";
const eggWhite = { name: "Egg white", servings: [{ label: "100 g", grams: 100 }, { label: "1 large", grams: 33 }], nutrients: { calories: 52, protein_g: 11 } }; // fiber unknown
const egg = { name: "Egg", servings: [{ label: "1 large", grams: 50 }], nutrients: { calories: 70, protein_g: 6, fat_g: 5 } };
const toast = { name: "Toast", servings: [{ label: "1 slice", grams: 30 }], nutrients: { calories: 80, protein_g: 3, fiber_g: 2 } };
const juice = { name: "Orange juice", servings: [{ label: "1 cup", ml: 240 }], nutrients: { calories: 110 } }; // known by volume only
const mine = async (f: object) => (await t.api("POST", "/api/my-foods", f)).body.food;
const portion = (p: Record<string, unknown> = {}) => ({ servingIndex: 0, unit: "serving", quantity: 1, fraction: 1, ...p });
const log = (food: { kind: string; id: number }, p: Record<string, unknown> = {}, meal = "breakfast", day = DAY) =>
  t.api("POST", "/api/log", { day, meal, food: { kind: food.kind, id: food.id }, ...portion(p) });
const getDay = async (day = DAY) => (await t.api("GET", `/api/day/${day}`)).body;
// Undo of a combine: the server splits back what it recorded when combining (nothing is sent but which one)
const undo = (c: { id: number }) => t.api("POST", `/api/log/combines/${c.id}/undo`);

describe("adding the same food again combines it", () => {
  it("100 g + 100 g → 200 g: the entry grows, nutrients follow, unknown stays unknown, and the answer says so", async () => {
    const food = await mine(eggWhite);
    const first = (await log(food, { unit: "g", quantity: 100 })).body.entry;
    const again = await log(food, { unit: "g", quantity: 100 });
    expect(again.status).toBe(200);
    expect(again.body.entry).toMatchObject({ id: first.id, unit: "g", quantity: 200, fraction: 1, nutrients: { calories: 104, protein_g: 22 } });
    expect(again.body.entry.nutrients).not.toHaveProperty("fiber_g");
    expect(again.body.combined).toEqual({
      id: expect.any(Number),
      entry: again.body.entry,
      before: { servingIndex: 0, unit: "g", quantity: 100, fraction: 1 },
      added: { servingIndex: 0, unit: "g", quantity: 100, fraction: 1 },
      splitTo: { day: DAY, meal: "breakfast" },
    });
    expect((await getDay()).entries).toEqual([again.body.entry]);
  });

  it("1 large + 1 large → 2 large; a half adds as a half", async () => {
    const food = await mine(egg);
    await log(food);
    const two = (await log(food)).body.entry;
    expect(two).toMatchObject({ unit: "serving", servingIndex: 0, quantity: 2, fraction: 1, nutrients: { calories: 140 } });
    const more = (await log(food, { fraction: 0.5 })).body.entry;
    expect(more).toMatchObject({ quantity: 2.5, fraction: 1, nutrients: { calories: 175 } });
  });

  it("different units combine through grams, shown in the existing entry's unit", async () => {
    const food = await mine(eggWhite);
    await log(food, { unit: "g", quantity: 100 });
    const r = await log(food, { servingIndex: 1, quantity: 1 }); // 1 large = 33 g
    expect(r.body.entry).toMatchObject({ unit: "g", quantity: 133, nutrients: { calories: 69 } });
    expect(r.body.combined.added).toEqual({ servingIndex: 1, unit: "serving", quantity: 1, fraction: 1 });
    // and the other way round: grams into an entry counted in eggs
    const lunch = (await log(food, { servingIndex: 1, quantity: 2 }, "lunch")).body.entry;
    const more = (await log(food, { unit: "g", quantity: 33 }, "lunch")).body;
    expect(more.entry).toMatchObject({ id: lunch.id, unit: "serving", servingIndex: 1, quantity: 3 });
    // ounces too
    const oz = (await log(food, { unit: "oz", quantity: 1 }, "lunch")).body.entry;
    expect(oz.quantity).toBeCloseTo(3 + 28.349523125 / 33, 3);
  });

  it("volumes combine through millilitres; a weight and a volume that can't meet stay separate", async () => {
    const oj = await mine(juice);
    await log(oj, { unit: "ml", quantity: 240 });
    expect((await log(oj, { unit: "cup", quantity: 1 })).body.entry).toMatchObject({ unit: "ml", quantity: expect.closeTo(476.6, 1) });
    const both = await mine({ name: "Milk", servings: [{ label: "1 cup", grams: 245 }, { label: "1 glass", ml: 250 }], nutrients: { calories: 150 } });
    const grams = (await log(both, { unit: "g", quantity: 100 }, "dinner")).body.entry;
    const glass = await log(both, { servingIndex: 1, quantity: 1 }, "dinner"); // the glass has no grams
    expect(glass.body.combined).toBeUndefined();
    expect(glass.body.entry.id).not.toBe(grams.id);
    expect((await getDay()).entries.filter((e: any) => e.meal === "dinner")).toHaveLength(2);
  });

  it("another meal, another day or another food stays its own entry; water never combines", async () => {
    const food = await mine(egg);
    const other = await mine(toast);
    await log(food);
    for (const r of [await log(food, {}, "lunch"), await log(food, {}, "breakfast", "2026-11-18"), await log(other)]) expect(r.body.combined).toBeUndefined();
    for (let i = 0; i < 2; i++) expect((await t.api("POST", "/api/log", { day: DAY, meal: "supplements", water_ml: 250 })).body.combined).toBeUndefined();
    expect((await getDay()).entries).toHaveLength(5);
  });

  it("entries already duplicated stay as they are; the newest addition grows the first of them", async () => {
    const food = await mine(egg);
    const me = (await t.api("GET", "/api/auth/me")).body.user;
    const row = { userId: me.id, day: DAY, meal: "breakfast", name: "Egg", icon: "🥚", source: "user_food", sourceRef: `user_food:${food.id}`, unit: "serving", quantity: 1, perServing: egg.nutrients, servings: egg.servings, nutrients: egg.nutrients };
    await t.db.insert(logEntries).values([row, row]);
    const r = await log(food);
    const entries = (await getDay()).entries;
    expect(entries.map((e: any) => e.quantity)).toEqual([2, 1]);
    expect(r.body.entry.id).toBe(entries[0].id);
  });

  it("foods without a reference combine by the same name and the same nutrients per unit", async () => {
    const me = (await t.api("GET", "/api/auth/me")).body.user;
    const row = (nutrients: object) => ({ userId: me.id, day: DAY, meal: "lunch", name: "Soup", icon: "🍲", source: "user_food", sourceRef: null, unit: "serving", quantity: 1, perServing: nutrients, servings: [{ label: "1 bowl", grams: 300 }], nutrients });
    const [a] = await t.db.insert(logEntries).values(row({ calories: 200 })).returning();
    await t.db.insert(logEntries).values(row({ calories: 250 })); // a different soup by its numbers
    const [c] = await t.db.insert(logEntries).values({ ...row({ calories: 200 }), meal: "dinner" }).returning();
    const moved = (await t.api("POST", "/api/log/move", { ids: [c.id], day: DAY, meal: "lunch" })).body;
    expect(moved.combined).toEqual([expect.objectContaining({ entry: expect.objectContaining({ id: a.id, quantity: 2, nutrients: { calories: 400 } }) })]);
  });

  it("a quick meal adds each of its items this way", async () => {
    const e = await mine(egg);
    const tst = await mine(toast);
    const quick = (await t.api("POST", "/api/my-foods/meals", { name: "Eggs on toast", items: [{ food: { kind: "user_food", id: e.id }, ...portion({ quantity: 2 }) }, { food: { kind: "user_food", id: tst.id }, ...portion() }] })).body.food;
    const already = (await log(e)).body.entry;
    const r = await t.api("POST", "/api/log/meal", { day: DAY, meal: "breakfast", foodId: quick.id });
    expect(r.status).toBe(200);
    expect(r.body.combined).toEqual([expect.objectContaining({ entry: expect.objectContaining({ id: already.id, quantity: 3 }), before: portion(), added: portion({ quantity: 2 }) })]);
    expect(r.body.entries.map((x: any) => x.name)).toEqual(["Egg", "Toast"]);
    expect((await getDay()).entries.map((x: any) => [x.name, x.quantity])).toEqual([
      ["Egg", 3],
      ["Toast", 1],
    ]);
  });

  it("moving or copying into a meal that already has the food combines; Undo puts it back where it was", async () => {
    const food = await mine(egg);
    const breakfast = (await log(food)).body.entry;
    const lunch = (await log(food, { quantity: 2 }, "lunch")).body.entry;
    const moved = await t.api("POST", "/api/log/move", { ids: [lunch.id], day: DAY, meal: "breakfast", copy: false });
    expect(moved.status).toBe(200);
    expect(moved.body.combined).toEqual([
      { id: expect.any(Number), entry: expect.objectContaining({ id: breakfast.id, quantity: 3 }), before: portion(), added: portion({ quantity: 2 }), splitTo: { day: DAY, meal: "lunch" } },
    ]);
    expect((await getDay()).entries.map((e: any) => [e.meal, e.quantity])).toEqual([["breakfast", 3]]);
    // Undo: split it back
    const undone = await undo(moved.body.combined[0]);
    expect(undone.status).toBe(200);
    expect((await getDay()).entries.map((e: any) => [e.meal, e.quantity, e.nutrients.calories])).toEqual([
      ["breakfast", 1, 70],
      ["lunch", 2, 140],
    ]);
    // a copy combines too, and a move within the same meal changes nothing
    const copied = await t.api("POST", "/api/log/move", { ids: [breakfast.id], day: DAY, meal: "lunch", copy: true });
    expect(copied.body.combined).toHaveLength(1);
    expect((await getDay()).entries.map((e: any) => [e.meal, e.quantity])).toEqual([
      ["breakfast", 1],
      ["lunch", 3],
    ]);
    const lunchNow = (await getDay()).entries.find((e: any) => e.meal === "lunch");
    expect((await t.api("POST", "/api/log/move", { ids: [lunchNow.id], day: DAY, meal: "lunch" })).body.combined).toEqual([]);
  });

  it("Undo only splits while the entry is still what the combine made: twice, or after an edit, is a 409 and changes nothing", async () => {
    const food = await mine(egg);
    await log(food);
    const { combined } = (await log(food)).body;
    expect((await undo(combined)).status).toBe(200);
    const again = await undo(combined); // a double tap, or a retry
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("This entry changed since — undo isn't possible");
    expect((await getDay()).entries.map((e: any) => e.quantity)).toEqual([1, 1]);

    // combined again, then edited before Undo: the edit stands
    const [first, second] = (await getDay()).entries;
    expect((await t.api("DELETE", `/api/log/${second.id}`)).status).toBe(204);
    const next = (await log(food)).body.combined;
    expect(next.entry.id).toBe(first.id);
    expect((await t.api("PATCH", `/api/log/${first.id}`, { quantity: 5 })).status).toBe(200);
    const late = await undo(next);
    expect(late.status).toBe(409);
    expect((await getDay()).entries.map((e: any) => e.quantity)).toEqual([5]);
    // combined again, then the entry deleted: a 409 too
    const last = (await log(food)).body.combined;
    expect((await t.api("DELETE", `/api/log/${first.id}`)).status).toBe(204);
    expect((await undo(last)).status).toBe(409);
  });

  it("a quick meal holding the same food twice: each item adds once, and an entry is listed once", async () => {
    const e = await mine(egg);
    const quick = (await t.api("POST", "/api/my-foods/meals", { name: "Two eggs", items: [{ food: { kind: "user_food", id: e.id }, ...portion() }, { food: { kind: "user_food", id: e.id }, ...portion({ quantity: 2 }) }] })).body.food;
    // Nothing there yet: two new entries, as the meal has them (not combined with each other)
    const fresh = (await t.api("POST", "/api/log/meal", { day: DAY, meal: "lunch", foodId: quick.id })).body;
    expect(fresh.combined).toEqual([]);
    expect(fresh.entries.map((x: any) => x.quantity)).toEqual([1, 2]);
    expect(new Set(fresh.entries.map((x: any) => x.id)).size).toBe(2);
    // An egg already there: both items grow it, and it is listed once, at its final amount
    const already = (await log(e)).body.entry;
    const r = (await t.api("POST", "/api/log/meal", { day: DAY, meal: "breakfast", foodId: quick.id })).body;
    expect(r.entries).toEqual([expect.objectContaining({ id: already.id, quantity: 4 })]);
    expect(r.combined.map((c: any) => [c.entry.id, c.before.quantity, c.added.quantity])).toEqual([
      [already.id, 1, 1],
      [already.id, 2, 2],
    ]);
    // Undo, last first, puts it back exactly
    for (const c of [...r.combined].reverse()) expect((await undo(c)).status).toBe(200);
    expect((await getDay()).entries.filter((x: any) => x.meal === "breakfast").map((x: any) => x.quantity)).toEqual([1, 2, 1]); // the egg, then the two split back off (last first)
  });

  it("Undo after logging splits the addition back off as its own entry", async () => {
    const food = await mine(eggWhite);
    await log(food, { unit: "g", quantity: 100 });
    const { combined } = (await log(food, { servingIndex: 1, quantity: 1 })).body;
    const r = await undo(combined);
    expect(r.body.entries).toEqual([
      expect.objectContaining({ id: combined.entry.id, unit: "g", quantity: 100, nutrients: { calories: 52, protein_g: 11 } }),
      expect.objectContaining({ unit: "serving", servingIndex: 1, quantity: 1, meal: "breakfast", name: "Egg white", sourceRef: `user_food:${food.id}` }),
    ]);
    expect((await getDay()).entries).toHaveLength(2);
    // only your own combines
    expect((await undo({ id: 99999 })).status).toBe(404);
    const other = await t.createUser("ann");
    t.setToken(other.token);
    expect((await undo(combined)).status).toBe(404);
  });

  it("Undo splits off what the combine recorded, even after the food's servings changed", async () => {
    // Logged when the food had only "100 g"; then "1 large" was added to it (the same numbers per 100 g)
    const food = await mine({ ...eggWhite, servings: [{ label: "100 g", grams: 100 }] });
    await log(food, { quantity: 1 }); // 1 × 100 g
    expect((await t.api("PATCH", `/api/my-foods/${food.id}`, eggWhite)).status).toBe(200);
    const { combined } = (await log(food, { servingIndex: 1, quantity: 1 })).body; // 1 large (33 g)
    expect(combined.entry).toMatchObject({ unit: "serving", servingIndex: 0, quantity: 1.33 });
    // The entry's own servings have no "1 large": the split must use the servings that were added
    const r = await undo(combined);
    expect(r.status).toBe(200);
    expect(r.body.entries).toEqual([
      expect.objectContaining({ id: combined.entry.id, unit: "serving", servingIndex: 0, quantity: 1, nutrients: { calories: 52, protein_g: 11 } }),
      expect.objectContaining({ unit: "serving", servingIndex: 1, quantity: 1, servings: eggWhite.servings, nutrients: { calories: 17, protein_g: 3.6 } }),
    ]);
  });

  it("a food changed since it was logged stays its own entry (nothing is computed from numbers it no longer has)", async () => {
    const food = await mine(egg);
    await log(food);
    expect((await t.api("PATCH", `/api/my-foods/${food.id}`, { ...egg, nutrients: { calories: 80 } })).status).toBe(200);
    const r = await log(food);
    expect(r.body.combined).toBeUndefined();
    expect((await getDay()).entries.map((e: any) => e.nutrients.calories)).toEqual([70, 80]);
  });

  it("a food from the database combines too (the same reference)", async () => {
    offKnows(t, { "0012345678905": offProduct("0012345678905", "Crunchy bar", 400) });
    const bar = (await t.api("GET", "/api/foods/barcode/0012345678905")).body.food;
    await log(bar, { servingIndex: 1 });
    expect((await log(bar, { servingIndex: 1 })).body.entry).toMatchObject({ quantity: 2, nutrients: { calories: 320 } });
  });
});

describe("combining when requests race", () => {
  it("adds of the same food racing into a meal never leave two rows", async () => {
    const food = await mine(egg);
    for (let round = 0; round < 5; round++) {
      const meal = ["breakfast", "lunch", "dinner", "snacks", "breakfast"][round];
      const day = round === 4 ? "2026-11-18" : DAY;
      const all = await Promise.all(Array.from({ length: 6 }, () => log(food, {}, meal, day)));
      expect(all.map((r) => r.status)).toEqual([200, 200, 200, 200, 200, 200]);
      const here = (await getDay(day)).entries.filter((e: any) => e.meal === meal);
      expect(here.map((e: any) => e.quantity)).toEqual([6]);
      // every add but the first says it combined, each from the amount before it
      expect(all.filter((r) => r.body.combined).map((r) => r.body.combined.before.quantity).sort()).toEqual([1, 2, 3, 4, 5]);
    }
  });

  it("a quick meal and a single add racing into a meal leave one row", async () => {
    const e = await mine(egg);
    const quick = (await t.api("POST", "/api/my-foods/meals", { name: "Egg", items: [{ food: { kind: "user_food", id: e.id }, ...portion() }] })).body.food;
    for (let round = 0; round < 5; round++) {
      const meal = ["breakfast", "lunch", "dinner", "snacks", "supplements"][round];
      const all = await Promise.all([log(e, {}, meal), t.api("POST", "/api/log/meal", { day: DAY, meal, foodId: quick.id }), log(e, {}, meal)]);
      expect(all.map((r) => r.status)).toEqual([200, 200, 200]);
      expect((await getDay()).entries.filter((x: any) => x.meal === meal).map((x: any) => x.quantity)).toEqual([3]);
    }
  });

  it("moves in opposite directions don't deadlock, and each entry ends up combined once", async () => {
    const food = await mine(egg);
    for (let round = 0; round < 5; round++) {
      const day = `2026-11-${10 + round}`;
      const a = (await log(food, {}, "breakfast", day)).body.entry;
      const b = (await log(food, { quantity: 2 }, "lunch", day)).body.entry;
      const other = await mine({ ...toast, name: `Toast ${round}` });
      const c = (await log(other, {}, "breakfast", day)).body.entry;
      const d = (await log(other, { quantity: 2 }, "lunch", day)).body.entry;
      const [x, y] = await Promise.all([
        t.api("POST", "/api/log/move", { ids: [a.id, c.id], day, meal: "lunch" }),
        t.api("POST", "/api/log/move", { ids: [d.id, b.id], day, meal: "breakfast" }),
      ]);
      expect([x.status, y.status], JSON.stringify([x.body, y.body])).toEqual([200, 200]);
      // Whichever went first, both foods end up as one entry each holding everything
      const left = (await getDay(day)).entries;
      expect(left.map((e: any) => [e.name, e.quantity]).sort()).toEqual([["Egg", 3], [`Toast ${round}`, 3]]);
    }
  });

  it("Undo racing a new add of the same food leaves the amounts adding up", async () => {
    const food = await mine(egg);
    await log(food);
    const { combined } = (await log(food)).body;
    const [u, more] = await Promise.all([undo(combined), log(food)]);
    expect(more.status).toBe(200);
    const total = (await getDay()).entries.reduce((n: number, e: any) => n + e.quantity, 0);
    expect([200, 409]).toContain(u.status);
    expect(total).toBe(3);
  });
});
