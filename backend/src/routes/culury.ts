import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../lib/guards.js";
import { badRequest } from "../lib/errors.js";
import { openSaved, revealRateLimit, sendSavedKey } from "../lib/savedKeys.js";
import { DAY, MEALS, todayFor } from "../lib/days.js";
import {
  cleanCuluryUrl,
  culuryLink,
  culuryMessage,
  culurySummary,
  loadCuluryRecipe,
  logCuluryFailure,
  mealPlan,
  removeCuluryLink,
  savedCuluryKeyEnc,
  savedCuluryLink,
  saveCuluryLink,
  setCuluryEnabled,
  testCulury,
} from "../lib/culury.js";

// The person's RecipeHub link (Settings › Integrations), their RecipeHub meal plan and recipes. Per person: the
// link used is always the caller's own. The API key is never sent with the summary; the eye and copy
// buttons fetch it from /api/settings/culury/key (the caller's own only).
const linkBody = z.object({ url: z.string().trim().min(1, "Enter RecipeHub's address").max(300), apiKey: z.string().max(300).optional() });
const testBody = z.object({ url: z.string().trim().max(300).optional(), apiKey: z.string().max(300).optional() });
const planQuery = z.object({ day: DAY, meal: z.enum(MEALS).optional() });
const switchBody = z.object({ enabled: z.boolean({ error: "The switch is on (true) or off (false)" }) });
const recipeParam = z.object({ id: z.string().regex(/^\d{1,9}$/, "Not a recipe").transform(Number) });

export default async function culuryRoutes(app: FastifyInstance) {
  app.get("/api/settings/culury", async (req) => culurySummary(app, requireUser(req)));

  app.put("/api/settings/culury", async (req) => {
    const userId = requireUser(req);
    const b = linkBody.parse(req.body ?? {});
    await saveCuluryLink(app, userId, b.url, b.apiKey);
    return culurySummary(app, userId);
  });

  // The person's RecipeHub switch: off = RecipeHub is never asked (the link is kept for when it's back on)
  app.put("/api/settings/culury/enabled", async (req) => {
    const userId = requireUser(req);
    await setCuluryEnabled(app, userId, switchBody.parse(req.body ?? {}).enabled);
    return culurySummary(app, userId);
  });

  app.get("/api/settings/culury/key", { config: revealRateLimit }, async (req, reply) => {
    const userId = requireUser(req);
    return sendSavedKey(app, reply, userId, "RecipeHub key", { key: openSaved(await savedCuluryKeyEnc(app, userId), app.jwtSecret) });
  });

  app.delete("/api/settings/culury", async (req) => {
    const userId = requireUser(req);
    await removeCuluryLink(app, userId);
    return culurySummary(app, userId);
  });

  // The saved link, or an address + key typed in Settings (not saved yet). A saved key is only used
  // with its own saved address.
  app.post("/api/settings/culury/test", async (req) => {
    const userId = requireUser(req);
    const b = testBody.parse(req.body ?? {});
    const saved = await savedCuluryLink(app, userId);
    const url = b.url ? cleanCuluryUrl(b.url) : (saved?.url ?? null);
    const key = b.apiKey?.trim() || (saved && saved.url === url ? saved.key : null);
    if (!url || !key) throw badRequest("Add RecipeHub's address and API key first");
    try {
      await testCulury(app, { url, key }, await todayFor(app, userId));
    } catch (err) {
      await logCuluryFailure(app, userId, "connection test", err, true);
      throw badRequest(culuryMessage(err));
    }
    return { ok: true, message: "Connected to RecipeHub" };
  });

  app.get("/api/culury/plan", async (req) => {
    const userId = requireUser(req);
    const q = planQuery.parse(req.query ?? {});
    const link = await culuryLink(app, userId); // null too when the person's RecipeHub is off
    if (!link) return { linked: false, days: [], errors: [] };
    try {
      return { linked: true, days: await mealPlan(app, link, q.day, q.meal), errors: [] };
    } catch (err) {
      await logCuluryFailure(app, userId, "meal plan", err);
      return { linked: true, days: [], errors: [{ source: "culury", message: culuryMessage(err) }] };
    }
  });

  app.get("/api/culury/recipes/:id", async (req) => {
    const userId = requireUser(req);
    const { id } = recipeParam.parse(req.params);
    return loadCuluryRecipe(app, userId, id);
  });
}
