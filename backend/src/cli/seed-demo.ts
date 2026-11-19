// Fill an existing account with a few months of believable tracking, to try the app with (spec §38).
//   npm run seed-demo                          the first admin, 90 days
//   npm run seed-demo -- --user <username> --days 120
//   npm run seed-demo -- --replace             wipe that account's tracking and the foods this made, and fill it again
//   docker compose exec -u node bytesize npm run seed-demo
// Never creates an account. Touches only the one account's entries, weigh-ins, water, shots and the foods it made itself.
import "dotenv/config";
import { pathToFileURL } from "node:url";
import { createDb } from "../db/index.js";
import { runMigrations } from "../db/migrate.js";
import { parseSeedArgs, seedDemo } from "../lib/demoData.js";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  let args: ReturnType<typeof parseSeedArgs>;
  try {
    args = parseSeedArgs(process.argv.slice(2));
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
  const { db, pool } = createDb(process.env.DATABASE_URL);
  try {
    await runMigrations(db);
    const r = await seedDemo(db, args);
    if (r.replaced || r.deleted.foods) {
      const d = r.deleted;
      console.log(`Deleted from ${r.username}: ${d.entries} log entries (water included), ${d.weighIns} weigh-ins, ${d.shots} shots, ${d.foods} demo foods and quick meals.`);
    }
    console.log(`Filled ${r.username} (${r.timezone}) from ${r.from} to ${r.to}:`);
    console.log(`  ${r.foods} My foods and ${r.quickMeals} quick meals, ${r.entries} food log entries over ${args.days - r.emptyDays} days (${r.emptyDays} left empty), ${r.waterEntries} water entries,`);
    console.log(`  ${r.weighIns} weigh-ins, ${r.shots} GLP-1 shots.`);
    console.log("Sign in as that account to see it. Run again with --replace to wipe and refill.");
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
