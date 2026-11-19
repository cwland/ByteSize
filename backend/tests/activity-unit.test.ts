import { describe, expect, it } from "vitest";
import { MET, WORKOUT_TYPES, activityDays, daySteps, estimateCalories } from "../src/lib/activity.js";
import { addedRange, bankWeek, calorieStatus, counted, inForce, type BankDay, type WorkoutCalorieSettings } from "../src/lib/workoutCalories.js";

describe("MET estimate (§40b)", () => {
  it("every type has a standard MET value", () => {
    expect([...WORKOUT_TYPES].sort()).toEqual(["cycling", "hiit", "hike", "other", "run", "sport", "strength", "swim", "walk", "yoga"]);
    for (const t of WORKOUT_TYPES) expect(MET[t]).toBeGreaterThan(1);
    expect(MET.run).toBeGreaterThan(MET.walk);
    expect(MET.yoga).toBeLessThan(MET.walk);
  });

  it("calories ≈ MET × kg × hours, rounded", () => {
    expect(estimateCalories("walk", 60, 100)).toBe(Math.round(MET.walk * 100));
    expect(estimateCalories("run", 30, 80)).toBe(Math.round(MET.run * 80 * 0.5));
    expect(estimateCalories("strength", 45, 111.1)).toBe(Math.round(MET.strength * 111.1 * 0.75));
    expect(estimateCalories("yoga", 0, 90)).toBe(0);
  });
});

describe("a day's steps", () => {
  it("is the Health number when there is one, else the typed one; none: null", () => {
    expect(daySteps([])).toEqual({ steps: null, source: null });
    expect(daySteps([{ source: "manual", steps: 4000 }])).toEqual({ steps: 4000, source: "manual" });
    expect(daySteps([{ source: "manual", steps: 4000 }, { source: "health", steps: 6123 }])).toEqual({ steps: 6123, source: "health" });
    expect(daySteps([{ source: "health", steps: 0 }, { source: "manual", steps: 900 }])).toEqual({ steps: 0, source: "health" });
  });

  it("activityDays: one row per day with steps, workouts, active minutes and calories earned (unknown calories as 0)", () => {
    const days = activityDays(
      [
        { day: "2026-11-16", source: "manual", steps: 3000 },
        { day: "2026-11-16", source: "health", steps: 8000 },
        { day: "2026-11-18", source: "manual", steps: 500 },
      ],
      [
        { day: "2026-11-16", minutes: 30, calories: 250 },
        { day: "2026-11-16", minutes: 20, calories: null },
        { day: "2026-11-17", minutes: 45, calories: 300 },
      ],
      "2026-11-16",
      "2026-11-18"
    );
    expect(days).toEqual([
      { day: "2026-11-16", steps: 8000, stepsSource: "health", workouts: 2, activeMinutes: 50, earned: 250 },
      { day: "2026-11-17", steps: null, stepsSource: null, workouts: 1, activeMinutes: 45, earned: 300 },
      { day: "2026-11-18", steps: 500, stepsSource: "manual", workouts: 0, activeMinutes: 0, earned: 0 },
    ]);
  });
});

const show: WorkoutCalorieSettings = { mode: "show", countPct: 50, weeklyCap: 1000 };
const add = (countPct: 25 | 50 | 75 | 100 = 50): WorkoutCalorieSettings => ({ mode: "add", countPct, weeklyCap: 1000 });
const bank = (countPct: 25 | 50 | 75 | 100 = 50, weeklyCap = 1000): WorkoutCalorieSettings => ({ mode: "bank", countPct, weeklyCap });
const range = { min: 1500, max: 2000 };

describe("workout calories in the plan: one day", () => {
  it("counted = earned × the count, rounded", () => {
    expect(counted(320, 50)).toBe(160);
    expect(counted(333, 25)).toBe(83);
    expect(counted(0, 100)).toBe(0);
  });

  it("just show them: the range is unchanged; add to that day: min and max grow by earned × count", () => {
    expect(addedRange(range, 320, show)).toEqual(range);
    expect(addedRange(range, 320, bank())).toEqual(range);
    expect(addedRange(range, 320, add(50))).toEqual({ min: 1660, max: 2160 });
    expect(addedRange(range, 320, add(100))).toEqual({ min: 1820, max: 2320 });
    expect(addedRange(null, 320, add())).toBeNull();
  });

  it("the setting in force on a day is the latest from on or before it (ties: the newest row), like plans", () => {
    const rows = [
      { id: 1, effectiveFrom: "2026-11-01", mode: "add" as const, countPct: 50 as const, weeklyCap: 1000 },
      { id: 3, effectiveFrom: "2026-11-10", mode: "show" as const, countPct: 50 as const, weeklyCap: 1000 },
      { id: 2, effectiveFrom: "2026-11-10", mode: "bank" as const, countPct: 75 as const, weeklyCap: 800 },
    ];
    expect(inForce(rows, "2026-10-31")).toBeNull();
    expect(inForce(rows, "2026-11-09")?.mode).toBe("add");
    expect(inForce(rows, "2026-11-10")?.mode).toBe("show");
    expect(inForce(rows, "2026-12-25")?.mode).toBe("show");
  });

  it("calorieStatus: below / in / above the range; nothing logged or no range: null; covered counts as in", () => {
    expect(calorieStatus(1400, range, false, true)).toBe("below");
    expect(calorieStatus(1800, range, false, true)).toBe("in");
    expect(calorieStatus(2100, range, false, true)).toBe("above");
    expect(calorieStatus(2100, range, true, true)).toBe("in");
    expect(calorieStatus(0, range, false, false)).toBeNull();
    expect(calorieStatus(1800, null, false, true)).toBeNull();
  });
});

const day = (d: string, over: Partial<BankDay> = {}): BankDay => ({ day: d, settings: bank(), earned: 0, food: 1800, treat: 0, range, logged: true, ...over });

describe("the weekly bank (pure)", () => {
  it("earned × count goes in; the balance builds through the week", () => {
    const w = bankWeek([day("2026-11-15", { earned: 400 }), day("2026-11-16", { earned: 600 }), day("2026-11-17")]);
    expect(w.days.map((d) => [d.deposit, d.balance])).toEqual([
      [200, 200],
      [300, 500],
      [0, 500],
    ]);
    expect(w).toMatchObject({ balance: 500, deposited: 500, spent: 0 });
  });

  it("food calories left unused never go in", () => {
    const w = bankWeek([day("2026-11-15", { food: 900 }), day("2026-11-16", { food: 0, logged: false })]);
    expect(w.balance).toBe(0);
    expect(w.deposited).toBe(0);
  });

  it("the weekly cap stops deposits (default 1,000; 0 means nothing goes in)", () => {
    const w = bankWeek([day("a", { earned: 1600 }), day("b", { earned: 1000 })]);
    expect(w.days.map((d) => d.deposit)).toEqual([800, 200]);
    expect(w.balance).toBe(1000);
    expect(bankWeek([day("a", { earned: 1600, settings: bank(100, 0) })]).balance).toBe(0);
    expect(bankWeek([day("a", { earned: 9000, settings: bank(100, 5000) })]).balance).toBe(5000);
  });

  it("a day over its range takes the overage from the bank first and counts as in range when fully covered", () => {
    const w = bankWeek([day("a", { earned: 1000 }), day("b", { food: 2250 })]);
    expect(w.days[1]).toMatchObject({ overBy: 250, covered: 250, balance: 250, status: "in" });
    expect(w).toMatchObject({ balance: 250, spent: 250 });
  });

  it("an overage bigger than the bank is covered in part: the day is still above, the bank empties", () => {
    const w = bankWeek([day("a", { earned: 200 }), day("b", { food: 2500 })]);
    expect(w.days[1]).toMatchObject({ overBy: 500, covered: 100, balance: 0, status: "above" });
  });

  it("a workout earns before that day's overage is covered (the same day's walk covers that day's dessert)", () => {
    const w = bankWeek([day("a", { earned: 600, food: 2200 })]);
    expect(w.days[0]).toMatchObject({ deposit: 300, overBy: 200, covered: 200, balance: 100, status: "in" });
  });

  it("a treat spends from the bank on purpose: its calories are paid first, so they don't put the day over", () => {
    const w = bankWeek([day("a", { earned: 1000 }), day("b", { food: 2300, treat: 400 })]);
    // 500 in the bank; the 400-calorie treat is paid from it; the rest of the day (1,900) is in range
    expect(w.days[1]).toMatchObject({ treatSpent: 400, overBy: 0, covered: 0, balance: 100, status: "in" });
    // A treat bigger than the bank: the bank pays what it has; the rest counts as food
    const w2 = bankWeek([day("a", { earned: 200 }), day("b", { food: 2300, treat: 400 })]);
    expect(w2.days[1]).toMatchObject({ treatSpent: 100, overBy: 200, covered: 0, balance: 0, status: "above" });
  });

  it("a treat on a day that's otherwise in range keeps it in range (the minimum counts all the food)", () => {
    const w = bankWeek([day("a", { earned: 1000, food: 0, logged: false }), day("b", { food: 1600, treat: 400, range: { min: 1400, max: 2000 } })]);
    expect(w.days[1]).toMatchObject({ treatSpent: 400, status: "in" });
    // below the minimum even with the treat: still below
    expect(bankWeek([day("a", { earned: 1000, food: 1300, treat: 300 })]).days[0].status).toBe("below");
  });

  it("days not on the weekly bank neither fill nor spend it (a mode change mid-week)", () => {
    const w = bankWeek([day("a", { earned: 1000, settings: show }), day("b", { earned: 400 }), day("c", { food: 2100, settings: add() })]);
    expect(w.days.map((d) => d.deposit)).toEqual([0, 200, 0]);
    expect(w.days[2]).toMatchObject({ covered: 0, status: "above", balance: 200 });
  });

  it("add-to-that-day days are judged against the grown range", () => {
    const w = bankWeek([day("a", { settings: add(50), earned: 400, food: 2150 })]);
    expect(w.days[0]).toMatchObject({ range: { min: 1700, max: 2200 }, status: "in", deposit: 0 });
  });

  it("days with nothing logged are not judged", () => {
    expect(bankWeek([day("a", { food: 0, logged: false })]).days[0].status).toBeNull();
  });
});
