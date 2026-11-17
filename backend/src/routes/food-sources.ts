import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin } from "../lib/guards.js";
import { restaurantKeys, setSourceKeys, usdaKey } from "../lib/foodSources/settings.js";
import { testRestaurantSource } from "../lib/restaurants/index.js";
import { RESTAURANT_SOURCES } from "../lib/restaurants/types.js";

const key = z.string().trim().max(200).nullable().optional();

// Admin: where foods come from. Only whether each key is set is ever sent back.
export default async function foodSourceRoutes(app: FastifyInstance) {
  const summary = async () => {
    const r = await restaurantKeys(app);
    return { usda: { hasKey: (await usdaKey(app)) !== null }, spoonacular: { hasKey: r.spoonacular !== null }, fatsecret: { hasKey: r.fatsecret !== null } };
  };

  app.get("/api/admin/food-sources", async (req) => {
    requireAdmin(req);
    return summary();
  });

  // A key left out is kept; null or blank removes it
  app.put("/api/admin/food-sources", async (req) => {
    requireAdmin(req);
    const body = z.object({ usdaApiKey: key, spoonacularApiKey: key, fatsecretClientId: key, fatsecretClientSecret: key }).parse(req.body ?? {});
    await setSourceKeys(app, body);
    return summary();
  });

  // Test: one small search with the saved key (Spoonacular: about 1 point)
  app.post("/api/admin/food-sources/test", async (req) => {
    const userId = requireAdmin(req);
    const { source } = z.object({ source: z.enum(RESTAURANT_SOURCES, { error: "Choose spoonacular or fatsecret" }) }).parse(req.body ?? {});
    return testRestaurantSource(app, userId, source);
  });
}
