import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { badges, glp1Shots, logEntries, userBody, userSettings, users, vacations, weighIns } from "../db/schema.js";
import { HttpError, badRequest } from "../lib/errors.js";
import { requireUser } from "../lib/guards.js";
import { addDays, DAY, localDay, loggedDays, vacationCheck } from "../lib/days.js";
import { badgeList, earnedBadges } from "../lib/badges.js";
import type { Nutrients } from "../lib/nutrients.js";
import { averages, judge, trendOn, trendSeries, TREND_NUTRIENTS, weekStartOf, type DayLog, type Status, type TrendNutrient } from "../lib/trends.js";
import { DEFAULT_WEEK_START } from "./settings-me.js";
import { targetsOn } from "./body-plans.js";

// Weekly trends, badges and vacation mode. Who is asking comes only from the login.

const MAX_WEEKS = 104;
const MAX_VACATION_DAYS = 60;
const weeklyQuery = z.object({ weeks: z.coerce.number().int().min(1, "Choose at least 1 week").max(MAX_WEEKS, `Choose up to ${MAX_WEEKS} weeks`).default(12) });
const vacationBody = z.object({ from: DAY, to: DAY });
const seenBody = z.object({ ids: z.array(z.string().max(40)).min(1, "Choose at least one badge").max(100) });
const idParam = z.object({ id: z.coerce.number().int().positive().max(2147483647) });

async function userTimezone(db: Db, userId: number): Promise<string> {
  const [u] = await db.select({ timezone: users.timezone }).from(users).where(eq(users.id, userId));
  if (!u) throw new HttpError(401, "Not logged in");
  return u.timezone;
}

const roundKg = (kg: number) => Math.round(kg * 1000) / 1000;

/** Per week (the person's week start), newest first: days logged, averages, status against targets, change in trend weight. */
async function weekly(db: Db, userId: number, today: string, weeks: number) {
  const [s] = await db.select({ weekStart: userSettings.weekStart }).from(userSettings).where(eq(userSettings.userId, userId));
  const newest = weekStartOf(today, s?.weekStart ?? DEFAULT_WEEK_START);
  const oldest = addDays(newest, -7 * (weeks - 1));

  const rows = await db
    .select({ day: logEntries.day, source: logEntries.source, nutrients: logEntries.nutrients })
    .from(logEntries)
    .where(and(eq(logEntries.userId, userId), gte(logEntries.day, oldest), lte(logEntries.day, today)));
  const byDay = new Map<string, DayLog>();
  for (const r of rows) {
    const d = byDay.get(r.day) ?? { foods: [], waterMl: [] };
    if (r.source === "water") d.waterMl.push((r.nutrients as Nutrients).water_ml ?? 0);
    else d.foods.push(r.nutrients as Nutrients);
    byDay.set(r.day, d);
  }
  const series = trendSeries(await db.select({ day: weighIns.day, weightKg: weighIns.weightKg }).from(weighIns).where(and(eq(weighIns.userId, userId), lte(weighIns.day, today))));

  const out = [];
  for (let i = 0; i < weeks; i++) {
    const start = addDays(newest, -7 * i);
    const end = addDays(start, 6);
    const days = [...byDay.entries()].filter(([d, log]) => d >= start && d <= end && log.foods.length > 0).sort(([x], [y]) => (x < y ? -1 : 1));
    const avg = averages(days.map(([, log]) => log));
    // Judged against the targets in force on the week's last logged day
    const targets = days.length ? await targetsOn(db, userId, days[days.length - 1][0]) : null;
    const status = Object.fromEntries(TREND_NUTRIENTS.map((k) => [k, judge(avg[k], targets?.[k])])) as Record<TrendNutrient, Status>;
    // That week's change in trend weight: from the trend before the week (or its first weigh-in) to its last weigh-in
    const inWeek = series.filter((p) => p.day >= start && p.day <= end);
    const before = trendOn(series, addDays(start, -1));
    const weightChangeKg = inWeek.length ? roundKg(inWeek[inWeek.length - 1].trendKg - (before ?? inWeek[0].trendKg)) : null;
    out.push({ start, end, daysLogged: days.length, avg, status, weightChangeKg });
  }
  return out;
}

/** Works out the badges the history earns, stores any not stored yet (first earn wins, never removed), returns the list. */
async function refreshBadges(db: Db, userId: number, today: string) {
  const [w, body, days, onVacation, shots] = await Promise.all([
    db.select({ day: weighIns.day, weightKg: weighIns.weightKg }).from(weighIns).where(and(eq(weighIns.userId, userId), lte(weighIns.day, today))),
    db.select({ goalKg: userBody.goalWeightKg }).from(userBody).where(eq(userBody.userId, userId)),
    loggedDays(db, userId, today),
    vacationCheck(db, userId),
    db.select({ day: glp1Shots.day }).from(glp1Shots).where(and(eq(glp1Shots.userId, userId), lte(glp1Shots.day, today))),
  ]);
  const earned = earnedBadges({ weighIns: w, goalKg: body[0]?.goalKg ?? null, loggedDays: days, onVacation, today, shotDays: shots.map((s) => s.day) });
  if (earned.size) {
    await db
      .insert(badges)
      .values([...earned].map(([badge, earnedOn]) => ({ userId, badge, earnedOn })))
      .onConflictDoNothing();
  }
  const stored = await db.select({ badge: badges.badge, earnedOn: badges.earnedOn, seen: badges.seen }).from(badges).where(eq(badges.userId, userId)).orderBy(asc(badges.badge));
  const list = badgeList(stored);
  return { badges: list, new: list.filter((b) => b.earnedOn && !b.seen).map((b) => b.id) };
}

export default async function trendRoutes(app: FastifyInstance) {
  const { db } = app;
  const todayFor = async (userId: number) => localDay(await userTimezone(db, userId), app.now());

  app.get("/api/trends/weekly", async (req) => {
    const userId = requireUser(req);
    const { weeks } = weeklyQuery.parse(req.query ?? {});
    return { weeks: await weekly(db, userId, await todayFor(userId), weeks) };
  });

  // Every badge (earned or not; "new" = earned and not yet shown), storing any newly earned
  app.get("/api/badges", async (req) => {
    const userId = requireUser(req);
    return refreshBadges(db, userId, await todayFor(userId));
  });

  // The celebration was shown: these badges are no longer new
  app.post("/api/badges/seen", async (req) => {
    const userId = requireUser(req);
    const { ids } = seenBody.parse(req.body ?? {});
    const rows = await db
      .update(badges)
      .set({ seen: true })
      .where(and(eq(badges.userId, userId), inArray(badges.badge, ids)))
      .returning({ badge: badges.badge });
    return { seen: rows.map((r) => r.badge).sort() };
  });

  // Vacation mode: date ranges (inclusive) in which a day without food doesn't break the streak
  app.get("/api/vacations", async (req) => {
    const userId = requireUser(req);
    const rows = await db
      .select({ id: vacations.id, from: vacations.fromDay, to: vacations.toDay })
      .from(vacations)
      .where(eq(vacations.userId, userId))
      .orderBy(desc(vacations.fromDay), desc(vacations.id));
    return { vacations: rows };
  });

  app.post("/api/vacations", async (req) => {
    const userId = requireUser(req);
    const { from, to } = vacationBody.parse(req.body ?? {});
    if (from > to) throw badRequest("The end can't be before the start");
    if (addDays(from, MAX_VACATION_DAYS - 1) < to) throw badRequest(`A vacation can be at most ${MAX_VACATION_DAYS} days`);
    const [row] = await db.insert(vacations).values({ userId, fromDay: from, toDay: to }).returning({ id: vacations.id, from: vacations.fromDay, to: vacations.toDay });
    return { vacation: row };
  });

  app.delete("/api/vacations/:id", async (req, reply) => {
    const userId = requireUser(req);
    const { id } = idParam.parse(req.params);
    const gone = await db
      .delete(vacations)
      .where(and(eq(vacations.id, id), eq(vacations.userId, userId)))
      .returning({ id: vacations.id });
    if (!gone.length) throw new HttpError(404, "Vacation not found");
    return reply.status(204).send();
  });
}
