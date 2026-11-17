// Badges (pure): which badges a person's history earns, and on which day each was first earned.
// Stored on first earn and never removed (routes/trends.ts); this only works out what the history shows.

import { addDays, daysBetween } from "./days.js";
import { KG_PER_LB, trendOf, type WeighInPoint } from "./weight.js";

export const STREAKS = [7, 30, 100] as const;
const SHOTS_IN_A_ROW = 4;
/** A shot is on time within 1 day of the previous shot + 7 days. */
const DUE_DAYS = 7;
const GRACE_DAYS = 1;
const EPS = 1e-9;

/** The lost_N thresholds in lb, in order: 5, then every 10 (10, 20, 30, ...). */
export const lostLb = (i: number) => (i === 0 ? 5 : 10 * i);
export const lostId = (lb: number) => `lost_${lb}`;
export const isLostId = (id: string) => /^lost_\d+$/.test(id);

export type BadgeHistory = {
  weighIns: WeighInPoint[];
  goalKg: number | null;
  /** Days with food logged (any order). */
  loggedDays: string[];
  onVacation: (day: string) => boolean;
  today: string;
  /** Days with a GLP-1 shot (any order). */
  shotDays: string[];
};

/** Every badge the history earns, with the day each was first earned. */
export function earnedBadges(h: BadgeHistory): Map<string, string> {
  const earned = new Map<string, string>();
  const earn = (id: string, day: string) => {
    if (!earned.has(id)) earned.set(id, day);
  };

  // Weight: start = the first weigh-in; lost = start − trend (in lb thresholds); halfway / goal against the goal
  const series = trendOf(h.weighIns);
  if (series.length) {
    const start = series[0].weightKg;
    earn("first_weigh_in", series[0].day);
    const losing = h.goalKg !== null && h.goalKg < start; // a goal at or above the start has nothing to lose toward
    let next = 0;
    for (const p of series) {
      const lost = start - p.trendKg;
      while (lost + EPS >= lostLb(next) * KG_PER_LB) earn(lostId(lostLb(next++)), p.day);
      if (losing && p.trendKg <= start - (start - h.goalKg!) / 2 + EPS) earn("halfway", p.day);
      if (losing && p.trendKg <= h.goalKg! + EPS) earn("goal_reached", p.day);
    }
  }

  // Logging streak, day by day: food counts; a vacation day without food is skipped; any other empty day resets
  const logged = new Set(h.loggedDays);
  const days = [...logged].sort();
  if (days.length) {
    let run = 0;
    for (let d = days[0]; d <= h.today; d = addDays(d, 1)) {
      if (logged.has(d)) {
        run++;
        for (const n of STREAKS) if (run === n) earn(`streak_${n}`, d);
      } else if (!h.onVacation(d)) run = 0;
    }
  }

  // Shots on time in a row: the first counts; each later one when within a day of the previous + 7
  const shots = [...new Set(h.shotDays)].sort();
  let inARow = 0;
  shots.forEach((d, i) => {
    const onTime = i === 0 || Math.abs(daysBetween(shots[i - 1], d) - DUE_DAYS) <= GRACE_DAYS;
    inARow = onTime ? inARow + 1 : 0;
    if (inARow === SHOTS_IN_A_ROW) earn("shots_on_time_4", d);
  });
  return earned;
}

export type Badge = { id: string; earnedOn: string | null; seen: boolean };

/**
 * The badge list: every fixed badge, each earned lost_N plus the next one still to earn, in a fixed order.
 * Unearned ones have earnedOn null.
 */
export function badgeList(stored: { badge: string; earnedOn: string; seen: boolean }[]): Badge[] {
  const byId = new Map(stored.map((s) => [s.badge, s]));
  const item = (id: string): Badge => {
    const s = byId.get(id);
    return { id, earnedOn: s?.earnedOn ?? null, seen: s?.seen ?? false };
  };
  const lost: string[] = [];
  for (let i = 0; ; i++) {
    const id = lostId(lostLb(i));
    lost.push(id);
    if (!byId.has(id)) break;
  }
  return [item("first_weigh_in"), ...lost.map(item), item("halfway"), item("goal_reached"), ...STREAKS.map((n) => item(`streak_${n}`)), item("shots_on_time_4")];
}
