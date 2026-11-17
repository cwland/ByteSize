import type { FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { HttpError } from "./errors.js";

// Security headers on every response. The CSP allows only this server's own scripts; images may
// also come from https:// sites (food photos from Open Food Facts) and data: URLs.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export interface RateLimitOptions {
  max: number; // requests per window, per address, to each sensitive route
  windowMs: number;
}
export const DEFAULT_RATE_LIMIT: RateLimitOptions = { max: 10, windowMs: 60_000 };

// Sign-in, password reset and account setup: limited per address (on top of the login lockout)
export const SENSITIVE_ROUTES = new Set([
  "POST /api/auth/setup",
  "POST /api/auth/login",
  "POST /api/passkeys/login/options",
  "POST /api/passkeys/login/verify",
  "POST /api/auth/password",
]);

export function securityHeaders(app: FastifyInstance) {
  app.addHook("onSend", async (req, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "same-origin");
    reply.header("Cross-Origin-Opener-Policy", "same-origin");
    reply.header("Permissions-Policy", "camera=(self), microphone=(), geolocation=(), screen-wake-lock=(self)");
    if (!req.url.startsWith("/api/")) reply.header("Content-Security-Policy", CSP);
    // HTTPS (directly or through a reverse proxy that says so): browsers stay on HTTPS
    if (req.protocol === "https") reply.header("Strict-Transport-Security", "max-age=15552000");
  });
}

// Must be set up before the routes are registered
export function rateLimits(app: FastifyInstance, opts: RateLimitOptions | false) {
  if (!opts) return;
  app.addHook("onRoute", (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    if (methods.some((m) => SENSITIVE_ROUTES.has(`${m} ${route.url}`))) {
      route.config = { ...(route.config as object), rateLimit: { max: opts.max, timeWindow: opts.windowMs } } as typeof route.config;
    }
  });
  app.register(rateLimit, {
    global: false,
    // One count per route and address (so a few sign-ins don't use up password resets)
    keyGenerator: (req) => `${req.routeOptions.url}|${req.ip}`,
    errorResponseBuilder: (_req, ctx) => new HttpError(429, `Too many tries. Wait ${Math.ceil(ctx.ttl / 1000)} seconds and try again.`),
  });

}
