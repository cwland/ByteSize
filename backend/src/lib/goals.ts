// Goals with a start and end (§40c). Pure: no I/O, no clock reads. Days are the person's local YYYY-MM-DD dates.
// Progress is worked out from what each day held (DayFacts, gathered by routes/goals.ts) every time it's shown; once
// the end date has passed, routes/goals.ts keeps the last result so later edits to old days can't flip it.

import { addDays, daysBetween } from "./days.js";
import { trendOn, weekStartOf } from "./trends.js";
import type { TrendPoint } from "./weight.js";

export const GOAL_TYPES = [
  "logging_days",
  "protein_days",
  "calorie_days",
  "water_days",
  "weigh_ins",
  "fiber_days",
  "streak",
  "steps",
  "workouts",
  "active_minutes",
  "weight_by_date",
] as const;
export type GoalType = (typeof GOAL_TYPES)[number];
export const GOAL_PERIODS = ["week", "month", "stretch"] as const;
export type GoalPeriod = (typeof GOAL_PERIODS)[number];
/** Steps only: the total per period, or the average per day */
export const STEP_MEASURES = ["total", "average"] as const;
export type StepMeasure = (typeof STEP_MEASURES)[number];

/** A new goal's name when none is given */
export const GOAL_NAMES: Record<GoalType, string> = {
  logging_days: "Logging days",
  protein_days: "Protein days",
  calorie_days: "Calorie days",
  water_days: "Water days",
  weigh_ins: "Weigh-ins",
  fiber_days: "Fiber days",
  streak: "Streak",
  steps: "Steps",
  workouts: "Workouts",
  active_minutes: "Active minutes",
  weight_by_date: "Weight by a date",
};

/** Days that count toward a "days" goal, by type */
const DAY_KIND = {
  logging_days: "logged",
  protein_days: "protein",
  calorie_days: "calories",
  water_days: "water",
  weigh_ins: "weighed",
  fiber_days: "fiber",
} as const satisfies Partial<Record<GoalType, keyof DayFacts>>;
export const isDayCount = (t: GoalType): t is keyof typeof DAY_KIND => t in DAY_KIND;
/** Goals over the whole stretch only (a streak within it; the trend by its end date) */
export const STRETCH_ONLY: readonly GoalType[] = ["streak", "weight_by_date"];

/** endedEarly: ended by End now or by a new goal of its type (its end is then that day) */
export type GoalSpec = { type: GoalType; target: number; period: GoalPeriod; measure: StepMeasure | null; start: string; end: string | null; endedEarly?: boolean };

/** What one day held, as goals count it */
export type DayFacts = {
  day: string;
  /** food logged (water doesn't count) */
  logged: boolean;
  /** protein / fiber / water at or above the day's minimum (the targets in force that day), with something logged */
  protein: boolean;
  fiber: boolean;
  water: boolean;
  /** calories in range, a bank-covered day counting (lib/calorieDays.ts) */
  calories: boolean;
  weighed: boolean;
  /** Health's number if there is one, else the typed one; null: none */
  steps: number | null;
  workouts: number;
  activeMinutes: number;
  /** inside one of the person's vacations */
  vacation: boolean;
};
export const emptyDay = (day: string): DayFacts => ({ day, logged: false, protein: false, fiber: false, water: false, calories: false, weighed: false, steps: null, workouts: 0, activeMinutes: 0, vacation: false });

export type Period = { start: string; end: string; /** days in the whole calendar period (a week 7, a month 28–31, the stretch its own) */ length: number };
/** unjudged: shown, never hit or missed — a partial week under 4 days (month: 15), or the stretch of a goal ended early */
export type PeriodStatus = "hit" | "missed" | "open" | "unjudged";
export type PeriodProgress = { start: string; end: string; value: number | null; target: number; status: PeriodStatus };
/** ended: ended early with no period to judge (neither completed nor missed) */
export type GoalState = "upcoming" | "active" | "completed" | "missed" | "ended";
export type GoalProgress = {
  state: GoalState;
  /** the periods that have started, oldest first */
  periods: PeriodProgress[];
  /** the period holding today; null before the start and after the end */
  current: PeriodProgress | null;
  /** judged periods hit, and judged periods decided (hit or missed) */
  hit: number;
  done: number;
  /** every judged period of the goal (null: ongoing) */
  of: number | null;
  /** how many of them must be hit to complete it: 80% rounded up for each week / each month, the one for a stretch (null: ongoing) */
  needed: number | null;
  /** weight by a date: the trend at the start (null for other goals, or no weigh-in yet) */
  startKg: number | null;
  /** the last day counted: today, or the end once it has passed */
  asOf: string;
};

const lastOfMonth = (day: string) => addDays(`${addDays(`${day.slice(0, 7)}-28`, 4).slice(0, 7)}-01`, -1);
const firstOfMonth = (day: string) => `${day.slice(0, 7)}-01`;

/** The goal's periods up to the one holding `until` (bounded goals: never past the end), each clipped to the goal. */
export function periodsOf(g: Pick<GoalSpec, "period" | "start" | "end">, weekStart: number, until: string): Period[] {
  if (g.period === "stretch") {
    const end = g.end ?? until; // a stretch always has an end (routes/goals.ts)
    return [{ start: g.start, end, length: daysBetween(g.start, end) + 1 }];
  }
  const last = g.end ?? "9999-12-31";
  const out: Period[] = [];
  let from = g.period === "week" ? weekStartOf(g.start, weekStart) : firstOfMonth(g.start);
  while (from <= last && from <= until) {
    const to = g.period === "week" ? addDays(from, 6) : lastOfMonth(from);
    out.push({ start: from < g.start ? g.start : from, end: to > last ? last : to, length: daysBetween(from, to) + 1 });
    from = addDays(to, 1);
  }
  return out;
}

const EPS = 1e-9;
const span = (p: { start: string; end: string }) => daysBetween(p.start, p.end) + 1;
/** A partial week counts with at least 4 of its days, a partial month with at least 15 */
export const MIN_JUDGED_DAYS: Record<GoalPeriod, number> = { week: 4, month: 15, stretch: 1 };
/** Each week / each month: the share of judged periods to hit (rounded up) */
export const NEEDED_SHARE = 0.8;

/** Whether a period is judged (hit or missed): a whole one, or a partial one long enough; never the stretch of a goal ended early */
function judged(g: GoalSpec, p: Period): boolean {
  if (g.period === "stretch") return !g.endedEarly;
  return span(p) === p.length || span(p) >= MIN_JUDGED_DAYS[g.period];
}

/** How many judged periods must be hit */
export const neededOf = (period: GoalPeriod, of: number) => (period === "stretch" ? of : Math.min(of, Math.ceil(NEEDED_SHARE * of - EPS)));

/** A period's target: a per-day average or a weight as set; a count or total its share for a partial period (rounded, at least 1), a day count never more than its days. */
function targetFor(g: GoalSpec, p: Period): number {
  if (g.type === "weight_by_date" || g.type === "streak" || (g.type === "steps" && g.measure === "average")) return g.target;
  const days = span(p);
  const share = days === p.length ? g.target : Math.max(1, Math.round((g.target * days) / p.length));
  return isDayCount(g.type) ? Math.min(share, days) : share;
}

/** The longest run of logged days in the days given (oldest first): a vacation day without food neither counts nor breaks it. */
function longestRun(facts: DayFacts[]): number {
  let best = 0;
  let run = 0;
  for (const f of facts) {
    if (f.logged) best = Math.max(best, ++run);
    else if (!f.vacation) run = 0;
  }
  return best;
}

/** A period's value from its days up to `asOf` (weight: the trend as of then). */
function valueOf(g: GoalSpec, facts: DayFacts[], trend: readonly TrendPoint[], asOf: string): number | null {
  if (isDayCount(g.type)) {
    const kind = DAY_KIND[g.type];
    return facts.filter((f) => f[kind]).length;
  }
  switch (g.type) {
    case "streak":
      return longestRun(facts);
    case "workouts":
      return facts.reduce((n, f) => n + f.workouts, 0);
    case "active_minutes":
      return facts.reduce((n, f) => n + f.activeMinutes, 0);
    case "steps": {
      const known = facts.filter((f) => f.steps !== null).map((f) => f.steps!);
      const total = known.reduce((a, b) => a + b, 0);
      if (g.measure !== "average") return total;
      return known.length ? Math.round(total / known.length) : null;
    }
    case "weight_by_date": {
      const kg = trendOn(trend, asOf);
      return kg === null ? null : Math.round(kg * 1000) / 1000;
    }
  }
  return null;
}

/** Counts and totals only grow as the days go by, so reaching the target early is already a hit; an average or a weight isn't decided until the period ends. */
const growsOnly = (g: GoalSpec) => g.type !== "weight_by_date" && !(g.type === "steps" && g.measure === "average");

/**
 * The goal's progress as of `today`: each period that has started (value, target, hit / missed / open / unjudged), how
 * many were hit, and the goal's state. Completed: its end has passed and at least 80% (rounded up) of its judged weeks
 * or months were hit; a stretch, its one period (weight by a date: the trend on the end date at or under the target).
 * Partial weeks under 4 days (months under 15) are shown but not judged; a stretch ended early isn't judged.
 */
export function progressOf(g: GoalSpec, input: { days: readonly DayFacts[]; trend: readonly TrendPoint[]; today: string; weekStart: number }): GoalProgress {
  const { today, weekStart, trend } = input;
  const over = g.end !== null && g.end < today;
  const asOf = over ? g.end! : today;
  const of = g.end === null ? null : periodsOf(g, weekStart, g.end).filter((p) => judged(g, p)).length;
  const needed = of === null ? null : neededOf(g.period, of);
  const startKg = g.type === "weight_by_date" ? (trendOn(trend, g.start) ?? trend.find((p) => p.day >= g.start && p.day <= asOf)?.trendKg ?? null) : null;
  if (today < g.start) return { state: "upcoming", periods: [], current: null, hit: 0, done: 0, of, needed, startKg, asOf: today };

  const byDay = new Map(input.days.map((f) => [f.day, f]));
  const periods = periodsOf(g, weekStart, asOf).map((p): PeriodProgress => {
    const until = p.end < asOf ? p.end : asOf;
    const facts: DayFacts[] = [];
    for (let d = p.start; d <= until; d = addDays(d, 1)) facts.push(byDay.get(d) ?? emptyDay(d));
    const value = valueOf(g, facts, trend, until);
    const target = targetFor(g, p);
    const closed = p.end < today;
    const reached = value !== null && (g.type === "weight_by_date" ? value <= target + EPS : value >= target - EPS);
    const status: PeriodStatus = !judged(g, p) ? "unjudged" : reached && (closed || growsOnly(g)) ? "hit" : closed ? "missed" : "open";
    return { start: p.start, end: p.end, value, target, status };
  });
  const hit = periods.filter((p) => p.status === "hit").length;
  const done = periods.filter((p) => p.status === "hit" || p.status === "missed").length;
  const current = over ? null : (periods.find((p) => p.start <= today && today <= p.end) ?? null);
  // Over: completed when enough judged periods were hit; with none to judge (ended early) just "ended"
  const state: GoalState = !over ? "active" : !of ? "ended" : hit >= needed! ? "completed" : "missed";
  return { state, periods, current, hit, done, of, needed, startKg, asOf };
}
