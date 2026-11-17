import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../lib/guards.js";
import { estimateFood, fillGaps, lookupBarcode, searchFoods } from "../lib/foods.js";

// Finding foods (search, typed or scanned barcodes) and AI drafts. Who is asking comes only from the login.
export default async function foodRoutes(app: FastifyInstance) {
  app.get("/api/foods/search", async (req) => {
    const userId = requireUser(req);
    const q = (req.query as { q?: unknown }).q;
    return searchFoods(app, userId, typeof q === "string" ? q : undefined);
  });

  app.get("/api/foods/barcode/:code", async (req) => {
    const userId = requireUser(req);
    const { code, food, errors } = await lookupBarcode(app, userId, String((req.params as { code: string }).code));
    return { code, food, errors };
  });

  app.post("/api/ai/estimate", async (req) => {
    const userId = requireUser(req);
    const { text } = z.object({ text: z.string().trim().min(2, "Describe the food").max(500) }).parse(req.body ?? {});
    return { food: await estimateFood(app, userId, text) };
  });

  app.post("/api/ai/fill-gaps", async (req) => {
    const userId = requireUser(req);
    const { food } = z.object({ food: z.object({ kind: z.enum(["cache", "user_food"]), id: z.number().int().positive().max(2147483647) }) }).parse(req.body ?? {});
    return fillGaps(app, userId, food);
  });
}
