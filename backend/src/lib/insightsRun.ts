// Insights (§43): loading a person's data, asking the AI (lib/ai.ts, the "insights" task: the services in their order,
// failover, a cut-off answer asked again with more room), keeping what it wrote, the on-demand limits, and the weekly
// run. What the AI is told and how its answers are read: lib/insights.ts (pure).
import type { FastifyInstance } from "fastify";
import { and, asc, count, countDistinct, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, ne, notInArray, sql } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { activitySteps, glp1Settings, glp1Shots, insights, logEntries, targets, userBody, userSettings, users, weighIns, workouts } from "../db/schema.js";
import { AiError, AiStopped, type AiProgress } from "./ai.js";
import { originOf } from "./mail.js";
import { buildRecapEmail } from "./recapEmail.js";
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
  earlierFor,
  EARLIER_EXCHANGES,
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
export const REFRESH_FAILED = "Couldn't write your insights right now. Try again in 10 minutes.";
export const REFRESH_EVERY_MS = 10 * 60_000; // Refresh: once per 10 minutes per card per person
export const QUESTIONS_PER_DAY = 20; // and questions: 20 a day (the person's day)
export const KEEP_ANSWERS = 25; // the chat (§47) keeps the last 25 exchanges: 50 messages
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
type Person = { timezone: string; units: "imperial" | "metric"; weekStart: number; weeklyOn: boolean; emailOn: boolean; email: string | null };

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
const INSIGHTS_LOCK = 43; // (§43) with the person's id: one limit check or card write at a time per person
/** Holds this person's insights lock until the transaction ends. */
const lockPerson = (tx: Tx, userId: number) => tx.execute(sql`select pg_advisory_xact_lock(${INSIGHTS_LOCK}, ${userId})`);
/** An answer still being written (a question asked, its answer not back yet): counted for the day, never shown. */
const PENDING = { pending: true };
const notPending = sql`(${insights.content} ->> 'pending') is null`;
/** A question cleared with Clear chat (§47): its words are gone, the row stays so the day's 20 questions still count. */
const CLEARED = { cleared: true };
const notCleared = sql`(${insights.content} ->> 'cleared') is null`;
const shown = and(notPending, notCleared);

async function personOf(db: Db, userId: number): Promise<Person> {
  const [u] = await db
    .select({ timezone: users.timezone, units: users.units, email: users.email, weekStart: userSettings.weekStart, weeklyOn: userSettings.insightsWeekly, emailOn: userSettings.insightsEmail })
    .from(users)
    .leftJoin(userSettings, eq(userSettings.userId, users.id))
    .where(eq(users.id, userId));
  if (!u) throw new HttpError(401, "Not logged in");
  return { timezone: u.timezone, units: u.units, weekStart: u.weekStart ?? 0, weeklyOn: u.weeklyOn ?? true, emailOn: u.emailOn ?? false, email: u.email };
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
export async function loadSummaryInput(db: Db, userId: number, from: string, to: string, person: Pick<Person, "units" | "weekStart">, today?: string): Promise<SummaryInput> {
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
    await lockPerson(tx, userId);
    // The week's "so far" recap (and, for the final one, seed-demo's) gives way to this one
    await tx.delete(insights).where(and(eq(insights.userId, userId), eq(insights.kind, "recap"), inArray(insights.source, source === "weekly" ? ["refresh", "demo"] : ["refresh"]), eq(insights.periodStart, period.from)));
    // The week's final recap written again (§45): it keeps the "emailed" marker, so it is never sent twice
    let sent: Date | null = null;
    let tries = 0;
    if (source === "weekly") {
      const old = await tx.delete(insights).where(and(eq(insights.userId, userId), eq(insights.kind, "recap"), eq(insights.source, "weekly"), eq(insights.periodStart, period.from))).returning({ at: insights.emailedAt, tries: insights.emailTries });
      for (const o of old) {
        if (o.at && (!sent || o.at > sent)) sent = o.at;
        tries = Math.max(tries, o.tries);
      }
    }
    const [made] = await tx
      .insert(insights)
      .values({ userId, kind: "recap", source, periodStart: period.from, periodEnd: period.to, content: { ...recap, numbers: weekNumbers(input) }, createdAt: app.now(), emailedAt: sent, emailTries: tries })
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
    await lockPerson(tx, userId);
    await tx.delete(insights).where(and(eq(insights.userId, userId), eq(insights.kind, "protein")));
    const [made] = await tx.insert(insights).values({ userId, kind: "protein", source, periodStart: from, periodEnd: to, content: { ...advice, facts }, createdAt: app.now() }).returning();
    return made;
  });
  countUsage(app, userId, "ai_insights");
  return row;
}

export type QuestionClaim = { id: number; question: string; from: string; to: string; today: string };

/**
 * A question's place in today's 20, taken under the person's lock (two at once can't both have the last one): a
 * pending answer row, filled in by answerClaimed or removed if no answer comes. 429 when today's are used up.
 */
export async function claimQuestion(app: FastifyInstance, userId: number, question: string): Promise<QuestionClaim> {
  const person = await personOf(app.db, userId);
  const now = app.now();
  const today = localDay(person.timezone, now);
  const range = questionRange(question, today, person.weekStart);
  return app.db.transaction(async (tx) => {
    await lockPerson(tx, userId);
    // A pending answer from a request that never finished (the server stopped): gone after an hour
    await tx.delete(insights).where(and(eq(insights.userId, userId), eq(insights.kind, "answer"), sql`not ${notPending}`, lt(insights.createdAt, new Date(now.getTime() - HOUR_MS))));
    // Cleared questions no longer count after a day (their rows only held the day's count)
    await tx.delete(insights).where(and(eq(insights.userId, userId), eq(insights.kind, "answer"), sql`not ${notCleared}`, lt(insights.createdAt, new Date(now.getTime() - 27 * HOUR_MS))));
    if ((await questionsLeft(app, userId, person.timezone, tx)) <= 0) throw new HttpError(429, TOO_MANY_QUESTIONS);
    const [row] = await tx.insert(insights).values({ userId, kind: "answer", source: "ask", periodStart: range.from, periodEnd: range.to, question, content: PENDING, createdAt: now }).returning({ id: insights.id });
    return { id: row.id, question, ...range, today };
  });
}

/** The answer to a claimed question, from the person's own data for its range; the last 20 are kept. No answer: the claim is let go. */
export async function answerClaimed(app: FastifyInstance, userId: number, claim: QuestionClaim, opts: Opts = {}) {
  try {
    const person = await personOf(app.db, userId);
    const input = await loadSummaryInput(app.db, userId, claim.from, claim.to, person, claim.today);
    const summary = buildSummary(input);
    const json = await askAi(app, userId, questionAsk(summary, claim.question, earlierFor(summary, await earlierExchanges(app.db, userId, claim.id))), opts);
    const content = readAnswer(json) ?? (await unusable(app, userId, "answer", json));
    const row = await app.db.transaction(async (tx) => {
      await lockPerson(tx, userId);
      const [made] = await tx.update(insights).set({ content }).where(and(eq(insights.id, claim.id), eq(insights.userId, userId))).returning();
      const mine = and(eq(insights.userId, userId), eq(insights.kind, "answer"), shown);
      const keep = (await tx.select({ id: insights.id }).from(insights).where(mine).orderBy(desc(insights.createdAt), desc(insights.id)).limit(KEEP_ANSWERS)).map((r) => r.id);
      await tx.delete(insights).where(and(mine, notInArray(insights.id, keep)));
      return made;
    });
    if (!row) throw new HttpError(502, INSIGHTS_FAILED); // the claim was cleaned up meanwhile (very slow AI)
    countUsage(app, userId, "ai_insights");
    return row;
  } catch (err) {
    await app.db.delete(insights).where(and(eq(insights.id, claim.id), eq(insights.userId, userId), sql`not ${notPending}`));
    throw err;
  }
}

/** The exchanges before a question in this chat (§47), oldest first: what they asked and what they were told (not off-topic ones). */
async function earlierExchanges(db: Db, userId: number, beforeId: number) {
  const rows = await db
    .select({ question: insights.question, content: insights.content })
    .from(insights)
    .where(and(eq(insights.userId, userId), eq(insights.kind, "answer"), shown, lt(insights.id, beforeId), isNotNull(insights.question), sql`(${insights.content} ->> 'offTopic') is distinct from 'true'`, sql`(${insights.content} ->> 'answer') is not null`))
    .orderBy(desc(insights.createdAt), desc(insights.id))
    .limit(EARLIER_EXCHANGES);
  return rows.reverse().map((r) => ({ question: r.question!, answer: String((r.content as { answer: unknown }).answer) }));
}

/** Clear chat: the person's questions and answers are emptied (what was said is erased). The day's question count stays. */
export async function clearChat(app: FastifyInstance, userId: number) {
  return app.db.transaction(async (tx) => {
    await lockPerson(tx, userId);
    const cleared = await tx.update(insights).set({ question: null, content: CLEARED }).where(and(eq(insights.userId, userId), eq(insights.kind, "answer"), shown)).returning({ id: insights.id });
    return { cleared: cleared.length };
  });
}

/** Claim and answer in one (tests and callers that don't stream). */
export async function answerQuestion(app: FastifyInstance, userId: number, question: string, opts: Opts = {}) {
  return answerClaimed(app, userId, await claimQuestion(app, userId, question), opts);
}

// ---------- limits ----------

const triedColumn = (kind: "recap" | "protein") => (kind === "recap" ? userSettings.insightsRecapTriedAt : userSettings.insightsProteinTriedAt);
const secondsLeft = (app: FastifyInstance, at: Date | null | undefined) => (at ? Math.max(0, Math.ceil((at.getTime() + REFRESH_EVERY_MS - app.now().getTime()) / 1000)) : 0);

/** Seconds until this card can be refreshed again (0: now). Every try counts, worked or not. */
export async function refreshWait(app: FastifyInstance, userId: number, kind: "recap" | "protein", db: Db | Tx = app.db): Promise<number> {
  const [row] = await db.select({ at: triedColumn(kind) }).from(userSettings).where(eq(userSettings.userId, userId));
  return secondsLeft(app, row?.at);
}

/** A refresh of this card, noted under the person's lock before the AI is asked (so two at once can't both go); 429 when too soon. */
export async function claimRefresh(app: FastifyInstance, userId: number, kind: "recap" | "protein") {
  await app.db.transaction(async (tx) => {
    await lockPerson(tx, userId);
    const wait = await refreshWait(app, userId, kind, tx);
    if (wait > 0) throw refreshTooSoon(wait);
    const set = kind === "recap" ? { insightsRecapTriedAt: app.now() } : { insightsProteinTriedAt: app.now() };
    await tx.insert(userSettings).values({ userId, ...set }).onConflictDoUpdate({ target: userSettings.userId, set });
  });
}
/** A refresh whose AI didn't answer: it still counts, so say when to try again. */
export const refreshFailed = () => new HttpError(502, REFRESH_FAILED, { retryAfterSec: REFRESH_EVERY_MS / 1000 });

/** Questions the person can still ask today (their own day). */
export async function questionsLeft(app: FastifyInstance, userId: number, timezone?: string, db: Db | Tx = app.db): Promise<number> {
  const tz = timezone ?? (await personOf(app.db, userId)).timezone;
  const now = app.now();
  const today = localDay(tz, now);
  const recent = await db
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
    app.db.select().from(insights).where(and(mine("answer"), shown)).orderBy(...newest(insights.createdAt)).limit(KEEP_ANSWERS),
    questionsLeft(app, userId, person.timezone),
    refreshWait(app, userId, "recap"),
    refreshWait(app, userId, "protein"),
  ]);
  return {
    aiReady,
    weeklyOn: person.weeklyOn,
    email: { on: person.emailOn, available: !!(await app.mail.active()), hasAddress: !!person.email },
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

export const NO_MAIL_SERVER = "Email isn't set up on this server. An admin can set it up in Settings › Email.";
export const NO_ACCOUNT_EMAIL = "Add an email address in Settings › Profile";

/** The switches on the Insights page: the weekly recap, and (§45) emailing it. Emailing needs server email and an address on the account. */
export async function setInsightsSwitches(app: FastifyInstance, userId: number, change: { weeklyOn?: boolean; emailOn?: boolean }) {
  // Without an AI service nothing can be turned on (turning off is always fine; what was chosen is kept for when one is set up)
  if ((change.weeklyOn || change.emailOn) && !(await app.ai.active("insights"))) throw new HttpError(409, INSIGHTS_OFF);
  if (change.emailOn) {
    const person = await personOf(app.db, userId);
    if (!(await app.mail.active())) throw new HttpError(409, NO_MAIL_SERVER);
    if (!person.email) throw new HttpError(409, NO_ACCOUNT_EMAIL);
  }
  const set = { ...(change.weeklyOn === undefined ? {} : { insightsWeekly: change.weeklyOn }), ...(change.emailOn === undefined ? {} : { insightsEmail: change.emailOn }) };
  await app.db.insert(userSettings).values({ userId, ...set }).onConflictDoUpdate({ target: userSettings.userId, set });
  const p = await personOf(app.db, userId);
  return { weeklyOn: p.weeklyOn, emailOn: p.emailOn };
}

// ---------- emailing the recap (§45) ----------

/** A person left with no email address: their weekly recap email goes off (adding an address later doesn't restart it). */
export const emailRecapOff = (db: Db, userId: number) => db.update(userSettings).set({ insightsEmail: false }).where(eq(userSettings.userId, userId));

export const EMAIL_TRIES = 4; // the first send and 3 retries (one with each hourly check)

/**
 * Emails a weekly recap to its person, once. Only a final weekly recap (never "so far" or seed-demo), only while the
 * switch is on, the account has an address and the server has email. The try is counted before sending (under one
 * update, so two checks can't both send); a failure is logged and left for the next hourly check, up to EMAIL_TRIES.
 * Never throws.
 */
export async function emailRecap(app: FastifyInstance, recapId: number): Promise<void> {
  try {
    const [r] = await app.db.select().from(insights).where(and(eq(insights.id, recapId), eq(insights.kind, "recap"), eq(insights.source, "weekly"), isNull(insights.emailedAt), lt(insights.emailTries, EMAIL_TRIES)));
    if (!r) return;
    const [u] = await app.db
      .select({ email: users.email, name: users.displayName, username: users.username, disabled: users.disabled, on: userSettings.insightsEmail, dateFormat: userSettings.dateFormat })
      .from(users)
      .leftJoin(userSettings, eq(userSettings.userId, users.id))
      .where(eq(users.id, r.userId));
    if (!u || u.disabled || !u.on || !u.email) return;
    const active = await app.mail.active();
    if (!active) return;
    const claimed = await app.db.update(insights).set({ emailTries: r.emailTries + 1 }).where(and(eq(insights.id, r.id), isNull(insights.emailedAt), eq(insights.emailTries, r.emailTries))).returning({ id: insights.id });
    if (claimed.length === 0) return;
    const base = originOf(active.config.appUrl) ?? originOf(app.appOrigins[0]);
    const mail = buildRecapEmail({ name: u.name?.trim() || u.username, from: r.periodStart, to: r.periodEnd, dateFormat: u.dateFormat ?? "weekday-long-month-short", content: r.content as never, link: base ? `${base}/#/insights` : null });
    const tries = r.emailTries + 1;
    try {
      await app.mail.send({ to: u.email, subject: mail.subject, text: mail.text, html: mail.html }, "recap", { config: active.config, userId: r.userId });
    } catch (err) {
      await logEvent(app.db, {
        category: "schedule",
        level: tries >= EMAIL_TRIES ? "error" : "warning",
        source: "Weekly insights",
        event: tries >= EMAIL_TRIES ? `The recap email for ${r.periodStart} couldn't be sent (gave up after ${tries} tries)` : `The recap email for ${r.periodStart} couldn't be sent (try ${tries} of ${EMAIL_TRIES}; trying again with the next hourly check)`,
        detail: (err as Error).message,
        userId: r.userId,
      });
      return;
    }
    // Sent. Marking it is separate: if that fails the recap must still never go out twice, so it is given no more tries
    try {
      await app.db.update(insights).set({ emailedAt: app.now() }).where(eq(insights.id, r.id));
    } catch (err) {
      await app.db.update(insights).set({ emailTries: EMAIL_TRIES }).where(eq(insights.id, r.id)).catch(() => {});
      await logEvent(app.db, { category: "schedule", level: "warning", source: "Weekly insights", event: `The recap email for ${r.periodStart} was sent but couldn't be marked as sent (it won't be sent again)`, detail: (err as Error).message, userId: r.userId }).catch(() => {});
    }
  } catch (err) {
    console.error("The recap email failed:", err); // e.g. the database is down: nothing here may fail the recap
  }
}

/** Recap emails that failed earlier (tried, not yet sent, under EMAIL_TRIES): each tried again, in the background. */
async function retryRecapEmails(app: FastifyInstance) {
  const again = await app.db
    .select({ id: insights.id })
    .from(insights)
    .where(and(eq(insights.kind, "recap"), eq(insights.source, "weekly"), isNull(insights.emailedAt), gt(insights.emailTries, 0), lt(insights.emailTries, EMAIL_TRIES)))
    .orderBy(asc(insights.id));
  for (const r of again) emailInBackground(app, r.id);
}

/** Sends in the background: nothing waits for the mail server. */
const emailInBackground = (app: FastifyInstance, recapId: number) => app.mail.background(() => emailRecap(app, recapId), (err) => console.error("The recap email failed:", err));

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
  if (!(await app.ai.active("insights"))) return []; // no AI: no recaps, and no recap emails either (§43 "No AI set up")
  await retryRecapEmails(app);
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
      const recap = await writeRecap(app, p.id, "weekly", week, { signal });
      tries.delete(key);
      emailInBackground(app, recap.id); // when they've asked for it (§45); never holds up or fails the recap
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
