import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../lib/guards.js";
import { badRequest, HttpError } from "../lib/errors.js";
import { DAY, MEALS, todayFor } from "../lib/days.js";
import {
  cleanCuluryUrl,
  culuryLink,
  culuryMessage,
  culuryRecipe,
  culurySummary,
  CuluryError,
  logCuluryFailure,
  mealPlan,
  removeCuluryLink,
  saveCuluryLink,
  testCulury,
} from "../lib/culury.js";

// The person's Culury link (Settings › Integrations), their Culury meal plan and recipes. Per person: the
// link used is always the caller's own. The API key is never sent back.
const NOT_LINKED = "Link Culury in Settings › Integrations first";
const linkBody = z.object({ url: z.string().trim().min(1, "Enter Culury's address").max(300), apiKey: z.string().max(300).optional() });
const testBody = z.object({ url: z.string().trim().max(300).optional(), apiKey: z.string().max(300).optional() });
const planQuery = z.object({ day: DAY, meal: z.enum(MEALS).optional() });
const recipeParam = z.object({ id: z.string().regex(/^\d{1,9}$/, "Not a recipe").transform(Number) });

/** Culury failing for a request that needs it: a plain 404 / 502. */
export function culuryHttpError(err: unknown): HttpError {
  if (err instanceof CuluryError && err.notFound) return new HttpError(404, "Culury doesn't have that recipe (any more)");
  return new HttpError(502, culuryMessage(err));
}

export default async function culuryRoutes(app: FastifyInstance) {
  app.get("/api/settings/culury", async (req) => culurySummary(app, requireUser(req)));

  app.put("/api/settings/culury", async (req) => {
    const userId = requireUser(req);
    const b = linkBody.parse(req.body ?? {});
    await saveCuluryLink(app, userId, b.url, b.apiKey);
    return culurySummary(app, userId);
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
    const saved = await culuryLink(app, userId);
    const url = b.url ? cleanCuluryUrl(b.url) : (saved?.url ?? null);
    const key = b.apiKey?.trim() || (saved && saved.url === url ? saved.key : null);
    if (!url || !key) throw badRequest("Add Culury's address and API key first");
    try {
      await testCulury(app, { url, key }, await todayFor(app, userId));
    } catch (err) {
      await logCuluryFailure(app, userId, "connection test", err);
      throw badRequest(culuryMessage(err));
    }
    return { ok: true, message: "Connected to Culury" };
  });

  app.get("/api/culury/plan", async (req) => {
    const userId = requireUser(req);
    const q = planQuery.parse(req.query ?? {});
    const link = await culuryLink(app, userId);
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

/** A recipe from the caller's own Culury, for showing or logging. 400 not linked; 404 / 502 from Culury. */
export async function loadCuluryRecipe(app: FastifyInstance, userId: number, id: number) {
  const link = await culuryLink(app, userId);
  if (!link) throw badRequest(NOT_LINKED);
  try {
    return await culuryRecipe(app, link, id);
  } catch (err) {
    if (!(err instanceof CuluryError && err.notFound)) await logCuluryFailure(app, userId, "recipe", err);
    throw culuryHttpError(err);
  }
}
