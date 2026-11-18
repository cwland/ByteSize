import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin } from "../lib/guards.js";
import { restaurantKeys, savedSourceKeys, setSourceKeys, setSourceSwitches, sourceSwitches, usdaKey } from "../lib/foodSources/settings.js";
import { openSaved, revealRateLimit, sendSavedKey } from "../lib/savedKeys.js";
import { clearPoints, testRestaurantSource } from "../lib/restaurants/index.js";
import { RESTAURANT_SOURCES } from "../lib/restaurants/types.js";

const key = z.string().trim().max(200).nullable().optional();
const on = z.boolean({ error: "A switch is on (true) or off (false)" }).optional();
const switches = z.strictObject({ off: on, usda: on, spoonacular: on, fatsecret: on }).optional();

// Admin: where foods come from. The summary says whether each source is on and whether its key is set; a
// saved key itself is only sent by .../:source/key, one at a time, for the eye and copy buttons.
export default async function foodSourceRoutes(app: FastifyInstance) {
  const summary = async () => {
    const r = await restaurantKeys(app);
    const on = await sourceSwitches(app);
    return {
      off: { enabled: on.off },
      usda: { hasKey: (await usdaKey(app)) !== null, enabled: on.usda },
      spoonacular: { hasKey: r.spoonacular !== null, enabled: on.spoonacular },
      fatsecret: { hasKey: r.fatsecret !== null, enabled: on.fatsecret },
    };
  };

  app.get("/api/admin/food-sources", async (req) => {
    requireAdmin(req);
    return summary();
  });

  // A key left out is kept; null or blank removes it. enabled: the switches given (the keys stay as they are)
  app.put("/api/admin/food-sources", async (req) => {
    requireAdmin(req);
    const { enabled, ...body } = z.object({ usdaApiKey: key, spoonacularApiKey: key, fatsecretClientId: key, fatsecretClientSecret: key, enabled: switches }).parse(req.body ?? {});
    const before = (await restaurantKeys(app)).spoonacular;
    await setSourceKeys(app, body);
    if (enabled) await setSourceSwitches(app, enabled);
    // A new or changed Spoonacular key is tried at once, not after midnight UTC
    if ((await restaurantKeys(app)).spoonacular !== before) await clearPoints(app);
    return summary();
  });

  app.get("/api/admin/food-sources/:source/key", { config: revealRateLimit }, async (req, reply) => {
    const userId = requireAdmin(req);
    const { source } = z.object({ source: z.enum(["usda", "spoonacular", "fatsecret"], { error: "Choose usda, spoonacular or fatsecret" }) }).parse(req.params);
    const s = await savedSourceKeys(app);
    const open = (enc: string | null | undefined) => openSaved(enc, app.jwtSecret);
    if (source === "usda") return sendSavedKey(app, reply, userId, "USDA key", { key: open(s.usdaApiKey) });
    if (source === "spoonacular") return sendSavedKey(app, reply, userId, "Spoonacular key", { key: open(s.spoonacularApiKey) });
    return sendSavedKey(app, reply, userId, "FatSecret ID and secret", { clientId: open(s.fatsecretClientId), clientSecret: open(s.fatsecretClientSecret) });
  });

  // Test: one small search with the saved key (Spoonacular: about 1 point)
  app.post("/api/admin/food-sources/test", async (req) => {
    const userId = requireAdmin(req);
    const { source } = z.object({ source: z.enum(RESTAURANT_SOURCES, { error: "Choose spoonacular or fatsecret" }) }).parse(req.body ?? {});
    return testRestaurantSource(app, userId, source);
  });
}
