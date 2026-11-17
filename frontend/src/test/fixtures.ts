// Contract-shaped sample data (plan "API contracts") shared by the screen tests.

export const steadyTargets = {
  calories: { min: 1810, max: 2110 },
  protein_g: { min: 126, max: 180 },
  fiber_g: { min: 25, max: 38 },
  water_ml: { min: 1893, max: 3785 },
  plan: "steady",
  effectiveFrom: "2026-11-16",
};

export const bodyA = {
  sex: "male",
  birthYear: 1986,
  heightCm: 177.8,
  weightKg: 113.3980925,
  goalWeightKg: 81.6466266,
  activity: "sedentary",
  glp1: true,
};

export const plansA = {
  tdee: 2460,
  floor: 1599,
  current: null,
  explanation: "Steady keeps you at 1,960 calories, above your 1,599 floor, and loses about 1 lb a week.",
  plans: [
    { id: "relaxed", name: "Relaxed", lbsPerWeek: 0.5, calories: 2210, weeksToGoal: 140, recommended: false, notRecommended: false },
    { id: "steady", name: "Steady", lbsPerWeek: 1, calories: 1960, weeksToGoal: 70, recommended: true, notRecommended: false },
    { id: "accelerated", name: "Accelerated", lbsPerWeek: 1.5, calories: 1710, weeksToGoal: 47, recommended: false, notRecommended: false },
    { id: "vigorous", name: "Vigorous", lbsPerWeek: 2, calories: 1460, weeksToGoal: 35, recommended: false, notRecommended: true },
  ],
};

export const plansNoSafe = {
  tdee: 1352,
  floor: 1200,
  current: null,
  explanation: "Every plan here would put you under a safe calorie floor of 1,200. Set your targets with your care team, then enter them under Goals.",
  plans: plansA.plans.map((p, i) => ({ ...p, calories: 1102 - i * 250, recommended: false, notRecommended: true })),
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
    streak: 0,
    ...over,
  };
}
export { meal as mealTotals };

export const settingsMe = {
  mealWindows: { breakfast: "10:30", lunch: "14:30", snacks: "17:00", dinner: "21:00" },
  waterButtonsMl: [237, 473],
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
