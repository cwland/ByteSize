// Insights (§43): loading a person's data, asking the AI (lib/ai.ts, the "insights" task: the services in their order,
// failover, a cut-off answer asked again with more room), keeping what it wrote, the on-demand limits, and the weekly
// run. What the AI is told and how its answers are read: lib/insights.ts (pure).
import type { FastifyInstance } from "fastify";
import { and, asc, count, countDistinct, desc, eq, gte, inArray, isNotNull, lte, ne, notInArray } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { activitySteps, glp1Settings, glp1Shots, insights, logEntries, targets, userBody, userSettings, users, weighIns, workouts } from "../db/schema.js";
import { AiError, AiStopped, type AiProgress } from "./ai.js";
import { logEvent } from "./appLog.js";
import { calorieDays } from "./calorieDays.js";
import { addDays, localDay } from "./days.js";
import { HttpError } from "./errors.js";
import {
  INSIGHTS_SYSTEM,
  buildSummary,
  goalsForSummary,
  proteinAsk,
  proteinFacts,
  questionAsk,
  questionRange,
  readAnswer,
  readProtein,
  readRecap,
  recapAsk,
  weekNumbers,
  type SummaryInput,
} from "./insights.js";
import { waitOnClose } from "./schedule.js";
import { weekStartOf } from "./trends.js";
import { countUsage } from "./usage.js";
import { activeGoals } from "./goalsData.js";

export const INSIGHTS_OFF = "Insights need an AI service. An admin can set one up in Settings › Integrations.";
export const INSIGHTS_FAILED = "Couldn't write your insights right now. Try again in a little while.";
export const REFRESH_EVERY_MS = 10 * 60_000; // Refresh: once per 10 minutes per card per person
export const QUESTIONS_PER_DAY = 20; // and questions: 20 a day (the person's day)
export const KEEP_ANSWERS = 20;
export const KEEP_RECAPS = 27; // shown: this one and about half a year of past recaps
export const PROTEIN_DAYS = 28;
export const MIN_LOGGED_DAYS = 3; // the weekly recap is skipped for a week with fewer
export const WEEKLY_HOUR = 6; // about 6 am in the person's time zone, the day after their week ends
export const WEEKLY_TRIES = 4; // the first and 3 more, an hour apart
// A retry is due 55 minutes after the last try: the hourly check reaches a person a little earlier or later each time
export const RETRY_AFTER_MS = 55 * 60_000;
const HOUR_MS = 60 * 60_000;
const MAX_TOKENS = 3000;

type Opts = { signal?: AbortSignal; onProgress?: (p: AiProgress) => void };
type Person = { timezone: string; units: "imperial" | "metric"; weekStart: number; weeklyOn: boolean };

async function personOf(db: Db, userId: number): Promise<Person> {
  const [u] = await db
    .select({ timezone: users.timezone, units: users.units, weekStart: userSettings.weekStart, weeklyOn: userSettings.insightsWeekly })
    .from(users)
    .leftJoin(userSettings, eq(userSettings.userId, users.id))
    .where(eq(users.id, userId));
  if (!u) throw new HttpError(401, "Not logged in");
  return { timezone: u.timezone, units: u.units, weekStart: u.weekStart ?? 0, weeklyOn: u.weeklyOn ?? true };
}

/** The week before the one holding `today` (the person's week start). */
export const weekBefore = (today: string, weekStart: number) => {
  const start = addDays(weekStartOf(today, weekStart), -7);
  return { from: start, to: addDays(start, 6) };
};

/**
 * Everything the summary is built from, for `from`..`to` (weigh-ins from the first, for the trend). today: the person's
 * today, to add their active goals (§40c); left out where only the numbers are wanted.
 */
export async function loadSummaryInput(db: Db, userId: number, from: string, to: string, person: Person, today?: string): Promise<SummaryInput> {
  const inRange = <T extends typeof logEntries | typeof glp1Shots | typeof activitySteps | typeof workouts>(tbl: T) => and(eq(tbl.userId, userId), gte(tbl.day, from), lte(tbl.day, to));
  const [entries, targetRows, days, weigh, shots, steps, done, body, glp] = await Promise.all([
    db.select().from(logEntries).where(inRange(logEntries)).orderBy(asc(logEntries.day), asc(logEntries.id)),
    db.select().from(targets).where(and(eq(targets.userId, userId), lte(targets.effectiveFrom, to))),
    calorieDays(db, userId, from, to, person.weekStart),
    db.select({ day: weighIns.day, weightKg: weighIns.weightKg }).from(weighIns).where(and(eq(weighIns.userId, userId), lte(weighIns.day, to))).orderBy(asc(weighIns.day)),
    db.select({ day: glp1Shots.day, medication: glp1Shots.medication, doseMg: glp1Shots.doseMg }).from(glp1Shots).where(inRange(glp1Shots)),
    db.select({ day: activitySteps.day, source: activitySteps.source, steps: activitySteps.steps }).from(activitySteps).where(inRange(activitySteps)),
    db.select({ day: workouts.day, type: workouts.type, minutes: workouts.minutes, calories: workouts.calories }).from(workouts).where(inRange(workouts)),
    db.select({ goalWeightKg: userBody.goalWeightKg, glp1: userBody.glp1 }).from(userBody).where(eq(userBody.userId, userId)),
    db.select({ medication: glp1Settings.medication, doseMg: glp1Settings.doseMg }).from(glp1Settings).where(eq(glp1Settings.userId, userId)),
  ]);
  return {
    units: person.units,
    weekStart: person.weekStart,
    from,
    to,
    entries: entries.map((e) => ({ day: e.day, meal: e.meal, name: e.name, source: e.source, unit: e.unit, quantity: e.quantity, fraction: e.fraction, servingIndex: e.servingIndex, servings: e.servings, nutrients: e.nutrients })),
    targets: targetRows,
    calorieDays: days.map((d) => ({ day: d.day, status: d.status, range: d.range })),
    weighIns: weigh,
    shots,
    steps,
    workouts: done,
    goalWeightKg: body[0]?.goalWeightKg ?? null,
    glp1: body[0]?.glp1 && glp[0] ? glp[0] : null,
    goals: today ? goalsForSummary(await activeGoals(db, userId, today), person.units) : [],
  };
}

/** The "insights" task: the AI's answer as JSON. AI off: 503; no usable answer from any service: 502 (never naming one). */
async function askAi(app: FastifyInstance, userId: number, user: string, opts: Opts): Promise<Record<string, unknown>> {
  if (!(await app.ai.active("insights"))) throw new HttpError(503, INSIGHTS_OFF);
  try {
    return (await app.ai.ask("insights", INSIGHTS_SYSTEM, user, { userId, maxTokens: MAX_TOKENS, reasoning: "low", ...opts })).json;
  } catch (err) {
    if (err instanceof AiStopped || !(err instanceof AiError)) throw err;
    throw new HttpError(502, INSIGHTS_FAILED); // what went wrong is in Settings › Logs
  }
}

async function unusable(app: FastifyInstance, userId: number, what: string, json: unknown): Promise<never> {
  await logEvent(app.db, { category: "ai", level: "warning", source: "Insights", event: `The AI's ${what} couldn't be used`, detail: JSON.stringify(json).slice(0, 600), userId });
  throw new HttpError(502, INSIGHTS_FAILED);
}

export type InsightRow = typeof insights.$inferSelect;
/** A kept insight as the app gets it. soFar: a recap of a week that wasn't over (Refresh). */
export const insightView = (r: InsightRow) => ({
  id: r.id,
  kind: r.kind,
  source: r.source,
  soFar: r.kind === "recap" && r.source === "refresh",
  periodStart: r.periodStart,
  periodEnd: r.periodEnd,
  question: r.question,
  content: r.content,
  createdAt: r.createdAt.toISOString(),
});

/**
 * The recap for `period`: weekly (a week that ended) or refresh (this week so far). Written by the AI, with the app's
 * own numbers beside it. Replaces that week's "so far" recap (and the weekly one, a seed-demo recap of that week).
 */
export async function writeRecap(app: FastifyInstance, userId: number, source: "weekly" | "refresh", period: { from: string; to: string }, opts: Opts = {}) {
  const person = await personOf(app.db, userId);
  const input = await loadSummaryInput(app.db, userId, period.from, period.to, person, localDay(person.timezone, app.now()));
  const json = await askAi(app, userId, recapAsk(buildSummary(input), source === "refresh"), opts);
  const recap = readRecap(json) ?? (await unusable(app, userId, "weekly recap", json));
  const row = await app.db.transaction(async (tx) => {
    // The week's "so far" recap (and, for the final one, seed-demo's) gives way to this one
    await tx.delete(insights).where(and(eq(insights.userId, userId), eq(insights.kind, "recap"), inArray(insights.source, source === "weekly" ? ["refresh", "demo"] : ["refresh"]), eq(insights.periodStart, period.from)));
    const [made] = await tx
      .insert(insights)
      .values({ userId, kind: "recap", source, periodStart: period.from, periodEnd: period.to, content: { ...recap, numbers: weekNumbers(input) }, createdAt: app.now() })
      .returning();
    return made;
  });
  countUsage(app, userId, "ai_insights");
  return row;
}

/** Protein help and food swaps for the 4 weeks to `to`: the app's facts, the AI's additions and swaps. Replaces the last. */
export async function writeProtein(app: FastifyInstance, userId: number, source: "weekly" | "refresh", to: string, opts: Opts = {}) {
  const person = await personOf(app.db, userId);
  const from = addDays(to, -(PROTEIN_DAYS - 1));
  const input = await loadSummaryInput(app.db, userId, from, to, person, localDay(person.timezone, app.now()));
  const summary = buildSummary(input);
  const facts = proteinFacts(input);
  const json = await askAi(app, userId, proteinAsk(summary, facts), opts);
  const advice = readProtein(json, summary) ?? (await unusable(app, userId, "protein help", json));
  const row = await app.db.transaction(async (tx) => {
    await tx.delete(insights).where(and(eq(insights.userId, userId), eq(insights.kind, "protein")));
    const [made] = await tx.insert(insights).values({ userId, kind: "protein", source, periodStart: from, periodEnd: to, content: { ...advice, facts }, createdAt: app.now() }).returning();
    return made;
  });
  countUsage(app, userId, "ai_insights");
  return row;
}

/** An answer from the person's own data for the range the question implies; the last 20 are kept. */
export async function answerQuestion(app: FastifyInstance, userId: number, question: string, opts: Opts = {}) {
  const person = await personOf(app.db, userId);
  const today = localDay(person.timezone, app.now());
  const range = questionRange(question, today, person.weekStart);
  const input = await loadSummaryInput(app.db, userId, range.from, range.to, person, today);
  const json = await askAi(app, userId, questionAsk(buildSummary(input), question), opts);
  const content = readAnswer(json) ?? (await unusable(app, userId, "answer", json));
  const row = await app.db.transaction(async (tx) => {
    const [made] = await tx.insert(insights).values({ userId, kind: "answer", source: "ask", periodStart: range.from, periodEnd: range.to, question, content, createdAt: app.now() }).returning();
    const keep = (await tx.select({ id: insights.id }).from(insights).where(and(eq(insights.userId, userId), eq(insights.kind, "answer"))).orderBy(desc(insights.createdAt), desc(insights.id)).limit(KEEP_ANSWERS)).map((r) => r.id);
    await tx.delete(insights).where(and(eq(insights.userId, userId), eq(insights.kind, "answer"), notInArray(insights.id, keep)));
    return made;
  });
  countUsage(app, userId, "ai_insights");
  return row;
}

// ---------- limits ----------

/** Seconds until this card can be refreshed again (0: now). Only refreshes that worked count. */
export async function refreshWait(app: FastifyInstance, userId: number, kind: "recap" | "protein"): Promise<number> {
  const [last] = await app.db
    .select({ at: insights.createdAt })
    .from(insights)
    .where(and(eq(insights.userId, userId), eq(insights.kind, kind), eq(insights.source, "refresh")))
    .orderBy(desc(insights.createdAt))
    .limit(1);
  if (!last) return 0;
  return Math.max(0, Math.ceil((last.at.getTime() + REFRESH_EVERY_MS - app.now().getTime()) / 1000));
}

/** Questions the person can still ask today (their own day). */
export async function questionsLeft(app: FastifyInstance, userId: number, timezone?: string): Promise<number> {
  const tz = timezone ?? (await personOf(app.db, userId)).timezone;
  const now = app.now();
  const today = localDay(tz, now);
  const recent = await app.db
    .select({ at: insights.createdAt })
    .from(insights)
    .where(and(eq(insights.userId, userId), eq(insights.kind, "answer"), gte(insights.createdAt, new Date(now.getTime() - 27 * HOUR_MS))));
  return Math.max(0, QUESTIONS_PER_DAY - recent.filter((r) => localDay(tz, r.at) === today).length);
}

export const refreshTooSoon = (sec: number) =>
  new HttpError(429, `You refreshed this a few minutes ago. You can refresh it again in ${Math.max(1, Math.ceil(sec / 60))} minute${Math.ceil(sec / 60) === 1 ? "" : "s"}.`, { retryAfterSec: sec });
export const TOO_MANY_QUESTIONS = `You've asked ${QUESTIONS_PER_DAY} questions today. You can ask more tomorrow.`;

// ---------- the page ----------

const newest = <T extends typeof insights.createdAt>(c: T) => [desc(c), desc(insights.id)];

/** The Insights page: AI ready, the switch, the week just ended's numbers (from the app), the cards, and the limits. */
export async function insightsView(app: FastifyInstance, userId: number) {
  const person = await personOf(app.db, userId);
  const today = localDay(person.timezone, app.now());
  const week = weekBefore(today, person.weekStart);
  const mine = (kind: InsightRow["kind"]) => and(eq(insights.userId, userId), eq(insights.kind, kind));
  const [aiReady, numbers, recaps, protein, answers, left, recapIn, proteinIn] = await Promise.all([
    app.ai.active("insights").then((a) => !!a),
    loadSummaryInput(app.db, userId, week.from, week.to, person).then(weekNumbers),
    app.db.select().from(insights).where(mine("recap")).orderBy(desc(insights.periodStart), ...newest(insights.createdAt)).limit(KEEP_RECAPS),
    app.db.select().from(insights).where(mine("protein")).orderBy(...newest(insights.createdAt)).limit(1),
    app.db.select().from(insights).where(mine("answer")).orderBy(...newest(insights.createdAt)).limit(KEEP_ANSWERS),
    questionsLeft(app, userId, person.timezone),
    refreshWait(app, userId, "recap"),
    refreshWait(app, userId, "protein"),
  ]);
  return {
    aiReady,
    weeklyOn: person.weeklyOn,
    week: { ...week, numbers },
    recaps: recaps.map(insightView),
    protein: protein[0] ? insightView(protein[0]) : null,
    answers: answers.map(insightView),
    limits: { questionsLeft: left, questionsPerDay: QUESTIONS_PER_DAY, recapRefreshIn: recapIn, proteinRefreshIn: proteinIn },
  };
}

/** The Insights widget: the newest recap's opening lines. */
export async function latestRecap(app: FastifyInstance, userId: number) {
  const [r] = await app.db
    .select()
    .from(insights)
    .where(and(eq(insights.userId, userId), eq(insights.kind, "recap")))
    .orderBy(desc(insights.periodStart), ...newest(insights.createdAt))
    .limit(1);
  const aiReady = !!(await app.ai.active("insights"));
  const summary = (r?.content as { summary?: unknown } | undefined)?.summary;
  return { aiReady, recap: r ? { periodStart: r.periodStart, periodEnd: r.periodEnd, soFar: r.source === "refresh", summary: typeof summary === "string" ? summary : "", createdAt: r.createdAt.toISOString() } : null };
}

export async function setWeekly(app: FastifyInstance, userId: number, weeklyOn: boolean) {
  await app.db.insert(userSettings).values({ userId, insightsWeekly: weeklyOn }).onConflictDoUpdate({ target: userSettings.userId, set: { insightsWeekly: weeklyOn } });
  return { weeklyOn };
}

// ---------- the weekly run ----------

// Failed weekly recaps, per person and week: how many tries and when the last was. In memory: a restart starts the count
// again (at most 4 more tries per start; a server crashing over and over would try again on each start)
const runs = new WeakMap<FastifyInstance, Map<string, { tries: number; at: number }>>();
const runsOf = (app: FastifyInstance) => runs.get(app) ?? runs.set(app, new Map()).get(app)!;
/** Tests: forget earlier failures. */
export const resetInsightRuns = (app: FastifyInstance) => runsOf(app).clear();

const localHour = (timeZone: string, now: Date) => Number(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(now));

/**
 * The hourly check: each person whose week ended (and whose day after it has reached about 6 am) gets their recap for
 * that week, then their protein help, once. Skipped when they logged fewer than 3 days that week, the switch is off, or
 * AI isn't set up. A failed recap is tried again an hour later, up to 3 more times. Returns whose recaps were written.
 */
export async function weeklyInsightsCheck(app: FastifyInstance, signal?: AbortSignal): Promise<number[]> {
  if (!(await app.ai.active("insights"))) return [];
  const people = await app.db
    .select({ id: users.id, timezone: users.timezone, weekStart: userSettings.weekStart, weeklyOn: userSettings.insightsWeekly })
    .from(users)
    .leftJoin(userSettings, eq(userSettings.userId, users.id))
    .where(and(eq(users.disabled, false), isNotNull(users.passwordHash)))
    .orderBy(asc(users.id));
  const written: number[] = [];
  const tries = runsOf(app);
  for (const p of people) {
    if (signal?.aborted) break;
    const now = app.now();
    const today = localDay(p.timezone, now);
    const week = weekBefore(today, p.weekStart ?? 0);
    if (today === addDays(week.to, 1) && localHour(p.timezone, now) < WEEKLY_HOUR) continue;
    const [{ done }] = await app.db
      .select({ done: count() })
      .from(insights)
      .where(and(eq(insights.userId, p.id), eq(insights.kind, "recap"), eq(insights.source, "weekly"), eq(insights.periodStart, week.from)));
    if (done > 0) continue;
    const [{ days }] = await app.db
      .select({ days: countDistinct(logEntries.day) })
      .from(logEntries)
      .where(and(eq(logEntries.userId, p.id), ne(logEntries.source, "water"), gte(logEntries.day, week.from), lte(logEntries.day, week.to)));
    if (p.weeklyOn === false || days < MIN_LOGGED_DAYS) {
      // A week with no recap keeps no "so far" one either
      await app.db.delete(insights).where(and(eq(insights.userId, p.id), eq(insights.kind, "recap"), eq(insights.source, "refresh"), eq(insights.periodStart, week.from)));
      continue;
    }
    const key = `${p.id}:${week.from}`;
    const before = tries.get(key);
    if (before && (before.tries >= WEEKLY_TRIES || now.getTime() - before.at < RETRY_AFTER_MS)) continue;
    try {
      await writeRecap(app, p.id, "weekly", week, { signal });
      tries.delete(key);
      written.push(p.id);
    } catch (err) {
      if (signal?.aborted) break;
      const n = (before?.tries ?? 0) + 1;
      tries.set(key, { tries: n, at: now.getTime() });
      await logEvent(app.db, {
        category: "schedule",
        level: n >= WEEKLY_TRIES ? "error" : "warning",
        source: "Weekly insights",
        event: n >= WEEKLY_TRIES ? `The weekly recap for ${week.from} couldn't be written (gave up after ${n} tries)` : `The weekly recap for ${week.from} couldn't be written (try ${n} of ${WEEKLY_TRIES}; trying again in an hour)`,
        detail: (err as Error).message,
        userId: p.id,
      });
      continue;
    }
    try {
      await writeProtein(app, p.id, "weekly", week.to, { signal });
    } catch (err) {
      if (signal?.aborted) break;
      await logEvent(app.db, { category: "schedule", level: "warning", source: "Weekly insights", event: "Protein help couldn't be refreshed with the weekly recap", detail: (err as Error).message, userId: p.id });
    }
  }
  return written;
}

const CHECK_EVERY_MS = HOUR_MS;

/** Checks when the server starts, then every hour. Closing stops a run's AI request and waits (a while) for it. */
export function scheduleInsights(app: FastifyInstance) {
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<unknown> = Promise.resolve();
  const stop = new AbortController();
  const check = () =>
    (running = weeklyInsightsCheck(app, stop.signal).catch((err) =>
      logEvent(app.db, { category: "schedule", level: "error", source: "Weekly insights", event: "The weekly insights check failed", detail: (err as Error).message }),
    ));
  app.addHook("onReady", async () => {
    void check();
    timer = setInterval(() => void check(), CHECK_EVERY_MS);
    timer.unref();
  });
  app.addHook("onClose", async () => {
    clearInterval(timer);
    stop.abort();
    await waitOnClose(app, "weekly insights", running);
  });
}
