// Reset someone's password from the server (there are no reset emails).
//   npm run reset-password -- <username>
//   docker compose exec bytesize npm run reset-password -- <username>
// Reads the new password from NEW_PASSWORD, or asks for it twice. Signs that person out everywhere.
import "dotenv/config";
import readline from "node:readline";
import { eq, sql } from "drizzle-orm";
import { createDb } from "../db/index.js";
import { runMigrations } from "../db/migrate.js";
import { users } from "../db/schema.js";
import { hashPassword } from "../lib/auth.js";
import { revokeAll } from "../lib/sessions.js";
import { normalizeUsername } from "../lib/users.js";

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  // Don't echo what's typed
  (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
    if (s.includes(question)) process.stdout.write(s);
  };
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    })
  );
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const { db, pool } = createDb(process.env.DATABASE_URL);
try {
  const username = normalizeUsername(process.argv[2] ?? "");
  if (!username) throw new Error("Usage: npm run reset-password -- <username>");
  await runMigrations(db);
  const [user] = await db.select().from(users).where(eq(users.username, username));
  if (!user) {
    const all = await db.select({ username: users.username }).from(users).orderBy(users.id);
    throw new Error(`No account "${username}". Accounts: ${all.map((u) => u.username).join(", ") || "none yet"}`);
  }
  let pw = process.env.NEW_PASSWORD;
  if (pw === undefined) {
    pw = await ask(`New password for ${username}: `);
    if ((await ask("Again: ")) !== pw) throw new Error("Passwords don't match");
  }
  if (pw.length < 8) throw new Error("Password must be at least 8 characters");
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(pw), tokenVersion: sql`${users.tokenVersion} + 1` })
    .where(eq(users.id, user.id));
  await revokeAll(db, user.id);
  console.log(`Password changed for ${username}`);
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
