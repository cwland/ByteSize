import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { setupTestApp, type TestApp } from "./helpers.js";

let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
beforeEach(async () => {
  await t.reset();
  await t.login(); // admin "cory", America/Boise
  t.clock.date = new Date("2026-11-17T19:00:00Z"); // noon in Boise
});
afterAll(async () => t.close());

const DAY = "2026-11-17";
const beef = { name: "Ground beef", servings: [{ label: "100 g", grams: 100 }], nutrients: { calories: 250, protein_g: 26, fat_g: 15, carbs_g: 0, fiber_g: 0 } };
const beans = { name: "Kidney beans", servings: [{ label: "1 can", grams: 400 }], nutrients: { calories: 360, protein_g: 24, fat_g: 3, carbs_g: 66, fiber_g: 24 } };
const tomatoes = { name: "Crushed tomatoes", servings: [{ label: "1 can", grams: 400 }], nutrients: { calories: 80, protein_g: 4, fat_g: 0, carbs_g: 16, fiber_g: 4 } };
const onion = { name: "Onion", servings: [{ label: "1 medium" }], nutrients: { calories: 44, protein_g: 1, fat_g: 0, carbs_g: 10 } }; // no fiber, no weight

const mine = async (f: object) => {
  const r = await t.api("POST", "/api/my-foods", f);
  expect(r.status).toBe(200);
  return r.body.food;
};
const item = (food: { kind: string; id: number }, portion: Record<string, unknown> = {}) => ({ food: { kind: food.kind, id: food.id }, servingIndex: 0, unit: "serving", quantity: 1, fraction: 1, ...portion });

/** Chili: 6 servings of 350 g from 1200 g beef, 2 cans of beans and 1.5 cans of tomatoes. */
async function chiliItems() {
  const b = await mine(beef);
  const k = await mine(beans);
  const tm = await mine(tomatoes);
  return { b, k, tm, items: [item(b, { unit: "g", quantity: 1200 }), item(k, { quantity: 2 }), item(tm, { quantity: 1.5 })] };
}

describe("recipes", () => {
  it("chili: 6 servings of 350 g → exact per-serving nutrients, a 350 g serving, and 300 g logs 300/350 of it", async () => {
    const { b, items } = await chiliItems();
    const r = await t.api("POST", "/api/my-foods/recipes", { name: "Chili", items, servings: 6, servingGrams: 350, notes: "Simmer 2 h" });
    expect(r.status).toBe(200);
    const food = r.body.food;
    // (3000 + 720 + 120) / 6 kcal, (312 + 48 + 6) / 6 protein, (180 + 6 + 0) / 6 fat, (0 + 132 + 24) / 6 carbs, (0 + 48 + 6) / 6 fiber
    expect(food).toMatchObject({
      kind: "user_food",
      foodKind: "recipe",
      name: "Chili",
      servings: [
        { label: "1 serving (350 g)", grams: 350 },
        { label: "100 g", grams: 100 },
      ],
      nutrients: { calories: 640, protein_g: 61, fat_g: 31, carbs_g: 26, fiber_g: 9 },
      notes: "Simmer 2 h",
      recipeServings: 6,
      servingGrams: 350,
    });
    expect(food.items).toHaveLength(3);
    expect(food.items[0]).toEqual({
      food: { kind: "user_food", id: b.id },
      foodKind: "custom",
      name: "Ground beef",
      brand: null,
      icon: b.icon,
      imageUrl: null,
      servingIndex: 0,
      unit: "g",
      quantity: 1200,
      fraction: 1,
      servings: beef.servings,
      perServing: beef.nutrients,
      nutrients: { calories: 3000, protein_g: 312, fat_g: 180, carbs_g: 0, fiber_g: 0 },
      available: true,
    });
    // The same detail comes back from GET
    expect((await t.api("GET", `/api/my-foods/${food.id}`)).body.food).toEqual(food);

    const logged = await t.api("POST", "/api/log", { day: DAY, meal: "dinner", food: { kind: "user_food", id: food.id }, servingIndex: 0, unit: "g", quantity: 300, fraction: 1 });
    expect(logged.status).toBe(200);
    // 300/350 of a serving: 640 × 0.857 = 549, 61 → 52.3, 31 → 26.6, 26 → 22.3, 9 → 7.7
    expect(logged.body.entry.nutrients).toEqual({ calories: 549, protein_g: 52.3, fat_g: 26.6, carbs_g: 22.3, fiber_g: 7.7 });
    const one = await t.api("POST", "/api/log", { day: DAY, meal: "dinner", food: { kind: "user_food", id: food.id }, servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 });
    expect(one.body.entry.nutrients).toEqual(food.nutrients);
  });

  it("without a serving weight: '1 serving' with no grams, logged by servings only", async () => {
    const { items } = await chiliItems();
    const food = (await t.api("POST", "/api/my-foods/recipes", { name: "Chili", items, servings: 6 })).body.food;
    expect(food.servings).toEqual([{ label: "1 serving" }]);
    expect(food.servingGrams).toBeNull();
    const g = await t.api("POST", "/api/log", { day: DAY, meal: "dinner", food: { kind: "user_food", id: food.id }, servingIndex: 0, unit: "g", quantity: 300, fraction: 1 });
    expect(g.status).toBe(400);
  });

  it("an ingredient missing a nutrient makes the recipe's value unknown, never 0", async () => {
    const { items } = await chiliItems();
    const o = await mine(onion);
    const food = (await t.api("POST", "/api/my-foods/recipes", { name: "Chili", items: [...items, item(o, { quantity: 2 })], servings: 6, servingGrams: 350 })).body.food;
    expect(food.nutrients).not.toHaveProperty("fiber_g");
    expect(food.nutrients).toMatchObject({ calories: Math.round((3840 + 88) / 6), protein_g: 61.3 });
    expect(food.items[3].nutrients).toEqual({ calories: 88, protein_g: 2, fat_g: 0, carbs_g: 20 });
  });

  it("an amount the food can't be measured in is a form error", async () => {
    const o = await mine(onion);
    const r = await t.api("POST", "/api/my-foods/recipes", { name: "Soup", items: [item(o, { unit: "g", quantity: 150 })], servings: 4 });
    expect(r).toMatchObject({ status: 400, body: { error: "Choose an amount this food can be measured in" } });
    const r2 = await t.api("POST", "/api/my-foods/recipes", { name: "Soup", items: [item(o, { servingIndex: 3 })], servings: 4 });
    expect(r2).toMatchObject({ status: 400, body: { error: "Choose an amount this food can be measured in" } });
  });

  it("rejects a recipe with no ingredients, no servings, or a food that isn't there", async () => {
    const o = await mine(onion);
    expect((await t.api("POST", "/api/my-foods/recipes", { name: "Soup", items: [], servings: 4 })).status).toBe(400);
    expect((await t.api("POST", "/api/my-foods/recipes", { name: "Soup", items: [item(o)], servings: 0 })).status).toBe(400);
    expect((await t.api("POST", "/api/my-foods/recipes", { name: " ", items: [item(o)], servings: 2 })).status).toBe(400);
    expect((await t.api("POST", "/api/my-foods/recipes", { name: "Soup", items: [item({ kind: "user_food", id: 99999 })], servings: 2 })).status).toBe(404);
    expect((await t.api("POST", "/api/my-foods/recipes", { name: "Soup", items: [item({ kind: "cache", id: 99999 })], servings: 2 })).status).toBe(404);
    expect((await t.api("POST", "/api/my-foods/recipes", { name: "Soup", items: [{ ...item(o), food: { kind: "recipe", id: o.id } }], servings: 2 })).status).toBe(400);
  });

  it("editing an ingredient food doesn't change the recipe until Recalculate (or the recipe is saved again)", async () => {
    const { b, items } = await chiliItems();
    const chili = (await t.api("POST", "/api/my-foods/recipes", { name: "Chili", items, servings: 6, servingGrams: 350 })).body.food;
    expect((await t.api("PATCH", `/api/my-foods/${b.id}`, { nutrients: { ...beef.nutrients, calories: 300 } })).status).toBe(200);
    expect((await t.api("GET", `/api/my-foods/${chili.id}`)).body.food.nutrients.calories).toBe(640);

    const re = await t.api("POST", `/api/my-foods/${chili.id}/recalculate`);
    expect(re.status).toBe(200);
    // 1200 g of beef now 3600 kcal: (3600 + 720 + 120) / 6 = 740
    expect(re.body.food.nutrients.calories).toBe(740);
    expect(re.body.food.items[0].nutrients.calories).toBe(3600);
    expect((await t.api("GET", `/api/my-foods/${chili.id}`)).body.food.nutrients.calories).toBe(740);
  });

  it("PUT replaces name, ingredients, servings and weight", async () => {
    const { items, k } = await chiliItems();
    const chili = (await t.api("POST", "/api/my-foods/recipes", { name: "Chili", items, servings: 6, servingGrams: 350 })).body.food;
    const put = await t.api("PUT", `/api/my-foods/recipes/${chili.id}`, { name: "Bean pot", items: [item(k, { quantity: 2 })], servings: 4, servingGrams: null, notes: null });
    expect(put.status).toBe(200);
    expect(put.body.food).toMatchObject({ id: chili.id, name: "Bean pot", servings: [{ label: "1 serving" }], nutrients: { calories: 180, protein_g: 12, fat_g: 1.5, carbs_g: 33, fiber_g: 12 }, recipeServings: 4, servingGrams: null, notes: null });
    expect(put.body.food.items).toHaveLength(1);
    // A plain food can't be edited as a recipe, and a recipe isn't edited as a plain food
    expect((await t.api("PUT", `/api/my-foods/recipes/${k.id}`, { name: "x", items: [item(k)], servings: 1 })).status).toBe(404);
    expect((await t.api("PATCH", `/api/my-foods/${chili.id}`, { nutrients: { calories: 1 } })).status).toBe(400);
  });

  it("an archived ingredient keeps its saved values on Save and Recalculate", async () => {
    const { b, items } = await chiliItems();
    const chili = (await t.api("POST", "/api/my-foods/recipes", { name: "Chili", items, servings: 6, servingGrams: 350 })).body.food;
    expect(await t.api("DELETE", `/api/my-foods/${b.id}`)).toMatchObject({ status: 200, body: { archived: true } }); // used in a recipe: archived
    const got = (await t.api("GET", `/api/my-foods/${chili.id}`)).body.food;
    expect(got.items[0]).toMatchObject({ name: "Ground beef", available: false, nutrients: { calories: 3000 } });
    const re = await t.api("POST", `/api/my-foods/${chili.id}/recalculate`);
    expect(re.body.food.nutrients.calories).toBe(640);
    // Saving it again with half the beef uses the saved per-serving values
    const put = await t.api("PUT", `/api/my-foods/recipes/${chili.id}`, { name: "Chili", items: [{ ...items[0], quantity: 600 }, items[1], items[2]], servings: 6, servingGrams: 350 });
    expect(put.status).toBe(200);
    expect(put.body.food.nutrients.calories).toBe(390); // (1500 + 720 + 120) / 6
    // ...but a new archived food can't be added
    const other = await mine({ ...beef, name: "Pork" });
    await t.api("POST", "/api/log", { day: DAY, meal: "dinner", food: { kind: "user_food", id: other.id }, servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 });
    await t.api("DELETE", `/api/my-foods/${other.id}`); // logged: archived
    expect((await t.api("PUT", `/api/my-foods/recipes/${chili.id}`, { name: "Chili", items: [...items, item(other)], servings: 6 })).status).toBe(404);
  });

  it("a recipe may hold a recipe one level deep, never deeper, never itself, never a quick meal", async () => {
    const o = await mine(onion);
    const { items } = await chiliItems();
    const chili = (await t.api("POST", "/api/my-foods/recipes", { name: "Chili", items, servings: 6, servingGrams: 350 })).body.food;
    const bowl = await t.api("POST", "/api/my-foods/recipes", { name: "Chili bowl", items: [item(chili), item(o)], servings: 1 });
    expect(bowl.status).toBe(200);
    expect(bowl.body.food.items[0]).toMatchObject({ foodKind: "recipe", nutrients: { calories: 640 } });
    expect(bowl.body.food.nutrients).not.toHaveProperty("fiber_g");

    const deeper = await t.api("POST", "/api/my-foods/recipes", { name: "Party tray", items: [item(bowl.body.food)], servings: 4 });
    expect(deeper).toMatchObject({ status: 400, body: { error: "A recipe inside a recipe can't contain another recipe" } });
    // Chili is inside the bowl, so it can't take a recipe itself
    const soup = (await t.api("POST", "/api/my-foods/recipes", { name: "Soup", items: [item(o)], servings: 2 })).body.food;
    const nest = await t.api("PUT", `/api/my-foods/recipes/${chili.id}`, { name: "Chili", items: [...items, item(soup)], servings: 6 });
    expect(nest).toMatchObject({ status: 400, body: { error: "A recipe inside a recipe can't contain another recipe" } });
    const self = await t.api("PUT", `/api/my-foods/recipes/${soup.id}`, { name: "Soup", items: [item(soup)], servings: 2 });
    expect(self).toMatchObject({ status: 400, body: { error: "A recipe can't contain itself" } });

    const meal = (await t.api("POST", "/api/my-foods/meals", { name: "Lunch", items: [item(o)] })).body.food;
    const withMeal = await t.api("POST", "/api/my-foods/recipes", { name: "Odd", items: [item(meal)], servings: 1 });
    expect(withMeal).toMatchObject({ status: 400, body: { error: "A recipe can't contain a quick meal" } });
  });

  it("recipes sit in the 'My foods' search group with foodKind", async () => {
    const { items } = await chiliItems();
    const chili = (await t.api("POST", "/api/my-foods/recipes", { name: "Chili", items, servings: 6 })).body.food;
    const s = (await t.api("GET", "/api/foods/search?q=chili")).body;
    expect(s.groups[0]).toMatchObject({ source: "mine", label: "My foods", foods: [{ id: chili.id, foodKind: "recipe", nutrients: chili.nutrients }] });
    expect(s.groups[0].foods[0]).not.toHaveProperty("items");
  });

  it("GET one food: a plain food comes back without items; another id is 404", async () => {
    const o = await mine(onion);
    const got = await t.api("GET", `/api/my-foods/${o.id}`);
    expect(got.body.food).toEqual({ ...o, notes: null });
    expect((await t.api("GET", "/api/my-foods/99999")).status).toBe(404);
    expect((await t.api("POST", `/api/my-foods/${o.id}/recalculate`)).status).toBe(400);
  });
});

describe("my foods list and delete", () => {
  it("kind filter and sort (recent, used, az)", async () => {
    t.clock.date = null; // made and used in this order, by the real clock
    const o = await mine(onion);
    const k = await mine(beans);
    const chili = (await t.api("POST", "/api/my-foods/recipes", { name: "Chili", items: [item(k)], servings: 2 })).body.food;
    const meal = (await t.api("POST", "/api/my-foods/meals", { name: "Apple lunch", items: [item(o)] })).body.food;
    const log = (id: number) => t.api("POST", "/api/log", { day: DAY, meal: "lunch", food: { kind: "user_food", id }, servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 });
    await log(o.id);
    await log(o.id);
    await log(chili.id);

    const names = async (qs: string) => {
      const r = await t.api("GET", `/api/my-foods${qs}`);
      expect(r.status, qs).toBe(200);
      return r.body.foods.map((f: any) => f.name);
    };
    expect(await names("")).toEqual(["Apple lunch", "Chili", "Kidney beans", "Onion"]);
    expect(await names("?kind=all&sort=az")).toEqual(["Apple lunch", "Chili", "Kidney beans", "Onion"]);
    expect(await names("?kind=foods")).toEqual(["Kidney beans", "Onion"]);
    expect(await names("?kind=recipes")).toEqual(["Chili"]);
    expect(await names("?kind=meals")).toEqual(["Apple lunch"]);
    expect(await names("?sort=used")).toEqual(["Onion", "Chili", "Apple lunch", "Kidney beans"]);
    // Last used, else when it was made: chili, onion (used), then the rest newest first
    expect(await names("?sort=recent")).toEqual(["Chili", "Onion", "Apple lunch", "Kidney beans"]);
    expect(await names("?kind=foods&q=onion")).toEqual(["Onion"]);
    expect(await names("?kind=recipes&q=onion")).toEqual([]);
    expect((await t.api("GET", "/api/my-foods")).body.foods.find((f: any) => f.id === meal.id).foodKind).toBe("quick_meal");
    for (const qs of ["?kind=drinks", "?sort=best"]) expect((await t.api("GET", `/api/my-foods${qs}`)).status, qs).toBe(400);
  });

  it("an old kind 'ai' row reads as a plain food (foodKind custom) and is listed under foods", async () => {
    const [{ id: userId }] = (await t.db.execute<{ id: number }>(sql`select id from users limit 1`)).rows;
    await t.db.execute(sql`insert into user_foods (user_id, kind, name, servings, nutrients) values (${userId}, 'ai', 'Old guess', '[{"label":"1 bowl"}]', '{"calories": 100}')`);
    const foods = (await t.api("GET", "/api/my-foods?kind=foods")).body.foods;
    expect(foods).toMatchObject([{ name: "Old guess", foodKind: "custom" }]);
  });

  it("delete: a food never logged or used is gone; one logged or used as an ingredient is archived", async () => {
    const o = await mine(onion);
    const k = await mine(beans);
    const used = await mine({ ...beans, name: "Pinto beans" });
    const recipe = (await t.api("POST", "/api/my-foods/recipes", { name: "Beans", items: [item(used)], servings: 2 })).body.food;
    await t.api("POST", "/api/log", { day: DAY, meal: "lunch", food: { kind: "user_food", id: k.id }, servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 });
    const rows = async () => (await t.db.execute<{ id: number; archived: boolean }>(sql`select id, archived from user_foods order by id`)).rows;

    const removed = [];
    for (const f of [o, k, used]) removed.push(await t.api("DELETE", `/api/my-foods/${f.id}`));
    // The app is told which: deleted (never logged or used) or archived (hidden)
    expect(removed.map((r) => [r.status, r.body])).toEqual([
      [200, { archived: false }],
      [200, { archived: true }],
      [200, { archived: true }],
    ]);
    expect(await rows()).toEqual([
      { id: k.id, archived: true },
      { id: used.id, archived: true },
      { id: recipe.id, archived: false },
    ]);
    // A recipe never logged and not inside anything: gone, with its items
    expect(await t.api("DELETE", `/api/my-foods/${recipe.id}`)).toMatchObject({ status: 200, body: { archived: false } });
    expect((await rows()).map((r: any) => r.id)).toEqual([k.id, used.id]);
    expect((await t.db.execute(sql`select count(*)::int as n from recipe_items`)).rows[0]).toEqual({ n: 0 });
    expect((await t.api("DELETE", `/api/my-foods/${recipe.id}`)).status).toBe(404);
  });
});
