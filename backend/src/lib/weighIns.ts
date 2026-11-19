// Weigh-ins (§13 A) and the body weight that follows the latest one: shared by routes/weight.ts, the plan form,
// the CSV import and the demo seeder (lib code, so lib/demoData.ts needn't import routes).
import { and, desc, eq, gt } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { userBody, weighIns } from "../db/schema.js";

/** The database or a transaction on it */
export type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export async function latestWeighIn(db: DbOrTx, userId: number) {
  const [row] = await db.select().from(weighIns).where(eq(weighIns.userId, userId)).orderBy(desc(weighIns.day)).limit(1);
  return row ?? null;
}

/** The body weight (the plan's weight) follows the latest weigh-in; no body profile yet: nothing to update. */
export async function syncBodyWeight(db: DbOrTx, userId: number, now: Date) {
  const latest = await latestWeighIn(db, userId);
  if (!latest) return;
  await db.update(userBody).set({ weightKg: latest.weightKg, updatedAt: now }).where(eq(userBody.userId, userId));
}

export const isLatest = async (db: DbOrTx, userId: number, day: string) =>
  !(await db.select({ id: weighIns.id }).from(weighIns).where(and(eq(weighIns.userId, userId), gt(weighIns.day, day))).limit(1)).length;

/**
 * Saves the day's weigh-in (replacing one already there; note undefined keeps its note) and, when it is the
 * latest, makes it the body weight. Run it in a transaction so the two never disagree.
 */
export async function saveWeighIn(db: DbOrTx, userId: number, day: string, weightKg: number, note: string | null | undefined, now: Date) {
  const set = note === undefined ? { weightKg } : { weightKg, note };
  const [row] = await db
    .insert(weighIns)
    .values({ userId, day, weightKg, note: note ?? null })
    .onConflictDoUpdate({ target: [weighIns.userId, weighIns.day], set })
    .returning();
  // A backdated weigh-in leaves the body weight alone
  if (await isLatest(db, userId, day)) await syncBodyWeight(db, userId, now);
  return row;
}

