// Demo data (spec §38): a few months of believable tracking for one existing account, made by
// `npm run seed-demo`. Two halves:
//   planDemo()  pure: what happens on each day, from a seeded random number generator and "today"
//   seedDemo()  writes it, through the same lib functions and tables the app uses
// Everything the seeder makes is either dated rows of the one account (cleared by --replace) or foods
// carrying DEMO_NOTE (found and removed by --replace), so nothing else is ever touched.
import { and, asc, count, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { Db } from "../db/index.js";
import { glp1Settings, glp1Shots, logEntries, targets, usageCounts, userBody, userFoods, users, weighIns } from "../db/schema.js";
import { addDays, localDay, weekdayOf, type Meal } from "./days.js";
import { createMyFood, type FoodResult } from "./foods.js";
import { nextSite, type Site } from "./glp1.js";
import { amountFactor, scaleNutrients, type Nutrients, type Serving, type Unit } from "./nutrients.js";
import { createMeal, quickMealParts } from "./recipes.js";
import { normalizeUsername } from "./users.js";
import { KG_PER_LB } from "./weight.js";
import { saveWeighIn } from "../routes/weight.js";

/** Put on every food and quick meal the seeder makes: how --replace finds them again. */
export const DEMO_NOTE = "Demo data (npm run seed-demo)";
export const DEFAULT_DAYS = 90;
export const MIN_DAYS = 7;
export const MAX_DAYS = 365;
export const DEFAULT_SEED = 20261118;
/** Shots are on Fridays. */
export const INJECTION_WEEKDAY = 5;
export const MEDICATION = "Zepbound";
export const START_LB = 245;
export const GOAL_LB = 185;
const DEMO_TARGETS = { caloriesMin: 1500, caloriesMax: 2000, proteinMin: 110, proteinMax: 130, fiberMin: 30, fiberMax: 35, waterMin: 1893, waterMax: 3785 };
const GLASS_ML = 237;

// ---------- seeded randomness ----------

export type Rng = () => number;
/** mulberry32: a small seeded generator, 0 <= n < 1 */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const between = (r: Rng, lo: number, hi: number) => lo + r() * (hi - lo);
const intBetween = (r: Rng, lo: number, hi: number) => Math.floor(between(r, lo, hi + 1));
const pick = <T>(r: Rng, list: readonly T[]): T => list[Math.floor(r() * list.length)];
const gauss = (r: Rng) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// ---------- the foods ----------

type N = [calories: number, protein: number, fiber: number, carbs: number, fat: number, satFat: number, sugar: number, addedSugar: number, sodium: number, potassium: number, magnesium: number];
type DemoFood = {
  key: string;
  name: string;
  brand?: string;
  category: string;
  servings: Serving[];
  n: N;
  barcode?: string;
  /** the smallest sensible change in how much of it is eaten, in servings (whole things: 1) */
  step: number;
};
const food = (key: string, name: string, category: string, servings: Serving[], n: N, more: Partial<DemoFood> = {}): DemoFood => ({ key, name, category, servings, n, step: 0.5, ...more });

export const DEMO_FOODS: DemoFood[] = [
  food("oatmeal", "Oatmeal, cooked", "Cereals", [{ label: "1 cup", grams: 234 }], [166, 6, 4, 28, 3.6, 0.6, 0.6, 0, 9, 164, 63]),
  food("eggs", "Eggs, large", "Eggs", [{ label: "1 egg", grams: 50 }], [72, 6.3, 0, 0.4, 4.8, 1.6, 0.2, 0, 71, 69, 6], { step: 1 }),
  food("yogurt", "Greek yogurt, plain nonfat", "Dairy", [{ label: "1 container", grams: 170 }], [100, 17, 0, 6, 0.7, 0.1, 6, 0, 65, 240, 18], { step: 1 }),
  food("berries", "Mixed berries", "Fruits", [{ label: "1 cup", grams: 140 }], [70, 1, 4, 17, 0.5, 0, 10, 0, 1, 150, 15]),
  food("banana", "Banana", "Fruits", [{ label: "1 medium", grams: 118 }], [105, 1.3, 3.1, 27, 0.4, 0.1, 14, 0, 1, 422, 32], { step: 1 }),
  food("apple", "Apple", "Fruits", [{ label: "1 medium", grams: 182 }], [95, 0.5, 4.4, 25, 0.3, 0, 19, 0, 2, 195, 9], { step: 1 }),
  food("almonds", "Almonds", "Nuts", [{ label: "1 oz", grams: 28 }], [164, 6, 3.5, 6, 14, 1.1, 1.2, 0, 0, 208, 76]),
  food("shake", "Protein shake", "Beverages", [{ label: "1 bottle", grams: 330, ml: 330 }], [160, 30, 1, 5, 3, 1, 2, 0, 230, 390, 60], { brand: "Demo Nutrition", barcode: "0850000000011", step: 1 }),
  food("chicken", "Chicken breast, grilled", "Poultry", [{ label: "4 oz", grams: 113 }], [187, 35, 0, 0, 4, 1.1, 0, 0, 84, 370, 33]),
  food("salmon", "Salmon fillet, baked", "Fish", [{ label: "4 oz", grams: 113 }], [233, 25, 0, 0, 14, 3, 0, 0, 70, 430, 32]),
  food("sandwich", "Turkey sandwich", "Sandwiches", [{ label: "1 sandwich", grams: 230 }], [380, 28, 4, 42, 10, 2.5, 6, 2, 1050, 380, 45], { step: 1 }),
  food("salad", "Garden salad with dressing", "Salads", [{ label: "1 bowl", grams: 250 }], [180, 4, 4, 12, 13, 2, 5, 2, 380, 520, 40], { step: 1 }),
  food("rice", "Brown rice, cooked", "Grains", [{ label: "1 cup", grams: 195 }], [216, 5, 3.5, 45, 1.8, 0.4, 0.7, 0, 10, 84, 84]),
  food("sweetpotato", "Sweet potato, baked", "Vegetables", [{ label: "1 medium", grams: 130 }], [112, 2, 3.9, 26, 0.1, 0, 5.4, 0, 72, 438, 31], { step: 1 }),
  food("broccoli", "Broccoli, steamed", "Vegetables", [{ label: "1 cup", grams: 156 }], [55, 3.7, 5.1, 11, 0.6, 0.1, 2.2, 0, 64, 457, 33]),
  food("cottage", "Cottage cheese, low-fat", "Dairy", [{ label: "1/2 cup", grams: 113 }], [90, 12, 0, 5, 2.5, 1.5, 4, 0, 350, 110, 8]),
  food("stringcheese", "String cheese", "Dairy", [{ label: "1 stick", grams: 28 }], [80, 7, 0, 1, 6, 3.5, 0, 0, 190, 30, 7], { brand: "Demo Dairy", barcode: "0850000000028", step: 1 }),
  food("granolabar", "Granola bar", "Snacks", [{ label: "1 bar", grams: 40 }], [150, 3, 2, 25, 5, 1, 8, 6, 95, 90, 25], { brand: "Demo Snacks", barcode: "0850000000035", step: 1 }),
  food("coffee", "Coffee with milk", "Beverages", [{ label: "1 mug", grams: 240, ml: 240 }], [30, 1.5, 0, 2.5, 1.5, 1, 2.5, 0, 25, 150, 10], { step: 1 }),
  food("burritobowl", "Burrito bowl", "Mexican", [{ label: "1 bowl", grams: 450 }], [640, 38, 12, 70, 22, 6, 5, 0, 1250, 900, 110], { step: 1 }),
  food("pizza", "Pizza slice", "Pizza", [{ label: "1 slice", grams: 107 }], [285, 12, 2.5, 36, 10, 4.5, 3.8, 0, 640, 184, 24], { step: 1 }),
  food("peanutbutter", "Peanut butter", "Spreads", [{ label: "1 tbsp", grams: 16 }], [94, 3.6, 1, 3.2, 8, 1.6, 1.2, 0.4, 60, 100, 27], { brand: "Demo Pantry", barcode: "0850000000042" }),
  food("toast", "Whole wheat toast", "Bread", [{ label: "1 slice", grams: 32 }], [80, 4, 2, 14, 1, 0.2, 1.5, 1, 130, 70, 23], { step: 1 }),
  food("avocado", "Avocado", "Fruits", [{ label: "1/2 avocado", grams: 100 }], [160, 2, 6.7, 8.5, 14.7, 2.1, 0.7, 0, 7, 485, 29]),
  food("stirfry", "Chicken stir-fry with vegetables", "Mixed dishes", [{ label: "1 plate", grams: 350 }], [420, 36, 5, 38, 14, 3, 7, 3, 720, 640, 70]),
  food("chili", "Turkey chili", "Soups", [{ label: "1 bowl", grams: 300 }], [310, 28, 9, 28, 9, 2.5, 8, 1, 780, 820, 70]),
];
const BY_KEY = new Map(DEMO_FOODS.map((f) => [f.key, f] as const));

const per = (f: DemoFood): Nutrients => {
  const [calories, protein_g, fiber_g, carbs_g, fat_g, saturated_fat_g, sugar_g, added_sugar_g, sodium_mg, potassium_mg, magnesium_mg] = f.n;
  return { calories, protein_g, fiber_g, carbs_g, fat_g, saturated_fat_g, sugar_g, added_sugar_g, sodium_mg, potassium_mg, magnesium_mg };
};

type Part = { food: string; quantity: number; unit?: Unit };
export const DEMO_QUICK_MEALS: { key: string; name: string; parts: Part[] }[] = [
  { key: "eggsToast", name: "Eggs and toast", parts: [{ food: "eggs", quantity: 2 }, { food: "toast", quantity: 2 }, { food: "coffee", quantity: 1 }] },
  { key: "yogurtBowl", name: "Yogurt bowl", parts: [{ food: "yogurt", quantity: 1 }, { food: "berries", quantity: 1 }, { food: "almonds", quantity: 1 }] },
];
const QUICK_BY_KEY = new Map(DEMO_QUICK_MEALS.map((q) => [q.key, q] as const));

/** Calories and protein of a portion of a demo food, worked out the way the app does for an entry. */
function portion(key: string, quantity: number, unit: Unit = "serving"): { calories: number; protein: number } {
  const f = BY_KEY.get(key)!;
  const n = scaleNutrients(per(f), amountFactor(f.servings, 0, unit, quantity));
  return { calories: n.calories ?? 0, protein: n.protein_g ?? 0 };
}

// ---------- meal ideas ----------

const ozOf = (food: string, oz: number): Part => ({ food, quantity: oz, unit: "oz" });
const p = (food: string, quantity: number): Part => ({ food, quantity });
type Idea = { parts: Part[] } | { quick: string };
const BREAKFASTS: Idea[] = [
  { parts: [p("oatmeal", 1), p("berries", 0.5), p("almonds", 0.5), p("yogurt", 1)] },
  { parts: [p("eggs", 3), p("toast", 1), p("avocado", 0.5)] },
  { parts: [p("shake", 1), p("banana", 1), p("peanutbutter", 1)] },
  { parts: [p("cottage", 2), p("banana", 1), p("coffee", 1)] },
  { quick: "eggsToast" },
  { quick: "yogurtBowl" },
];
const LUNCHES: Idea[] = [
  { parts: [p("sandwich", 1), p("apple", 1), p("stringcheese", 1)] },
  { parts: [p("salad", 1), ozOf("chicken", 5), p("apple", 1)] },
  { parts: [p("burritobowl", 1)] },
  { parts: [p("chili", 1), p("stringcheese", 1), p("toast", 1)] },
  { parts: [ozOf("chicken", 4), p("rice", 1), p("broccoli", 1)] },
];
const DINNERS: Idea[] = [
  { parts: [ozOf("salmon", 6), p("sweetpotato", 1), p("broccoli", 1)] },
  { parts: [p("stirfry", 1), p("rice", 1)] },
  { parts: [ozOf("chicken", 4), p("rice", 1), p("broccoli", 1.5)] },
  { parts: [p("pizza", 2), p("salad", 1)] },
  { parts: [p("burritobowl", 1)] },
  { parts: [ozOf("salmon", 6), p("rice", 1), p("salad", 1)] },
];
const SNACKS: Idea[] = [
  { parts: [p("apple", 1), p("almonds", 1)] },
  { parts: [p("stringcheese", 1), p("banana", 1)] },
  { parts: [p("shake", 1)] },
  { parts: [p("yogurt", 1), p("berries", 1)] },
  { parts: [p("granolabar", 1)] },
  { parts: [p("cottage", 1), p("berries", 1)] },
];

const ideaCalories = (i: Idea) => ("quick" in i ? QUICK_BY_KEY.get(i.quick)!.parts : i.parts).reduce((s, x) => s + portion(x.food, x.quantity, x.unit).calories, 0);

/** A meal idea scaled toward `target` calories (0.65x to 1.4x), each amount rounded to what the food comes in. Quick meals are logged as they are. */
function scaled(i: Idea, target: number): PlannedItem[] {
  if ("quick" in i) return [{ quick: i.quick }];
  const s = clamp(target / ideaCalories(i), 0.65, 1.4);
  return i.parts.map((x) => {
    const f = BY_KEY.get(x.food)!;
    const step = x.unit === "oz" ? 1 : f.step;
    const quantity = Math.max(step, Math.round((x.quantity * s) / step) * step);
    return { food: x.food, quantity, unit: x.unit ?? "serving" };
  });
}

// ---------- the plan ----------

export type PlannedItem = { food: string; quantity: number; unit: Unit } | { quick: string };
export type PlannedMeal = { meal: Meal; minutes: number; items: PlannedItem[] };
export type PlannedDay = {
  day: string;
  meals: PlannedMeal[];
  /** water drunk in one go, in ml, with the time of day (minutes after midnight) */
  water: { ml: number; minutes: number }[];
  weightLb: number | null;
  /** the smooth weight line the day's weigh-in wobbles around */
  trendLb: number;
  shot: { doseMg: number; site: Site } | null;
  /** nothing logged on purpose, so streaks have breaks */
  empty: boolean;
};
export type DemoPlan = { today: string; from: string; days: PlannedDay[]; usage: Record<string, number> };

export function doseForShot(index: number): number {
  return index < 4 ? 2.5 : index < 8 ? 5 : 7.5;
}

/** Day by day, what the demo account did. Same `today`, `days` and `seed`: same plan. */
export function planDemo(o: { today: string; days: number; seed?: number; metric?: boolean }): DemoPlan {
  const rng = seededRng(o.seed ?? DEFAULT_SEED);
  const from = addDays(o.today, -(o.days - 1));
  // A flat spell of ten days (in a run long enough to have one) about 60% of the way through
  const plateauAt = o.days >= 28 ? Math.round(o.days * 0.6) : Infinity;
  const PLATEAU_DAYS = 10;
  const LB_PER_WEEK = 1.75;
  const round1 = (x: number) => Math.round(x * 10) / 10;

  let shots = 0;
  let lastSite: Site | null = null;
  let lastShotDay: string | null = null;
  const days: PlannedDay[] = [];
  for (let i = 0; i < o.days; i++) {
    const day = addDays(from, i);
    const isToday = i === o.days - 1;
    const sinceShot = lastShotDay ? Math.round((Date.parse(day) - Date.parse(lastShotDay)) / 86_400_000) : 99;
    let shot: PlannedDay["shot"] = null;
    if (weekdayOf(day) === INJECTION_WEEKDAY) {
      lastSite = nextSite(lastSite);
      shot = { doseMg: doseForShot(shots++), site: lastSite };
      lastShotDay = day;
    }

    // weight: a trend of about 1.75 lb a week, flat through the plateau, plus day-to-day noise of at most 1.5 lb
    const flat = clamp(i - plateauAt, 0, PLATEAU_DAYS);
    const trendLb = START_LB - (LB_PER_WEEK / 7) * (i - flat);
    const weighed = i === 0 || isToday || rng() >= 0.2;
    const noise = clamp(gauss(rng) * 0.8, -1.5, 1.5);
    const weightLb = weighed ? (i === 0 ? START_LB : o.metric ? Math.round((trendLb + noise) * KG_PER_LB * 10) / 10 / KG_PER_LB : round1(trendLb + noise)) : null;

    // food: about 1 day in 20 is left empty (never the first, or today)
    const empty = !isToday && i > 0 && rng() < 0.05;
    const meals: PlannedMeal[] = [];
    const water: PlannedDay["water"] = [];
    if (!empty) {
      const roll = rng();
      let target = roll < 0.1 ? between(rng, 2050, 2400) : roll > 0.92 ? between(rng, 1250, 1450) : clamp(1750 + gauss(rng) * 110, 1550, 1950);
      if (sinceShot === 1) target *= 0.88; // appetite is a bit lower in the two days after a shot
      if (sinceShot === 2) target *= 0.94;
      const snack = !isToday && rng() < 0.65;
      const share = snack ? { breakfast: 0.2, lunch: 0.3, dinner: 0.33, snacks: 0.17 } : { breakfast: 0.23, lunch: 0.34, dinner: 0.43, snacks: 0 };
      meals.push({ meal: "breakfast", minutes: intBetween(rng, 7 * 60 + 15, 9 * 60), items: scaled(pick(rng, BREAKFASTS), target * share.breakfast) });
      if (!isToday) {
        meals.push({ meal: "lunch", minutes: intBetween(rng, 12 * 60, 13 * 60 + 30), items: scaled(pick(rng, LUNCHES), target * share.lunch) });
        if (snack) meals.push({ meal: "snacks", minutes: intBetween(rng, 15 * 60, 16 * 60 + 30), items: scaled(pick(rng, SNACKS), target * share.snacks) });
        meals.push({ meal: "dinner", minutes: intBetween(rng, 18 * 60, 19 * 60 + 30), items: scaled(pick(rng, DINNERS), target * share.dinner) });
      }
      // water: 4 to 9 glasses most days, in one to three goes (none today: only breakfast so far)
      if (!isToday && rng() < 0.9) {
        let glasses = intBetween(rng, 4, 9);
        const goes = Math.min(glasses, intBetween(rng, 1, 3));
        for (let g = 0; g < goes; g++) {
          const n = g === goes - 1 ? glasses : Math.max(1, Math.round(glasses / (goes - g)));
          glasses -= n;
          water.push({ ml: n * GLASS_ML, minutes: 10 * 60 + g * 4 * 60 + intBetween(rng, 0, 90) });
        }
      }
    }
    days.push({ day, meals, water, weightLb, trendLb, shot, empty });
  }
  // A few App info counts so that tab isn't empty
  const barcodeFoods = DEMO_FOODS.filter((f) => f.barcode).length;
  const usage = { barcodes_scanned: barcodeFoods + intBetween(rng, 3, 8), lookups_saved: intBetween(rng, 8, 20), ai_estimates: intBetween(rng, 2, 6) };
  return { today: o.today, from, days, usage };
}

// ---------- command-line arguments ----------

export const USAGE =
  "Usage: npm run seed-demo -- [--user <username>] [--days <7-365>] [--replace]\n" +
  "Fills an existing account (default: the first admin) with a few months of food, weight, water and GLP-1 tracking. It never creates accounts.\n" +
  `Default --days ${DEFAULT_DAYS}. An account that already has tracking is left alone unless you add --replace, which deletes\n` +
  "that account's entries, weigh-ins, water, shots and the foods this command made earlier, then fills it again.";

export type SeedArgs = { username?: string; days: number; replace: boolean };

/** Arguments are never printed back (a --password may be one). */
export function parseSeedArgs(args: string[]): SeedArgs {
  const out: SeedArgs = { username: undefined, days: DEFAULT_DAYS, replace: false };
  for (let i = 0; i < args.length; i++) {
    const [flag, inline] = args[i].startsWith("--") && args[i].includes("=") ? [args[i].slice(0, args[i].indexOf("=")), args[i].slice(args[i].indexOf("=") + 1)] : [args[i], undefined];
    const value = () => {
      const v = inline ?? args[++i];
      if (v === undefined || v === "") throw new Error(USAGE);
      return v;
    };
    if (flag === "--replace" && inline === undefined) out.replace = true;
    else if (flag === "--user") out.username = value();
    else if (flag === "--days") {
      const v = value();
      if (!/^\d+$/.test(v) || Number(v) < MIN_DAYS || Number(v) > MAX_DAYS) throw new Error(`--days must be a whole number from ${MIN_DAYS} to ${MAX_DAYS}`);
      out.days = Number(v);
    } else throw new Error(USAGE);
  }
  return out;
}

// ---------- writing it ----------

export type SeedOptions = SeedArgs & {
  /** the clock (default: now) */
  now?: Date;
  seed?: number;
};
export type SeedResult = {
  username: string;
  replaced: boolean;
  /** what --replace removed */
  deleted: { entries: number; weighIns: number; shots: number; foods: number };
  timezone: string;
  from: string;
  to: string;
  foods: number;
  quickMeals: number;
  entries: number;
  waterEntries: number;
  weighIns: number;
  shots: number;
  emptyDays: number;
};

export const HAS_DATA = "That account already has tracking (entries, weigh-ins, water or shots). Add --replace to delete those, and the demo foods made earlier, and fill it again.";

/** The instant a local time on a local day happens in `timeZone`. */
export function instantAt(timeZone: string, day: string, minutes: number): Date {
  const guess = Date.parse(`${day}T00:00:00Z`) + minutes * 60_000;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(guess));
  const g = (t: string) => Number(parts.find((x) => x.type === t)!.value);
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"));
  return new Date(guess - (asUtc - Math.floor(guess / 1000) * 1000));
}

type FoodRow = typeof userFoods.$inferSelect;

/** Fills one existing account (never creates one). Everything happens in one transaction. */
export async function seedDemo(db: Db, opts: SeedOptions): Promise<SeedResult> {
  if (!Number.isInteger(opts.days) || opts.days < MIN_DAYS || opts.days > MAX_DAYS) throw new Error(`--days must be a whole number from ${MIN_DAYS} to ${MAX_DAYS}`);
  const now = opts.now ?? new Date();

  return db.transaction(async (tx) => {
    const dbx = tx as unknown as Db;
    const app = { db: dbx } as unknown as FastifyInstance; // the lib functions only read app.db
    const all = await dbx.select().from(users).orderBy(asc(users.id));
    const wanted = opts.username === undefined ? "" : normalizeUsername(opts.username);
    if (opts.username !== undefined && !wanted) throw new Error(USAGE);
    const user = wanted ? all.find((u) => u.username === wanted) : all.find((u) => u.isAdmin);
    if (!user) {
      if (!wanted) throw new Error("No admin account yet. Open ByteSize to set one up.");
      throw new Error(`No account has that username (this command never creates one). Accounts: ${all.map((u) => u.username).join(", ") || "none yet"}`);
    }
    const username = user.username;
    const deleted = { entries: 0, weighIns: 0, shots: 0, foods: 0 };
    const has = async (table: typeof logEntries | typeof weighIns | typeof glp1Shots) => (await dbx.select({ n: count() }).from(table).where(eq(table.userId, user.id)))[0].n > 0;
    let replaced = false;
    if ((await has(logEntries)) || (await has(weighIns)) || (await has(glp1Shots))) {
      if (!opts.replace) throw new Error(HAS_DATA);
      // Only this account's tracking (recipe items go with their meal, below)
      deleted.entries = (await dbx.delete(logEntries).where(eq(logEntries.userId, user.id)).returning({ id: logEntries.id })).length;
      deleted.weighIns = (await dbx.delete(weighIns).where(eq(weighIns.userId, user.id)).returning({ id: weighIns.id })).length;
      deleted.shots = (await dbx.delete(glp1Shots).where(eq(glp1Shots.userId, user.id)).returning({ id: glp1Shots.id })).length;
      replaced = true;
    }
    // Demo foods from an earlier run, whether or not the tracking is still there
    deleted.foods = (await dbx.delete(userFoods).where(and(eq(userFoods.userId, user.id), eq(userFoods.notes, DEMO_NOTE))).returning({ id: userFoods.id })).length;

    const userId = user.id;
    const timezone = user.timezone;
    const metric = user.units === "metric";
    const today = localDay(timezone, now);
    const plan = planDemo({ today, days: opts.days, seed: opts.seed, metric });

    // --- foods and quick meals (the app's own creators) ---
    const taken = new Set((await dbx.select({ b: userFoods.barcode }).from(userFoods).where(and(eq(userFoods.userId, userId), eq(userFoods.archived, false)))).map((r) => r.b));
    const foods = new Map<string, Awaited<ReturnType<typeof createMyFood>>>();
    for (const f of DEMO_FOODS) {
      const barcode = f.barcode && !taken.has(f.barcode) ? f.barcode : null;
      const made = await createMyFood(app, userId, { name: f.name, brand: f.brand ?? null, barcode, category: f.category, servings: f.servings, nutrients: per(f) });
      await dbx.update(userFoods).set({ notes: DEMO_NOTE }).where(eq(userFoods.id, made.id));
      foods.set(f.key, made);
    }
    const quick = new Map<string, number>();
    for (const q of DEMO_QUICK_MEALS) {
      const made = await createMeal(app, userId, {
        name: q.name,
        items: q.parts.map((x) => ({ food: { kind: "user_food" as const, id: foods.get(x.food)!.id }, servingIndex: 0, unit: x.unit ?? "serving", quantity: x.quantity, fraction: 1 })),
      });
      await dbx.update(userFoods).set({ notes: DEMO_NOTE }).where(eq(userFoods.id, made.id));
      quick.set(q.key, made.id);
    }

    // --- the log: the same snapshot fields POST /api/log writes ---
    const rows: (typeof logEntries.$inferInsert)[] = [];
    const uses = new Map<number, Date>(); // my food id -> last used
    const useCounts = new Map<number, number>();
    const used = (id: number, at: Date) => {
      useCounts.set(id, (useCounts.get(id) ?? 0) + 1);
      if (!uses.has(id) || uses.get(id)! < at) uses.set(id, at);
    };
    const stamp = (day: string, minutes: number) => new Date(Math.min(instantAt(timezone, day, minutes).getTime(), now.getTime() - 60_000));
    let waterEntries = 0;
    for (const d of plan.days) {
      for (const m of d.meals) {
        let minute = m.minutes;
        for (const item of m.items) {
          const at = stamp(d.day, minute++);
          if ("quick" in item) {
            const id = quick.get(item.quick)!;
            const { parts } = await quickMealParts(dbx, userId, id);
            for (const part of parts) {
              rows.push(entry(userId, d.day, m.meal, part.food, part.portion, part.nutrients, at, `quick:${id}`));
              if (part.food.kind === "user_food") used(part.food.id, at);
            }
            used(id, at);
          } else {
            const f = foods.get(item.food)!;
            const portionRef = { servingIndex: 0, unit: item.unit, quantity: item.quantity, fraction: 1 };
            const nutrients = scaleNutrients(f.nutrients, amountFactor(f.servings, 0, item.unit, item.quantity));
            rows.push(entry(userId, d.day, m.meal, f, portionRef, nutrients, at, null));
            used(f.id, at);
          }
        }
      }
      for (const w of d.water) {
        const at = stamp(d.day, w.minutes);
        waterEntries++;
        rows.push({
          userId, day: d.day, meal: "supplements", name: "Water", brand: null, icon: "💧", source: "water", sourceRef: null,
          servingIndex: 0, unit: "ml", quantity: w.ml, fraction: 1, perServing: { water_ml: 1 }, servings: [{ label: "1 ml", ml: 1 }],
          nutrients: scaleNutrients({ water_ml: 1 }, w.ml), createdAt: at, updatedAt: at,
        });
      }
    }
    for (let i = 0; i < rows.length; i += 500) await dbx.insert(logEntries).values(rows.slice(i, i + 500));
    for (const [id, n] of useCounts) await dbx.update(userFoods).set({ useCount: n, lastUsedAt: uses.get(id)! }).where(eq(userFoods.id, id));

    // --- profile, goals, GLP-1 ---
    const [body] = await dbx.select().from(userBody).where(eq(userBody.userId, userId));
    const startKg = START_LB * KG_PER_LB;
    if (!body) {
      await dbx.insert(userBody).values({ userId, sex: "female", birthDate: "1984-06-01", heightCm: 168, weightKg: startKg, goalWeightKg: GOAL_LB * KG_PER_LB, activity: "some", glp1: true, targetsWeightKg: startKg });
    } else if (!body.glp1) {
      await dbx.update(userBody).set({ glp1: true }).where(eq(userBody.userId, userId));
    }
    const [haveTargets] = await dbx.select({ id: targets.id }).from(targets).where(eq(targets.userId, userId)).limit(1);
    if (!haveTargets) await dbx.insert(targets).values({ userId, effectiveFrom: plan.from, plan: null, ...DEMO_TARGETS });

    const shots = plan.days.filter((d) => d.shot);
    for (const d of shots) await dbx.insert(glp1Shots).values({ userId, day: d.day, medication: MEDICATION, doseMg: d.shot!.doseMg, site: d.shot!.site, note: null });
    const last = shots.at(-1)?.shot;
    const glp = { medication: MEDICATION, doseMg: last?.doseMg ?? 2.5, injectionWeekday: INJECTION_WEEKDAY, updatedAt: now };
    await dbx.insert(glp1Settings).values({ userId, ...glp }).onConflictDoUpdate({ target: glp1Settings.userId, set: glp });

    // --- weigh-ins (kg in the table; the person's units on screen), the latest one becomes the body weight ---
    let weighed = 0;
    for (const d of plan.days) {
      if (d.weightLb === null) continue;
      await saveWeighIn(dbx, userId, d.day, d.weightLb * KG_PER_LB, null, now);
      weighed++;
    }

    // --- Settings › App info ---
    for (const [key, n] of Object.entries(plan.usage)) {
      await dbx.insert(usageCounts).values({ userId, key, count: n }).onConflictDoUpdate({ target: [usageCounts.userId, usageCounts.key], set: { count: sql`excluded.count` } });
    }

    return {
      username,
      replaced,
      deleted,
      timezone,
      from: plan.from,
      to: plan.today,
      foods: DEMO_FOODS.length,
      quickMeals: DEMO_QUICK_MEALS.length,
      entries: rows.length - waterEntries,
      waterEntries,
      weighIns: weighed,
      shots: shots.length,
      emptyDays: plan.days.filter((d) => d.empty).length,
    };
  });
}

type EntryFood = Pick<FoodResult, "kind" | "id" | "name" | "brand" | "icon" | "servings" | "nutrients" | "aiFields">;

/** One log entry for a food and an amount, with the snapshot columns filled as the app fills them. */
function entry(userId: number, day: string, meal: Meal, f: EntryFood, portion: { servingIndex: number; unit: Unit | string; quantity: number; fraction: number }, nutrients: Nutrients, at: Date, groupRef: string | null): typeof logEntries.$inferInsert {
  return {
    userId, day, meal, name: f.name, brand: f.brand, icon: f.icon, imageUrl: null,
    source: f.kind, sourceRef: `${f.kind}:${f.id}`,
    servingIndex: portion.servingIndex, unit: portion.unit as string, quantity: portion.quantity, fraction: portion.fraction,
    perServing: f.nutrients, servings: f.servings, nutrients, aiEstimated: f.aiFields.length > 0, groupRef,
    createdAt: at, updatedAt: at,
  };
}
