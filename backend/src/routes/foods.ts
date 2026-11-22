import { PassThrough } from "node:stream";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { AiStopped, type AiProgress } from "../lib/ai.js";
import { logEvent } from "../lib/appLog.js";
import { HttpError } from "../lib/errors.js";
import { requireUser } from "../lib/guards.js";
import { aiReady, estimateFood, estimateFoodItems, fillGaps, lookupBarcode, pickBarcode, searchFoods } from "../lib/foods.js";
import { refreshKept, refreshRateLimit } from "../lib/lookups.js";
import { wholeKeptFood } from "../lib/restaurants/index.js";

const cacheRef = z.object({ cacheId: z.number().int().positive().max(2147483647) });

// Finding foods (search, typed or scanned barcodes) and AI drafts. Who is asking comes only from the login.
export default async function foodRoutes(app: FastifyInstance) {
  app.get("/api/foods/search", async (req) => {
    const userId = requireUser(req);
    const q = (req.query as { q?: unknown }).q;
    return searchFoods(app, userId, typeof q === "string" ? q : undefined);
  });

  // A barcode: the food (the most complete answer), and choices when the sources disagree on what it is
  app.get("/api/foods/barcode/:code", async (req) => {
    const userId = requireUser(req);
    const { code, food, errors, choices } = await lookupBarcode(app, userId, String((req.params as { code: string }).code));
    return { code, food, errors, choices };
  });

  // The kept food picked from the choices: that barcode opens it straight away next time (for this person)
  app.post("/api/foods/barcode/:code/pick", async (req, reply) => {
    const userId = requireUser(req);
    const { id } = z.object({ id: z.number().int().positive().max(2147483647) }).parse(req.body ?? {});
    await pickBarcode(app, userId, String((req.params as { code: string }).code), id);
    return reply.status(204).send();
  });

  // One kept food as it is now, whole (opening a FatSecret search row fetches the whole food once)
  app.get("/api/foods/cache/:id", async (req) => {
    const userId = requireUser(req);
    const { id } = z.object({ id: z.coerce.number().int().positive().max(2147483647) }).parse(req.params);
    return { food: await wholeKeptFood(app, userId, id) };
  });

  // Check for changes: the kept copy the person is looking at, fetched again from its source (rate-limited per person)
  app.post("/api/foods/refresh", { config: refreshRateLimit }, async (req) => {
    const userId = requireUser(req);
    return refreshKept(app, userId, cacheRef.parse(req.body ?? {}).cacheId);
  });

  // Describe it. Asked for as lines (accept: application/x-ndjson), it says how it's going while the AI works:
  // {"progress": "another"} when another AI service is asked, then the answer or {"error", "status"} as the last
  // line. The person going away (Cancel) stops the AI request. Without lines: plain JSON.
  //   /api/ai/estimate: one food ({"food", "assumed", "interpretedAs"?})
  //   /api/ai/estimate-items: several foods, each with its amount, and a name for them together
  //   ({"items", "mealName", "assumed", "interpretedAs"?}); mealName is null for one food
  const describe =
    <T>(route: string, run: (userId: number, text: string, opts: { signal: AbortSignal; onProgress?: (p: AiProgress) => void }) => Promise<T>) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      const userId = requireUser(req);
      const { text } = z.object({ text: z.string().trim().min(2, "Describe the food").max(500) }).parse(req.body ?? {});
      const stop = new AbortController();
      reply.raw.on("close", () => !reply.raw.writableFinished && stop.abort());
      if (!String(req.headers.accept ?? "").includes("application/x-ndjson")) {
        try {
          return await run(userId, text, { signal: stop.signal });
        } catch (err) {
          if (err instanceof AiStopped) return reply.status(499).send({ error: "Stopped" }); // nobody is waiting for it
          throw err;
        }
      }
      await aiReady(app); // AI off: a plain 503 as before, not a line
      const out = new PassThrough();
      out.on("error", () => {}); // the person went away mid-answer
      const line = (o: unknown) => !out.destroyed && out.write(`${JSON.stringify(o)}\n`);
      void run(userId, text, { signal: stop.signal, onProgress: (p) => p.kind === "failover" && line({ progress: "another" }) })
        .then(line, async (err) => {
          if (err instanceof AiStopped) return;
          if (err instanceof HttpError) return line({ error: err.message, status: err.statusCode });
          req.log.error(err);
          await logEvent(app.db, { category: "api", level: "error", source: `POST ${route}`, event: "Server error", detail: (err as Error).message, userId });
          line({ error: "Something went wrong", status: 500 });
        })
        .finally(() => out.end());
      // x-accel-buffering: nginx-style reverse proxies pass each line on at once instead of holding the answer back
      return reply.type("application/x-ndjson").header("cache-control", "no-store").header("x-accel-buffering", "no").send(out);
    };

  app.post("/api/ai/estimate", describe("/api/ai/estimate", (userId, text, opts) => estimateFood(app, userId, text, opts)));
  app.post("/api/ai/estimate-items", describe("/api/ai/estimate-items", (userId, text, opts) => estimateFoodItems(app, userId, text, opts)));

  app.post("/api/ai/fill-gaps", async (req) => {
    const userId = requireUser(req);
    const { food } = z.object({ food: z.object({ kind: z.enum(["cache", "user_food"]), id: z.number().int().positive().max(2147483647) }) }).parse(req.body ?? {});
    return fillGaps(app, userId, food);
  });
}
