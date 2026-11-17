// Contract-shaped sample data (plan "API contracts") shared by the screen tests.

export const steadyTargets = {
  calories: { min: 1810, max: 2110 },
  protein_g: { min: 126, max: 180 },
  fiber_g: { min: 25, max: 38 },
  water_ml: { min: 1893, max: 3785 },
  plan: "steady",
  effectiveFrom: "2026-11-16",
};

// Alex's body (plan Task A): born 1974-06-01, desk job plus a daily walk
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
