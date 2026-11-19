// Weight trend and goal projection (design §13 A). Pure: no I/O, no clock reads.

import { addDays } from "./days.js";

export type WeighInPoint = { day: string; weightKg: number };
export type TrendPoint = { day: string; trendKg: number };
export type Projection = {
  status: "ok" | "not_enough" | "not_losing" | "reached";
  /** ok with a goal: the projected goal day (YYYY-MM-DD), always after today */
  date?: string;
  /** ok / not_losing: kg lost per week by the trend (negative = gaining) */
  kgPerWeek?: number;
};

/** One pound in kilograms (exact). */
export const KG_PER_LB = 0.45359237;

const SMOOTHING = 0.9;
export const PROJECTION_DAYS = 28;
const MIN_SPAN_DAYS = 7;
/** A goal date further out than 3 years is shown as "Not losing right now" */
export const MAX_PROJECTION_DAYS = 1095;
/** 10 lb: the latest weight this far from the plan's weight suggests a re-plan */
export const REPLAN_KG = 4.54;

const dayNumber = (day: string) => Date.parse(`${day}T00:00:00Z`) / 86_400_000;

/**
 * Exponentially smoothed weight, aware of gaps: trend₀ = w₀; trend += (w − trend) × (1 − 0.9^days since the
 * previous weigh-in). Sorted by day, so backdated weigh-ins take their place.
 */
export function trendOf<P extends WeighInPoint>(points: readonly P[]): (P & { trendKg: number })[] {
  const sorted = [...points].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  let trend = 0;
  let prev = 0;
  return sorted.map((p, i) => {
    const d = dayNumber(p.day);
    trend = i === 0 ? p.weightKg : trend + (p.weightKg - trend) * (1 - SMOOTHING ** (d - prev));
    prev = d;
    return { ...p, trendKg: trend };
  });
}

/**
 * Where the trend is heading: least-squares slope of the trend over the last 28 days (needs ≥ 2 weigh-ins at
 * least 7 days apart). Losing → goal day = today + (trend − goal) ÷ rate. At or below a goal under the starting
 * weight → reached; at or below a goal at or above the start (nothing to lose toward) → not_losing.
 * `trendPoints` sorted by day (as trendOf gives them); `today` is the person's local day.
 */
export function projectionOf(trendPoints: readonly TrendPoint[], goalKg: number | null, today: string): Projection {
  const last = trendPoints[trendPoints.length - 1];
  if (!last) return { status: "not_enough" };
  // The start is the first weigh-in (trend₀ = w₀). A goal at or above it has nothing to lose toward: never "reached"
  if (goalKg !== null && last.trendKg <= goalKg) return goalKg < trendPoints[0].trendKg ? { status: "reached" } : { status: "not_losing" };

  const from = addDays(today, -(PROJECTION_DAYS - 1));
  const recent = trendPoints.filter((p) => p.day >= from && p.day <= today);
  if (recent.length < 2 || dayNumber(recent[recent.length - 1].day) - dayNumber(recent[0].day) < MIN_SPAN_DAYS) {
    return { status: "not_enough" };
  }

  const xs = recent.map((p) => dayNumber(p.day));
  const ys = recent.map((p) => p.trendKg);
  const mx = xs.reduce((s, x) => s + x, 0) / xs.length;
  const my = ys.reduce((s, y) => s + y, 0) / ys.length;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  const lossPerDay = -sxy / sxx; // sxx > 0: the points span at least 7 days
  // Round away float noise so a flat line isn't "losing" 1e-15 kg a week
  const kgPerWeek = Math.round(lossPerDay * 7 * 1e9) / 1e9;
  if (!(kgPerWeek > 0)) return { status: "not_losing", kgPerWeek };
  if (goalKg === null) return { status: "ok", kgPerWeek };

  // From where the trend is today, not at the last weigh-in (already past the goal by now: tomorrow)
  const trendToday = last.trendKg - lossPerDay * (dayNumber(today) - dayNumber(last.day));
  // Round to 1e-6 day so float noise can't push ceil() a day later
  const days = Math.max(1, Math.ceil(Math.round(((trendToday - goalKg) / lossPerDay) * 1e6) / 1e6));
  // A plateau's tiny slope would put the goal centuries away (and past what a date can hold)
  if (days > MAX_PROJECTION_DAYS) return { status: "not_losing", kgPerWeek };
  return { status: "ok", date: addDays(today, days), kgPerWeek };
}

/**
 * Least-squares line through points on at least two different days: its slope (kg a day) and the slope's
 * standard error (how sure that slope is: 0 for points on a straight line; 0 with only two points).
 */
function lineOf(points: readonly { day: string }[], y: (i: number) => number): { slope: number; slopeSe: number } {
  const xs = points.map((p) => dayNumber(p.day));
  const ys = points.map((_, i) => y(i));
  const n = xs.length;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  const slope = sxy / sxx;
  if (n < 3) return { slope, slopeSe: 0 };
  let rss = 0;
  for (let i = 0; i < n; i++) rss += (ys[i] - (my + slope * (xs[i] - mx))) ** 2;
  return { slope, slopeSe: Math.sqrt(rss / (n - 2) / sxx) };
}

export type GoalDate =
  | { status: "no_goal" | "reached" | "not_enough" }
  /** Gaining, flat, or so slow the goal is more than 3 years away. kgPerWeek: lost a week (≤ 0 = gaining or flat) */
  | { status: "not_heading"; kgPerWeek: number }
  | {
      status: "ok";
      /** kg lost a week by the trend (the pace) */
      kgPerWeek: number;
      /** latest trend − goal */
      toGoKg: number;
      /** whole weeks from today to the earliest and latest day */
      weeks: { min: number; max: number };
      /** the day at the pace, and the range's earliest and latest days (YYYY-MM-DD, after today) */
      date: string;
      earliest: string;
      latest: string;
    };

export const GOAL_DATE_DAYS = 42; // the last 6 weeks
export const GOAL_DATE_MIN_DAYS = 14; // first to last weigh-in in the window, both counted
export const GOAL_DATE_MIN_WEIGH_INS = 6;
const GOAL_DATE_SE = 1.5; // the range: the pace ± 1.5 standard errors of the slope...
const GOAL_DATE_SPREAD = 0.1; // ...and at least ±10% of the pace
const GOAL_DATE_SLOWEST = 0.5; // its slow end at most twice the time (an unsure slope would make it endless)

/**
 * The Goal date widget (§40a): when the trend reaches the goal at the current pace, as a range. Over the last 6 weeks'
 * trend points (≥ 14 days, ≥ 6 weigh-ins): pace = least-squares slope of the trend; the range is the pace ± 1.5
 * standard errors of the slope of the weigh-ins themselves over those days (at least ±10% of the pace), so steady
 * weigh-ins give a tight range and bumpy ones a wider one. Days are
 * counted from the last weigh-in's trend; every day is after today. `trendPoints` sorted by day (as trendOf gives them).
 */
export function goalDateOf(trendPoints: readonly (TrendPoint & { weightKg?: number })[], goalKg: number | null, today: string): GoalDate {
  if (goalKg === null) return { status: "no_goal" };
  const recent = trendPoints.filter((p) => p.day > addDays(today, -GOAL_DATE_DAYS) && p.day <= today);
  const last = recent[recent.length - 1] ?? trendPoints.filter((p) => p.day <= today).at(-1);
  if (last && last.trendKg <= goalKg) return { status: "reached" };
  if (!last || recent.length < GOAL_DATE_MIN_WEIGH_INS || dayNumber(last.day) - dayNumber(recent[0].day) + 1 < GOAL_DATE_MIN_DAYS) {
    return { status: "not_enough" };
  }

  // Round away float noise so a flat line isn't "losing" 1e-15 kg a week
  const lossPerDay = -lineOf(recent, (i) => recent[i].trendKg).slope;
  // How sure the pace is: from the weigh-ins themselves (the trend smooths their ups and downs away)
  const { slopeSe } = lineOf(recent, (i) => recent[i].weightKg ?? recent[i].trendKg);
  const kgPerWeek = Math.round(lossPerDay * 7 * 1e9) / 1e9 + 0; // + 0: never −0
  const toGoKg = last.trendKg - goalKg;
  const spread = Math.max(GOAL_DATE_SE * slopeSe, GOAL_DATE_SPREAD * lossPerDay);
  const fast = lossPerDay + spread;
  const slow = Math.max(lossPerDay - spread, lossPerDay * GOAL_DATE_SLOWEST);

  // Days from today to where the trend meets the goal at `rate` kg a day (from the last weigh-in; at least tomorrow)
  const fromToday = (rate: number) => {
    const fromLast = Math.ceil(Math.round((toGoKg / rate) * 1e6) / 1e6);
    return Math.max(1, fromLast - (dayNumber(today) - dayNumber(last.day)));
  };
  if (!(kgPerWeek > 0) || fromToday(lossPerDay) > MAX_PROJECTION_DAYS) return { status: "not_heading", kgPerWeek };
  const [soon, mid, late] = [fromToday(fast), fromToday(lossPerDay), Math.min(fromToday(slow), MAX_PROJECTION_DAYS)];
  const weeks = (days: number) => Math.max(1, Math.round(days / 7));
  return {
    status: "ok",
    kgPerWeek,
    toGoKg,
    weeks: { min: weeks(soon), max: weeks(late) },
    date: addDays(today, mid),
    earliest: addDays(today, soon),
    latest: addDays(today, late),
  };
}

/**
 * Whether the latest weight is 10 lb (4.54 kg) or more from the weight the current targets were set with
 * (for plans chosen before that was recorded, the caller passes the first weigh-in's weight).
 */
export function replanHint(latestKg: number | null, targetsWeightKg: number | null): boolean {
  if (latestKg === null || targetsWeightKg === null) return false;
  return Math.abs(latestKg - targetsWeightKg) >= REPLAN_KG - 1e-9;
}
