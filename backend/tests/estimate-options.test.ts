import { describe, expect, it } from "vitest";
import { DEFAULT_ESTIMATE, ESTIMATE_WEEKS, goalDateOf, projectionOf, trendOf } from "../src/lib/weight.js";
import { addDays } from "../src/lib/days.js";

// The goal estimate goes by the person's choice: scale weigh-ins or the trend, over the last 6, 12 or 26 weeks.
const TODAY = "2026-11-26";
/** One weigh-in every `every` days ending today, weight(i) for i = 0 … n − 1 (oldest first). */
const weighIns = (n: number, every: number, weight: (i: number) => number) =>
  Array.from({ length: n }, (_, i) => ({ day: addDays(TODAY, -every * (n - 1 - i)), weightKg: weight(i) }));

describe("estimate options", () => {
  it("defaults: scale weigh-ins over 12 weeks; the windows are 6, 12 and 26 weeks", () => {
    expect(DEFAULT_ESTIMATE).toEqual({ basis: "scale", days: 84 });
    expect(ESTIMATE_WEEKS).toEqual([6, 12, 26]);
  });

  it("scale basis fits the weigh-ins and counts to go from the latest weigh-in, not the lagging trend", () => {
    // 1 kg a week for 12 weeks: the trend lags above the weigh-ins
    const pts = trendOf(weighIns(13, 7, (i) => 110 - i));
    const goal = 88; // latest weigh-in 98 → 10 kg to go at 1 kg a week = 70 days
    const scale = projectionOf(pts, goal, TODAY, { basis: "scale", days: 84 });
    expect(scale).toMatchObject({ status: "ok", date: addDays(TODAY, 70) });
    if (scale.status !== "ok") throw new Error("not ok");
    expect(scale.kgPerWeek).toBeCloseTo(1, 6);
    const trend = projectionOf(pts, goal, TODAY, { basis: "trend", days: 84 });
    expect(trend.date! > scale.date!).toBe(true);
  });

  it("a 12-week window keeps a slow last month from setting the pace on its own", () => {
    // 8 weeks at 0.7 kg a week, then 4 weeks at 0.1 kg a week (weekly weigh-ins)
    const w = (i: number) => (i <= 8 ? 110 - 0.7 * i : 110 - 0.7 * 8 - 0.1 * (i - 8));
    const pts = trendOf(weighIns(13, 7, w));
    const short = goalDateOf(pts, 90, TODAY, { basis: "scale", days: 42 });
    const long = goalDateOf(pts, 90, TODAY, { basis: "scale", days: 84 });
    if (short.status !== "ok" || long.status !== "ok") throw new Error(`not ok: ${short.status} ${long.status}`);
    expect(long.kgPerWeek).toBeGreaterThan(short.kgPerWeek * 1.5);
    expect(long.date < short.date).toBe(true);
  });

  it("one heavy weigh-in two weeks back barely moves a 12-week scale pace", () => {
    // 0.6 kg a week, weigh-ins every 4 days; one reading 2.3 kg high 14 days ago (a salty day)
    const base = weighIns(22, 4, (i) => 115 - (0.6 / 7) * 4 * i);
    const bumped = base.map((p) => (p.day === addDays(TODAY, -16) ? { ...p, weightKg: p.weightKg + 2.3 } : p));
    const p = projectionOf(trendOf(bumped), 90, TODAY, { basis: "scale", days: 84 });
    if (p.status !== "ok") throw new Error(`not ok: ${p.status}`);
    expect(p.kgPerWeek).toBeGreaterThan(0.6 * 0.85);
    expect(p.kgPerWeek).toBeLessThan(0.6 * 1.15);
  });

  it("scale basis: the latest weigh-in at or under the goal is reached", () => {
    const pts = trendOf(weighIns(13, 7, (i) => 100 - i)); // latest weigh-in 88; the trend lags about 1 kg above
    expect(pts[pts.length - 1].trendKg).toBeGreaterThan(88.5);
    expect(projectionOf(pts, 88.5, TODAY, { basis: "scale", days: 84 })).toEqual({ status: "reached" });
    expect(goalDateOf(pts, 88.5, TODAY, { basis: "scale", days: 84 })).toEqual({ status: "reached" });
    expect(projectionOf(pts, 88.5, TODAY, { basis: "trend", days: 84 }).status).toBe("ok");
  });

  it("too few weigh-ins inside the window is not enough, whatever the basis", () => {
    const pts = trendOf([...weighIns(10, 7, (i) => 110 - i).slice(0, 8).map((p) => ({ ...p, day: addDays(p.day, -200) })), { day: TODAY, weightKg: 100 }]);
    expect(projectionOf(pts, 90, TODAY, { basis: "scale", days: 42 })).toEqual({ status: "not_enough" });
    expect(goalDateOf(pts, 90, TODAY, { basis: "scale", days: 42 })).toEqual({ status: "not_enough" });
  });
});
