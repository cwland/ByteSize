import type { FastifyInstance } from "fastify";
import { eq, sql } from "drizzle-orm";
import { appSettings, usageCounts } from "../db/schema.js";
import { logEvent } from "./appLog.js";

// The per-person usage counter behind Settings › App info. Counting happens where the event does (a barcode
// lookup, a photo read, an AI estimate, an outside call, a saved copy answering) and never gets in the way of
// what it counts: the caller doesn't wait for it, and a failure is logged, never thrown.

/** Outside sources, as keyed here (the order Settings › App info lists them). */
export const OUTSIDE_SOURCES = ["off", "usda", "fatsecret", "spoonacular", "culury"] as const;
export type OutsideSource = (typeof OUTSIDE_SOURCES)[number];
export type UsageKey = "barcodes_scanned" | "photos_read" | "ai_estimates" | "lookups_saved" | `outside_${OutsideSource}`;

const pending = new Set<Promise<void>>();

/** Adds `by` (default 1) to this person's count for `key`: one atomic upsert, started now and not waited for. */
export function countUsage(app: FastifyInstance, userId: number, key: UsageKey, by = 1): void {
  const write = (async () => {
    await app.db
      .insert(usageCounts)
      .values({ userId, key, count: by })
      .onConflictDoUpdate({ target: [usageCounts.userId, usageCounts.key], set: { count: sql`${usageCounts.count} + ${by}` } });
  })()
    .catch((err) => logEvent(app.db, { category: "api", level: "warning", source: "Usage counter", event: `Couldn't count ${key}`, detail: (err as Error)?.message, userId }))
    .finally(() => pending.delete(write));
  pending.add(write);
}

/** Counts started and not yet written. */
export const usagePending = () => pending.size;

/** Resolves when every count started so far has been written (or has failed): for shutdown and tests. */
export async function usageSettled(): Promise<void> {
  while (pending.size) await Promise.allSettled([...pending]);
}

const SINCE_KEY = "usage_counting_since";

/** The day counting began (YYYY-MM-DD, the app's clock in UTC): written the first time it is asked for, which is at start-up. */
export async function countingSince(app: FastifyInstance): Promise<string> {
  const read = async () => (await app.db.select().from(appSettings).where(eq(appSettings.key, SINCE_KEY)))[0]?.value as string | undefined;
  const have = await read();
  if (have) return have;
  const today = app.now().toISOString().slice(0, 10);
  await app.db.insert(appSettings).values({ key: SINCE_KEY, value: today }).onConflictDoNothing();
  return (await read()) ?? today;
}

/** Writes "counting since" when the server starts (so it is the day this shipped, not the day someone first looked). */
export function scheduleCountingSince(app: FastifyInstance) {
  app.addHook("onReady", async () => {
    await countingSince(app).catch((err) => logEvent(app.db, { category: "api", level: "warning", source: "Usage counter", event: "Couldn't note the day counting began", detail: (err as Error).message }));
  });
}
