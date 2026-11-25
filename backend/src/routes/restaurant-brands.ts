import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { restaurantBrands } from "../db/schema.js";
import { requireUser } from "../lib/guards.js";
import { brandKey } from "../lib/restaurantBrands.js";

// "Treat <brand> as a restaurant" / "Not a restaurant": the person's own say, which beats the built-in chain list
const markBody = z.object({
  brand: z.string().trim().min(1, "Which brand?").max(200),
  restaurant: z.boolean(),
});

export default async function restaurantBrandRoutes(app: FastifyInstance) {
  const { db } = app;

  app.put("/api/restaurant-brands", async (req) => {
    const userId = requireUser(req);
    const { brand, restaurant } = markBody.parse(req.body ?? {});
    const key = brandKey(brand);
    if (!key) throw markBody.parse({ brand: "", restaurant }); // only punctuation: same 400 as an empty brand
    await db
      .insert(restaurantBrands)
      .values({ userId, brandKey: key, brand, isRestaurant: restaurant })
      .onConflictDoUpdate({ target: [restaurantBrands.userId, restaurantBrands.brandKey], set: { brand, isRestaurant: restaurant } });
    return { brand, key, restaurant };
  });

  // Back to the built-in list's answer (the key as PUT returned it, or the brand as written)
  app.delete("/api/restaurant-brands/:key", async (req) => {
    const userId = requireUser(req);
    const key = brandKey(String((req.params as { key: string }).key));
    await db.delete(restaurantBrands).where(and(eq(restaurantBrands.userId, userId), eq(restaurantBrands.brandKey, key)));
    return { ok: true };
  });
}
