import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../lib/guards.js";
import { archiveMyFood, createMyFood, findMyFoods, foodFields, overrideFields, overrideFood, toResult, updateMyFood } from "../lib/foods.js";

const idParam = z.object({ id: z.coerce.number().int().positive().max(2147483647) });

// A person's own foods: custom foods and corrections (overrides) of cached foods. Archived, never deleted.
export default async function myFoodRoutes(app: FastifyInstance) {
  app.get("/api/my-foods", async (req) => {
    const userId = requireUser(req);
    const raw = (req.query as { q?: unknown }).q;
    const q = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
    const rows = await findMyFoods(app.db, userId, q || null, q ? 50 : 500);
    return { foods: rows.map((r) => toResult(r, "user_food")) };
  });

  app.post("/api/my-foods", async (req) => {
    const userId = requireUser(req);
    return { food: await createMyFood(app, userId, foodFields.parse(req.body ?? {})) };
  });

  app.post("/api/my-foods/override", async (req) => {
    const userId = requireUser(req);
    return { food: await overrideFood(app, userId, overrideFields.parse(req.body ?? {})) };
  });

  app.patch("/api/my-foods/:id", async (req) => {
    const userId = requireUser(req);
    const { id } = idParam.parse(req.params);
    return { food: await updateMyFood(app, userId, id, foodFields.partial().parse(req.body ?? {})) };
  });

  app.delete("/api/my-foods/:id", async (req, reply) => {
    const userId = requireUser(req);
    const { id } = idParam.parse(req.params);
    await archiveMyFood(app, userId, id);
    return reply.status(204).send();
  });
}
