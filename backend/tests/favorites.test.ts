import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";
import { twoUsers } from "./isolation.js";
import { foodCache } from "../src/db/schema.js";

// L2 (SPEC-10): bookmark foods as Favorites, and "Same as yesterday": what was logged in a meal the day before.
let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
beforeEach(async () => {
  await t.reset();
  await t.login();
});
afterAll(async () => t.close());

const toast = { name: "Toast", servings: [{ label: "1 slice", grams: 30 }], nutrients: { calories: 80 } };
const mine = async (f = toast) => (await t.api("POST", "/api/my-foods", f)).body.food;
const cached = async (name = "Banana") =>
  ({ ...(await t.db.insert(foodCache).values({ source: "usda", sourceId: name, name, servings: [{ label: "1 medium", grams: 118 }], nutrients: { calories: 105 } }).returning())[0], kind: "cache" });
const log = (food: { kind: string; id: number }, day: string, meal: string, portion: Record<string, unknown> = {}) =>
  t.api("POST", "/api/log", { day, meal, food: { kind: food.kind, id: food.id }, servingIndex: 0, unit: "serving", quantity: 1, fraction: 1, ...portion });

describe("favorites", () => {
  it("bookmarks a food and lists it, newest first, each ready to log", async () => {
    const own = await mine();
    const banana = await cached();
    expect((await t.api("PUT", "/api/foods/favorites", { food: { kind: "user_food", id: own.id } })).status).toBe(200);
    const r = await t.api("PUT", "/api/foods/favorites", { food: { kind: "cache", id: banana.id } });
    expect(r.body).toEqual({ refs: [`cache:${banana.id}`, `user_food:${own.id}`] });
    const list = (await t.api("GET", "/api/foods/favorites")).body.foods;
    expect(list.map((f: { name: string }) => f.name)).toEqual(["Banana", "Toast"]);
    expect(list[0]).toMatchObject({ kind: "cache", id: banana.id, last: { servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 } });
  });

  it("bookmarking twice keeps one", async () => {
    const own = await mine();
    await t.api("PUT", "/api/foods/favorites", { food: { kind: "user_food", id: own.id } });
    await t.api("PUT", "/api/foods/favorites", { food: { kind: "user_food", id: own.id } });
    expect((await t.api("GET", "/api/foods/favorites")).body.foods).toHaveLength(1);
  });

  it("un-bookmarks", async () => {
    const own = await mine();
    await t.api("PUT", "/api/foods/favorites", { food: { kind: "user_food", id: own.id } });
    const r = await t.api("DELETE", `/api/foods/favorites/user_food/${own.id}`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ refs: [] });
    expect((await t.api("GET", "/api/foods/favorites")).body.foods).toEqual([]);
  });

  it("a food that doesn't exist can't be bookmarked", async () => {
    expect((await t.api("PUT", "/api/foods/favorites", { food: { kind: "cache", id: 999999 } })).status).toBe(404);
  });

  it("an archived food drops out of the list", async () => {
    const own = await mine();
    await t.api("PUT", "/api/foods/favorites", { food: { kind: "user_food", id: own.id } });
    await t.api("DELETE", `/api/my-foods/${own.id}`);
    expect((await t.api("GET", "/api/foods/favorites")).body.foods).toEqual([]);
  });

  it("each person has their own, and can't bookmark another's food", async () => {
    const { a, b } = await twoUsers(t);
    const annas = (await a.as("POST", "/api/my-foods", toast)).body.food;
    await a.as("PUT", "/api/foods/favorites", { food: { kind: "user_food", id: annas.id } });
    expect((await b.as("GET", "/api/foods/favorites")).body.foods).toEqual([]);
    expect((await b.as("PUT", "/api/foods/favorites", { food: { kind: "user_food", id: annas.id } })).status).toBe(404);
    expect((await b.as("DELETE", `/api/foods/favorites/user_food/${annas.id}`)).body).toEqual({ refs: [] });
    expect((await a.as("GET", "/api/foods/favorites")).body.foods).toHaveLength(1);
  });
});

describe("same as yesterday", () => {
  it("is what was logged in that meal the day before, with the amounts", async () => {
    const own = await mine();
    const banana = await cached();
    await log(own, "2026-11-18", "breakfast", { quantity: 2 });
    const b1 = await log(banana, "2026-11-18", "breakfast");
    expect(b1.status, JSON.stringify(b1.body)).toBe(200);
    await log(banana, "2026-11-18", "lunch", { quantity: 3 }); // another meal: not it
    await log(own, "2026-11-17", "breakfast"); // two days back: not it
    const r = await t.api("GET", "/api/foods/same-as-yesterday?day=2026-11-19&meal=breakfast");
    expect(r.status).toBe(200);
    expect(r.body.foods.map((f: { name: string; last: { quantity: number } }) => [f.name, f.last.quantity])).toEqual([
      ["Toast", 2],
      ["Banana", 1],
    ]);
  });

  it("nothing yesterday: an empty list", async () => {
    expect((await t.api("GET", "/api/foods/same-as-yesterday?day=2026-11-19&meal=dinner")).body).toEqual({ foods: [] });
  });

  it("needs a day and a meal", async () => {
    expect((await t.api("GET", "/api/foods/same-as-yesterday?meal=dinner")).status).toBe(400);
    expect((await t.api("GET", "/api/foods/same-as-yesterday?day=2026-11-19")).status).toBe(400);
  });

  it("never shows another person's log", async () => {
    const { a, b } = await twoUsers(t);
    const annas = (await a.as("POST", "/api/my-foods", toast)).body.food;
    await a.as("POST", "/api/log", { day: "2026-11-18", meal: "lunch", food: { kind: "user_food", id: annas.id }, servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 });
    expect((await b.as("GET", "/api/foods/same-as-yesterday?day=2026-11-19&meal=lunch")).body).toEqual({ foods: [] });
  });
});
