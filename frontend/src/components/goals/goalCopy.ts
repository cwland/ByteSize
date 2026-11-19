// Goals (§40c): the words for a goal, from the server's numbers. Pure. `day` writes a date the person's way.
import type { Goal, GoalPeriod, GoalPeriodProgress, GoalType, Units } from "../../types";
import { fmt, formatWeight } from "../../units";

type Spec = Pick<Goal, "type" | "target" | "period" | "measure" | "end">;
type DayFmt = (day: string) => string;

/** The kinds of goal, in the order the New goal sheet offers them */
export const GOAL_KINDS: { type: GoalType; name: string; group: "Habits" | "Activity" | "Weight" }[] = [
  { type: "logging_days", name: "Logging days", group: "Habits" },
  { type: "protein_days", name: "Protein days", group: "Habits" },
  { type: "calorie_days", name: "Calorie days", group: "Habits" },
  { type: "water_days", name: "Water days", group: "Habits" },
  { type: "fiber_days", name: "Fiber days", group: "Habits" },
  { type: "weigh_ins", name: "Weigh-ins", group: "Habits" },
  { type: "streak", name: "Streak", group: "Habits" },
  { type: "steps", name: "Steps", group: "Activity" },
  { type: "workouts", name: "Workouts", group: "Activity" },
  { type: "active_minutes", name: "Active minutes", group: "Activity" },
  { type: "weight_by_date", name: "Weight by a date", group: "Weight" },
];
export const kindName = (t: GoalType) => GOAL_KINDS.find((k) => k.type === t)?.name ?? t;
/** What each kind counts, for the New goal sheet */
export const KIND_HINT: Record<GoalType, string> = {
  logging_days: "Days you log food",
  protein_days: "Days you reach your protein minimum",
  calorie_days: "Days your calories are in range (a day your workout bank covers counts)",
  water_days: "Days you reach your water minimum",
  fiber_days: "Days you reach your fiber minimum",
  weigh_ins: "Days you weigh in",
  streak: "Your longest run of days with food logged, inside the dates",
  steps: "Steps from Health, or the ones you type",
  workouts: "Workouts you log or Health sends",
  active_minutes: "Minutes of all your workouts",
  weight_by_date: "Your trend weight on the end date",
};
/** Kinds that run over the whole stretch only */
export const STRETCH_ONLY: GoalType[] = ["streak", "weight_by_date"];
const DAY_COUNTS: GoalType[] = ["logging_days", "protein_days", "calorie_days", "water_days", "fiber_days", "weigh_ins"];
export const isDayCount = (t: GoalType) => DAY_COUNTS.includes(t);

const PER: Record<GoalPeriod, string> = { week: "a week", month: "a month", stretch: "in all" };
const EACH: Record<GoalPeriod, string> = { week: "each week", month: "each month", stretch: "in all" };
const WHEN: Record<GoalPeriod, string> = { week: "this week", month: "this month", stretch: "so far" };
const plural = (n: number, one: string, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;
const DOING: Partial<Record<GoalType, string>> = {
  logging_days: "Log food",
  protein_days: "Reach your protein",
  calorie_days: "Stay in your calorie range",
  water_days: "Drink your water",
  fiber_days: "Reach your fiber",
  weigh_ins: "Weigh in",
};

/** "Log food 5 days a week", "70,000 steps a week", "180 lb by Jan 31" */
export function targetText(g: Spec, units: Units, day: DayFmt): string {
  const per = PER[g.period];
  if (isDayCount(g.type)) return `${DOING[g.type]} ${plural(g.target, "day")} ${per}`;
  switch (g.type) {
    case "streak":
      return `Reach a ${fmt(g.target)}-day logging streak`;
    case "steps":
      return g.measure === "average" ? `${fmt(g.target)} steps a day, on average${g.period === "stretch" ? "" : ` ${EACH[g.period]}`}` : `${plural(g.target, "step")} ${per}`;
    case "workouts":
      return `${plural(g.target, "workout")} ${per}`;
    case "active_minutes":
      return `${fmt(g.target)} active minutes ${per}`;
    case "weight_by_date":
      return `${formatWeight(g.target, units)}${g.end ? ` by ${day(g.end)}` : ""}`;
  }
  return "";
}

/** A period's progress: "4 of 6 days this week". `when` defaults to the period's ("this week"); "" for a finished one. */
export function progressText(g: Pick<Goal, "type" | "period" | "measure">, p: GoalPeriodProgress, units: Units = "imperial", when = WHEN[g.period]): string {
  const at = when ? ` ${when}` : "";
  const v = p.value;
  if (g.type === "weight_by_date") return v === null ? "No weigh-ins yet" : `Now ${formatWeight(v, units)} · goal ${formatWeight(p.target, units)}`;
  if (g.type === "streak") return `Longest streak: ${fmt(v ?? 0)} of ${plural(p.target, "day")}`;
  if (g.type === "steps" && g.measure === "average") return v === null ? `No steps yet${at}` : `${fmt(v)} steps a day${at}, of ${fmt(p.target)}`;
  const what = isDayCount(g.type) ? "days" : g.type === "steps" ? "steps" : g.type === "workouts" ? "workouts" : "minutes";
  return `${fmt(v ?? 0)} of ${fmt(p.target)} ${what}${at}`;
}

/** Weekly and monthly goals: "3 of 4 weeks hit" (decided periods); none decided yet, or a stretch: null */
export function overallText(g: Pick<Goal, "period" | "progress">): string | null {
  const { hit, done } = g.progress;
  if (g.period === "stretch" || done === 0) return null;
  return `${fmt(hit)} of ${plural(done, g.period)} hit`;
}

/** Each week / each month with an end: "10 of 12 weeks needed" (80% of the judged periods, rounded up); else null */
export function neededText(g: Pick<Goal, "period" | "end" | "progress">): string | null {
  const { needed, of } = g.progress;
  if (g.period === "stretch" || g.end === null || needed === null || !of) return null;
  return `${fmt(needed)} of ${plural(of, g.period)} needed`;
}

/** A line under the ring: a short partial week or month isn't counted; a steps average leaves out days without steps */
export function periodNote(g: Pick<Goal, "type" | "period" | "measure">, p: GoalPeriodProgress): string | null {
  if (p.status === "unjudged" && g.period !== "stretch") return `A short ${g.period}: shown, not counted`;
  if (g.type === "steps" && g.measure === "average") return "Average on days with steps";
  return null;
}

/** A finished goal: met (✓), missed (✗), or neither (null: ended today and still being worked out, or ended early with nothing to judge), with its final numbers */
export function resultText(g: Goal, units: Units): { met: boolean | null; text: string } {
  const pr = g.progress;
  if (pr.state === "ended") return { met: null, text: g.period === "stretch" ? "Ended early" : `Ended early, before a full ${g.period}` };
  if (pr.state !== "completed" && pr.state !== "missed") {
    const so = overallText(g);
    return { met: null, text: `Ended today${so ? ` · ${so} so far` : ""}` };
  }
  const met = pr.state === "completed";
  const head = met ? "Completed" : "Missed";
  if (g.period !== "stretch") {
    const of = pr.of ?? pr.done;
    const needed = pr.needed !== null && pr.needed !== undefined && pr.needed < of ? ` (${fmt(pr.needed)} needed)` : "";
    return { met, text: `${head} · ${fmt(pr.hit)} of ${plural(of, g.period)} hit${needed}` };
  }
  const last = pr.periods[pr.periods.length - 1];
  if (!last) return { met, text: head };
  if (g.type === "weight_by_date") return { met, text: last.value === null ? `${head} · no weigh-ins` : `${head} · ended at ${formatWeight(last.value, units)} · goal ${formatWeight(last.target, units)}` };
  return { met, text: `${head} · ${progressText(g, last, units, "")}` };
}

/** "Nov 15 – Dec 12", "From Nov 15, ongoing", "Starts Dec 1 · until Dec 12"; past: its dates only */
export function datesText(g: Pick<Goal, "start" | "end" | "progress">, day: DayFmt, range?: (from: string, to: string) => string, o: { past?: boolean } = {}): string {
  if (g.progress.state === "upcoming" && !o.past) return `Starts ${day(g.start)}${g.end ? ` · until ${day(g.end)}` : ", ongoing"}`;
  if (!g.end) return `From ${day(g.start)}, ongoing`;
  return range ? range(g.start, g.end) : `${day(g.start)} – ${day(g.end)}`;
}

/** How full the ring is (0–1): the share of the target; a weight, how far from the start toward the goal */
export function ringFraction(g: Pick<Goal, "type" | "progress">, p: GoalPeriodProgress): number {
  if (p.value === null) return 0;
  let f: number;
  if (g.type === "weight_by_date") {
    const start = g.progress.startKg;
    if (start === null || start <= p.target) return p.value <= p.target ? 1 : 0;
    f = (start - p.value) / (start - p.target);
  } else f = p.target > 0 ? p.value / p.target : 0;
  return Math.max(0, Math.min(1, f));
}

/** One line for the Goals list: the current period's progress, or when it starts */
export function goalSummary(g: Goal, units: Units, day: DayFmt): string {
  if (g.progress.state === "upcoming") return `Starts ${day(g.start)}`;
  const p = g.progress.current;
  return p ? progressText(g, p, units) : (overallText(g) ?? "");
}

/** The target box's label in the New goal / Edit sheet */
export function TARGET_LABEL(type: GoalType, period: GoalPeriod, measure: "total" | "average" | null, units: Units): string {
  const cap = (s: string) => `${s} ${EACH[period]}`;
  if (isDayCount(type)) return cap("Days");
  switch (type) {
    case "streak":
      return "Streak length (days)";
    case "steps":
      return measure === "average" ? "Steps a day (average)" : cap("Steps");
    case "workouts":
      return cap("Workouts");
    case "active_minutes":
      return cap("Minutes");
    case "weight_by_date":
      return `Goal weight (${units === "metric" ? "kg" : "lb"})`;
  }
  return "Target";
}
