// Reset a password from the server (locked out, or email isn't set up).
//   npm run reset-password                       the first admin: prints a new random password once
//   npm run reset-password -- <username>         that person
//   npm run reset-password -- <username> --password   type the new password instead (or set NEW_PASSWORD)
// A password is never given as an argument (it would stay in the shell history), and arguments are never printed.
//   docker compose exec bytesize npm run reset-password -- <username>
// Signs that person out everywhere, and goes in Settings › Logs.
import "dotenv/config";
import crypto from "node:crypto";
import readline from "node:readline";
import { pathToFileURL } from "node:url";
import { asc, eq, sql } from "drizzle-orm";
import { createDb, type Db } from "../db/index.js";
import { runMigrations } from "../db/migrate.js";
import { users } from "../db/schema.js";
import { hashPassword } from "../lib/auth.js";
import { logEvent } from "../lib/appLog.js";
import { revokeAll } from "../lib/sessions.js";
import { normalizeUsername } from "../lib/users.js";

export const USAGE =
  "Usage: npm run reset-password -- [username] [--password]\n" +
  "Without a username: the first admin. Without --password: a new random password is printed once.\n" +
  "The new password is never given as an argument: --password asks for it, or set NEW_PASSWORD.";

/** At most one username and --password; anything else is refused (without repeating it: it may be a password). */
export function parseResetArgs(args: string[]) {
  const names = args.filter((a) => !a.startsWith("-"));
  const flags = args.filter((a) => a.startsWith("-"));
  if (names.length > 1 || flags.some((f) => f !== "--password")) throw new Error(USAGE);
  return { username: names[0] as string | undefined, typePassword: flags.includes("--password") };
}

/** Sets a new password (the one given, or a random one) and ends the account's sessions. */
export async function resetPassword(db: Db, opts: { username?: string; password?: string }) {
  const all = await db.select().from(users).orderBy(asc(users.id));
  const wanted = opts.username ? normalizeUsername(opts.username) : "";
  const user = wanted ? all.find((u) => u.username === wanted) : all.find((u) => u.isAdmin);
  if (!user) {
    if (!wanted) throw new Error("No admin account yet. Open ByteSize to set one up.");
    throw new Error(`No account has that username. Accounts: ${all.map((u) => u.username).join(", ") || "none yet"}`);
  }
  const generated = opts.password === undefined;
  const password = opts.password ?? crypto.randomBytes(15).toString("base64url");
  if (password.length < 8) throw new Error("Password must be at least 8 characters");
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(password), tokenVersion: sql`${users.tokenVersion} + 1` })
    .where(eq(users.id, user.id));
  await revokeAll(db, user.id);
  await logEvent(db, { category: "auth", level: "info", source: "Command line", event: "Password reset from the command line", detail: user.username, userId: user.id });
  return { username: user.username, password, generated };
}

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

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  let args: ReturnType<typeof parseResetArgs>;
  try {
    args = parseResetArgs(process.argv.slice(2));
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
  const { username, typePassword } = args;
  const { db, pool } = createDb(process.env.DATABASE_URL);
  try {
    await runMigrations(db);
    let password: string | undefined;
    if (typePassword) {
      password = process.env.NEW_PASSWORD;
      if (password === undefined) {
        password = await ask("New password: ");
        if ((await ask("Again: ")) !== password) throw new Error("Passwords don't match");
      }
    }
    const r = await resetPassword(db, { username, password });
    console.log(`Password changed for ${r.username}. All of their devices are signed out.`);
    if (r.generated) console.log(`New password (shown once): ${r.password}`);
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
