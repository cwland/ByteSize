import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin } from "../lib/guards.js";
import { setUsdaKey, usdaKey } from "../lib/foodSources/settings.js";

// Admin: where foods come from. Only whether a USDA key is set is ever sent back.
export default async function foodSourceRoutes(app: FastifyInstance) {
  const summary = async () => ({ usda: { hasKey: (await usdaKey(app)) !== null } });

  app.get("/api/admin/food-sources", async (req) => {
    requireAdmin(req);
    return summary();
  });

  app.put("/api/admin/food-sources", async (req) => {
    requireAdmin(req);
    const body = z.object({ usdaApiKey: z.string().trim().max(200).nullable() }).parse(req.body);
    await setUsdaKey(app, body.usdaApiKey || null);
    return summary();
  });
}
