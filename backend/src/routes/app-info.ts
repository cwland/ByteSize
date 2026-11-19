import type { FastifyInstance } from "fastify";
import { appInfo } from "../lib/appInfo.js";
import { requireUser } from "../lib/guards.js";

// Settings › App info. A person's own numbers; "everyone" is the admin's alone. Who is asking comes only from the login.
export default async function appInfoRoutes(app: FastifyInstance) {
  app.get("/api/app-info", async (req) => appInfo(app, requireUser(req), req.auth!.isAdmin));
}
