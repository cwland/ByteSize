import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { setupTestApp, type TestApp } from "./helpers.js";
import { asUser } from "./isolation.js";
import { activitySteps, goals, insights, logCombines, glp1Shots, glp1Settings, logEntries, recipeItems, targets, usageCounts, userBody, userFoods, users, weighIns, workouts } from "../src/db/schema.js";
import {
  DEFAULT_DAYS, DEMO_FOODS, DEMO_NOTE, DEMO_QUICK_MEALS, HAS_DATA, INJECTION_WEEKDAY, START_LB, USAGE,
  describeSeed, instantAt, parseSeedArgs, planDemo, planDemoGoals, seedDemo, type PlannedDay,
} from "../src/lib/demoData.js";
import { addDays, weekdayOf } from "../src/lib/days.js";
import { KG_PER_LB } from "../src/lib/weight.js";
import { SITES } from "../src/lib/glp1.js";

// npm run seed-demo (spec §38): a few months of believable tracking for one non-admin account
let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
beforeEach(async () => {
  await t.reset();
  await t.login();
});
afterAll(async () => t.close());

const NOW = new Date("2026-11-18T18:00:00Z"); // Wednesday; 11:00 in Boise
const TODAY = "2026-11-18";
const TZ = "America/Boise";
const args = (o: Partial<Parameters<typeof seedDemo>[1]> = {}) => ({ username: "demo", days: 90, replace: false, now: NOW, ...o });
// The account being tested: a member who is in Boise (the seeder fills accounts, never makes them)
async function member(username = "demo", timezone = TZ) {
  const made = await t.createUser(username);
  await t.db.update(users).set({ timezone }).where(eq(users.id, made.id));
  return made;
}
const lb = (kg: number) => kg / KG_PER_LB;

async function signIn(username = "demo", password = "password123") {
  const res = await t.app.inject({ method: "POST", url: "/api/auth/login", payload: { username, password } });
  expect(res.statusCode).toBe(200);
  const token = JSON.parse(res.body).token as string;
  t.clock.date = NOW;
  return asUser(t, token);
}
const idOf = async (username: string) => (await t.db.select().from(users).where(eq(users.username, username)))[0].id;
const counts = async (userId: number) => ({
  entries: (await t.db.select().from(logEntries).where(eq(logEntries.userId, userId))).length,
  weighIns: (await t.db.select().from(weighIns).where(eq(weighIns.userId, userId))).length,
  shots: (await t.db.select().from(glp1Shots).where(eq(glp1Shots.userId, userId))).length,
  foods: (await t.db.select().from(userFoods).where(eq(userFoods.userId, userId))).length,
  steps: (await t.db.select().from(activitySteps).where(eq(activitySteps.userId, userId))).length,
  workouts: (await t.db.select().from(workouts).where(eq(workouts.userId, userId))).length,
  goals: (await t.db.select().from(goals).where(eq(goals.userId, userId))).length,
});

describe("the plan (pure)", () => {
  const plan = (o: Partial<Parameters<typeof planDemo>[0]> = {}) => planDemo({ today: TODAY, days: 90, ...o });

  it("is the same for the same seed and day, and changes with the seed", () => {
    expect(plan()).toEqual(plan());
    expect(plan({ seed: 7 })).not.toEqual(plan());
    expect(plan().days).toHaveLength(90);
    expect(plan().days[0].day).toBe("2026-08-21");
    expect(plan().days.at(-1)!.day).toBe(TODAY);
  });

  it("weight starts at 245 lb, trends down 1.5 to 2 lb a week with one plateau, and wobbles at most 1.5 lb", () => {
    for (const days of [90, 180]) {
      const p = plan({ days });
      const weighed = p.days.filter((d) => d.weightLb !== null);
      expect(weighed[0].weightLb).toBe(START_LB);
      expect(weighed.at(-1)!.day).toBe(TODAY);
      const lostPerWeek = (START_LB - p.days.at(-1)!.trendLb) / ((days - 1) / 7);
      expect(lostPerWeek).toBeGreaterThan(1.3);
      expect(lostPerWeek).toBeLessThan(2.0);
      for (const d of weighed.slice(1)) expect(Math.abs(d.weightLb! - d.trendLb)).toBeLessThanOrEqual(1.5 + 0.051);
      // the end is near the trend, so it ended lower than it started by roughly the trend's loss
      expect(START_LB - weighed.at(-1)!.weightLb!).toBeGreaterThan(lostPerWeek * ((days - 1) / 7) - 1.6);
      // a plateau: a stretch of a week or more where the trend doesn't move
      const flat = p.days.filter((d, i) => i > 0 && d.trendLb === p.days[i - 1].trendLb);
      expect(flat.length).toBeGreaterThanOrEqual(7);
      expect(flat.length).toBeLessThanOrEqual(14);
    }
  });

  it("skips about one weigh-in in five, and never the first day or today", () => {
    const p = plan({ days: 365 });
    const skipped = p.days.filter((d) => d.weightLb === null).length;
    expect(skipped).toBeGreaterThan(365 * 0.1);
    expect(skipped).toBeLessThan(365 * 0.3);
    expect(p.days[0].weightLb).not.toBeNull();
    expect(p.days.at(-1)!.weightLb).not.toBeNull();
  });

  it("weighs in whole tenths of a kilo for someone in metric", () => {
    const w = plan({ metric: true }).days.filter((d) => d.weightLb !== null).slice(1);
    for (const d of w) expect(Math.abs(Math.round(d.weightLb! * KG_PER_LB * 10) - d.weightLb! * KG_PER_LB * 10)).toBeLessThan(1e-6);
  });

  it("shots are weekly on the same weekday: 2.5 mg for four weeks, then 5 mg for four, then 7.5 mg, with rotating sites", () => {
    const shots = plan({ days: 120 }).days.filter((d) => d.shot);
    expect(shots.length).toBeGreaterThanOrEqual(17);
    for (const [i, d] of shots.entries()) {
      expect(weekdayOf(d.day)).toBe(INJECTION_WEEKDAY);
      if (i > 0) expect(addDays(shots[i - 1].day, 7)).toBe(d.day);
      expect(d.shot!.doseMg).toBe(i < 4 ? 2.5 : i < 8 ? 5 : 7.5);
      expect(d.shot!.site).toBe(SITES[i % SITES.length]);
    }
  });

  it("leaves about one day in twenty empty (never the first or today); today has breakfast only", () => {
    const p = plan({ days: 365 });
    const empty = p.days.filter((d) => d.empty);
    expect(empty.length).toBeGreaterThanOrEqual(8);
    expect(empty.length).toBeLessThanOrEqual(32);
    for (const d of empty) expect(d.meals).toEqual([]);
    expect(p.days[0].empty).toBe(false);
    const today = p.days.at(-1)!;
    expect(today.meals.map((m) => m.meal)).toEqual(["breakfast"]);
    expect(today.water).toEqual([]);
    // other days have breakfast, lunch and dinner
    for (const d of p.days.slice(0, -1).filter((d) => !d.empty)) expect(d.meals.map((m) => m.meal)).toEqual(expect.arrayContaining(["breakfast", "lunch", "dinner"]));
    // snacks on many
    const withSnacks = p.days.filter((d) => d.meals.some((m) => m.meal === "snacks")).length;
    expect(withSnacks).toBeGreaterThan(365 * 0.4);
  });

  it("activity (§40b): steps on each of the last four weeks' days, mostly from Health, and about three workouts a week (none today)", () => {
    const p = plan();
    const recent = p.days.slice(-28);
    expect(p.days.slice(0, -28).every((d) => d.steps === null && d.workouts.length === 0)).toBe(true);
    expect(recent.every((d) => d.steps !== null)).toBe(true);
    for (const d of recent.slice(0, -1)) expect(d.steps!.steps).toBeGreaterThanOrEqual(3500);
    expect(recent.filter((d) => d.steps!.source === "health").length).toBeGreaterThan(18);
    const sessions = recent.flatMap((d) => d.workouts);
    expect(sessions.length).toBeGreaterThanOrEqual(8);
    expect(sessions.length).toBeLessThanOrEqual(16);
    expect(new Set(sessions.map((w) => w.type)).size).toBeGreaterThanOrEqual(3);
    for (const w of sessions) {
      expect(w.minutes).toBeGreaterThanOrEqual(20);
      expect(w.calories).toBeGreaterThan(50);
    }
    expect(recent.at(-1)!.workouts).toEqual([]);
    // short runs get activity on every day
    expect(plan({ days: 7 }).days.every((d) => d.steps !== null)).toBe(true);
  });

  it("goals (§40c): a few active ones and a few that ended, all inside the seeded days", () => {
    const p = plan();
    const g = planDemoGoals(p, 0);
    const active = g.filter((x) => x.end === null || x.end >= TODAY);
    const past = g.filter((x) => x.end !== null && x.end < TODAY);
    expect(active.length).toBeGreaterThanOrEqual(2);
    expect(past.length).toBeGreaterThanOrEqual(3);
    expect(new Set(g.map((x) => x.type)).size).toBe(g.length); // one of each type, so none replaces another
    for (const x of g) expect(x.start >= p.from && x.start <= TODAY, x.name).toBe(true);
    const weight = g.find((x) => x.type === "weight_by_date")!;
    expect(weight.target).toBeCloseTo((p.days.at(-1)!.trendLb - 4) * KG_PER_LB, 6);
    // A week of history has room for none of the ended ones
    const short = planDemoGoals(plan({ days: 7 }), 0);
    expect(short.every((x) => x.end === null || x.end >= TODAY)).toBe(true);
  });

  it("water is 4 to 9 glasses on most days", () => {
    const p = plan({ days: 365 });
    const fed = p.days.slice(0, -1).filter((d) => !d.empty);
    const wet = fed.filter((d) => d.water.length > 0);
    expect(wet.length).toBeGreaterThan(fed.length * 0.8);
    for (const d of wet) {
      const glasses = d.water.reduce((s, w) => s + w.ml, 0) / 237;
      expect(glasses).toBeGreaterThanOrEqual(4);
      expect(glasses).toBeLessThanOrEqual(9);
    }
  });
});

describe("parseSeedArgs", () => {
  it("has the spec's defaults: the first admin, 90 days, no replace", () => {
    expect(parseSeedArgs([])).toEqual({ username: undefined, days: DEFAULT_DAYS, replace: false });
    expect(DEFAULT_DAYS).toBe(90);
  });
  it("takes --user, --days and --replace (spaced or with =)", () => {
    expect(parseSeedArgs(["--user", "sam", "--days", "30", "--replace"])).toEqual({ username: "sam", days: 30, replace: true });
    expect(parseSeedArgs(["--user=sam", "--days=365"])).toMatchObject({ username: "sam", days: 365 });
  });
  it("days are 7 to 365; there is no --password; anything else is refused without being echoed", () => {
    for (const bad of [["--days", "6"], ["--days", "366"], ["--days", "abc"], ["--days", "9.5"], ["--days"], ["--password", "x"]]) expect(() => parseSeedArgs(bad)).toThrow();
    expect(parseSeedArgs(["--days", "7"]).days).toBe(7);
    let message = "";
    try {
      parseSeedArgs(["--user", "sam", "--bogus", "secret-value-1"]);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toBe(USAGE);
    // It says what --replace deletes, the newer kinds (§40b, §40c) included
    expect(USAGE).toContain("steps, workouts, goals");
    expect(message).not.toContain("secret-value-1");
  });
});

describe("instantAt", () => {
  it("is the moment a local time happens in a zone (summer and winter)", () => {
    expect(instantAt("America/Boise", "2026-11-18", 8 * 60).toISOString()).toBe("2026-11-18T15:00:00.000Z"); // MST, UTC-7
    expect(instantAt("America/Boise", "2026-07-18", 8 * 60).toISOString()).toBe("2026-07-18T14:00:00.000Z"); // MDT, UTC-6
    expect(instantAt("UTC", "2026-11-18", 90).toISOString()).toBe("2026-11-18T01:30:00.000Z");
  });
});

describe("npm run seed-demo", () => {
  beforeEach(async () => {
    await member();
  });

  it("fills the account (GLP-1 on, goals set, setup untouched); the person's own sign-in is unchanged", async () => {
    const r = await seedDemo(t.db, args());
    expect(r).toMatchObject({ username: "demo", replaced: false, deleted: { entries: 0, weighIns: 0, shots: 0, foods: 0, combines: 0, steps: 0, workouts: 0, goals: 0 }, timezone: TZ, from: "2026-08-21", to: TODAY, foods: DEMO_FOODS.length, quickMeals: 2 });
    const [u] = await t.db.select().from(users).where(eq(users.username, "demo"));
    expect(u).toMatchObject({ isAdmin: false, timezone: TZ });
    expect((await t.db.select().from(users)).length).toBe(2); // no account was made
    const as = await signIn();
    expect((await as("GET", "/api/body")).body.body).toMatchObject({ glp1: true });
    const goals = (await as("GET", "/api/day/today")).body.targets;
    expect(goals).toMatchObject({ calories: { min: 1500, max: 2000 }, protein_g: { min: 110, max: 130 } });
    expect(goals.fiber_g.max).toBeGreaterThan(0);
    expect(goals.water_ml.max).toBeGreaterThan(0);
    expect(DEMO_FOODS.length).toBeGreaterThanOrEqual(25);
    expect(DEMO_FOODS.filter((f) => f.barcode).length).toBeGreaterThanOrEqual(3);
  });

  it("a plan that starts today (set up today) also covers the seeded days: copied back to the first day, same plan and numbers", async () => {
    const id = await idOf("demo");
    const plan = { plan: "steady", caloriesMin: 1700, caloriesMax: 2100, proteinMin: 120, proteinMax: 140, fiberMin: 28, fiberMax: 34, waterMin: 2200, waterMax: 3200 };
    await t.db.insert(targets).values({ userId: id, effectiveFrom: TODAY, ...plan });
    const r = await seedDemo(t.db, args());
    const as = await signIn();
    for (const day of [r.from, "2026-10-01", TODAY]) {
      const goals = (await as("GET", `/api/day/${day}`)).body.targets;
      expect(goals, day).toMatchObject({ calories: { min: 1700, max: 2100 }, protein_g: { min: 120, max: 140 } });
    }
    const rows = await t.db.select().from(targets).where(eq(targets.userId, id));
    expect(rows.map((x) => [x.effectiveFrom, x.plan]).sort()).toEqual([[r.from, "steady"], [TODAY, "steady"]]);
    // Run again (--replace): no second copy
    await seedDemo(t.db, args({ replace: true }));
    expect((await t.db.select().from(targets).where(eq(targets.userId, id))).length).toBe(2);
  });

  it("keeps goals and GLP-1 already set; sets them only where unset", async () => {
    const id = await idOf("demo");
    await t.db.insert(targets).values({ userId: id, effectiveFrom: "2026-01-01", plan: "steady", caloriesMin: 1800, caloriesMax: 2200, proteinMin: 90, proteinMax: 100, fiberMin: 25, fiberMax: 30, waterMin: 2000, waterMax: 3000 });
    await t.db.insert(userBody).values({ userId: id, sex: "male", birthDate: "1980-01-01", heightCm: 180, weightKg: 100, goalWeightKg: 85, activity: "some", glp1: false });
    await seedDemo(t.db, args());
    expect((await t.db.select().from(targets).where(eq(targets.userId, id))).map((x) => x.caloriesMin)).toEqual([1800]);
    const [b] = await t.db.select().from(userBody).where(eq(userBody.userId, id));
    expect(b).toMatchObject({ glp1: true, sex: "male", goalWeightKg: 85 });
  });

  it("makes about 25 My foods with full nutrition (a few with barcodes) and two quick meals, all marked as demo", async () => {
    await seedDemo(t.db, args());
    const id = await idOf("demo");
    const mine = await t.db.select().from(userFoods).where(eq(userFoods.userId, id));
    expect(mine.filter((f) => f.kind === "custom")).toHaveLength(DEMO_FOODS.length);
    expect(mine.filter((f) => f.kind === "quick_meal").map((f) => f.name).sort()).toEqual(DEMO_QUICK_MEALS.map((q) => q.name).sort());
    expect(mine.every((f) => f.notes === DEMO_NOTE)).toBe(true);
    expect(mine.filter((f) => f.barcode).length).toBeGreaterThanOrEqual(3);
    for (const f of mine.filter((f) => f.kind === "custom")) {
      const n = f.nutrients as Record<string, number>;
      for (const k of ["calories", "protein_g", "fiber_g", "carbs_g", "fat_g", "sodium_mg"]) expect(n[k], `${f.name} ${k}`).toBeTypeOf("number");
      expect(n.sugar_alcohol_g).toBeUndefined(); // unknown stays absent, never 0
    }
    const list = (await (await signIn())("GET", "/api/my-foods")).body;
    expect(JSON.stringify(list)).toContain("Oatmeal");
  });

  it("logs entries the way the app does: snapshot, amounts and nutrients agree; unknown nutrients are absent; quick meals as grouped items", async () => {
    await seedDemo(t.db, args());
    const id = await idOf("demo");
    const rows = await t.db.select().from(logEntries).where(eq(logEntries.userId, id));
    const foodRows = rows.filter((r) => r.source !== "water");
    expect(foodRows.length).toBeGreaterThan(90 * 3);
    const { amountFactor, scaleNutrients } = await import("../src/lib/nutrients.js");
    for (const r of foodRows.slice(0, 300)) {
      expect(r.source).toBe("user_food");
      expect(r.sourceRef).toMatch(/^user_food:\d+$/);
      expect(r.perServing).toBeTruthy();
      expect(scaleNutrients(r.perServing as any, amountFactor(r.servings as any, r.servingIndex, r.unit as any, r.quantity) * r.fraction)).toEqual(r.nutrients);
      expect((r.nutrients as any).water_ml).toBeUndefined();
      expect((r.nutrients as any).sugar_alcohol_g).toBeUndefined();
    }
    expect(foodRows.some((r) => r.groupRef?.startsWith("quick:"))).toBe(true);
    expect(foodRows.some((r) => r.name === "Eggs, large" && r.quantity >= 2)).toBe(true); // combined amounts
    const water = rows.filter((r) => r.source === "water");
    expect(water.length).toBeGreaterThan(60);
    expect(water.every((r) => r.meal === "supplements" && r.unit === "ml" && (r.nutrients as any).water_ml === r.quantity)).toBe(true);
    // the foods' use counts follow
    const eggs = (await t.db.select().from(userFoods).where(and(eq(userFoods.userId, id), eq(userFoods.name, "Eggs, large"))))[0];
    expect(eggs.useCount).toBeGreaterThan(5);
  });

  it("daily totals read normally: calories mostly 1500-2000, protein mostly 100-135 g, today breakfast only", async () => {
    await seedDemo(t.db, args({ days: 180 }));
    const as = await signIn();
    let full = 0, calOk = 0, calOver = 0, calUnder = 0, protOk = 0;
    for (let i = 1; i < 180; i++) {
      const day = addDays(TODAY, -i);
      const v = (await as("GET", `/api/day/${day}`)).body;
      if (v.entries.every((e: any) => e.source === "water")) continue;
      full++;
      const c = v.totals.calories, pr = v.totals.protein_g;
      if (c >= 1500 && c <= 2000) calOk++;
      else if (c > 2000) calOver++;
      else calUnder++;
      if (pr >= 100 && pr <= 135) protOk++;
    }
    expect(full).toBeGreaterThan(150);
    expect(calOk / full).toBeGreaterThan(0.6);
    expect(calOver).toBeGreaterThan(0); // some over days
    expect(calUnder).toBeGreaterThan(0); // and some under
    expect(protOk / full).toBeGreaterThan(0.6);
    const today = (await as("GET", "/api/day/today")).body;
    expect(today.entries.filter((e: any) => e.source !== "water").every((e: any) => e.meal === "breakfast")).toBe(true);
    expect(today.entries.length).toBeGreaterThan(0);
    expect(today.streak).toBeDefined();
  });

  it("appetite is a bit lower in the two days after a shot", async () => {
    await seedDemo(t.db, args({ days: 365 }));
    const id = await idOf("demo");
    const rows = await t.db.select().from(logEntries).where(and(eq(logEntries.userId, id), sql`${logEntries.source} <> 'water'`));
    const byDay = new Map<string, number>();
    for (const r of rows) byDay.set(r.day, (byDay.get(r.day) ?? 0) + ((r.nutrients as any).calories ?? 0));
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const after: number[] = [], other: number[] = [];
    for (const [day, cal] of byDay) {
      if (day === TODAY) continue;
      const dow = (weekdayOf(day) - INJECTION_WEEKDAY + 7) % 7; // days since the shot weekday
      (dow === 1 || dow === 2 ? after : other).push(cal);
    }
    expect(avg(after)).toBeLessThan(avg(other) - 60);
  });

  it("weigh-ins are stored in kg, start at 245 lb and end lower; the body weight follows the latest; Weight reads them", async () => {
    await seedDemo(t.db, args());
    const id = await idOf("demo");
    const ws = await t.db.select().from(weighIns).where(eq(weighIns.userId, id)).orderBy(weighIns.day);
    expect(ws.length).toBeGreaterThan(60);
    expect(ws.length).toBeLessThan(90);
    expect(ws[0].day).toBe("2026-08-21");
    expect(lb(ws[0].weightKg)).toBeCloseTo(245, 1);
    expect(ws.at(-1)!.day).toBe(TODAY);
    const lost = 245 - lb(ws.at(-1)!.weightKg);
    expect(lost).toBeGreaterThan(14);
    expect(lost).toBeLessThan(25);
    for (const w of ws) expect(Math.round(lb(w.weightKg) * 10) / 10).toBeCloseTo(lb(w.weightKg), 3); // whole tenths of a pound
    const [b] = await t.db.select().from(userBody).where(eq(userBody.userId, id));
    expect(b.weightKg).toBeCloseTo(ws.at(-1)!.weightKg, 5);
    const w = (await (await signIn())("GET", "/api/weight")).body;
    expect(w.weighIns.length).toBe(ws.length);
    expect(w.start.weightKg).toBeCloseTo(245 * KG_PER_LB, 5);
  });

  it("GLP-1: weekly shots with the dose schedule, settings follow the latest, the GLP-1 view reads them", async () => {
    await seedDemo(t.db, args());
    const id = await idOf("demo");
    const shots = await t.db.select().from(glp1Shots).where(eq(glp1Shots.userId, id)).orderBy(glp1Shots.day);
    expect(shots.map((s) => s.doseMg)).toEqual([2.5, 2.5, 2.5, 2.5, 5, 5, 5, 5, 7.5, 7.5, 7.5, 7.5, 7.5].slice(0, shots.length));
    expect(shots.length).toBeGreaterThanOrEqual(12);
    expect(shots.every((s) => weekdayOf(s.day) === INJECTION_WEEKDAY && s.medication === "Zepbound")).toBe(true);
    const [s] = await t.db.select().from(glp1Settings).where(eq(glp1Settings.userId, id));
    expect(s).toMatchObject({ doseMg: shots.at(-1)!.doseMg, injectionWeekday: INJECTION_WEEKDAY });
    const view = (await (await signIn())("GET", "/api/glp1")).body;
    expect(view.settings).toMatchObject({ medication: "Zepbound" });
    expect(view.recentShots?.length ?? view.shots?.length).toBeGreaterThan(0);
  });

  it("fills a few App info counts", async () => {
    await seedDemo(t.db, args());
    const id = await idOf("demo");
    const rows = await t.db.select().from(usageCounts).where(eq(usageCounts.userId, id));
    const by = Object.fromEntries(rows.map((r) => [r.key, r.count]));
    expect(by.barcodes_scanned).toBeGreaterThan(0);
    expect(by.lookups_saved).toBeGreaterThan(0);
    expect(by.ai_estimates).toBeGreaterThan(0);
    const info = (await (await signIn())("GET", "/api/app-info")).body;
    expect(JSON.stringify(info.you)).toContain(String(by.barcodes_scanned));
  });

  it("makes the same data every run for the same options and day", async () => {
    const snapshot = async () => {
      const id = await idOf("demo");
      const rows = await t.db.select().from(logEntries).where(eq(logEntries.userId, id)).orderBy(logEntries.day, logEntries.createdAt, logEntries.name);
      const ws = await t.db.select().from(weighIns).where(eq(weighIns.userId, id)).orderBy(weighIns.day);
      const ss = await t.db.select().from(glp1Shots).where(eq(glp1Shots.userId, id)).orderBy(glp1Shots.day);
      return JSON.stringify({ rows: rows.map(({ id: _i, userId: _u, sourceRef: _s, groupRef: _g, ...r }) => r), ws: ws.map((w) => [w.day, w.weightKg]), ss: ss.map((s) => [s.day, s.doseMg, s.site]) });
    };
    await seedDemo(t.db, args());
    const first = await snapshot();
    await seedDemo(t.db, args({ replace: true }));
    expect(await snapshot()).toBe(first);
  });

  it("a second run without --replace changes nothing and says so", async () => {
    await seedDemo(t.db, args());
    const id = await idOf("demo");
    const before = await counts(id);
    await expect(seedDemo(t.db, args())).rejects.toThrow(HAS_DATA);
    await expect(seedDemo(t.db, args())).rejects.toThrow(/--replace/);
    expect(await counts(id)).toEqual(before);
  });

  it("writes the steps and workouts the Activity widget reads, and counts them", async () => {
    const r = await seedDemo(t.db, args());
    const p = planDemo({ today: TODAY, days: 90 });
    expect(r.stepDays).toBe(28);
    expect(r.workouts).toBe(p.days.flatMap((d) => d.workouts).length);
    const as = await signIn();
    const yesterday = p.days.at(-2)!;
    const a = (await as("GET", `/api/activity/${yesterday.day}`)).body;
    expect(a.steps).toBe(yesterday.steps!.steps);
    expect(a.workouts.length).toBe(yesterday.workouts.length);
    const range = (await as("GET", `/api/activity?from=${addDays(TODAY, -27)}&to=${TODAY}`)).body;
    expect(range.workouts.length).toBe(r.workouts);
    expect(describeSeed(r, 90).join("\n")).toContain(`${r.stepDays} days of steps, ${r.workouts} workouts`);
  });

  it("adds one weekly recap and one protein help card (no AI call) so Insights isn't empty; --replace clears and refills them", async () => {
    const r = await seedDemo(t.db, args());
    expect(r.insights).toBe(2);
    expect(t.ai.calls).toHaveLength(0);
    const id = await idOf("demo");
    const rows = await t.db.select().from(insights).where(eq(insights.userId, id));
    // Last week: Sun 8 - Sat 14 Nov (Sunday start); protein help: the 4 weeks to its end
    expect(rows.map((x) => [x.kind, x.source, x.periodStart, x.periodEnd]).sort()).toEqual([
      ["protein", "demo", "2026-10-18", "2026-11-14"],
      ["recap", "demo", "2026-11-08", "2026-11-14"],
    ]);
    const as = await signIn();
    const page = (await as("GET", "/api/insights")).body;
    // The recap's numbers are the app's, the same as the page works out for that week
    expect(page.recaps[0]).toMatchObject({ soFar: false, content: { summary: expect.stringMatching(/You logged \d of 7 days/), wentWell: expect.any(Array), tryNext: expect.any(String) } });
    expect(page.recaps[0].content.numbers).toEqual(page.week.numbers);
    expect(page.protein.content.facts.topSources.length).toBeGreaterThan(0);
    expect(page.protein.content.additions.length).toBeGreaterThan(0);
    expect(describeSeed(r, 90).join("\n")).toContain("Insights: one weekly recap and one protein help card");
    // Refilled, not doubled; what the person's own AI wrote (a recap, an answer) is left alone
    await t.db.insert(insights).values([
      { userId: id, kind: "recap", source: "weekly", periodStart: "2026-11-01", periodEnd: "2026-11-07", content: { summary: "Mine" } },
      { userId: id, kind: "answer", source: "ask", periodStart: TODAY, periodEnd: TODAY, question: "Mine?", content: { answer: "Yes", offTopic: false } },
    ]);
    const again = await seedDemo(t.db, args({ replace: true }));
    expect(again.deleted.insights).toBe(2);
    expect((await t.db.select().from(insights).where(eq(insights.userId, id))).map((x) => x.source).sort()).toEqual(["ask", "demo", "demo", "weekly"]);
  });

  it("writes the goals: active ones on the Goals page, ended ones kept with a result, at least one met and one missed", async () => {
    const r = await seedDemo(t.db, args());
    const as = await signIn();
    const { active, past } = (await as("GET", "/api/goals")).body;
    expect(active.length).toBe(r.goals.active);
    expect(past.length).toBe(r.goals.past);
    expect(active.length).toBeGreaterThanOrEqual(2);
    expect(past.every((g: any) => g.frozen)).toBe(true);
    const states = past.map((g: any) => g.progress.state);
    expect(states).toContain("completed");
    expect(states).toContain("missed");
    expect(r.goals.met).toBe(states.filter((s: string) => s === "completed").length);
    expect((await as("GET", "/api/badges")).body.badges.find((b: any) => b.id === "goal_met").earnedOn).not.toBeNull();
    expect(describeSeed(r, 90).join("\n")).toContain(`${r.goals.active} active goals and ${r.goals.past} ended ones (${r.goals.met} met)`);
  });

  it("--replace deletes that account's tracking and earlier demo foods, refills it, and prints what it deleted; other My foods, settings and accounts are untouched", async () => {
    const { id: samId } = await member("sam");
    const sam = await signIn("sam");
    const food = (await sam("POST", "/api/my-foods", { name: "Sam's soup", servings: [{ label: "1 bowl", grams: 300 }], nutrients: { calories: 200 } })).body.food;
    await sam("POST", "/api/log", { day: TODAY, meal: "lunch", food: { kind: "user_food", id: food.id }, servingIndex: 0, unit: "serving", quantity: 1 });
    await sam("PUT", "/api/weigh-ins/2026-11-10", { weightKg: 80 });
    await sam("PUT", "/api/glp1/settings", { medication: "Ozempic", doseMg: 1, injectionWeekday: 2 });
    await sam("PUT", "/api/glp1/shots/2026-11-10", { site: "arm_left" });
    const samBefore = await counts(samId);

    const first = await seedDemo(t.db, args());
    const demoId = await idOf("demo");
    // the account also has a food of its own, and a setting
    await t.db.insert(userFoods).values({ userId: demoId, kind: "custom", name: "Mine, by hand", servings: [{ label: "1" }], nutrients: { calories: 50 } });
    await t.db.update(users).set({ displayName: "Keep me" }).where(eq(users.id, demoId));
    const demoBefore = await counts(demoId);
    expect(await counts(samId)).toEqual(samBefore);

    // over and over
    for (let i = 0; i < 2; i++) {
      const r = await seedDemo(t.db, args({ replace: true }));
      expect(r.replaced).toBe(true);
      expect(r.deleted).toEqual({ entries: first.entries + first.waterEntries, weighIns: first.weighIns, shots: first.shots, foods: DEMO_FOODS.length + DEMO_QUICK_MEALS.length, combines: 0, steps: first.stepDays, workouts: first.workouts, insights: 2, goals: first.goals.active + first.goals.past });
      expect(r).toMatchObject({ entries: first.entries, waterEntries: first.waterEntries, weighIns: first.weighIns, shots: first.shots });
      expect(await counts(demoId)).toEqual(demoBefore); // refilled, foods not doubled, the hand-made one stays
    }
    expect((await t.db.select().from(userFoods).where(and(eq(userFoods.userId, demoId), eq(userFoods.name, "Mine, by hand")))).length).toBe(1);
    expect((await t.db.select().from(users).where(eq(users.id, demoId)))[0].displayName).toBe("Keep me");
    expect(await counts(samId)).toEqual(samBefore);
    expect((await sam("GET", `/api/day/${TODAY}`)).body.entries.map((e: any) => e.name)).toEqual(["Sam's soup"]);
    expect((await sam("GET", "/api/glp1")).body.settings).toMatchObject({ medication: "Ozempic" });
    const orphan = await t.db.execute(sql`select count(*)::int as n from recipe_items r left join user_foods u on u.id = r.recipe_id where u.id is null`);
    expect((orphan.rows[0] as any).n).toBe(0);
    expect((await t.db.select().from(recipeItems)).length).toBe(DEMO_QUICK_MEALS.reduce((s, q) => s + q.parts.length, 0));
  });

  it("--replace deletes the account's Undo records for combined entries (log_combines), and no one else's", async () => {
    await seedDemo(t.db, args());
    const id = await idOf("demo");
    const [e] = await t.db.select().from(logEntries).where(eq(logEntries.userId, id)).limit(1);
    const p = { servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 };
    await t.db.insert(logCombines).values({ userId: id, entryId: e.id, before: p, after: { ...p, quantity: 2 }, added: p, addedServings: [{ label: "1" }], splitDay: e.day, splitMeal: e.meal } as any);
    await expect(seedDemo(t.db, args({ replace: true }))).resolves.toMatchObject({ replaced: true });
    expect((await t.db.select().from(logCombines)).length).toBe(0); // gone with the entries; the seeder makes none of its own
  });

  it("says what else it set (body weight, GLP-1, App info counts, a starter profile) and what --replace deleted, and --replace clears the account's undo records", async () => {
    const first = await seedDemo(t.db, args());
    const text = describeSeed(first, 90).join("\n");
    expect(text).toMatch(/Also set: body weight to \d+\.\d lb \(latest weigh-in\), GLP-1 settings \(Zepbound, Fridays\), App info counts \(3\)\./);
    expect(text).toContain("Made a starter profile");
    expect(text).not.toContain("Deleted from");
    const id = await idOf("demo");
    const [b] = await t.db.select().from(userBody).where(eq(userBody.userId, id));
    const [w] = await t.db.select().from(weighIns).where(eq(weighIns.userId, id)).orderBy(sql`day desc`).limit(1);
    expect(text).toContain(`body weight to ${(Math.round((b.weightKg / KG_PER_LB) * 10) / 10).toFixed(1)} lb`);
    expect(b.weightKg).toBeCloseTo(w.weightKg, 5);
    const [e] = await t.db.select().from(logEntries).where(eq(logEntries.userId, id)).limit(1);
    const p = { servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 };
    await t.db.insert(logCombines).values({ userId: id, entryId: e.id, before: p, after: p, added: p, addedServings: [{ label: "1" }], splitDay: e.day, splitMeal: e.meal } as any);
    const again = await seedDemo(t.db, args({ replace: true }));
    const text2 = describeSeed(again, 90).join("\n");
    expect(text2).not.toContain("Made a starter profile"); // the profile exists now
    expect(text2).toMatch(/Deleted from demo: \d+ log entries \(water included\), \d+ weigh-ins, 13 shots, 28 days of steps, \d+ workouts, \d+ goals, 28 demo foods and quick meals, 1 undo records, 2 demo insights\./);
    expect((await t.db.select().from(logCombines).where(eq(logCombines.userId, id))).length).toBe(0);
  });

  it("--replace on an account with no tracking still just fills it; earlier demo foods are not duplicated", async () => {
    await seedDemo(t.db, args());
    const id = await idOf("demo");
    await t.db.delete(logEntries).where(eq(logEntries.userId, id));
    await t.db.delete(weighIns).where(eq(weighIns.userId, id));
    await t.db.delete(glp1Shots).where(eq(glp1Shots.userId, id));
    const r = await seedDemo(t.db, args({ replace: true }));
    expect(r.deleted).toMatchObject({ entries: 0, foods: DEMO_FOODS.length + DEMO_QUICK_MEALS.length });
    expect((await counts(id)).foods).toBe(DEMO_FOODS.length + DEMO_QUICK_MEALS.length);
  });

  it("fills an admin account (the default is the first admin), and leaves other accounts alone", async () => {
    const sam = await member("sam");
    const samBefore = await counts(sam.id);
    const cory = await idOf("cory");
    const r = await seedDemo(t.db, { days: 90, replace: false, now: NOW, ...{ username: undefined } });
    expect(r.username).toBe("cory");
    expect((await counts(cory)).entries).toBeGreaterThan(200);
    expect(await counts(sam.id)).toEqual(samBefore);
    await expect(seedDemo(t.db, { days: 90, replace: false, now: NOW })).rejects.toThrow(/--replace/);
    await seedDemo(t.db, { days: 90, replace: true, now: NOW });
    expect((await t.db.select().from(userFoods).where(eq(userFoods.userId, cory))).length).toBe(DEMO_FOODS.length + 2);
  });

  it("never creates an account: an unknown username says which accounts exist", async () => {
    await expect(seedDemo(t.db, args({ username: "nobody" }))).rejects.toThrow("No account has that username (this command never creates one). Accounts: cory, demo");
    expect((await t.db.select().from(users)).length).toBe(2);
    expect((await t.db.select().from(logEntries)).length).toBe(0);
  });

  it("finds the user in any capitalization, and uses their time zone for 'today'", async () => {
    await t.db.update(users).set({ timezone: "Pacific/Auckland" }).where(eq(users.username, "demo"));
    const r = await seedDemo(t.db, args({ username: " DEMO " }));
    expect(r).toMatchObject({ username: "demo", timezone: "Pacific/Auckland", to: "2026-11-19" }); // already tomorrow there
  });

  it("--days sets how far back it goes (7 to 365) and a bad number writes nothing", async () => {
    const r = await seedDemo(t.db, args({ days: 7 }));
    expect(r.from).toBe("2026-11-12");
    const id = await idOf("demo");
    expect((await t.db.select().from(weighIns).where(eq(weighIns.userId, id))).length).toBeGreaterThanOrEqual(2);
    await expect(seedDemo(t.db, args({ days: 6, replace: true }))).rejects.toThrow(/7 to 365/);
    await expect(seedDemo(t.db, args({ days: 366, replace: true }))).rejects.toThrow(/7 to 365/);
    expect((await counts(id)).weighIns).toBeGreaterThanOrEqual(2);
  });
});

describe("lib/demoData.ts (§46)", () => {
  it("doesn't import from routes (the seeder uses lib code only)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../src/lib/demoData.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/from "\.\.\/routes\//);
  });
});
