import { describe, expect, it } from "vitest";
import { emptyDay, periodsOf, progressOf, type DayFacts, type GoalSpec } from "../src/lib/goals.js";
import { addDays } from "../src/lib/days.js";

// §40c: goal progress (pure). November 2026: the 1st is a Sunday, so Sunday weeks are Nov 1–7, 8–14, 15–21, 22–28.

const SUN = 0;
const MON = 1;

/** Facts for each day from `from` to `to`, `f` filling each in (by day and its index). */
function days(from: string, to: string, f: (day: string, i: number) => Partial<DayFacts>): DayFacts[] {
  const out: DayFacts[] = [];
  for (let d = from, i = 0; d <= to; d = addDays(d, 1), i++) out.push({ ...emptyDay(d), ...f(d, i) });
  return out;
}
const goal = (g: Partial<GoalSpec>): GoalSpec => ({ type: "logging_days", target: 5, period: "week", measure: null, start: "2026-11-01", end: "2026-11-14", ...g });
const run = (g: Partial<GoalSpec>, facts: DayFacts[], today: string, weekStart = SUN, trend: { day: string; trendKg: number }[] = []) => progressOf(goal(g), { days: facts, trend, today, weekStart });

describe("periods", () => {
  it("weeks follow the week start, clipped to the goal", () => {
    expect(periodsOf(goal({ start: "2026-11-05", end: "2026-11-18" }), SUN, "2026-11-30")).toEqual([
      { start: "2026-11-05", end: "2026-11-07", length: 7 },
      { start: "2026-11-08", end: "2026-11-14", length: 7 },
      { start: "2026-11-15", end: "2026-11-18", length: 7 },
    ]);
    expect(periodsOf(goal({ start: "2026-11-05", end: "2026-11-18" }), MON, "2026-11-30")).toEqual([
      { start: "2026-11-05", end: "2026-11-08", length: 7 },
      { start: "2026-11-09", end: "2026-11-15", length: 7 },
      { start: "2026-11-16", end: "2026-11-18", length: 7 },
    ]);
  });

  it("months are calendar months, clipped to the goal", () => {
    expect(periodsOf(goal({ period: "month", start: "2026-11-20", end: "2027-02-10" }), SUN, "2027-03-01")).toEqual([
      { start: "2026-11-20", end: "2026-11-30", length: 30 },
      { start: "2026-12-01", end: "2026-12-31", length: 31 },
      { start: "2027-01-01", end: "2027-01-31", length: 31 },
      { start: "2027-02-01", end: "2027-02-10", length: 28 },
    ]);
  });

  it("the whole stretch is one period", () => {
    expect(periodsOf(goal({ period: "stretch", start: "2026-11-03", end: "2026-11-30" }), SUN, "2026-11-10")).toEqual([{ start: "2026-11-03", end: "2026-11-30", length: 28 }]);
  });

  it("an ongoing goal has periods up to the one holding `until`", () => {
    expect(periodsOf(goal({ end: null, start: "2026-11-01" }), SUN, "2026-11-18").map((p) => p.start)).toEqual(["2026-11-01", "2026-11-08", "2026-11-15"]);
    expect(periodsOf(goal({ end: null, period: "month", start: "2026-10-15" }), SUN, "2026-11-18").map((p) => [p.start, p.end])).toEqual([
      ["2026-10-15", "2026-10-31"],
      ["2026-11-01", "2026-11-30"],
    ]);
  });
});

describe("day-count goals by week", () => {
  // Week 1 (Nov 1–7): logged 5 days; week 2 (Nov 8–14): logged 4
  const logged = days("2026-11-01", "2026-11-14", (_, i) => ({ logged: i < 5 || (i >= 7 && i < 11) }));

  it("each week is hit or missed; the goal is completed only when every week was hit", () => {
    const p = run({}, logged, "2026-11-20");
    expect(p.periods.map((x) => [x.start, x.value, x.target, x.status])).toEqual([
      ["2026-11-01", 5, 5, "hit"],
      ["2026-11-08", 4, 5, "missed"],
    ]);
    expect(p).toMatchObject({ state: "missed", hit: 1, done: 2, of: 2, current: null });
    const all = days("2026-11-01", "2026-11-14", (_, i) => ({ logged: i % 7 < 5 }));
    expect(run({}, all, "2026-11-15")).toMatchObject({ state: "completed", hit: 2, done: 2, of: 2 });
  });

  it("the week holding today is open until its target is reached (then hit, early)", () => {
    const facts = days("2026-11-15", "2026-11-18", (_, i) => ({ logged: i < 3 }));
    const p = run({ start: "2026-11-15", end: "2026-11-28" }, facts, "2026-11-18");
    expect(p.current).toEqual({ start: "2026-11-15", end: "2026-11-21", value: 3, target: 5, status: "open" });
    expect(p).toMatchObject({ state: "active", hit: 0, done: 0, of: 2 });
    const more = days("2026-11-15", "2026-11-19", () => ({ logged: true }));
    expect(run({ start: "2026-11-15", end: "2026-11-28" }, more, "2026-11-19")).toMatchObject({ current: { value: 5, status: "hit" }, hit: 1, done: 1 });
  });

  it("days after today never count (even with data on them)", () => {
    const facts = days("2026-11-15", "2026-11-21", () => ({ logged: true }));
    expect(run({ start: "2026-11-15", end: "2026-11-21" }, facts, "2026-11-17").current).toMatchObject({ value: 3, status: "open" });
  });

  it("a partial first or last week asks for its share of the target (rounded up), never more than its days", () => {
    // Thu Nov 5 – Wed Nov 11, 6 days a week: Nov 5–7 (3 of 7 days) → 3; Nov 8–11 (4 of 7) → 4
    const facts = days("2026-11-05", "2026-11-11", () => ({ logged: true }));
    const p = run({ target: 6, start: "2026-11-05", end: "2026-11-11" }, facts, "2026-11-12");
    expect(p.periods.map((x) => [x.start, x.end, x.value, x.target, x.status])).toEqual([
      ["2026-11-05", "2026-11-07", 3, 3, "hit"],
      ["2026-11-08", "2026-11-11", 4, 4, "hit"],
    ]);
    expect(p.state).toBe("completed");
    // 2 days a week, a 1-day last week: ceil(2/7) = 1
    expect(run({ target: 2, start: "2026-11-01", end: "2026-11-08" }, [], "2026-11-09").periods.map((x) => x.target)).toEqual([2, 1]);
  });

  it("other day kinds: protein, calories, water, fiber, weigh-ins", () => {
    const facts = days("2026-11-01", "2026-11-07", (_, i) => ({ protein: i < 2, calories: i < 3, water: i < 4, fiber: i < 5, weighed: i < 6 }));
    const value = (type: GoalSpec["type"]) => run({ type, target: 1, end: "2026-11-07" }, facts, "2026-11-08").periods[0].value;
    expect([value("protein_days"), value("calorie_days"), value("water_days"), value("fiber_days"), value("weigh_ins")]).toEqual([2, 3, 4, 5, 6]);
  });
});

describe("day-count goals by month and over the whole stretch", () => {
  it("a month counts its days; a partial month asks for its share", () => {
    // From Nov 20: 11 of November's 30 days → 20 × 11/30 = 7.33 → 8
    const facts = days("2026-11-20", "2026-12-31", (d) => ({ weighed: d.endsWith("0") || d.endsWith("5") || d >= "2026-12-01" }));
    const p = run({ type: "weigh_ins", target: 20, period: "month", start: "2026-11-20", end: "2026-12-31" }, facts, "2027-01-02");
    expect(p.periods.map((x) => [x.start, x.value, x.target, x.status])).toEqual([
      ["2026-11-20", 3, 8, "missed"],
      ["2026-12-01", 31, 20, "hit"],
    ]);
    expect(p).toMatchObject({ state: "missed", hit: 1, of: 2 });
  });

  it("a target above a month's days asks for every day of a shorter month", () => {
    const facts = days("2027-02-01", "2027-02-28", () => ({ logged: true }));
    const p = run({ target: 31, period: "month", start: "2027-02-01", end: "2027-02-28" }, facts, "2027-03-01");
    expect(p.periods[0]).toMatchObject({ value: 28, target: 28, status: "hit" });
  });

  it("the whole stretch counts every day in it against the whole target", () => {
    const facts = days("2026-11-01", "2026-11-30", (_, i) => ({ water: i % 2 === 0 }));
    const p = run({ type: "water_days", target: 12, period: "stretch", start: "2026-11-01", end: "2026-11-30" }, facts, "2026-11-10");
    expect(p.current).toEqual({ start: "2026-11-01", end: "2026-11-30", value: 5, target: 12, status: "open" });
    expect(p).toMatchObject({ state: "active", of: 1 });
    expect(run({ type: "water_days", target: 12, period: "stretch", start: "2026-11-01", end: "2026-11-30" }, facts, "2026-12-01")).toMatchObject({ state: "completed", hit: 1, of: 1 });
  });
});

describe("activity goals", () => {
  // Steps: 8,000 each day of Nov 1–7 except none on the 3rd (not sent) and 2,000 on the 7th
  const steps = days("2026-11-01", "2026-11-07", (d) => ({ steps: d === "2026-11-03" ? null : d === "2026-11-07" ? 2000 : 8000 }));

  it("steps in total per period", () => {
    const p = run({ type: "steps", measure: "total", target: 40000, end: "2026-11-07" }, steps, "2026-11-08");
    expect(p.periods[0]).toMatchObject({ value: 42000, target: 40000, status: "hit" });
  });

  it("steps as an average per day leave out days with no steps, and aren't decided before the period ends", () => {
    const g = { type: "steps" as const, measure: "average" as const, target: 7000, end: "2026-11-07" };
    // 42,000 over 6 days with steps = 7,000
    expect(run(g, steps, "2026-11-08").periods[0]).toMatchObject({ value: 7000, target: 7000, status: "hit" });
    // Mid-week: an average can still fall, so it stays open even above the target
    expect(run(g, steps, "2026-11-02").current).toMatchObject({ value: 8000, status: "open" });
    // A partial week doesn't change a per-day average target
    expect(run({ ...g, start: "2026-11-05" }, steps, "2026-11-08").periods[0]).toMatchObject({ value: 6000, target: 7000, status: "missed" });
    // No steps at all: unknown, and missed once it's over
    expect(run(g, [], "2026-11-08").periods[0]).toMatchObject({ value: null, status: "missed" });
  });

  it("workouts counted and active minutes totalled, a partial period asking for its share", () => {
    const facts = days("2026-11-05", "2026-11-14", (_, i) => ({ workouts: i % 2, activeMinutes: (i % 2) * 30 }));
    const w = run({ type: "workouts", target: 3, start: "2026-11-05", end: "2026-11-14" }, facts, "2026-11-15");
    // Nov 5–7: 3 × 3/7 → 2; Nov 8–14: 3
    expect(w.periods.map((x) => [x.value, x.target, x.status])).toEqual([
      [1, 2, "missed"],
      [4, 3, "hit"],
    ]);
    const m = run({ type: "active_minutes", target: 150, start: "2026-11-05", end: "2026-11-14" }, facts, "2026-11-15");
    // 150 × 3/7 = 64.3 → 65
    expect(m.periods.map((x) => [x.value, x.target])).toEqual([
      [30, 65],
      [120, 150],
    ]);
  });
});

describe("streak goals", () => {
  it("the longest run of logged days inside the stretch; vacation days without food skip, other empty days break", () => {
    // Logged Oct 30–Nov 4 (the run before the start doesn't count), gap on Nov 5, then Nov 6–9 with Nov 8 on vacation unlogged
    const facts = days("2026-10-30", "2026-11-12", (d) => ({
      logged: d <= "2026-11-04" || (d >= "2026-11-06" && d <= "2026-11-10" && d !== "2026-11-08"),
      vacation: d === "2026-11-08",
    }));
    const g = { type: "streak" as const, target: 5, period: "stretch" as const, start: "2026-11-01", end: "2026-11-30" };
    // Nov 1–4 = 4; Nov 6, 7, (8 skipped), 9, 10 = 4
    expect(run(g, facts, "2026-11-12").current).toMatchObject({ value: 4, target: 5, status: "open" });
    const more = [...facts.filter((f) => f.day < "2026-11-11"), { ...emptyDay("2026-11-11"), logged: true }];
    expect(run(g, more, "2026-11-12").current).toMatchObject({ value: 5, status: "hit" });
    expect(run(g, facts, "2026-12-01")).toMatchObject({ state: "missed", hit: 0, of: 1 });
  });
});

describe("weight by a date", () => {
  const trend = [
    { day: "2026-10-28", trendKg: 92 },
    { day: "2026-11-02", trendKg: 91 },
    { day: "2026-11-10", trendKg: 89.6 },
    { day: "2026-11-20", trendKg: 88.9 },
  ];
  const g = { type: "weight_by_date" as const, target: 89, period: "stretch" as const, start: "2026-11-01", end: "2026-11-30" };

  it("the trend weight as of today, from the trend at the start; open until the end date", () => {
    const p = run(g, [], "2026-11-12", SUN, trend);
    expect(p.current).toEqual({ start: "2026-11-01", end: "2026-11-30", value: 89.6, target: 89, status: "open" });
    expect(p).toMatchObject({ state: "active", startKg: 92 });
    // Under the target before the end: still open (the trend can go back up)
    expect(run(g, [], "2026-11-25", SUN, trend).current).toMatchObject({ value: 88.9, status: "open" });
  });

  it("judged by the trend on the end date: at or under the target is completed", () => {
    expect(run(g, [], "2026-12-05", SUN, trend)).toMatchObject({ state: "completed", current: null, periods: [{ value: 88.9, status: "hit" }] });
    expect(run({ ...g, end: "2026-11-15" }, [], "2026-12-05", SUN, trend)).toMatchObject({ state: "missed", periods: [{ value: 89.6, status: "missed" }] });
    expect(run(g, [], "2026-12-05", SUN, [])).toMatchObject({ state: "missed", startKg: null, periods: [{ value: null, status: "missed" }] });
  });
});

describe("goal state", () => {
  it("a goal that hasn't started yet is upcoming, with no periods", () => {
    expect(run({ start: "2026-11-22", end: "2026-12-05" }, [], "2026-11-18")).toEqual({ state: "upcoming", periods: [], current: null, hit: 0, done: 0, of: 2, startKg: null, asOf: "2026-11-18" });
  });

  it("an ongoing goal stays active, counting the weeks so far", () => {
    const facts = days("2026-11-01", "2026-11-18", () => ({ logged: true }));
    const p = run({ end: null }, facts, "2026-11-18");
    expect(p).toMatchObject({ state: "active", hit: 2, done: 2, of: null });
    expect(p.periods.map((x) => x.status)).toEqual(["hit", "hit", "open"]);
  });

  it("asOf is the last day counted: today, or the end once it has passed", () => {
    expect(run({}, [], "2026-11-10").asOf).toBe("2026-11-10");
    expect(run({}, [], "2026-12-10").asOf).toBe("2026-11-14");
  });
});
