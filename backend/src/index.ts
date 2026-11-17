import "dotenv/config";
import { createDb } from "./db/index.js";
import { runMigrations } from "./db/migrate.js";
import { buildApp } from "./app.js";

const databaseUrl = process.env.DATABASE_URL;
const jwtSecret = process.env.JWT_SECRET ?? "";
if (!databaseUrl) {
  console.error("DATABASE_URL isn't set. Copy .env.example to .env and fill it in.");
  process.exit(1);
}
if (jwtSecret.length < 32) {
  console.error("JWT_SECRET must be at least 32 characters. Make one with: openssl rand -base64 48");
  process.exit(1);
}

const { db } = createDb(databaseUrl);
await runMigrations(db);

const app = buildApp({ db, jwtSecret, logger: true });
const port = Number(process.env.PORT ?? 4100);
await app.listen({ port, host: "0.0.0.0" });
