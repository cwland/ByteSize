import path from "node:path";
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
import profileRoutes from "./routes/profile.js";
import passkeyRoutes from "./routes/passkeys.js";
import { AiService, type AiFetch } from "./lib/ai.js";
import { logEvent } from "./lib/appLog.js";
import aiSettingsRoutes from "./routes/settings-ai.js";
import logRoutes from "./routes/logs.js";
import foodSourceRoutes from "./routes/food-sources.js";
import bodyPlanRoutes from "./routes/body-plans.js";
import settingsMeRoutes from "./routes/settings-me.js";
import foodRoutes from "./routes/foods.js";
import myFoodRoutes from "./routes/my-foods.js";
import foodLogRoutes from "./routes/log.js";
import photoRoutes from "./routes/photos.js";
import weightRoutes from "./routes/weight.js";
import weightImportRoutes from "./routes/weight-import.js";
import glp1Routes from "./routes/glp1.js";
import trendRoutes from "./routes/trends.js";
import culuryRoutes from "./routes/culury.js";
import restaurantRoutes from "./routes/restaurants.js";
import backupRoutes from "./routes/backups.js";
import { scheduleBackups } from "./lib/backup.js";
import exportRoutes from "./routes/export.js";
import { scheduleRestaurantCleanup } from "./lib/restaurants/index.js";
import { scheduleUploadCleanup, setPhotoSecret } from "./lib/photos.js";
import { MailService, type EmailConfig, type TransportFactory } from "./lib/mail.js";
import emailSettingsRoutes from "./routes/settings-email.js";
import passwordResetRoutes from "./routes/password-reset.js";
import oauthRoutes from "./routes/oauth.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
    jwtSecret: string;
    now: () => Date; // the clock (tests can set it)
    ai: AiService;
    foodFetch: typeof fetch; // Open Food Facts / USDA (tests swap in a fake food web)
    dataDir: string; // where ByteSize keeps files (uploads/...)
    sleep: (ms: number) => Promise<void>; // waits (the restaurant queue); tests record instead of waiting
    mail: MailService; // Settings › Email: forgot-password codes
    oauthFetch?: typeof fetch; // the OAuth provider (tests swap in a pretend one)
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
  "POST /api/auth/forgot",
  "POST /api/auth/reset",
  "POST /api/auth/oauth/start",
  "GET /api/auth/oauth/callback",
  "POST /api/auth/oauth/finish",
  "GET /api/photos/:id", // the owner's login or the URL's signature (an <img> can't send the token)
]);

export interface AppOptions {
  db: Db;
  jwtSecret: string;
  logger?: boolean;
  now?: () => Date;
  rateLimit?: RateLimitOptions | false; // tests turn it off
  aiFetch?: AiFetch; // tests swap in a fake AI
  aiTimeScale?: number; // tests shrink AI waits
  foodFetch?: typeof fetch; // tests swap in a fake food web
  dataDir?: string; // default: DATA_DIR, else ./data/app (tests use a temp folder)
  sleep?: (ms: number) => Promise<void>;
  backupSchedule?: boolean; // the daily backup (default on; tests turn it off)
  emailEnv?: EmailConfig | null; // email settings from .env (used when none are saved in the app)
  mailTransport?: TransportFactory; // tests swap in a fake: no email is ever sent
  oauthFetch?: typeof fetch; // tests: a pretend OAuth provider
}

export function buildApp(opts: AppOptions): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: process.env.TRUST_PROXY ?? "loopback, linklocal, uniquelocal" });
  app.decorate("db", opts.db);
  app.decorate("jwtSecret", opts.jwtSecret);
  app.decorate("now", opts.now ?? (() => new Date()));
  app.decorate("ai", new AiService(opts.db, opts.jwtSecret, opts.aiFetch, opts.aiTimeScale ?? 1));
  app.decorate("foodFetch", opts.foodFetch ?? ((input: Parameters<typeof fetch>[0], init?: RequestInit) => fetch(input, init)));
  app.decorate("sleep", opts.sleep ?? ((ms: number) => new Promise<void>((res) => setTimeout(res, ms))));
  app.decorate("mail", new MailService(opts.db, opts.jwtSecret, opts.emailEnv ?? null, opts.mailTransport, app.now));
  app.decorate("oauthFetch", opts.oauthFetch);
  setPhotoSecret(opts.jwtSecret);
  app.decorate("dataDir", path.resolve(opts.dataDir ?? process.env.DATA_DIR ?? "data/app"));

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: "Invalid request", details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HttpError) return reply.status(err.statusCode).send({ ...err.extra, error: err.message });
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
    // No such route (or only the web app's catch-all, which hands /api back to it): the 404 handler answers
    if (!req.routeOptions.url || req.routeOptions.url === "/*") return;
    throw new HttpError(401, "Not logged in");
  });

  app.register(healthRoutes);
  app.register(authRoutes);
  app.register(passwordResetRoutes); // forgot password: an emailed 6-digit code
  app.register(oauthRoutes); // sign in with OAuth / OpenID Connect, Link my account
  app.register(emailSettingsRoutes); // Settings › Email (admin)
  app.register(adminUserRoutes);
  app.register(profileRoutes);
  app.register(passkeyRoutes);
  app.register(aiSettingsRoutes);
  app.register(logRoutes);
  app.register(foodSourceRoutes);
  app.register(bodyPlanRoutes);
  app.register(settingsMeRoutes);
  app.register(foodRoutes);
  app.register(myFoodRoutes);
  app.register(foodLogRoutes);
  app.register(photoRoutes); // registers multipart uploads for its own routes only
  app.register(weightRoutes);
  app.register(weightImportRoutes); // Settings › Data: weight history from a CSV (multipart for its own routes only)
  app.register(glp1Routes);
  app.register(trendRoutes); // weekly trends, badges, vacations
  app.register(culuryRoutes); // the person's Culury link: meal plan and recipes
  app.register(restaurantRoutes); // restaurant menus (Spoonacular, FatSecret)
  app.register(backupRoutes); // admin: whole-server backups and restore
  app.register(exportRoutes); // Download my data
  scheduleUploadCleanup(app);
  scheduleRestaurantCleanup(app); // FatSecret foods nobody kept, restaurant searches past 24 h
  if (opts.backupSchedule ?? true) scheduleBackups(app); // daily backup after BACKUP_HOUR
  return app;
}
