import "dotenv/config";
import path from "node:path";
import { createDb } from "./db/index.js";
import { runMigrations } from "./db/migrate.js";
import { buildApp } from "./app.js";
import { serveWeb } from "./web.js";
import { startupProblem } from "./lib/startup.js";
import { emailConfigFromEnv } from "./lib/mail.js";
import { applyEmergencyOAuthSwitch } from "./lib/oauth.js";

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
try {
  await runMigrations(db);
} catch (err) {
  // A missing database, a stopped server or a wrong password: say so in one line, not a stack trace
  const problem = startupProblem(err, databaseUrl);
  if (!problem) throw err;
  console.error(problem);
  process.exit(1);
}

const app = buildApp({ db, jwtSecret, logger: true, emailEnv: emailConfigFromEnv(process.env) });
// Locked out by OAuth? EMERGENCY_DISABLE_OAUTH=true turns OAuth only and OAuth sign-in off at every start
const emergency = await applyEmergencyOAuthSwitch(db, process.env);
if (emergency) app.log.warn(`EMERGENCY_DISABLE_OAUTH: OAuth sign-in and OAuth only are off (OAuth was ${emergency.was.enabled ? "on" : "off"}, OAuth only ${emergency.was.oauthOnly ? "on" : "off"}). Remove the setting once you're back in.`);
// Production (Docker): the API also serves the built web app from WEB_DIR
if (process.env.WEB_DIR) await serveWeb(app, path.resolve(process.env.WEB_DIR));
const port = Number(process.env.PORT ?? 4100);
await app.listen({ port, host: "0.0.0.0" });
