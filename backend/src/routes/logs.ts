import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { LOG_CATEGORIES, recentLogs } from "../lib/appLog.js";
import { requireUser } from "../lib/guards.js";

export default async function logRoutes(app: FastifyInstance) {
  // Settings › Logs: an admin sees every line, a member only the lines from their own actions
  app.get("/api/logs", async (req) => {
    const userId = requireUser(req);
    const q = z
      .object({ category: z.enum(LOG_CATEGORIES).optional(), problems: z.enum(["true", "false"]).optional() })
      .parse(req.query);
    return recentLogs(app.db, { userId: req.auth!.isAdmin ? undefined : userId, category: q.category, problemsOnly: q.problems === "true" });
  });
}
