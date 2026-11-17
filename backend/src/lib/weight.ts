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
 * Whether the latest weight is 10 lb (4.54 kg) or more from the weight the current targets were set with
 * (for plans chosen before that was recorded, the caller passes the first weigh-in's weight).
 */
export function replanHint(latestKg: number | null, targetsWeightKg: number | null): boolean {
  if (latestKg === null || targetsWeightKg === null) return false;
  return Math.abs(latestKg - targetsWeightKg) >= REPLAN_KG - 1e-9;
}
