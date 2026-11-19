import { describe, expect, it } from "vitest";
import {
  INSIGHTS_SYSTEM,
  OFF_TOPIC,
  buildSummary,
  goalsForSummary,
  proteinFacts,
  questionRange,
  readAnswer,
  readProtein,
  readRecap,
  recapAsk,
  weekNumbers,
  type SummaryInput,
} from "../src/lib/insights.js";

// §43 Insights: the summary the AI sees (pure), the app's own numbers, the prompt, and reading the AI's answers.

const target = (over: Partial<SummaryInput["targets"][number]> = {}) => ({
  id: 1,
  effectiveFrom: "2026-11-01",
  plan: "steady",
  caloriesMin: 1600,
  caloriesMax: 1800,
  proteinMin: 120,
  proteinMax: 160,
  fiberMin: 25,
  fiberMax: 38,
  waterMin: 2000,
  waterMax: 3000,
  ...over,
});

const entry = (day: string, meal: string, name: string, nutrients: Record<string, number>, over: Record<string, unknown> = {}) => ({
  id: Math.floor(Math.random() * 1e6),
  userId: 7,
  day,
  meal,
  name,
  brand: null,
  icon: "🍽",
  source: "cache",
  unit: "serving",
  quantity: 1,
  fraction: 1,
  servingIndex: 0,
  servings: [{ label: "1 cup", grams: 245 }],
  nutrients,
  ...over,
});

// One week (Monday start) of data, with private things in every row that could hold them
function input(over: Partial<SummaryInput> = {}): SummaryInput {
  return {
    units: "imperial",
    weekStart: 1,
    from: "2026-11-09",
    to: "2026-11-15",
    entries: [
      entry("2026-11-09", "breakfast", "Greek yogurt", { calories: 150, protein_g: 20, carbs_g: 8, fat_g: 4, fiber_g: 0, sugar_g: 6, sodium_mg: 60 }, { notes: "PRIVATE ENTRY NOTE" }),
      entry("2026-11-09", "dinner", "Cheese pizza", { calories: 1500, protein_g: 50, carbs_g: 180, fat_g: 60 }, { quantity: 3, servings: [{ label: "1 slice" }] }),
      entry("2026-11-09", "supplements", "Water", { water_ml: 2100 }, { source: "water", unit: "ml", quantity: 2100, servings: [{ label: "1 ml", ml: 1 }] }),
      entry("2026-11-10", "lunch", "Chicken breast", { calories: 300, protein_g: 60 }, { unit: "g", quantity: 200 }),
      entry("2026-11-10", "snacks", "Greek yogurt", { calories: 150, protein_g: 20 }),
      entry("2026-11-11", "lunch", "Chicken breast", { calories: 1700, protein_g: 125 }),
      entry("2026-11-11", "snacks", "Water", { water_ml: 500 }, { source: "water" }),
    ],
    targets: [target({ notes: "PRIVATE TARGET" } as never)],
    calorieDays: [
      { day: "2026-11-09", status: "in", range: { min: 1600, max: 1800 } },
      { day: "2026-11-10", status: "below", range: { min: 1600, max: 1800 } },
      { day: "2026-11-11", status: "in", range: { min: 1600, max: 1800 } },
      { day: "2026-11-12", status: null, range: { min: 1600, max: 1800 } },
      { day: "2026-11-13", status: null, range: { min: 1600, max: 1800 } },
      { day: "2026-11-14", status: null, range: { min: 1600, max: 1800 } },
      { day: "2026-11-15", status: null, range: { min: 1600, max: 1800 } },
    ],
    weighIns: [
      { day: "2026-11-01", weightKg: 100, note: "PRIVATE WEIGH NOTE" },
      { day: "2026-11-10", weightKg: 99, note: "PRIVATE WEIGH NOTE" },
      { day: "2026-11-14", weightKg: 98.5, note: null },
    ] as unknown as SummaryInput["weighIns"],
    shots: [{ day: "2026-11-12", medication: "Mounjaro", doseMg: 5, site: "thigh_left", note: "PRIVATE SHOT NOTE" }] as unknown as SummaryInput["shots"],
    steps: [
      { day: "2026-11-09", source: "manual", steps: 4000 },
      { day: "2026-11-09", source: "health", steps: 6000 },
      { day: "2026-11-10", source: "health", steps: 8000 },
    ],
    workouts: [{ day: "2026-11-10", type: "walk", minutes: 30, calories: 150, note: "PRIVATE WORKOUT NOTE", externalId: "HK-SECRET" }] as unknown as SummaryInput["workouts"],
    goalWeightKg: 80,
    glp1: { medication: "Mounjaro", doseMg: 5 },
    goals: [],
    ...over,
  };
}

describe("the summary the AI sees", () => {
  it("has each day with its plan, totals, foods by meal, in range, weigh-in and trend, shot, steps and workouts", () => {
    const s = buildSummary(input());
    expect(s.period).toEqual({ from: "2026-11-09", to: "2026-11-15" });
    expect(s.weekStartsOn).toBe("Monday");
    expect(s.units).toEqual({ weight: "lb", water: "fl oz", energy: "calories", nutrients: "g (sodium mg)" });
    expect(s.plan).toEqual({ calories: { min: 1600, max: 1800 }, protein_g: { min: 120, max: 160 }, fiber_g: { min: 25, max: 38 }, water: { min: 67.6, max: 101.4 } });
    expect(s.goalWeight).toBe(176.4);
    expect(s.glp1).toEqual({ medication: "Mounjaro", dose: "5 mg" });
    expect(s.days).toHaveLength(7);
    const mon = s.days[0];
    expect(mon).toMatchObject({
      date: "2026-11-09",
      weekday: "Monday",
      logged: true,
      inRange: true,
      plan: { calories: { min: 1600, max: 1800 }, protein_g: { min: 120, max: 160 } },
      totals: { calories: 1650, protein_g: 70, carbs_g: 188, fat_g: 64, fiber_g: 0, sugar_g: 6, sodium_mg: 60, water: 71 },
      steps: 6000, // Health's number wins
      workouts: [],
    });
    expect(mon.meals.breakfast).toEqual([{ food: "Greek yogurt", amount: "1 × 1 cup", calories: 150, protein_g: 20 }]);
    expect(mon.meals.dinner).toEqual([{ food: "Cheese pizza", amount: "3 × 1 slice", calories: 1500, protein_g: 50 }]);
    expect(mon.meals.supplements).toBeUndefined(); // water is in the totals, not a food
    const tue = s.days[1];
    expect(tue).toMatchObject({ inRange: false, weighIn: 218.3, steps: 8000, workouts: [{ type: "walk", minutes: 30, calories: 150 }] });
    expect(tue.meals.lunch).toEqual([{ food: "Chicken breast", amount: "200 g", calories: 300, protein_g: 60 }]);
    expect(tue.trend).toBeCloseTo(219.1, 0);
    expect(mon.trend).toBe(220.5); // as of the day (the last weigh-in before it)
    expect(s.days[3]).toMatchObject({ date: "2026-11-12", logged: false, shot: { medication: "Mounjaro", dose: "5 mg" } });
    expect(s.days[3].meals).toEqual({});
    expect(s.days[3].inRange).toBeNull();
  });

  it("uses metric when the person does", () => {
    const s = buildSummary(input({ units: "metric" }));
    expect(s.units.weight).toBe("kg");
    expect(s.units.water).toBe("ml");
    expect(s.goalWeight).toBe(80);
    expect(s.days[1].weighIn).toBe(99);
    expect(s.days[0].totals.water).toBe(2100);
    expect(s.plan?.water).toEqual({ min: 2000, max: 3000 });
  });

  it("week start comes from the person's setting", () => {
    expect(buildSummary(input({ weekStart: 0 })).weekStartsOn).toBe("Sunday");
    expect(buildSummary(input({ weekStart: 6 })).weekStartsOn).toBe("Saturday");
  });

  it("holds nothing else: no names, emails, keys, notes or ids", () => {
    const extra = { username: "cory", displayName: "Cory Landers", email: "cory@example.com", apiKey: "bs_SECRETKEY", passwordHash: "$2b$hash" };
    const text = JSON.stringify(buildSummary({ ...input(), ...(extra as object) } as SummaryInput));
    for (const bad of ["PRIVATE", "cory", "Cory", "example.com", "bs_SECRET", "$2b$", "HK-SECRET", "thigh_left", "userId", "\"id\""]) expect(text).not.toContain(bad);
  });

  it("goals, when the app has them, are listed by name and target", () => {
    const s = buildSummary(input({ goals: [{ name: "Protein 5 days a week", target: "5 days", progress: "3 of 5" }] }));
    expect(s.goals).toEqual([{ name: "Protein 5 days a week", target: "5 days", progress: "3 of 5" }]);
  });

  it("no plan: days have no plan and aren't judged", () => {
    const s = buildSummary(input({ targets: [], calorieDays: [] }));
    expect(s.plan).toBeNull();
    expect(s.days[0].plan).toBeNull();
    expect(s.days[0].inRange).toBeNull();
  });
});

describe("active goals for the summary (§40c)", () => {
  const goal = (over: Record<string, unknown> = {}) => ({
    name: "Work out 3 times a week", type: "workouts", target: 3, period: "week", end: null,
    progress: { state: "active", current: { value: 2, target: 3 }, hit: 1, done: 2 }, ...over,
  });
  it("only active ones: name, target and progress, weights in the person's units", () => {
    expect(goalsForSummary([goal(), goal({ name: "Old", progress: { state: "completed", current: null, hit: 4, done: 4 } })], "imperial")).toEqual([
      { name: "Work out 3 times a week", target: "3 a week", progress: "2 of 3 this week; 1 of 2 weeks hit" },
    ]);
    expect(goalsForSummary([goal({ name: "Reach 90 kg", type: "weight_by_date", target: 90, period: "stretch", end: "2027-03-01", progress: { state: "active", current: { value: 95, target: 90 }, hit: 0, done: 0 } })], "imperial")).toEqual([
      { name: "Reach 90 kg", target: "198.4 lb by 2027-03-01" },
    ]);
  });
});

describe("the week's numbers (from the app, never the AI)", () => {
  it("days logged and in range, averages against the plan, water days, steps, workouts and the trend's change", () => {
    const n = weekNumbers(input());
    expect(n).toEqual({
      from: "2026-11-09",
      to: "2026-11-15",
      daysLogged: 3,
      daysInRange: 2,
      avgCalories: 1267, // (1650 + 450 + 1700) / 3
      avgProtein: 91.7, // (70 + 80 + 125) / 3
      plan: { calories: { min: 1600, max: 1800 }, proteinMin: 120 },
      waterDays: 1, // only Monday reached 2000 ml
      steps: { days: 2, average: 7000 },
      workouts: { count: 1, minutes: 30 },
      trendChange: expect.any(Number),
      weightUnit: "lb",
    });
    expect(n.trendChange!).toBeLessThan(0);
  });

  it("nothing logged: averages unknown, not 0", () => {
    const n = weekNumbers(input({ entries: [], calorieDays: [], steps: [], workouts: [], weighIns: [] }));
    expect(n).toMatchObject({ daysLogged: 0, daysInRange: 0, avgCalories: null, avgProtein: null, waterDays: 0, steps: { days: 0, average: null }, trendChange: null });
  });
});

describe("protein facts (from the app)", () => {
  it("top sources and the days protein fell short, by how much", () => {
    const f = proteinFacts(input());
    expect(f.topSources[0]).toEqual({ food: "Chicken breast", protein_g: 185, times: 2 });
    expect(f.topSources.map((x) => x.food)).toEqual(["Chicken breast", "Cheese pizza", "Greek yogurt"]);
    expect(f.shortDays).toEqual([
      { date: "2026-11-09", protein_g: 70, min: 120, shortBy: 50 },
      { date: "2026-11-10", protein_g: 80, min: 120, shortBy: 40 },
    ]);
    expect(f.daysLogged).toBe(3);
  });
});

describe("the range a question implies", () => {
  const today = "2026-11-18"; // a Wednesday
  it.each([
    ["How's my protein?", "2026-10-22", today],
    ["How did I do today?", today, today],
    ["What about yesterday?", "2026-11-17", "2026-11-17"],
    ["How was this week?", "2026-11-16", today],
    ["How was last week?", "2026-11-09", "2026-11-15"],
    ["Over the last 3 weeks?", "2026-10-29", today],
    ["In the past two weeks", "2026-11-05", today],
    ["last 10 days", "2026-11-09", today],
    ["over the last 2 months", "2026-09-19", today],
    ["this month so far", "2026-11-01", today],
    ["How was last month?", "2026-10-01", "2026-10-31"],
    ["since I started", "2026-05-21", today],
    ["over the last 52 weeks", "2026-05-21", today], // at most 26 weeks
    ["the last 0 days", today, today], // at least a day
  ])("%s", (q, from, to) => {
    expect(questionRange(q, today, 1)).toEqual({ from, to });
  });
});

describe("the prompt", () => {
  it("the system prompt holds the coach's rules (pinned)", () => {
    for (const rule of [/friendly coach/i, /short/i, /only (the )?numbers/i, /don't know/i, /medical/i, /dose/i, /care team/i, /below the plan's (calorie )?minimum/i, /protein first/i, /GLP-1/, /plain words/i, /units/i, /JSON/])
      expect(INSIGHTS_SYSTEM).toMatch(rule);
    expect(INSIGHTS_SYSTEM).toMatchInlineSnapshot(`
      "You are ByteSize's friendly coach. You look at one person's own food, weight and activity data and tell them what you notice, with practical tips.
      Be encouraging but honest. Keep it short and practical: plain words, short sentences, no jargon. Talk to the person as "you".
      Use only the numbers in the data summary you are given. If the summary doesn't show something, say you don't know. Never guess or invent numbers, foods or dates.
      Use the person's units exactly as the summary's "units" says (weight, water).
      No medical or dose advice: never suggest starting, stopping, changing, skipping or timing a medication or dose. For symptoms, side effects or doses, suggest talking to their care team.
      Never suggest eating below the plan's calorie minimum, skipping meals or fasting. On days below the minimum, encourage reaching it.
      The person may be on a GLP-1 medication: put protein first (protein at every meal, eaten first), with small, satisfying meals.
      Never mention AI, models or services.
      Answer with JSON only, in the shape asked for."
    `);
  });

  it("the recap ask carries the summary and the shape wanted", () => {
    const ask = recapAsk(buildSummary(input()), false);
    expect(ask).toContain('"date":"2026-11-09"');
    expect(ask).toMatch(/"wentWell"/);
    expect(ask).toMatch(/"tryNext"/);
    expect(recapAsk(buildSummary(input()), true)).toMatch(/so far/i);
  });
});

describe("reading the AI's answers", () => {
  it("a recap: kept as asked, bullets trimmed to 3 and 2, a lone string taken as one bullet", () => {
    expect(readRecap({ summary: "Good week.", wentWell: ["a", "b", "c", "d"], slipped: ["x", "y", "z"], tryNext: "Eat eggs." })).toEqual({ summary: "Good week.", wentWell: ["a", "b", "c"], slipped: ["x", "y"], tryNext: "Eat eggs." });
    expect(readRecap({ summary: "Ok.", wentWell: "Logged daily", slipped: [], tryNext: "Walk." })).toEqual({ summary: "Ok.", wentWell: ["Logged daily"], slipped: [], tryNext: "Walk." });
  });

  it("a recap that's too long is cut; one missing its summary or tip is refused", () => {
    const r = readRecap({ summary: "word ".repeat(400), wentWell: ["a"], slipped: [], tryNext: "t" });
    expect(r!.summary.length).toBeLessThanOrEqual(800);
    expect(r!.summary.endsWith("…")).toBe(true);
    expect(readRecap({ wentWell: ["a"], tryNext: "t" })).toBeNull();
    expect(readRecap({ summary: "s", wentWell: ["a"] })).toBeNull();
    expect(readRecap({ summary: 5, wentWell: ["a"], tryNext: "t" })).toBeNull();
    expect(readRecap(null)).toBeNull();
  });

  it("protein help: swaps of foods not in the data are dropped", () => {
    const summary = buildSummary(input());
    const p = readProtein(
      {
        additions: [{ suggestion: "Greek yogurt at breakfast", why: "closes the gap on 2 of 3 short days" }],
        swaps: [
          { food: "Cheese pizza", swap: "Thin-crust chicken pizza", saving: "about 300 calories" },
          { food: "Donuts", swap: "Protein bar", saving: "200 calories" },
        ],
      },
      summary,
    );
    expect(p).toEqual({ intro: null, additions: [{ suggestion: "Greek yogurt at breakfast", why: "closes the gap on 2 of 3 short days" }], swaps: [{ food: "Cheese pizza", swap: "Thin-crust chicken pizza", saving: "about 300 calories" }] });
    expect(readProtein({ swaps: [] }, summary)).toBeNull(); // no additions
  });

  it("an answer, or the polite off-topic reply", () => {
    expect(readAnswer({ answer: "You averaged 98 g." })).toEqual({ answer: "You averaged 98 g.", offTopic: false });
    expect(readAnswer({ offTopic: true })).toEqual({ answer: OFF_TOPIC, offTopic: true });
    expect(OFF_TOPIC).toMatch(/I can only help with your ByteSize data/);
    expect(readAnswer({ answer: "" })).toBeNull();
    expect(readAnswer({})).toBeNull();
  });
});
