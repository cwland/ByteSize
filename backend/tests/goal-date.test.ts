import { describe, expect, it } from "vitest";
import { goalDateOf, trendOf, type TrendPoint, type EstimateOptions } from "../src/lib/weight.js";
import { addDays } from "../src/lib/days.js";

const T42: EstimateOptions = { basis: "trend", days: 42 }; // these tests pin the trend over 6 weeks (the old default)

// The Goal date widget's numbers (§40a), pinned here to the trend over the last 6 weeks (T42; scale weigh-ins and other
// windows are in estimate-options.test.ts) (≥ 14 days and ≥ 6 weigh-ins), the pace
// from a least-squares line through it, and a range of the pace ± 1.5 standard errors of the slope of the weigh-ins
// themselves over the same days (at least ±5%): steady weigh-ins give a tight range, bumpy ones a wider one.
const TODAY = "2026-11-18";
// Daily trend points ending `endDaysAgo` before today: trend(i) = start + slope(i), i = 0 … n − 1
const series = (n: number, start: number, slope: (i: number) => number, endDaysAgo = 0): TrendPoint[] =>
  Array.from({ length: n }, (_, i) => ({ day: addDays(TODAY, -(n - 1 - i) - endDaysAgo), trendKg: start + slope(i) }));

describe("goalDateOf", () => {
  it("steady: 0.7 kg a week with 14 kg to go is 20 weeks; a straight line's range is the ±5% floor", () => {
    const pts = series(42, 100, (i) => -0.1 * i); // Oct 8 … Nov 18, ends at 95.9
    const g = goalDateOf(pts, 81.9, TODAY, T42);
    expect(g).toMatchObject({ status: "ok", date: "2027-04-07", earliest: "2027-04-01", latest: "2027-04-15", weeks: { min: 19, max: 21 } });
    if (g.status !== "ok") throw new Error("not ok");
    expect(g.kgPerWeek).toBeCloseTo(0.7, 9);
    expect(g.toGoKg).toBeCloseTo(14, 9);
  });

  it("steady weigh-ins with everyday ups and downs (about 1.4 lb a week): a range of a few weeks, not months", () => {
    // Daily weigh-ins over 6 weeks: −0.09 kg a day, ±0.6 kg of day-to-day noise; the trend smooths it
    const noise = [0.5, -0.3, 0.6, -0.6, 0.1, 0.4, -0.5, 0.2, -0.1, 0.6, -0.4, 0.0, 0.3, -0.6];
    const weighIns = Array.from({ length: 42 }, (_, i) => ({ day: addDays(TODAY, i - 41), weightKg: 105 - 0.09 * i + noise[i % noise.length] }));
    const trend = trendOf(weighIns);
    const g = goalDateOf(trend, trend[trend.length - 1].trendKg - 19, TODAY, T42); // ~30 weeks to go
    if (g.status !== "ok") throw new Error(`not ok: ${g.status}`);
    expect(g.weeks.min).toBeGreaterThanOrEqual(24);
    expect(g.weeks.max).toBeLessThanOrEqual(38);
    expect(g.weeks.max - g.weeks.min).toBeLessThanOrEqual(8);
  });

  it("bumpy: big day-to-day swings in the weigh-ins widen the range; the date sits inside it", () => {
    // The same 0.09 kg a day, with ±0.3 kg or ±2.5 kg of day-to-day swing
    const shape = [1, -0.6, 0.8, -1, 0.2, 0.7, -0.9, 0.4, -0.2, 1, -0.7, 0, 0.5, -1];
    const run = (swing: number) => {
      const trend = trendOf(Array.from({ length: 42 }, (_, i) => ({ day: addDays(TODAY, i - 41), weightKg: 105 - 0.09 * i + swing * shape[i % shape.length] })));
      const g = goalDateOf(trend, 85, TODAY, T42);
      if (g.status !== "ok") throw new Error(`not ok: ${g.status}`);
      return g;
    };
    const calm = run(0.3);
    const bumpy = run(2.5);
    expect(bumpy.weeks.max - bumpy.weeks.min).toBeGreaterThan(calm.weeks.max - calm.weeks.min + 4);
    expect(bumpy.earliest < bumpy.date && bumpy.date < bumpy.latest).toBe(true);
  });

  it("gaining or flat: not heading toward the goal (no date)", () => {
    expect(goalDateOf(series(42, 90, (i) => 0.05 * i), 80, TODAY, T42)).toMatchObject({ status: "not_heading" });
    expect(goalDateOf(series(42, 90, () => 0), 80, TODAY, T42)).toEqual({ status: "not_heading", kgPerWeek: 0 });
    // So slow the goal is more than 3 years away
    expect(goalDateOf(series(42, 90, (i) => -0.001 * i), 60, TODAY, T42)).toMatchObject({ status: "not_heading" });
  });

  it("reached: the trend at or under the goal", () => {
    expect(goalDateOf(series(42, 82, (i) => -0.1 * i), 78, TODAY, T42)).toEqual({ status: "reached" });
    // Even with only one weigh-in
    expect(goalDateOf([{ day: TODAY, trendKg: 70 }], 72, TODAY, T42)).toEqual({ status: "reached" });
  });

  it("too little data: under 6 weigh-ins, or under 14 days, in the last 6 weeks", () => {
    expect(goalDateOf([], 80, TODAY, T42)).toEqual({ status: "not_enough" });
    // 5 weigh-ins a week apart
    expect(goalDateOf(series(5, 100, (i) => -0.5 * i).map((p, i) => ({ ...p, day: addDays(TODAY, -7 * (4 - i)) })), 80, TODAY, T42)).toEqual({ status: "not_enough" });
    // 13 days of daily weigh-ins
    expect(goalDateOf(series(13, 100, (i) => -0.1 * i), 80, TODAY, T42)).toEqual({ status: "not_enough" });
    // 14 days is enough
    expect(goalDateOf(series(14, 100, (i) => -0.1 * i), 80, TODAY, T42).status).toBe("ok");
    // Older weigh-ins don't count: the last 6 weeks hold only 5
    const old = series(30, 110, (i) => -0.1 * i, 50);
    expect(goalDateOf([...old, ...series(5, 100, (i) => -0.1 * i)], 80, TODAY, T42)).toEqual({ status: "not_enough" });
  });

  it("no goal weight: nothing to aim at", () => {
    expect(goalDateOf(series(42, 100, (i) => -0.1 * i), null, TODAY, T42)).toEqual({ status: "no_goal" });
  });

  it("counts from the last weigh-in, and never puts the date before tomorrow", () => {
    // Last weigh-in 7 days ago, 0.7 kg to go at 0.7 kg a week: due a week after that weigh-in (today) → tomorrow
    const g = goalDateOf(series(30, 100, (i) => -0.1 * i, 7), 100 - 2.9 - 0.7, TODAY, T42);
    expect(g).toMatchObject({ status: "ok", date: addDays(TODAY, 1), weeks: { min: 1 } });
  });

  it("works in kg whatever units the person uses (pace and distance are kg)", () => {
    // A metric person losing 0.5 kg a week with 10 kg to go: 20 weeks
    const g = goalDateOf(series(42, 90, (i) => -(0.5 / 7) * i), 90 - (0.5 / 7) * 41 - 10, TODAY, T42);
    if (g.status !== "ok") throw new Error("not ok");
    expect(g.kgPerWeek).toBeCloseTo(0.5, 9);
    expect(g.toGoKg).toBeCloseTo(10, 9);
    expect(g.date).toBe(addDays(TODAY, 140));
  });
});
