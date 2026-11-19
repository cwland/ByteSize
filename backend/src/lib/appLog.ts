import { and, desc, eq, inArray, lt, type SQL } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { appLog } from "../db/schema.js";

// Settings › Logs. One line per event, kept 30 days. Each line says whose action it was
// (userId; null for the server's own): a member sees only their own lines, an admin sees all.
//  - ai:       an AI service that didn't answer, timed out, or answered with something unusable; AI tests
//  - api:      server errors
//  - auth:     sign-in events
//  - schedule: scheduled task runs (backups, reminders)
//  - food:     food lookups
//  - email:    emails sent (only the subject, never a code)
export const LOG_CATEGORIES = ["ai", "api", "auth", "schedule", "food", "email"] as const;
export type LogCategory = (typeof LOG_CATEGORIES)[number];
export type LogLevel = "info" | "warning" | "error";
export const LOG_DAYS = 30;

export interface LogEntry {
  category: LogCategory;
  level: LogLevel;
  event: string;
  source?: string | null;
  detail?: string | null;
  userId?: number | null;
}

const clip = (s: string | null | undefined, n: number) => (s ? s.replace(/\s+/g, " ").trim().slice(0, n) : null);
const cutoff = () => new Date(Date.now() - LOG_DAYS * 24 * 60 * 60 * 1000);
let writes = 0;

// Lines being written (many callers don't wait): tests wait for them before emptying the tables
const pending = new Set<Promise<void>>();
export const logsPending = () => pending.size;
export async function logsSettled(): Promise<void> {
  while (pending.size) await Promise.allSettled([...pending]);
}

// Best effort: a log problem never breaks what's being logged
export function logEvent(db: Db, e: LogEntry): Promise<void> {
  const write = writeLine(db, e).finally(() => pending.delete(write));
  pending.add(write);
  return write;
}

async function writeLine(db: Db, e: LogEntry) {
  try {
    await db.insert(appLog).values({ category: e.category, level: e.level, event: clip(e.event, 300)!, source: clip(e.source, 120), detail: clip(e.detail, 1000), userId: e.userId ?? null });
    if (++writes % 50 === 0) await db.delete(appLog).where(lt(appLog.at, cutoff()));
  } catch {
    // ignore
  }
}

// Newest first; optionally one person's lines, one category and/or problems only
export async function recentLogs(db: Db, opts: { userId?: number; category?: LogCategory; problemsOnly?: boolean; limit?: number } = {}) {
  await db.delete(appLog).where(lt(appLog.at, cutoff()));
  const where: SQL[] = [];
  if (opts.userId !== undefined) where.push(eq(appLog.userId, opts.userId));
  if (opts.category) where.push(eq(appLog.category, opts.category));
  if (opts.problemsOnly) where.push(inArray(appLog.level, ["warning", "error"]));
  return db
    .select()
    .from(appLog)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(appLog.at), desc(appLog.id))
    .limit(opts.limit ?? 1000);
}
