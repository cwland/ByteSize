// Contract-shaped sample data (plan "API contracts") shared by the screen tests.

import { emptyWeightJson } from "./weightFixtures";
import { noGlp1 } from "./glp1Fixtures";

export const steadyTargets = {
  calories: { min: 1810, max: 2110 },
  protein_g: { min: 126, max: 180 },
  fiber_g: { min: 25, max: 38 },
  water_ml: { min: 1893, max: 3785 },
  plan: "steady",
  effectiveFrom: "2026-11-16",
};

// Cory's body (plan Task A): born 1974-06-01, desk job plus a daily walk
export const bodyA = {
  sex: "male",
  birthDate: "1974-06-01",
  heightCm: 182.88,
  weightKg: 102.51187562,
  goalWeightKg: 81.6466266,
  activity: "some",
  glp1: true,
  needsReview: false,
};

const r = (min: number, max: number) => ({ min, max });
const water = r(1893, 3785);
export const plansA = {
  tdee: 2487,
  floor: 1617,
  current: null,
  explanation: "Steady keeps you at 1,987 calories, above your 1,617 floor, and loses about 1 lb a week.",
  plans: [
    { id: "maintenance", name: "Maintenance", lbsPerWeek: 0, calories: 2487, weeksToGoal: null, recommended: false, notRecommended: false,
      bestFor: "Reached your goal, taking a break, or a vacation week",
      targets: { calories: r(2387, 2587), protein_g: r(144, 180), fiber_g: r(30, 35), water_ml: water } },
    { id: "relaxed", name: "Relaxed", lbsPerWeek: 0.5, calories: 2237, weeksToGoal: 92, recommended: false, notRecommended: false,
      bestFor: "Easing into a new dose, minimal side effects and strength gains",
      targets: { calories: r(2187, 2287), protein_g: r(144, 162), fiber_g: r(30, 35), water_ml: water } },
    { id: "steady", name: "Steady", lbsPerWeek: 1, calories: 1987, weeksToGoal: 46, recommended: true, notRecommended: false,
      bestFor: "The sweet spot: sustainable loss, high energy, no muscle loss",
      targets: { calories: r(1937, 2037), protein_g: r(162, 180), fiber_g: r(30, 35), water_ml: water } },
    { id: "accelerated", name: "Accelerated", lbsPerWeek: 1.5, calories: 1737, weeksToGoal: 31, recommended: false, notRecommended: false,
      bestFor: "Strong appetite suppression, when eating more feels forced",
      targets: { calories: r(1687, 1787), protein_g: r(171, 189), fiber_g: r(28, 32), water_ml: water } },
    { id: "vigorous", name: "Vigorous", lbsPerWeek: 2, calories: 1487, weeksToGoal: 23, recommended: false, notRecommended: true,
      bestFor: "The fastest loss, and the hardest to sustain",
      targets: { calories: r(1437, 1537), protein_g: r(180, 198), fiber_g: r(25, 30), water_ml: water } },
  ],
};

export const plansNoSafe = {
  tdee: 1352,
  floor: 1200,
  current: null,
  explanation: "Every plan here would put you under a safe calorie floor of 1,200. Set your targets with your care team, then enter them under Goals.",
  // As the server sends it: every weight-loss plan under the floor; Maintenance (no deficit) is safe but not recommended
  plans: plansA.plans.map((p, i) =>
    p.id === "maintenance" ? { ...p, calories: 1352, recommended: false, notRecommended: false } : { ...p, calories: 1102 - (i - 1) * 250, recommended: false, notRecommended: true },
  ),
};

const meal = (calories = 0, over: Record<string, number | null> = {}) => ({ calories, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, suggested: null as number | null, ...over });

export function dayJson(over: Record<string, unknown> = {}) {
  return {
    day: "2026-11-16",
    entries: [],
    totals: { calories: 0, unknownCount: {} },
    meals: { breakfast: meal(), lunch: meal(), dinner: meal(), snacks: meal(), supplements: meal() },
    targets: steadyTargets,
    exercise: { calories: 0 },
    activity: activityJson({ day: (over.day as string) ?? "2026-11-16" }),
    workoutCalories: workoutCaloriesJson(),
    streak: 0,
    ...over,
  };
}

// §40b: a day's activity and its workout calories, as GET /api/day sends them
export function activityJson(over: Record<string, unknown> = {}) {
  return { day: "2026-11-16", steps: null, stepsSource: null, typedSteps: null, stepGoal: null, workouts: [], earned: 0, activeMinutes: 0, ...over };
}
export function workoutCaloriesJson(over: Record<string, unknown> = {}) {
  return { mode: "show", countPct: 50, weeklyCap: 1000, earned: 0, added: 0, planCalories: steadyTargets.calories, status: null, bank: null, ...over };
}
export function workoutJson(over: Record<string, unknown> = {}) {
  return { id: 1, day: "2026-11-16", type: "walk", minutes: 30, calories: 120, source: "manual", externalId: null, note: null, ...over };
}
export { meal as mealTotals };

export const settingsMe = {
  mealWindows: { breakfast: "10:30", lunch: "14:30", snacks: "17:00", dinner: "21:00" },
  waterButtonsMl: [237, 473],
  weekStart: 0,
  dateFormat: "weekday-long-month-short",
};

// A cereal bar from Open Food Facts: nutrients per 100 g, plus a 40 g bar
export const barFood = {
  kind: "cache",
  id: 42,
  name: "Peanut butter bar",
  brand: "Crunchy Co",
  icon: "🍫",
  barcode: "0012345678905",
  servings: [
    { label: "100 g", grams: 100 },
    { label: "1 bar", grams: 40 },
  ],
  nutrients: { calories: 450, protein_g: 20, fiber_g: 5, carbs_g: 50, fat_g: 20 },
  aiFields: [],
  imageUrl: null,
  override: false,
  source: "off",
};

export function entryJson(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    day: "2026-11-16",
    meal: "breakfast",
    name: "Toast",
    brand: null,
    icon: "🍞",
    imageUrl: null,
    servingIndex: 0,
    unit: "serving",
    quantity: 1,
    fraction: 1,
    servings: [{ label: "2 slices", grams: 60 }],
    nutrients: { calories: 160, protein_g: 6, carbs_g: 30, fat_g: 2, fiber_g: 4 },
    aiEstimated: false,
    source: "cache",
    sourceRef: "cache:7",
    ...over,
  };
}

// The M3 GET routes Goals and the Dashboard call besides their own, answered as for a person with nothing
// recorded yet, so a test that isn't about them renders no 404 notices. Spread first, then override:
// fakeServer({ ...m3Routes, "GET /api/weight": () => weightJson() })
export const m3Routes = {
  "GET /api/weight": () => emptyWeightJson,
  "GET /api/glp1": () => noGlp1,
  "GET /api/body": () => ({ body: null }),
  "GET /api/badges": () => ({ badges: [], new: [] }),
  "GET /api/trends/weekly": () => ({ weeks: [] }),
  "GET /api/vacations": () => ({ vacations: [] }),
  "GET /api/layouts/dashboard": () => ({ layout: null }), // each widget page's default layout (a test may replace one)
  "GET /api/layouts/goals": () => ({ layout: null }),
  "GET /api/workout-calories": () => ({ settings: { mode: "show", countPct: 50, weeklyCap: 1000 }, effectiveFrom: null }), // Goals › Your plan
};

// Culury (§14 A). Not linked is the default for any screen that opens Add food:
// fakeServer({ ...culuryOff, … })
export const culuryOff = { "GET /api/settings/culury": () => ({ url: null, hasKey: false, enabled: false }) };
export const culuryOn = { "GET /api/settings/culury": () => ({ url: "http://culury.lan:4000", hasKey: true, enabled: true }) };
// Linked, but the person switched Culury off in Settings › Integrations
export const culuryLinkedOff = { "GET /api/settings/culury": () => ({ url: "http://culury.lan:4000", hasKey: true, enabled: false }) };

// As GET /api/culury/plan sends it: the selected day (Wed) first, its dinner first; then the rest in date order
export const culuryPlan = {
  linked: true,
  days: [
    {
      day: "2026-11-18",
      items: [
        { slot: "dinner", title: "Chili con carne", recipeId: 812, servings: 2, note: null },
        { slot: "lunch", title: "Leftovers", recipeId: null, servings: null, note: "Leftovers" },
      ],
    },
    { day: "2026-11-16", items: [{ slot: "breakfast", title: "Overnight oats", recipeId: 77, servings: 1, note: null }] },
    { day: "2026-11-17", items: [{ slot: "second-breakfast", title: "Taco soup", recipeId: 90, servings: null, note: null }] },
  ],
  errors: [],
};

// GET /api/culury/recipes/812: per serving, a serving weight from Culury's "About 1½ cups (340 g)"
export const culuryChili = {
  kind: "culury",
  id: 812,
  name: "Chili con carne",
  brand: null,
  icon: "🍲",
  barcode: null,
  servings: [{ label: "1 serving", grams: 340 }],
  nutrients: { calories: 520, protein_g: 38, fiber_g: 9, carbs_g: 40, fat_g: 22 },
  aiFields: [],
  imageUrl: null,
  override: false,
  source: "culury",
  foodKind: "recipe",
};

// Restaurants (§14 B): Add Food asks for the status on open; answered as nothing set up, so a test that
// isn't about restaurants renders no notice. The Restaurants view's own GETs, empty.
export const restaurantRoutes = {
  "GET /api/restaurants/status": () => ({ sources: [], lookupsLeft: null, turnedOff: false }),
  "GET /api/restaurants/favourites": () => ({ chains: [] }),
  "GET /api/restaurants/recent-chains": () => ({ chains: [] }),
};

// Backups (Settings › Data): newest first, the way the server lists them
export const backupList = {
  backups: [
    { name: "bytesize-2026-11-17-020000.tar.gz", size: 2516582, createdAt: "2026-11-17T09:00:00.000Z" },
    { name: "bytesize-2026-11-16-181500-before-restore.tar.gz", size: 1048576, createdAt: "2026-11-17T01:15:00.000Z" },
    { name: "bytesize-2026-11-16-020000.tar.gz", size: 2411724, createdAt: "2026-11-16T09:00:00.000Z" },
  ],
  keep: 14,
  unreadableKeys: [] as string[],
  problem: null as string | null,
};

// Import weight history (Settings › Data): a Lose It-style file, as POST /api/weight/import/preview reads it
export const weightImportPreview = {
  columns: ["Date", "Weight", "BMI"],
  dateColumn: 0,
  weightColumn: 1,
  units: "lb" as const,
  dateFormat: "mdy" as const,
  dateFormatMatters: true,
  count: 214,
  from: "2025-01-03",
  to: "2026-11-16",
  existingDays: 3,
  unreadable: 2,
  problems: [
    { line: 5, reason: 'Can\'t read the weight "abc"' },
    { line: 9, reason: "Date is in the future" },
  ],
  rows: [
    { day: "2026-11-16", weightKg: 214.2 * 0.45359237, existing: false },
    { day: "2026-11-15", weightKg: 214.8 * 0.45359237, existing: true },
  ],
};

// GET /api/admin/food-sources: every source on with its key, default hours, FatSecret on Basic; over: per source
export function foodSourcesJson(over: Record<string, Record<string, unknown>> = {}) {
  const base: Record<string, Record<string, unknown>> = {
    off: { enabled: true, hours: 9999 },
    usda: { hasKey: true, enabled: true, hours: 9999 },
    spoonacular: { hasKey: true, enabled: true, hours: 1 },
    fatsecret: { hasKey: true, enabled: true, hours: 24, plan: "basic", barcodeScopeMissing: false },
  };
  return Object.fromEntries(Object.entries(base).map(([k, v]) => [k, { ...v, ...over[k] }]));
}
