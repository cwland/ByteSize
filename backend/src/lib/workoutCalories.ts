// Workout calories in the plan (§40b), pure. Three modes, a setting with a history like targets (the one in force
// on a day is the latest effective_from on or before it, so a change applies from that day forward):
//   show  "Earned today: 320", ranges unchanged
//   add   the day's calorie range (min and max) grows by earned × count
//   bank  earned × count goes into a bank for the week (the person's week start; no carry-over; a weekly cap). A
//         treat (a log entry marked so) is paid from the bank first; then a day over its range takes the overage
//         from the bank, and a day fully covered counts as in range. Only workout calories go in, never food left unused.

export const WORKOUT_MODES = ["show", "add", "bank"] as const;
export type WorkoutMode = (typeof WORKOUT_MODES)[number];
export const COUNT_PCTS = [25, 50, 75, 100] as const;
export type CountPct = (typeof COUNT_PCTS)[number];
export const MAX_WEEKLY_CAP = 5000;
export type WorkoutCalorieSettings = { mode: WorkoutMode; countPct: CountPct; weeklyCap: number };
export const DEFAULT_WORKOUT_CALORIES: WorkoutCalorieSettings = { mode: "show", countPct: 50, weeklyCap: 1000 };

type Range = { min: number; max: number };

/** earned × count, rounded */
export const counted = (earned: number, pct: number) => Math.round((earned * pct) / 100);

/** The setting in force on `day`: the latest effectiveFrom on or before it (ties: the highest id); none: null. */
export function inForce<T extends { id: number; effectiveFrom: string }>(rows: readonly T[], day: string): T | null {
  let best: T | null = null;
  for (const r of rows) {
    if (r.effectiveFrom > day) continue;
    if (!best || r.effectiveFrom > best.effectiveFrom || (r.effectiveFrom === best.effectiveFrom && r.id > best.id)) best = r;
  }
  return best;
}

/** The day's calorie range with its workouts: grown by earned × count in "add" mode, else as planned. */
export function addedRange(range: Range | null, earned: number, s: WorkoutCalorieSettings): Range | null {
  if (!range || s.mode !== "add") return range;
  const extra = counted(earned, s.countPct);
  return { min: range.min + extra, max: range.max + extra };
}

export type CalorieStatus = "below" | "in" | "above" | null;

/**
 * A day's calories against its range; a day the bank covered is in range. Nothing logged or no range: not judged.
 * overMax: the food judged against the maximum (after a treat paid from the bank); the minimum always counts all of it,
 * so a treat never makes a day "below".
 */
export function calorieStatus(food: number, range: Range | null, covered: boolean, logged: boolean, overMax = food): CalorieStatus {
  if (!logged || !range) return null;
  if (food < range.min) return "below";
  if (overMax > range.max) return covered ? "in" : "above";
  return "in";
}

export type BankDay = {
  day: string;
  settings: WorkoutCalorieSettings;
  /** workout calories earned that day (unknown as 0) */
  earned: number;
  /** food calories eaten (treats included) */
  food: number;
  /** calories of the day's entries marked as a treat */
  treat: number;
  /** the plan's calorie range that day (before workouts); null: no plan */
  range: Range | null;
  /** any food logged that day */
  logged: boolean;
};
export type BankDayResult = {
  day: string;
  mode: WorkoutMode;
  settings: WorkoutCalorieSettings;
  range: Range | null; // as judged (grown in "add" mode)
  added: number; // "add" mode: what the range grew by
  deposit: number;
  treatSpent: number;
  overBy: number; // after the treat was paid
  covered: number; // of overBy, paid from the bank
  balance: number; // after the day
  status: CalorieStatus;
};

/**
 * One week (oldest day first, days of a single bank week, up to the last day wanted). Each bank day: its workouts
 * go in first (capped at the week's cap in force that day), then its treats are paid, then any overage is covered.
 */
export function bankWeek(days: BankDay[]): { days: BankDayResult[]; balance: number; deposited: number; spent: number } {
  let balance = 0;
  let deposited = 0;
  let spent = 0;
  const out = days.map((d): BankDayResult => {
    const s = d.settings;
    const range = addedRange(d.range, d.earned, s);
    const added = s.mode === "add" && d.range ? counted(d.earned, s.countPct) : 0;
    if (s.mode !== "bank") {
      return { day: d.day, mode: s.mode, settings: s, range, added, deposit: 0, treatSpent: 0, overBy: range && d.logged ? Math.max(0, d.food - range.max) : 0, covered: 0, balance, status: calorieStatus(d.food, range, false, d.logged) };
    }
    const deposit = Math.max(0, Math.min(counted(d.earned, s.countPct), Math.max(0, s.weeklyCap) - deposited));
    deposited += deposit;
    balance += deposit;
    const treatSpent = Math.min(Math.max(0, d.treat), balance);
    balance -= treatSpent;
    const food = d.food - treatSpent;
    const overBy = range && d.logged ? Math.max(0, food - range.max) : 0;
    const covered = Math.min(overBy, balance);
    balance -= covered;
    spent += treatSpent + covered;
    return { day: d.day, mode: s.mode, settings: s, range, added, deposit, treatSpent, overBy, covered, balance, status: calorieStatus(d.food, range, overBy > 0 && covered === overBy, d.logged, food) };
  });
  return { days: out, balance, deposited, spent };
}
