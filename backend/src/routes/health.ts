import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { APP_VERSION } from "../lib/version.js";

// Public: for Docker health checks and reverse proxies. Checks the database answers.
export default async function healthRoutes(app: FastifyInstance) {
  const handler = async (_req: unknown, reply: { status: (n: number) => unknown }) => {
    try {
      await app.db.execute(sql`select 1`);
      return { ok: true, db: true, version: APP_VERSION };
    } catch {
      reply.status(503);
      return { ok: false, db: false, version: APP_VERSION };
    }
  };
  app.get("/health", handler);
  app.get("/api/health", handler);
}
