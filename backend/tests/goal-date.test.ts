import { describe, expect, it } from "vitest";
import { goalDateOf, type TrendPoint } from "../src/lib/weight.js";
import { addDays } from "../src/lib/days.js";

// The Goal date widget's numbers (§40a): the trend over the last 6 weeks (≥ 14 days and ≥ 6 weigh-ins), the pace
// from a least-squares line through it, and a range from the two halves' slopes or ±15% of the pace, whichever is wider.
const TODAY = "2026-11-18";
// Daily trend points ending `endDaysAgo` before today: trend(i) = start + slope(i), i = 0 … n − 1
const series = (n: number, start: number, slope: (i: number) => number, endDaysAgo = 0): TrendPoint[] =>
  Array.from({ length: n }, (_, i) => ({ day: addDays(TODAY, -(n - 1 - i) - endDaysAgo), trendKg: start + slope(i) }));

describe("goalDateOf", () => {
  it("steady: 0.7 kg a week with 14 kg to go is 20 weeks; the range is ±15% of the pace", () => {
    const pts = series(42, 100, (i) => -0.1 * i); // Oct 8 … Nov 18, ends at 95.9
    const g = goalDateOf(pts, 81.9, TODAY);
    expect(g).toMatchObject({ status: "ok", date: "2027-04-07", earliest: "2027-03-20", latest: "2027-05-02", weeks: { min: 17, max: 24 } });
    if (g.status !== "ok") throw new Error("not ok");
    expect(g.kgPerWeek).toBeCloseTo(0.7, 9);
    expect(g.toGoKg).toBeCloseTo(14, 9);
  });

  it("bumpy: fast then slow widens the range past ±15%, and the date sits inside it", () => {
    // 0.2 kg a day for three weeks, then 0.05 kg a day
    const pts = series(42, 100, (i) => (i <= 20 ? -0.2 * i : -4 - 0.05 * (i - 20)));
    const g = goalDateOf(pts, 80, TODAY);
    if (g.status !== "ok") throw new Error(`not ok: ${g.status}`);
    const steady = goalDateOf(series(42, 100, (i) => -(g.kgPerWeek / 7) * i), 100 - (g.kgPerWeek / 7) * 41 - g.toGoKg, TODAY);
    if (steady.status !== "ok") throw new Error("steady not ok");
    // Same pace and distance, a wider range
    expect(g.weeks.max - g.weeks.min).toBeGreaterThan(steady.weeks.max - steady.weeks.min);
    expect(g.earliest < g.date && g.date < g.latest).toBe(true);
    expect(g.earliest < steady.earliest).toBe(true);
    expect(g.latest > steady.latest).toBe(true);
  });

  it("gaining or flat: not heading toward the goal (no date)", () => {
    expect(goalDateOf(series(42, 90, (i) => 0.05 * i), 80, TODAY)).toMatchObject({ status: "not_heading" });
    expect(goalDateOf(series(42, 90, () => 0), 80, TODAY)).toEqual({ status: "not_heading", kgPerWeek: 0 });
    // So slow the goal is more than 3 years away
    expect(goalDateOf(series(42, 90, (i) => -0.001 * i), 60, TODAY)).toMatchObject({ status: "not_heading" });
  });

  it("reached: the trend at or under the goal", () => {
    expect(goalDateOf(series(42, 82, (i) => -0.1 * i), 78, TODAY)).toEqual({ status: "reached" });
    // Even with only one weigh-in
    expect(goalDateOf([{ day: TODAY, trendKg: 70 }], 72, TODAY)).toEqual({ status: "reached" });
  });

  it("too little data: under 6 weigh-ins, or under 14 days, in the last 6 weeks", () => {
    expect(goalDateOf([], 80, TODAY)).toEqual({ status: "not_enough" });
    // 5 weigh-ins a week apart
    expect(goalDateOf(series(5, 100, (i) => -0.5 * i).map((p, i) => ({ ...p, day: addDays(TODAY, -7 * (4 - i)) })), 80, TODAY)).toEqual({ status: "not_enough" });
    // 13 days of daily weigh-ins
    expect(goalDateOf(series(13, 100, (i) => -0.1 * i), 80, TODAY)).toEqual({ status: "not_enough" });
    // 14 days is enough
    expect(goalDateOf(series(14, 100, (i) => -0.1 * i), 80, TODAY).status).toBe("ok");
    // Older weigh-ins don't count: the last 6 weeks hold only 5
    const old = series(30, 110, (i) => -0.1 * i, 50);
    expect(goalDateOf([...old, ...series(5, 100, (i) => -0.1 * i)], 80, TODAY)).toEqual({ status: "not_enough" });
  });

  it("no goal weight: nothing to aim at", () => {
    expect(goalDateOf(series(42, 100, (i) => -0.1 * i), null, TODAY)).toEqual({ status: "no_goal" });
  });

  it("counts from the last weigh-in, and never puts the date before tomorrow", () => {
    // Last weigh-in 7 days ago, 0.7 kg to go at 0.7 kg a week: due a week after that weigh-in (today) → tomorrow
    const g = goalDateOf(series(30, 100, (i) => -0.1 * i, 7), 100 - 2.9 - 0.7, TODAY);
    expect(g).toMatchObject({ status: "ok", date: addDays(TODAY, 1), weeks: { min: 1 } });
  });

  it("works in kg whatever units the person uses (pace and distance are kg)", () => {
    // A metric person losing 0.5 kg a week with 10 kg to go: 20 weeks
    const g = goalDateOf(series(42, 90, (i) => -(0.5 / 7) * i), 90 - (0.5 / 7) * 41 - 10, TODAY);
    if (g.status !== "ok") throw new Error("not ok");
    expect(g.kgPerWeek).toBeCloseTo(0.5, 9);
    expect(g.toGoKg).toBeCloseTo(10, 9);
    expect(g.date).toBe(addDays(TODAY, 140));
  });
});
