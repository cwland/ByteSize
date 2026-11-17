// The API's JSON shapes (plan "API contracts"). Everything is metric inside; screens convert at the edge.

export const NUTRIENT_KEYS = [
  "calories",
  "protein_g",
  "fiber_g",
  "carbs_g",
  "fat_g",
  "saturated_fat_g",
  "sugar_g",
  "added_sugar_g",
  "sugar_alcohol_g",
  "sodium_mg",
  "potassium_mg",
  "magnesium_mg",
  "water_ml",
] as const;
export type NutrientKey = (typeof NUTRIENT_KEYS)[number];
// A missing key means unknown, never 0
export type Nutrients = Partial<Record<NutrientKey, number>>;
export type Serving = { label: string; grams?: number; ml?: number; approx?: true }; // approx: ml estimated from grams (1 g ≈ 1 ml)
export type FoodResult = {
  kind: "cache" | "user_food";
  id: number;
  name: string;
  brand: string | null;
  icon: string;
  barcode: string | null;
  servings: Serving[];
  nutrients: Nutrients;
  aiFields: string[];
  imageUrl: string | null;
  override: boolean;
  source: "off" | "usda" | "mine" | "ai";
};
export type Portion = { servingIndex: number; unit: Unit; quantity: number; fraction: number };
export type RecentFood = FoodResult & { last: Portion };
export type Meal = "breakfast" | "lunch" | "dinner" | "snacks" | "supplements";
export type Unit = "serving" | "g" | "oz" | "ml" | "fl_oz" | "cup" | "tbsp" | "tsp";
export type LogEntry = {
  id: number;
  day: string;
  meal: Meal;
  name: string;
  brand: string | null;
  icon: string;
  servingIndex: number;
  unit: Unit;
  quantity: number;
  fraction: number;
  servings: Serving[];
  nutrients: Nutrients;
  aiEstimated: boolean;
  source: string;
  sourceRef: string | null;
};
export type Range = { min: number; max: number };
export type PlanId = "relaxed" | "steady" | "accelerated" | "vigorous";
export type Targets = { calories: Range; protein_g: Range; fiber_g: Range; water_ml: Range; plan: PlanId | null; effectiveFrom: string };
export type TargetRanges = Pick<Targets, "calories" | "protein_g" | "fiber_g" | "water_ml">;
export type Plan = { id: PlanId; name: string; lbsPerWeek: number; calories: number; weeksToGoal: number | null; recommended: boolean; notRecommended: boolean };
export type PlansResponse = { tdee: number; floor: number; plans: Plan[]; explanation: string; current: PlanId | null };
export type Activity = "sedentary" | "light" | "moderate" | "active" | "very";
export type Body = { sex: "male" | "female"; birthYear: number; heightCm: number; weightKg: number; goalWeightKg: number; activity: Activity; glp1: boolean };
export type MealTotals = { calories: number; protein_g: number; carbs_g: number; fat_g: number; fiber_g: number; suggested: number | null };
export type Day = {
  day: string;
  entries: LogEntry[];
  totals: Nutrients & { unknownCount: Record<string, number> };
  meals: Record<Meal, MealTotals>;
  targets: Targets | null;
  exercise: { calories: number };
  streak: number;
};
export type MealWindows = { breakfast: string; lunch: string; snacks: string; dinner: string };
export type SettingsMe = { mealWindows: MealWindows; waterButtonsMl: number[] };
export type Units = "imperial" | "metric";
