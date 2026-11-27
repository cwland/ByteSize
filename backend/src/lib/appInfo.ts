import type { FastifyInstance } from "fastify";
import { and, asc, count, countDistinct, eq, ne, sql } from "drizzle-orm";
import { glp1Shots, logEntries, usageCounts, userBody, userFoods, users, weighIns } from "../db/schema.js";
import { addDays, localDay, vacationCheck } from "./days.js";
import { HttpError } from "./errors.js";
import { OUTSIDE_SOURCES, countingSince } from "./usage.js";
import { APP_VERSION } from "./version.js";
import { trendOf } from "./weight.js";

// Settings › App info: a person's own numbers and (for the admin) the totals for everyone.

const KG_TO_LB = 2.2046226218;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** The longest run of days with food (water doesn't count); a vacation day without food neither counts nor breaks it. */
export function longestRun(days: string[], onVacation: (day: string) => boolean): number {
  const logged = new Set(days);
  if (!logged.size) return 0;
  const sorted = [...logged].sort();
  let best = 0;
  let run = 0;
  for (let d = sorted[0]; d <= sorted[sorted.length - 1]; d = addDays(d, 1)) {
    if (logged.has(d)) best = Math.max(best, ++run);
    else if (!onVacation(d)) run = 0;
  }
  return best;
}

const outsideTotals = (by: Record<string, number>) => {
  const per = Object.fromEntries(OUTSIDE_SOURCES.map((s) => [s, by[`outside_${s}`] ?? 0])) as Record<(typeof OUTSIDE_SOURCES)[number], number>;
  return { total: OUTSIDE_SOURCES.reduce((n, s) => n + per[s], 0), ...per };
};

async function mine(app: FastifyInstance, userId: number) {
  const { db } = app;
  const [me] = await db.select({ createdAt: users.createdAt, timezone: users.timezone, units: users.units }).from(users).where(eq(users.id, userId));
  if (!me) throw new HttpError(401, "Not logged in");
  const food = and(eq(logEntries.userId, userId), ne(logEntries.source, "water"));
  const [entries] = await db
    .select({ foods: count(), days: countDistinct(logEntries.day), different: countDistinct(sql`coalesce(${logEntries.sourceRef}, lower(${logEntries.name}))`) })
    .from(logEntries)
    .where(food);
  const days = (await db.selectDistinct({ day: logEntries.day }).from(logEntries).where(food)).map((r) => r.day);
  const [{ myFoods }] = await db.select({ myFoods: count() }).from(userFoods).where(and(eq(userFoods.userId, userId), eq(userFoods.archived, false)));
  const weigh = await db.select({ day: weighIns.day, weightKg: weighIns.weightKg }).from(weighIns).where(eq(weighIns.userId, userId)).orderBy(asc(weighIns.day));
  // Lost so far, as on the Weight page: by the scale (first − latest weigh-in) and by the trend (first − latest trend)
  const trend = trendOf(weigh);
  const unit = me.units === "metric" ? ("kg" as const) : ("lb" as const);
  const shown = (kg: number) => {
    const amount = unit === "kg" ? round1(kg) : round1(kg * KG_TO_LB);
    return amount > 0 ? { amount, unit } : null;
  };
  const first = weigh[0];
  const lastPoint = trend[trend.length - 1];
  const many = weigh.length > 1;
  const [body] = await db.select({ glp1: userBody.glp1 }).from(userBody).where(eq(userBody.userId, userId));
  const [{ shots }] = await db.select({ shots: count() }).from(glp1Shots).where(eq(glp1Shots.userId, userId));
  const by = Object.fromEntries((await db.select().from(usageCounts).where(eq(usageCounts.userId, userId))).map((r) => [r.key, r.count]));
  return {
    daysLogged: entries.days,
    foodsLogged: entries.foods,
    differentFoods: entries.different,
    myFoods,
    weighIns: weigh.length,
    weightLost: many ? shown(first.weightKg - lastPoint.weightKg) : null,
    weightLostTrend: many ? shown(first.weightKg - lastPoint.trendKg) : null,
    shots: body?.glp1 ? shots : null,
    longestStreak: longestRun(days, await vacationCheck(db, userId)),
    memberSince: localDay(me.timezone, me.createdAt),
    barcodesScanned: by.barcodes_scanned ?? 0,
    photosRead: by.photos_read ?? 0,
    aiEstimates: by.ai_estimates ?? 0,
    aiInsights: by.ai_insights ?? 0, // §43: recaps, protein help and answers the AI wrote
    lookupsSaved: by.lookups_saved ?? 0,
    outsideLookups: outsideTotals(by),
  };
}

async function everyone(app: FastifyInstance) {
  const { db } = app;
  const [{ people }] = await db.select({ people: count() }).from(users);
  const food = ne(logEntries.source, "water");
  const [{ foods }] = await db.select({ foods: count() }).from(logEntries).where(food);
  const [{ days }] = await db.select({ days: sql<number>`count(*)::int` }).from(db.selectDistinct({ u: logEntries.userId, d: logEntries.day }).from(logEntries).where(food).as("d"));
  const by: Record<string, number> = {};
  for (const r of await db.select({ key: usageCounts.key, n: sql<number>`sum(${usageCounts.count})::int` }).from(usageCounts).groupBy(usageCounts.key)) by[r.key] = r.n;
  return { people, daysLogged: days, foodsLogged: foods, barcodesScanned: by.barcodes_scanned ?? 0, outsideLookups: outsideTotals(by).total, lookupsSaved: by.lookups_saved ?? 0 };
}

export async function appInfo(app: FastifyInstance, userId: number, isAdmin: boolean) {
  return {
    you: await mine(app, userId),
    ...(isAdmin ? { everyone: await everyone(app) } : {}),
    countingSince: await countingSince(app),
    version: APP_VERSION,
  };
}
