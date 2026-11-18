import type { FastifyInstance } from "fastify";
import { requireUser } from "../lib/guards.js";
import { logEvent } from "../lib/appLog.js";
import { buildExport } from "../lib/exportData.js";

// "Download my data" (Settings): a zip of the caller's own records and photos. Who is asking comes only from the login.
export default async function exportRoutes(app: FastifyInstance) {
  app.get(
    "/api/export",
    {
      // 5 an hour per person (the zip can be big); tests without rate limits ignore this
      config: { rateLimit: { max: 5, timeWindow: 60 * 60 * 1000, keyGenerator: (req: { auth?: { userId: number }; ip: string }) => `export|${req.auth?.userId ?? req.ip}` } },
    },
    async (req, reply) => {
      const userId = requireUser(req);
      const { zip, name } = await buildExport(app, userId);
      await logEvent(app.db, { category: "api", level: "info", source: "Download my data", event: "Downloaded their data", detail: `${name} (${Math.round(zip.length / 1024)} KB)`, userId });
      return reply.type("application/zip").header("content-disposition", `attachment; filename="${name}"`).header("cache-control", "no-store").send(zip);
    },
  );
}
