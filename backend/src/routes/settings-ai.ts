import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError } from "../lib/errors.js";
import { requireAdmin, requireUser } from "../lib/guards.js";
import { logEvent } from "../lib/appLog.js";
import { AI_PROVIDERS, AiError, type AiConfig } from "../lib/ai.js";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));

// AI services (tried in order; the next one is a backup). The settings are the admin's;
// everyone signed in can ask whether AI is ready.
export default async function aiSettingsRoutes(app: FastifyInstance) {
  const service = z
    .object({
      id: z.string().max(40).optional(),
      name: z.string().trim().max(60).optional(),
      enabled: z.boolean().default(true),
      provider: z.enum(AI_PROVIDERS),
      model: z.string().trim().max(200).default(""),
      baseUrl: optionalText(500),
      apiKey: z.string().trim().max(500).nullable().optional(), // undefined = keep saved, "" = remove
      quick: z.boolean().optional(),
      photos: z.boolean().optional(),
    })
    .superRefine((v, ctx) => {
      if (v.baseUrl && !/^https?:\/\/[^\s/]+/.test(v.baseUrl)) ctx.addIssue({ code: "custom", path: ["baseUrl"], message: "Address should start with http:// or https://" });
    });
  const common = {
    enabled: z.boolean(),
    mode: z.enum(["auto", "manual"]).default("auto"),
    maxPerRun: z.coerce.number().int().min(1).max(500).default(50),
    timeoutSec: z.coerce.number().int().min(3).max(300).optional(),
    askNextOnNoMatch: z.boolean().optional(),
  };
  // Each service needs a model (and a local one its address)
  const checkReady = (enabled: boolean, list: z.infer<typeof service>[], ctx: z.RefinementCtx, prefix: (i: number) => (string | number)[]) => {
    if (!enabled) return;
    list.forEach((v, i) => {
      const who = list.length > 1 ? `${v.name || `Service ${i + 1}`}: ` : "";
      if (v.provider === "local" && !v.baseUrl) ctx.addIssue({ code: "custom", path: [...prefix(i), "baseUrl"], message: `${who}Enter your AI server's address` });
      if (!v.model) ctx.addIssue({ code: "custom", path: [...prefix(i), "model"], message: `${who}Choose a model` });
    });
  };
  const aiSettings = z.union([
    // Settings › AI saves the services (on/off is the switch at the top of Settings › AI)
    z
      .object({ ...common, enabled: z.boolean().optional(), mode: z.enum(["auto", "manual"]).optional(), services: z.array(service).max(10) })
      .superRefine((v, ctx) => checkReady(true, v.services, ctx, (i) => ["services", i])),
    // The single-provider shape from before backup services (updates the first service)
    service.and(z.object(common)).superRefine((v, ctx) => checkReady(v.enabled, [v], ctx, () => [])),
  ]);

  // The service to test or list models with: typed values, with a blank key falling back to the saved one
  const aiConfigFrom = async (body: unknown): Promise<AiConfig> => {
    const v = service.parse(body);
    const apiKey = v.apiKey === undefined || v.apiKey === null || v.apiKey === "" ? (await app.ai.savedKey(v.id)).key : v.apiKey;
    return { provider: v.provider, model: v.model, baseUrl: v.baseUrl ? v.baseUrl.replace(/\/+$/, "") : null, apiKey };
  };
  const aiErrors = async <T>(fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof AiError) throw new HttpError(400, e.message);
      throw e;
    }
  };

  // Is AI there, which kind leads, and can it read photos? (any signed-in person; no settings or keys)
  app.get("/api/ai/status", async (req) => {
    requireUser(req);
    return app.ai.status();
  });

  app.get("/api/settings/ai", async (req) => {
    requireAdmin(req);
    return { settings: await app.ai.summary() };
  });

  app.put("/api/settings/ai", async (req) => {
    requireAdmin(req);
    const v = aiSettings.parse(req.body);
    const clean = (sv: z.infer<typeof service>) => ({ ...sv, baseUrl: sv.baseUrl ? sv.baseUrl.replace(/\/+$/, "") : null, apiKey: sv.apiKey === null ? "" : sv.apiKey });
    if ("services" in v) {
      await app.ai.save({ ...v, services: v.services.map(clean) });
    } else {
      // Old shape: becomes (or replaces) the first service, keeping any backups after it
      const current = await app.ai.stored();
      const { enabled, mode, maxPerRun, timeoutSec, askNextOnNoMatch, ...first } = v;
      const rest = (current?.services.slice(1) ?? []).map((sv) => ({ ...sv, apiKey: undefined }));
      await app.ai.save({ enabled, mode, maxPerRun, timeoutSec, askNextOnNoMatch, services: [{ ...clean({ ...first, enabled: true }), id: current?.services[0]?.id }, ...rest] });
    }
    return { settings: await app.ai.summary() };
  });

  app.delete("/api/settings/ai", async (req, reply) => {
    requireAdmin(req);
    await app.ai.clear();
    return reply.status(204).send();
  });

  // Each test goes in Settings › Logs (never the key)
  app.post("/api/settings/ai/test", async (req) => {
    const userId = requireAdmin(req);
    const c = await aiConfigFrom(req.body);
    const timeoutSec = (await app.ai.stored())?.timeoutSec ?? 15;
    const source = `${c.provider}${c.model ? ` (${c.model})` : ""}`;
    try {
      await aiErrors(() => app.ai.test(c, Math.max(timeoutSec, 30) * 1000));
    } catch (e) {
      await logEvent(app.db, { category: "ai", level: "warning", source, event: `Test of ${c.model || "a service"} failed`, detail: (e as Error).message, userId });
      throw e;
    }
    await logEvent(app.db, { category: "ai", level: "info", source, event: `Test of ${c.model} passed`, userId });
    return { ok: true, message: `${c.model} answered correctly.` };
  });

  app.post("/api/settings/ai/models", async (req) => {
    requireAdmin(req);
    const c = await aiConfigFrom(req.body);
    return { models: await aiErrors(() => app.ai.models(c)) };
  });
}
