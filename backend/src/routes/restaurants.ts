import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../lib/guards.js";
import { addFavourite, listFavourites, recentChains, removeFavourite, restaurantItem, restaurantStatus, searchRestaurants } from "../lib/restaurants/index.js";
import { RESTAURANT_SOURCES, SOURCE_ID } from "../lib/restaurants/types.js";

const itemBody = z.object({
  source: z.enum(RESTAURANT_SOURCES, { error: "Choose spoonacular or fatsecret" }),
  sourceId: z.string().regex(SOURCE_ID, "Not a menu item id"),
});
const cacheBody = z.object({ cacheId: z.coerce.number().int().positive().max(2147483647) });

// Restaurants (big chains): menu search, an item's nutrition, the person's favourites and recent chains.
// The sources' keys stay on the server; any signed-in person may search.
export default async function restaurantRoutes(app: FastifyInstance) {
  app.get("/api/restaurants/status", async (req) => {
    requireUser(req);
    return restaurantStatus(app);
  });

  app.get("/api/restaurants/search", async (req) => {
    const userId = requireUser(req);
    const { q } = z.object({ q: z.string().max(200).optional() }).parse(req.query ?? {});
    return searchRestaurants(app, userId, q);
  });

  app.post("/api/restaurants/item", async (req) => {
    const userId = requireUser(req);
    const b = itemBody.parse(req.body ?? {});
    return restaurantItem(app, userId, b.source, b.sourceId);
  });

  app.get("/api/restaurants/recent-chains", async (req) => recentChains(app, requireUser(req)));

  app.get("/api/restaurants/favourites", async (req) => listFavourites(app, requireUser(req)));

  app.post("/api/restaurants/favourites", async (req) => {
    const userId = requireUser(req);
    return addFavourite(app, userId, cacheBody.parse(req.body ?? {}).cacheId);
  });

  app.delete("/api/restaurants/favourites", async (req) => {
    const userId = requireUser(req);
    return removeFavourite(app, userId, cacheBody.parse(req.body ?? req.query ?? {}).cacheId);
  });
}
