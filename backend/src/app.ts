import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { Db } from "./db/index.js";
import { HttpError } from "./lib/errors.js";
import healthRoutes from "./routes/health.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
    jwtSecret: string;
    now: () => Date; // the clock (tests can set it)
  }
}

export interface AppOptions {
  db: Db;
  jwtSecret: string;
  logger?: boolean;
  now?: () => Date;
}

export function buildApp(opts: AppOptions): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: process.env.TRUST_PROXY ?? "loopback, linklocal, uniquelocal" });
  app.decorate("db", opts.db);
  app.decorate("jwtSecret", opts.jwtSecret);
  app.decorate("now", opts.now ?? (() => new Date()));

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: "Invalid request", details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HttpError) return reply.status(err.statusCode).send({ error: err.message });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.status(status).send({ error: (err as Error).message });
    req.log.error(err);
    return reply.status(500).send({ error: "Something went wrong" });
  });
  app.setNotFoundHandler((req, reply) => reply.status(404).send({ error: `Not found: ${req.method} ${req.url.split("?")[0]}` }));

  app.register(healthRoutes);
  return app;
}
