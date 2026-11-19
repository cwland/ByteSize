import { describe, expect, it } from "vitest";
import type { Goal, GoalPeriodProgress } from "../../types";
import { datesText, goalSummary, overallText, progressText, resultText, ringFraction, targetText, TARGET_LABEL } from "./goalCopy";

const progress = (over: Partial<Goal["progress"]> = {}): Goal["progress"] => ({ state: "active", periods: [], current: null, hit: 0, done: 0, of: null, startKg: null, asOf: "2026-11-18", ...over });
const goal = (over: Partial<Goal> = {}): Goal => ({
  id: 1,
  type: "logging_days",
  name: "Logging days",
  target: 5,
  period: "week",
  measure: null,
  start: "2026-11-15",
  end: "2026-12-12",
  createdAt: "2026-11-15T08:00:00Z",
  endedEarly: false,
  frozen: false,
  progress: progress(),
  ...over,
});
const p = (value: number | null, target: number, status: GoalPeriodProgress["status"] = "open"): GoalPeriodProgress => ({ start: "2026-11-15", end: "2026-11-21", value, target, status });
const day = (d: string) => d.slice(5); // a stand-in date format

describe("goal copy (§40c)", () => {
  it("says the target in plain words, per type and period", () => {
    expect(targetText(goal(), "imperial", day)).toBe("Log food 5 days a week");
    expect(targetText(goal({ target: 1, period: "month" }), "imperial", day)).toBe("Log food 1 day a month");
    expect(targetText(goal({ type: "protein_days", period: "stretch", target: 20 }), "imperial", day)).toBe("Reach your protein 20 days in all");
    expect(targetText(goal({ type: "calorie_days" }), "imperial", day)).toBe("Stay in your calorie range 5 days a week");
    expect(targetText(goal({ type: "water_days" }), "imperial", day)).toBe("Drink your water 5 days a week");
    expect(targetText(goal({ type: "fiber_days" }), "imperial", day)).toBe("Reach your fiber 5 days a week");
    expect(targetText(goal({ type: "weigh_ins", target: 3 }), "imperial", day)).toBe("Weigh in 3 days a week");
    expect(targetText(goal({ type: "streak", target: 14, period: "stretch" }), "imperial", day)).toBe("Reach a 14-day logging streak");
    expect(targetText(goal({ type: "steps", measure: "total", target: 70000 }), "imperial", day)).toBe("70,000 steps a week");
    expect(targetText(goal({ type: "steps", measure: "average", target: 8000 }), "imperial", day)).toBe("8,000 steps a day, on average each week");
    expect(targetText(goal({ type: "steps", measure: "average", target: 8000, period: "stretch" }), "imperial", day)).toBe("8,000 steps a day, on average");
    expect(targetText(goal({ type: "workouts", target: 3 }), "imperial", day)).toBe("3 workouts a week");
    expect(targetText(goal({ type: "active_minutes", target: 150, period: "month" }), "imperial", day)).toBe("150 active minutes a month");
    expect(targetText(goal({ type: "weight_by_date", target: 81.646627, period: "stretch", end: "2027-01-31" }), "imperial", day)).toBe("180 lb by 01-31");
    expect(targetText(goal({ type: "weight_by_date", target: 81.6, period: "stretch", end: "2027-01-31" }), "metric", day)).toBe("81.6 kg by 01-31");
  });

  it("says the current period's progress (the ring's words)", () => {
    expect(progressText(goal(), p(4, 6))).toBe("4 of 6 days this week");
    expect(progressText(goal({ period: "month" }), p(1, 20))).toBe("1 of 20 days this month");
    expect(progressText(goal({ period: "stretch" }), p(9, 12))).toBe("9 of 12 days so far");
    expect(progressText(goal({ type: "steps", measure: "total" }), p(38200, 70000))).toBe("38,200 of 70,000 steps this week");
    expect(progressText(goal({ type: "steps", measure: "average" }), p(7412, 8000))).toBe("7,412 steps a day this week, of 8,000");
    expect(progressText(goal({ type: "steps", measure: "average" }), p(null, 8000))).toBe("No steps yet this week");
    expect(progressText(goal({ type: "workouts" }), p(1, 3))).toBe("1 of 3 workouts this week");
    expect(progressText(goal({ type: "active_minutes" }), p(95, 150))).toBe("95 of 150 minutes this week");
    expect(progressText(goal({ type: "streak", period: "stretch" }), p(4, 7))).toBe("Longest streak: 4 of 7 days");
    expect(progressText(goal({ type: "weight_by_date", period: "stretch" }), p(82.5, 81.6466), "imperial")).toBe("Now 181.9 lb · goal 180 lb");
    expect(progressText(goal({ type: "weight_by_date", period: "stretch" }), p(null, 80), "metric")).toBe("No weigh-ins yet");
    // A finished period's numbers, without "this week"
    expect(progressText(goal(), p(5, 5, "hit"), "imperial", "")).toBe("5 of 5 days");
  });

  it("the overall result so far, for weekly and monthly goals", () => {
    expect(overallText(goal({ progress: progress({ hit: 3, done: 4 }) }))).toBe("3 of 4 weeks hit");
    expect(overallText(goal({ period: "month", progress: progress({ hit: 1, done: 1 }) }))).toBe("1 of 1 month hit");
    expect(overallText(goal({ progress: progress({ hit: 0, done: 0 }) }))).toBeNull();
    expect(overallText(goal({ period: "stretch", progress: progress({ hit: 1, done: 1 }) }))).toBeNull();
  });

  it("a finished goal: completed or missed, with its final numbers", () => {
    const weeks = goal({ frozen: true, progress: progress({ state: "completed", hit: 4, done: 4, of: 4 }) });
    expect(resultText(weeks, "imperial")).toEqual({ met: true, text: "Completed · 4 of 4 weeks hit" });
    const stretch = goal({ period: "stretch", progress: progress({ state: "missed", hit: 0, done: 1, of: 1, periods: [p(10, 12, "missed")] }) });
    expect(resultText(stretch, "imperial")).toEqual({ met: false, text: "Missed · 10 of 12 days" });
    const weight = goal({ type: "weight_by_date", period: "stretch", progress: progress({ state: "completed", hit: 1, done: 1, of: 1, periods: [p(81, 81.6466, "hit")] }) });
    expect(resultText(weight, "imperial")).toEqual({ met: true, text: "Completed · ended at 178.6 lb · goal 180 lb" });
    // Ended early today: still being worked out
    expect(resultText(goal({ endedEarly: true, progress: progress({ state: "active", hit: 1, done: 1 }) }), "imperial")).toEqual({ met: null, text: "Ended today · 1 of 1 week hit so far" });
  });

  it("the dates", () => {
    expect(datesText(goal(), day)).toBe("11-15 – 12-12");
    expect(datesText(goal({ end: null }), day)).toBe("From 11-15, ongoing");
    expect(datesText(goal({ start: "2026-12-01", progress: progress({ state: "upcoming" }) }), day)).toBe("Starts 12-01 · until 12-12");
  });

  it("how full the ring is: the share of the target; a weight from its start toward the goal", () => {
    expect(ringFraction(goal(), p(3, 6))).toBe(0.5);
    expect(ringFraction(goal(), p(9, 6))).toBe(1);
    expect(ringFraction(goal(), p(null, 6))).toBe(0);
    const w = goal({ type: "weight_by_date", progress: progress({ startKg: 90 }) });
    expect(ringFraction(w, p(88, 85))).toBeCloseTo(0.4);
    expect(ringFraction(w, p(91, 85))).toBe(0);
    expect(ringFraction(w, p(84, 85))).toBe(1);
  });

  it("a one-line summary for the Goals list", () => {
    expect(goalSummary(goal({ progress: progress({ current: p(2, 3) }) }), "imperial", day)).toBe("2 of 3 days this week");
    expect(goalSummary(goal({ start: "2026-12-01", progress: progress({ state: "upcoming" }) }), "imperial", day)).toBe("Starts 12-01");
  });

  it("labels the target box for each kind", () => {
    expect(TARGET_LABEL("logging_days", "week", null, "imperial")).toBe("Days each week");
    expect(TARGET_LABEL("weigh_ins", "stretch", null, "imperial")).toBe("Days in all");
    expect(TARGET_LABEL("steps", "month", "total", "imperial")).toBe("Steps each month");
    expect(TARGET_LABEL("steps", "week", "average", "imperial")).toBe("Steps a day (average)");
    expect(TARGET_LABEL("streak", "stretch", null, "imperial")).toBe("Streak length (days)");
    expect(TARGET_LABEL("weight_by_date", "stretch", null, "metric")).toBe("Goal weight (kg)");
    expect(TARGET_LABEL("active_minutes", "week", null, "imperial")).toBe("Minutes each week");
    expect(TARGET_LABEL("workouts", "stretch", null, "imperial")).toBe("Workouts in all");
  });
});
