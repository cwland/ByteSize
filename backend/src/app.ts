import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { eq } from "drizzle-orm";
import type { Db } from "./db/index.js";
import { users } from "./db/schema.js";
import { HttpError } from "./lib/errors.js";
import { verifyToken } from "./lib/auth.js";
import { sessionForToken } from "./lib/sessions.js";
import { DEFAULT_RATE_LIMIT, rateLimits, securityHeaders, type RateLimitOptions } from "./lib/security.js";
import healthRoutes from "./routes/health.js";
import authRoutes from "./routes/auth.js";
import adminUserRoutes from "./routes/admin-users.js";
import { AiService, type AiFetch } from "./lib/ai.js";
import { logEvent } from "./lib/appLog.js";
import aiSettingsRoutes from "./routes/settings-ai.js";
import logRoutes from "./routes/logs.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
    jwtSecret: string;
    now: () => Date; // the clock (tests can set it)
    ai: AiService;
  }
  interface FastifyRequest {
    auth?: { userId: number; sessionId: number; isAdmin: boolean };
  }
}

// Open to anyone: everything else under /api needs a signed-in user
const PUBLIC_ROUTES = new Set([
  "GET /api/health",
  "GET /api/auth/status",
  "POST /api/auth/setup",
  "POST /api/auth/login",
  "POST /api/auth/logout",
  "POST /api/passkeys/login/options",
  "POST /api/passkeys/login/verify",
]);

export interface AppOptions {
  db: Db;
  jwtSecret: string;
  logger?: boolean;
  now?: () => Date;
  rateLimit?: RateLimitOptions | false; // tests turn it off
  aiFetch?: AiFetch; // tests swap in a fake AI
  aiTimeScale?: number; // tests shrink AI waits
}

export function buildApp(opts: AppOptions): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: process.env.TRUST_PROXY ?? "loopback, linklocal, uniquelocal" });
  app.decorate("db", opts.db);
  app.decorate("jwtSecret", opts.jwtSecret);
  app.decorate("now", opts.now ?? (() => new Date()));
  app.decorate("ai", new AiService(opts.db, opts.jwtSecret, opts.aiFetch, opts.aiTimeScale ?? 1));

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: "Invalid request", details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HttpError) return reply.status(err.statusCode).send({ error: err.message });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.status(status).send({ error: (err as Error).message });
    req.log.error(err);
    void logEvent(opts.db, { category: "api", level: "error", source: `${req.method} ${req.routeOptions.url ?? req.url.split("?")[0]}`, event: "Server error", detail: (err as Error).message, userId: req.auth?.userId ?? null });
    return reply.status(500).send({ error: "Something went wrong" });
  });
  app.setNotFoundHandler((req, reply) => reply.status(404).send({ error: `Not found: ${req.method} ${req.url.split("?")[0]}` }));

  securityHeaders(app);
  rateLimits(app, opts.rateLimit ?? DEFAULT_RATE_LIMIT);

  // Who is calling: a login token whose user is still allowed in and whose device is still signed in
  app.addHook("onRequest", async (req) => {
    const route = `${req.method} ${req.routeOptions.url ?? req.url}`;
    const header = req.headers.authorization;
    if (header?.startsWith("Bearer ")) {
      const claims = verifyToken(header.slice(7), opts.jwtSecret);
      if (claims) {
        const [user] = await opts.db.select({ tv: users.tokenVersion, isAdmin: users.isAdmin, disabled: users.disabled }).from(users).where(eq(users.id, claims.userId));
        // A turned-off account, or a token from before "sign out everywhere" / a password change, stops at once
        const session = user && !user.disabled && user.tv === claims.tokenVersion ? await sessionForToken(opts.db, req, header.slice(7), claims, app.now()) : null;
        if (session) {
          req.auth = { userId: claims.userId, sessionId: session.id, isAdmin: user.isAdmin };
          return;
        }
      }
    }
    if (!req.url.startsWith("/api/") || PUBLIC_ROUTES.has(route)) return;
    if (!req.routeOptions.url) return; // no such route: the 404 handler answers
    throw new HttpError(401, "Not logged in");
  });

  app.register(healthRoutes);
  app.register(authRoutes);
  app.register(adminUserRoutes);
  app.register(aiSettingsRoutes);
  app.register(logRoutes);
  return app;
}
