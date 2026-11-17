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
// What a food is to its owner. Database (cache) foods read as "custom"; only recipes and quick meals get a tag.
export type FoodKind = "custom" | "override" | "recipe" | "quick_meal";
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
  foodKind: FoodKind;
};
// POST /api/photos/analyze (multipart: images 1–2, mode). A barcode found in the photo is looked up
// like a typed one (food); otherwise a nutrition label is read by the photo AI into a draft (nothing saved).
export type PhotoMode = "auto" | "barcode" | "label";
export type SourceError = { source: string; message: string };
export type PhotoDraft = Omit<FoodResult, "id" | "kind" | "foodKind"> & { category: string; photoId: string }; // as the backend sends it: no foodKind
export type PhotoResult = { photoIds: string[]; barcode?: string; food?: FoodResult; draft?: PhotoDraft; errors: SourceError[]; labelReading: boolean };
export type FoodRef = { kind: "cache" | "user_food"; id: number };
// One ingredient of a recipe or food of a quick meal, as sent to the API
export type Item = { food: FoodRef } & Portion;
// …and as the API returns it: the food now (or its snapshot when archived or gone, available false)
export type ItemView = Item & {
  foodKind: FoodKind;
  name: string;
  brand: string | null;
  icon: string;
  imageUrl: string | null;
  servings: Serving[];
  perServing: Nutrients; // per servings[0]
  nutrients: Nutrients; // this amount, as stored at the last Save or Recalculate
  available: boolean;
};
// GET /api/my-foods/:id; items, recipeServings and servingGrams only for recipes and quick meals
export type MyFood = FoodResult & { notes: string | null; items?: ItemView[]; recipeServings?: number | null; servingGrams?: number | null };
export type Portion = { servingIndex: number; unit: Unit; quantity: number; fraction: number };
export type RecentFood = FoodResult & { last: Portion };
// Food search: groups in order (My foods, Basic foods, Saved foods, Open Food Facts, USDA); a close
// spelling ("Did you mean …?") comes only when little was found
export type SearchGroup = { source: string; label: string; foods: FoodResult[] };
export type SearchResult = { groups: SearchGroup[]; errors: { source: string; message: string }[]; suggestion?: string };
export type Meal = "breakfast" | "lunch" | "dinner" | "snacks" | "supplements";
export type Unit = "serving" | "g" | "oz" | "ml" | "fl_oz" | "cup" | "tbsp" | "tsp";
export type LogEntry = {
  id: number;
  day: string;
  meal: Meal;
  name: string;
  brand: string | null;
  icon: string;
  imageUrl: string | null;
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
export type PlanId = "maintenance" | "relaxed" | "steady" | "accelerated" | "vigorous";
export type Targets = { calories: Range; protein_g: Range; fiber_g: Range; water_ml: Range; plan: PlanId | null; effectiveFrom: string };
export type TargetRanges = Pick<Targets, "calories" | "protein_g" | "fiber_g" | "water_ml">;
export type Plan = {
  id: PlanId;
  name: string;
  lbsPerWeek: number;
  calories: number;
  weeksToGoal: number | null;
  recommended: boolean;
  notRecommended: boolean;
  bestFor: string;
  targets: TargetRanges; // exactly what selecting this plan sets
};
export type PlansResponse = { tdee: number; floor: number; plans: Plan[]; explanation: string; current: PlanId | null };
// How active the day is, not counting workouts (×1.2 / 1.3 / 1.4 / 1.5)
export type Activity = "sitting" | "some" | "most" | "physical";
export type Body = { sex: "male" | "female"; birthDate: string /* YYYY-MM-DD */; heightCm: number; weightKg: number; goalWeightKg: number; activity: Activity; glp1: boolean };
// GET/PUT /api/body: needsReview is set on bodies saved before the questions changed (cleared by PUT)
export type SavedBody = Body & { needsReview: boolean };
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
export type SettingsMe = { mealWindows: MealWindows; waterButtonsMl: number[]; weekStart: number /* 0 = Sunday … 6 = Saturday */ };
export type Units = "imperial" | "metric";
// GLP-1 (M3 §13 B): weekly shots, injection sites in rotation order, side-effect levels 1 mild … 3 strong
export const SITES = ["abdomen_left", "abdomen_right", "thigh_left", "thigh_right", "arm_left", "arm_right"] as const;
export type Site = (typeof SITES)[number];
export const SIDE_EFFECTS = ["nausea", "low_appetite", "fatigue", "constipation", "diarrhea", "heartburn", "headache"] as const;
export type SideEffect = (typeof SIDE_EFFECTS)[number];
export type Glp1Settings = { medication: string; doseMg: number; injectionWeekday: number /* 0 = Sunday */ };
export type Shot = { day: string; medication: string; doseMg: number; site: Site; note: string | null };
export type Glp1View = {
  settings: Glp1Settings | null;
  lastShot: Shot | null;
  nextDue: string | null;
  status: "none" | "upcoming" | "due" | "overdue";
  overdueDays: number;
  suggestedSite: Site;
  shots: Shot[]; // newest first
  doseHistory: { day: string; doseMg: number; medication: string }[]; // oldest first; the first shot and every change
};
export type SideEffectDay = { day: string; effects: Partial<Record<SideEffect, 1 | 2 | 3>>; note: string | null };
export type AfterInjection = { enough: boolean; days: { offset: number; avgCalories: number | null; avgProtein: number | null; daysCounted: number }[] };
