// Weight trend and weekly-average helpers (pure). Days are the person's local YYYY-MM-DD dates.

import { addDays, weekdayOf } from "./days.js";
import type { Nutrients } from "./nutrients.js";
import type { TrendPoint } from "./weight.js";

/** The trend as of `day` (from the last weigh-in on or before it; `series` oldest first, as trendOf gives it); null before the first weigh-in. */
export function trendOn(series: readonly TrendPoint[], day: string): number | null {
  let found: number | null = null;
  for (const p of series) {
    if (p.day > day) break;
    found = p.trendKg;
  }
  return found;
}

/** The first day of the week holding `day`, for weeks starting on `weekStart` (0 = Sunday). */
export function weekStartOf(day: string, weekStart: number): string {
  return addDays(day, -((weekdayOf(day) - weekStart + 7) % 7));
}

export const TREND_NUTRIENTS = ["calories", "protein_g", "fiber_g", "water_ml"] as const;
export type TrendNutrient = (typeof TREND_NUTRIENTS)[number];
export type Averages = Record<TrendNutrient, number | null>;
export type Status = "below" | "in" | "above" | null;

/** What one day held: its foods' nutrients and its water entries' millilitres. */
export type DayLog = { foods: Nutrients[]; waterMl: number[] };

const round = (k: TrendNutrient, v: number) => (k === "calories" || k === "water_ml" ? Math.round(v) : Math.round(v * 10) / 10);

/**
 * Averages over days with food logged. Each nutrient averages only the days where something told us about it
 * (a food that listed it; for water, a water entry), so unknown stays unknown: no days → null, never 0.
 */
export function averages(days: DayLog[]): Averages {
  const logged = days.filter((d) => d.foods.length > 0);
  const avg = {} as Averages;
  for (const k of TREND_NUTRIENTS) {
    const totals = logged.flatMap((d) => {
      const known = k === "water_ml" ? d.waterMl : d.foods.map((n) => n[k]).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
      return known.length ? [known.reduce((a, b) => a + b, 0)] : [];
    });
    avg[k] = totals.length ? round(k, totals.reduce((a, b) => a + b, 0) / totals.length) : null;
  }
  return avg;
}

/** Below, in or above a target range; null when the average or the range is unknown. */
export function judge(avg: number | null, range: { min: number; max: number } | null | undefined): Status {
  if (avg === null || !range) return null;
  return avg < range.min ? "below" : avg > range.max ? "above" : "in";
}
