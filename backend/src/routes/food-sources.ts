import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin } from "../lib/guards.js";
import { MAX_HOURS, fatsecretPlan, restaurantKeys, savedSourceKeys, setBarcodeScopeMissing, setFatsecretPlan, setSourceHours, setSourceKeys, setSourceSwitches, sourceHours, sourceSwitches, usdaKey } from "../lib/foodSources/settings.js";
import { openSaved, revealRateLimit, sendSavedKey } from "../lib/savedKeys.js";
import { clearPoints, testRestaurantSource } from "../lib/restaurants/index.js";
import { RESTAURANT_SOURCES } from "../lib/restaurants/types.js";
import { deleteSavedBarcode, deleteUnusedBarcodes, listSavedBarcodes, refreshKept, refreshRateLimit } from "../lib/lookups.js";

const savedId = z.object({ id: z.coerce.number().int().positive().max(2147483647) });
const SAVED_SOURCES = ["off", "usda", "fatsecret", "spoonacular"] as const;
const savedList = z.object({
  q: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number({ error: "Show 10 to 50 at a time" }).int("Show 10 to 50 at a time").min(10, "Show 10 to 50 at a time").max(50, "Show 10 to 50 at a time").default(10),
  // a comma list of source ids; left out: every source; empty: none
  sources: z
    .string()
    .transform((s) => s.split(",").filter(Boolean))
    .pipe(z.array(z.enum(SAVED_SOURCES, { error: "Unknown source" })))
    .optional(),
});

const key = z.string().trim().max(200).nullable().optional();
const on = z.boolean({ error: "A switch is on (true) or off (false)" }).optional();
const switches = z.strictObject({ off: on, usda: on, spoonacular: on, fatsecret: on }).optional();
const HOURS_MESSAGE = `Keep results for 1 to ${MAX_HOURS} whole hours`;
const hour = z.number({ error: HOURS_MESSAGE }).int(HOURS_MESSAGE).min(1, HOURS_MESSAGE).max(MAX_HOURS, HOURS_MESSAGE).optional();
const hours = z.strictObject({ off: hour, usda: hour, spoonacular: hour, fatsecret: hour }).optional();
const plan = z.enum(["basic", "premier"], { error: "Choose basic or premier" }).optional();

// Admin: where foods come from. The summary says whether each source is on and whether its key is set; a
// saved key itself is only sent by .../:source/key, one at a time, for the eye and copy buttons.
export default async function foodSourceRoutes(app: FastifyInstance) {
  const summary = async () => {
    const r = await restaurantKeys(app);
    const on = await sourceSwitches(app);
    const h = await sourceHours(app);
    return {
      off: { enabled: on.off, hours: h.off },
      usda: { hasKey: (await usdaKey(app)) !== null, enabled: on.usda, hours: h.usda },
      spoonacular: { hasKey: r.spoonacular !== null, enabled: on.spoonacular, hours: h.spoonacular },
      fatsecret: { hasKey: r.fatsecret !== null, enabled: on.fatsecret, hours: h.fatsecret, ...(await fatsecretPlan(app)) },
    };
  };

  app.get("/api/admin/food-sources", async (req) => {
    requireAdmin(req);
    return summary();
  });

  // A key left out is kept; null or blank removes it. enabled: the switches given (the keys stay as they are);
  // hours: how long each source's answers are kept; fatsecretPlan: basic or premier (barcode lookups)
  app.put("/api/admin/food-sources", async (req) => {
    requireAdmin(req);
    const { enabled, hours: keep, fatsecretPlan: chosen, ...body } = z
      .object({ usdaApiKey: key, spoonacularApiKey: key, fatsecretClientId: key, fatsecretClientSecret: key, enabled: switches, hours, fatsecretPlan: plan })
      .parse(req.body ?? {});
    const before = await restaurantKeys(app);
    await setSourceKeys(app, body);
    if (enabled) await setSourceSwitches(app, enabled);
    if (keep) await setSourceHours(app, keep);
    if (chosen) await setFatsecretPlan(app, chosen);
    const after = await restaurantKeys(app);
    // A new or changed Spoonacular key is tried at once, not after midnight UTC
    if (after.spoonacular !== before.spoonacular) await clearPoints(app);
    // New FatSecret credentials may have barcode access: try barcodes again
    if (JSON.stringify(after.fatsecret) !== JSON.stringify(before.fatsecret)) await setBarcodeScopeMissing(app, false);
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

  // Saved barcodes: every kept food with a barcode (shared public data), to refresh or delete
  app.get("/api/admin/saved-barcodes", async (req) => {
    requireAdmin(req);
    const { q, page, pageSize, sources } = savedList.parse(req.query ?? {});
    return listSavedBarcodes(app, q, page, pageSize, sources);
  });

  app.post("/api/admin/saved-barcodes/delete-unused", async (req) => {
    requireAdmin(req);
    return deleteUnusedBarcodes(app);
  });

  app.post("/api/admin/saved-barcodes/:id/refresh", { config: refreshRateLimit }, async (req) => {
    const userId = requireAdmin(req);
    return refreshKept(app, userId, savedId.parse(req.params).id);
  });

  app.delete("/api/admin/saved-barcodes/:id", async (req) => {
    requireAdmin(req);
    return deleteSavedBarcode(app, savedId.parse(req.params).id);
  });
}
