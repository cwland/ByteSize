// GLP-1 routine: the weekly schedule, site rotation, dose history and the after-injection view.
// Pure functions over days (YYYY-MM-DD in the person's timezone); the routes load the rows.

import { addDays } from "./days.js";

/** Injection sites, in rotation order. */
export const SITES = ["abdomen_left", "abdomen_right", "thigh_left", "thigh_right", "arm_left", "arm_right"] as const;
export type Site = (typeof SITES)[number];

export const SIDE_EFFECTS = ["nausea", "low_appetite", "fatigue", "constipation", "diarrhea", "heartburn", "headache"] as const;
export type SideEffect = (typeof SIDE_EFFECTS)[number];

/** Days between shots. */
export const SHOT_INTERVAL = 7;
/** The after-injection view looks at the last 12 weeks. */
export const AFTER_INJECTION_DAYS = 84;

export type Status = "none" | "upcoming" | "due" | "overdue";

/** Whole days from `a` to `b` (negative when b is before a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** 0 = Sunday ... 6 = Saturday. */
export function weekdayOf(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

/** The site after `last` in rotation (wrapping); the first site when there is no last shot. */
export function nextSite(last: string | null | undefined): Site {
  const i = SITES.indexOf(last as Site);
  return SITES[(i + 1) % SITES.length]; // unknown/none: i = -1 → the first site
}

/** Next due: the last shot + 7 days; no shots: the next injection weekday, today included; neither: null. */
export function nextDueDay(today: string, lastShotDay: string | null, injectionWeekday: number | null): string | null {
  if (lastShotDay) return addDays(lastShotDay, SHOT_INTERVAL);
  if (injectionWeekday === null) return null;
  return addDays(today, (injectionWeekday - weekdayOf(today) + 7) % 7);
}

/** Where today stands against the next due day. */
export function scheduleStatus(today: string, nextDue: string | null): { status: Status; overdueDays: number } {
  if (!nextDue) return { status: "none", overdueDays: 0 };
  const late = daysBetween(nextDue, today);
  if (late < 0) return { status: "upcoming", overdueDays: 0 };
  if (late === 0) return { status: "due", overdueDays: 0 };
  return { status: "overdue", overdueDays: late };
}

export type DoseChange = { day: string; doseMg: number; medication: string };

/** The shots where the dose or medication changed (the first shot included), oldest first. */
export function doseHistory(shotsOldestFirst: DoseChange[]): DoseChange[] {
  const out: DoseChange[] = [];
  for (const s of shotsOldestFirst) {
    const prev = out[out.length - 1];
    if (!prev || prev.doseMg !== s.doseMg || prev.medication !== s.medication) out.push({ day: s.day, doseMg: s.doseMg, medication: s.medication });
  }
  return out;
}

export type AfterInjectionDay = { offset: number; avgCalories: number | null; avgProtein: number | null; daysCounted: number };

/**
 * Average calories and protein by days since the most recent shot on/before each day (0-6; later days
 * ignored), over the given days with food only. Days before the first shot don't count.
 */
export function afterInjection(shotDays: string[], foodDays: { day: string; calories: number; protein: number }[]): AfterInjectionDay[] {
  const shots = [...shotDays].sort();
  const buckets = Array.from({ length: SHOT_INTERVAL }, () => ({ calories: 0, protein: 0, n: 0 }));
  for (const f of foodDays) {
    let last: string | null = null;
    for (const s of shots) {
      if (s > f.day) break;
      last = s;
    }
    if (!last) continue;
    const offset = daysBetween(last, f.day);
    if (offset >= SHOT_INTERVAL) continue;
    buckets[offset].calories += f.calories;
    buckets[offset].protein += f.protein;
    buckets[offset].n++;
  }
  return buckets.map((b, offset) => ({
    offset,
    avgCalories: b.n ? Math.round(b.calories / b.n) : null,
    avgProtein: b.n ? Math.round((b.protein / b.n) * 10) / 10 : null,
    daysCounted: b.n,
  }));
}
