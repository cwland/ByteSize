// Locked out by OAuth? Turns OAuth only and OAuth sign-in off, straight in the database.
//   npm run auth:reset
//   docker compose exec bytesize npm run auth:reset
// Or set EMERGENCY_DISABLE_OAUTH=true in .env and restart: the server does the same at start.
import "dotenv/config";
import { pathToFileURL } from "node:url";
import { createDb, type Db } from "../db/index.js";
import { runMigrations } from "../db/migrate.js";
import { logEvent } from "../lib/appLog.js";
import { emergencyResetAuth } from "../lib/oauth.js";

export async function authReset(db: Db) {
  const r = await emergencyResetAuth(db);
  await logEvent(db, { category: "auth", level: "warning", source: "Command line", event: "OAuth sign-in turned off from the command line" });
  return r;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  const { db, pool } = createDb(process.env.DATABASE_URL);
  try {
    await runMigrations(db);
    const r = await authReset(db);
    console.log(`OAuth sign-in was ${r.was.enabled ? "on" : "off"}, OAuth only ${r.was.oauthOnly ? "on" : "off"}. Both are off now.`);
    console.log("Sign in with your username and password. (Forgot it? npm run reset-password)");
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
