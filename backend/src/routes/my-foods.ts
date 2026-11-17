import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../lib/guards.js";
import { createMyFood, findMyFoods, foodFields, MY_FOOD_KINDS, MY_FOOD_SORTS, overrideFields, overrideFood, toResult, updateMyFood } from "../lib/foods.js";
import { createMeal, createRecipe, fromEntriesBody, getMyFood, mealBody, mealFromEntries, recalculate, recipeBody, removeMyFood, updateMeal, updateRecipe } from "../lib/recipes.js";

const idParam = z.object({ id: z.coerce.number().int().positive().max(2147483647) });
const listQuery = z.object({
  q: z.string().optional(),
  kind: z.enum(MY_FOOD_KINDS, { error: "Choose all, foods, recipes or meals" }).default("all"),
  sort: z.enum(MY_FOOD_SORTS, { error: "Choose recent, used or az" }).optional(),
});

// A person's own foods: custom foods, corrections (overrides) of cached foods, recipes and quick meals.
// Removing one deletes it when it was never logged or used in a recipe or meal; otherwise it is archived.
export default async function myFoodRoutes(app: FastifyInstance) {
  app.get("/api/my-foods", async (req) => {
    const userId = requireUser(req);
    const { q: raw, kind, sort } = listQuery.parse(req.query ?? {});
    const q = (raw ?? "").trim().replace(/\s+/g, " ");
    const rows = await findMyFoods(app.db, userId, q || null, q ? 50 : 500, { kind, sort });
    return { foods: rows.map((r) => toResult(r, "user_food")) };
  });

  app.get("/api/my-foods/:id", async (req) => {
    const userId = requireUser(req);
    const { id } = idParam.parse(req.params);
    return { food: await getMyFood(app.db, userId, id) };
  });

  app.post("/api/my-foods", async (req) => {
    const userId = requireUser(req);
    return { food: await createMyFood(app, userId, foodFields.parse(req.body ?? {})) };
  });

  app.post("/api/my-foods/override", async (req) => {
    const userId = requireUser(req);
    return { food: await overrideFood(app, userId, overrideFields.parse(req.body ?? {})) };
  });

  app.post("/api/my-foods/recipes", async (req) => {
    const userId = requireUser(req);
    return { food: await createRecipe(app, userId, recipeBody.parse(req.body ?? {})) };
  });

  app.put("/api/my-foods/recipes/:id", async (req) => {
    const userId = requireUser(req);
    const { id } = idParam.parse(req.params);
    return { food: await updateRecipe(app, userId, id, recipeBody.parse(req.body ?? {})) };
  });

  app.post("/api/my-foods/meals", async (req) => {
    const userId = requireUser(req);
    return { food: await createMeal(app, userId, mealBody.parse(req.body ?? {})) };
  });

  // "Save as a meal": a quick meal from logged entries ({ food, leftOut: names of entries left out })
  app.post("/api/my-foods/meals/from-entries", async (req) => {
    const userId = requireUser(req);
    return mealFromEntries(app, userId, fromEntriesBody.parse(req.body ?? {}));
  });

  app.put("/api/my-foods/meals/:id", async (req) => {
    const userId = requireUser(req);
    const { id } = idParam.parse(req.params);
    return { food: await updateMeal(app, userId, id, mealBody.parse(req.body ?? {})) };
  });

  app.post("/api/my-foods/:id/recalculate", async (req) => {
    const userId = requireUser(req);
    const { id } = idParam.parse(req.params);
    return { food: await recalculate(app, userId, id) };
  });

  app.patch("/api/my-foods/:id", async (req) => {
    const userId = requireUser(req);
    const { id } = idParam.parse(req.params);
    return { food: await updateMyFood(app, userId, id, foodFields.partial().parse(req.body ?? {})) };
  });

  app.delete("/api/my-foods/:id", async (req, reply) => {
    const userId = requireUser(req);
    const { id } = idParam.parse(req.params);
    await removeMyFood(app, userId, id);
    return reply.status(204).send();
  });
}
