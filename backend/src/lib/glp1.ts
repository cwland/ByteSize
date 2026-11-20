// GLP-1 routine: the weekly schedule, site rotation, dose history and the after-injection view.
// Pure functions over days (YYYY-MM-DD in the person's timezone); the routes load the rows.

import { addDays, daysBetween, weekdayOf } from "./days.js";

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

/** W1 (SPEC-14): the standard GLP-1 medications and their dose steps (mg). Anything else is "Compounded" (own name, dose and unit). */
export const MEDICATIONS = [
  { name: "Wegovy", ingredient: "semaglutide", doses: [0.25, 0.5, 1, 1.7, 2.4] },
  { name: "Ozempic", ingredient: "semaglutide", doses: [0.25, 0.5, 1, 2] },
  { name: "Zepbound", ingredient: "tirzepatide", doses: [2.5, 5, 7.5, 10, 12.5, 15] },
  { name: "Mounjaro", ingredient: "tirzepatide", doses: [2.5, 5, 7.5, 10, 12.5, 15] },
  { name: "Saxenda", ingredient: "liraglutide", doses: [0.6, 1.2, 1.8, 2.4, 3] },
  { name: "Trulicity", ingredient: "dulaglutide", doses: [0.75, 1.5, 3, 4.5] },
] as const;

/** What a dose is measured in (a compounded dose can be in units or ml). */
export const DOSE_UNITS = ["mg", "units", "ml"] as const;
export type DoseUnit = (typeof DOSE_UNITS)[number];
/** The most a dose can be in each unit. */
export const DOSE_MAX: Record<DoseUnit, number> = { mg: 100, units: 1000, ml: 100 };

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
 * ignored), over the given days with food only. Days before the first shot don't count. A day whose
 * calories (or protein) is unknown (null) is left out of that average only; daysCounted counts every day with food.
 */
export function afterInjection(shotDays: string[], foodDays: { day: string; calories: number | null; protein: number | null }[]): AfterInjectionDay[] {
  const shots = [...shotDays].sort();
  const buckets = Array.from({ length: SHOT_INTERVAL }, () => ({ calories: 0, nCalories: 0, protein: 0, nProtein: 0, n: 0 }));
  for (const f of foodDays) {
    let last: string | null = null;
    for (const s of shots) {
      if (s > f.day) break;
      last = s;
    }
    if (!last) continue;
    const offset = daysBetween(last, f.day);
    if (offset >= SHOT_INTERVAL) continue;
    const b = buckets[offset];
    b.n++;
    if (f.calories !== null) {
      b.calories += f.calories;
      b.nCalories++;
    }
    if (f.protein !== null) {
      b.protein += f.protein;
      b.nProtein++;
    }
  }
  return buckets.map((b, offset) => ({
    offset,
    avgCalories: b.nCalories ? Math.round(b.calories / b.nCalories) : null,
    avgProtein: b.nProtein ? Math.round((b.protein / b.nProtein) * 10) / 10 : null,
    daysCounted: b.n,
  }));
}
