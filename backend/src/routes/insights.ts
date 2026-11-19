import { PassThrough } from "node:stream";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { AiStopped, type AiProgress } from "../lib/ai.js";
import { logEvent } from "../lib/appLog.js";
import { HttpError } from "../lib/errors.js";
import { requireSignedIn, requireUser } from "../lib/guards.js";
import {
  INSIGHTS_OFF,
  answerClaimed,
  claimQuestion,
  claimRefresh,
  insightView,
  insightsView,
  latestRecap,
  refreshFailed,
  setInsightsSwitches,
  weekBefore,
  writeProtein,
  writeRecap,
} from "../lib/insightsRun.js";
import { addDays, todayFor } from "../lib/days.js";
import { weekStartFor } from "../lib/calorieDays.js";

type Work = (o: { signal: AbortSignal; onProgress?: (p: AiProgress) => void }) => Promise<unknown>;

// Insights (§43). Reading is open to Read only API keys; Refresh, Ask and the switch are for the person signed in
// (lib/apiKeys.ts lists only the reads). Who is asking comes only from the login.
export default async function insightsRoutes(app: FastifyInstance) {
  app.get("/api/insights", async (req) => insightsView(app, requireUser(req)));
  app.get("/api/insights/latest", async (req) => latestRecap(app, requireUser(req)));

  app.put("/api/insights/settings", async (req) => {
    const userId = requireSignedIn(req);
    const body = z
      .object({ weeklyOn: z.boolean().optional(), emailOn: z.boolean().optional() })
      .refine((b) => b.weeklyOn !== undefined || b.emailOn !== undefined, "Choose what to change")
      .parse(req.body ?? {});
    return setInsightsSwitches(app, userId, body);
  });

  // Refresh a card: the recap (this week so far) or protein help. Asked for as lines (accept: application/x-ndjson), it
  // says {"progress": "another"} when another AI service is asked, then {"insight"} or {"error", "status"}.
  app.post("/api/insights/refresh", async (req, reply) => {
    const userId = requireSignedIn(req);
    const { kind } = z.object({ kind: z.enum(["recap", "protein"], { error: "Choose the recap or protein help" }) }).parse(req.body ?? {});
    await aiReady(app);
    await claimRefresh(app, userId, kind); // 429 when too soon; this try counts from now, worked or not
    const today = await todayFor(app, userId);
    const weekStart = await weekStartFor(app.db, userId);
    const thisWeek = { from: addDays(weekBefore(today, weekStart).to, 1), to: today };
    return answered(req, reply, "POST /api/insights/refresh", userId, async (o) => {
      try {
        return { insight: insightView(kind === "recap" ? await writeRecap(app, userId, "refresh", thisWeek, o) : await writeProtein(app, userId, "refresh", today, o)) };
      } catch (err) {
        if (err instanceof HttpError && err.statusCode === 502) throw refreshFailed();
        throw err;
      }
    });
  });

  app.post("/api/insights/ask", async (req, reply) => {
    const userId = requireSignedIn(req);
    const { question } = z.object({ question: z.string().trim().min(3, "Type a question").max(300, "Keep the question under 300 characters") }).parse(req.body ?? {});
    await aiReady(app);
    const claim = await claimQuestion(app, userId, question); // 429 when today's are used up
    return answered(req, reply, "POST /api/insights/ask", userId, async (o) => ({ insight: insightView(await answerClaimed(app, userId, claim, o)) }));
  });

  // The answer, as one JSON or as lines with progress (as Describe it, routes/foods.ts). Going away stops the AI request.
  async function answered(req: FastifyRequest, reply: FastifyReply, source: string, userId: number, work: Work) {
    const stop = new AbortController();
    reply.raw.on("close", () => !reply.raw.writableFinished && stop.abort());
    if (!String(req.headers.accept ?? "").includes("application/x-ndjson")) {
      try {
        return await work({ signal: stop.signal });
      } catch (err) {
        if (err instanceof AiStopped) return reply.status(499).send({ error: "Stopped" });
        throw err;
      }
    }
    const out = new PassThrough();
    out.on("error", () => {});
    const line = (o: unknown) => !out.destroyed && out.write(`${JSON.stringify(o)}\n`);
    void work({ signal: stop.signal, onProgress: (p) => p.kind === "failover" && line({ progress: "another" }) })
      .then(line, async (err) => {
        if (err instanceof AiStopped) return;
        if (err instanceof HttpError) return line({ ...err.extra, error: err.message, status: err.statusCode });
        req.log.error(err);
        await logEvent(app.db, { category: "api", level: "error", source, event: "Server error", detail: (err as Error).message, userId });
        line({ error: "Something went wrong", status: 500 });
      })
      .finally(() => out.end());
    return reply.type("application/x-ndjson").header("cache-control", "no-store").header("x-accel-buffering", "no").send(out);
  }
}

async function aiReady(app: FastifyInstance) {
  if (!(await app.ai.active("insights"))) throw new HttpError(503, INSIGHTS_OFF);
}
