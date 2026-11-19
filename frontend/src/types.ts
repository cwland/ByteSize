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
  kind: "cache" | "user_food" | "culury"; // culury: a recipe read live from the person's Culury (id = its recipe id)
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
  source: "off" | "usda" | "mine" | "ai" | "culury" | RestaurantSource;
  foodKind: FoodKind;
  summary?: boolean; // a FatSecret search summary (calories, fat, carbs, protein): fetched whole when opened
  savedAt?: string | null; // a kept copy of an outside food: when it was fetched ("Saved copy from …"); null: fetched just now
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
// Food search: groups in order (My foods, Culury, Basic foods, FatSecret, USDA branded, Open Food Facts, Saved
// foods); a close spelling ("Did you mean …?") comes only when little was found
export type SearchGroup = { source: string; label: string; foods: FoodResult[] };
export type SearchResult = { groups: SearchGroup[]; errors: { source: string; message: string }[]; searched: string[]; suggestion?: string };
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
  treat?: boolean; // §40b: paid from the weekly workout-calorie bank on purpose
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
  exercise: { calories: number }; // workout calories earned that day
  activity?: DayActivity;
  workoutCalories?: DayWorkoutCalories;
  streak: number;
};
// Activity (§40b): GET /api/activity/:day (also in the day as activity). steps: Health's number, else the typed one.
export type WorkoutType = "walk" | "run" | "cycling" | "strength" | "swim" | "hike" | "yoga" | "hiit" | "sport" | "other";
export type Workout = { id: number; day: string; type: WorkoutType; minutes: number; calories: number | null; source: "manual" | "health"; externalId: string | null; note: string | null };
export type DayActivity = { day: string; steps: number | null; stepsSource: "manual" | "health" | null; typedSteps: number | null; stepGoal: number | null; workouts: Workout[]; earned: number; activeMinutes: number };
// Goals › Your plan › Workout calories: GET/PUT /api/workout-calories (a change applies from today on)
export type WorkoutMode = "show" | "add" | "bank";
export type WorkoutCalorieSettings = { mode: WorkoutMode; countPct: 25 | 50 | 75 | 100; weeklyCap: number };
export type WorkoutBank = {
  weekStart: string;
  balance: number;
  deposited: number;
  spent: number;
  weeklyCap: number;
  days: { day: string; deposit: number; spent: number }[]; // the week so far, up to the day
  thisDay: { overBy: number; covered: number; treatSpent: number };
};
export type DayWorkoutCalories = WorkoutCalorieSettings & { earned: number; added: number; planCalories: Range | null; status: "below" | "in" | "above" | null; bank: WorkoutBank | null };
export type MealWindows = { breakfast: string; lunch: string; snacks: string; dinner: string };
export type SettingsMe = { mealWindows: MealWindows; waterButtonsMl: number[]; weekStart: number /* 0 = Sunday … 6 = Saturday */; dateFormat?: string /* a key of dateFormat.ts */ };
export type Units = "imperial" | "metric";
// GET /api/weight: kg, unrounded. trendKg is the smoothed weight; projection.kgPerWeek > 0 means losing.
export type WeighIn = { day: string; weightKg: number; trendKg: number; note: string | null };
export type WeightProjection = { status: "ok" | "not_enough" | "not_losing" | "reached"; date?: string; kgPerWeek?: number };
// The Goal date widget's numbers (§40a; backend/src/lib/weight.ts goalDateOf): kg, days as YYYY-MM-DD, all after today
export type GoalDate =
  | { status: "no_goal" | "reached" | "not_enough" }
  | { status: "not_heading"; kgPerWeek: number }
  | { status: "ok"; kgPerWeek: number; toGoKg: number; weeks: { min: number; max: number }; date: string; earliest: string; latest: string };
export type Weight = {
  weighIns: WeighIn[];
  start: { day: string; weightKg: number } | null;
  latest: { day: string; weightKg: number } | null;
  trendKg: number | null;
  goalKg: number | null;
  lostKg: number | null;
  projection: WeightProjection;
  goalDate: GoalDate;
  replanHint: boolean;
};
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
// M3 weekly trends, badges, vacation mode (GET /api/trends/weekly, /api/badges, /api/vacations)
export type TrendKey = "calories" | "protein_g" | "fiber_g" | "water_ml";
export type WeekTrend = { start: string; end: string; daysLogged: number; caloriesInRange?: number; avg: Record<TrendKey, number | null>; status: Record<TrendKey, "below" | "in" | "above" | null>; weightChangeKg: number | null };
// count: Goal met only (§40c) — goals completed; earnedOn is the latest one's day
export type Badge = { id: string; earnedOn: string | null; seen: boolean; count?: number };
export type Vacation = { id: number; from: string; to: string };
// Culury link (§14 A): GET/PUT/DELETE /api/settings/culury (the key never comes back), GET /api/culury/plan
// (selected day first; recipeId null = a note, not loggable), GET /api/culury/recipes/:id
// enabled: the person's own Culury switch (PUT /api/settings/culury/enabled); off = Culury is never asked
export type CuluryLink = { url: string | null; hasKey: boolean; enabled: boolean };
export type CuluryPlan = { linked: boolean; days: { day: string; items: { slot: string; title: string; recipeId: number | null; servings: number | null; note: string | null }[] }[]; errors: SourceError[] };
export type CuluryRecipe = { food: FoodResult; hasNutrition: boolean; outdated: boolean };
// Restaurants (§14 B): lookupsLeft is Spoonacular points left today (null: not set up / not known yet)
export type RestaurantSource = "spoonacular" | "fatsecret";
// turnedOff: keys are saved but the admin switched every source off (Settings › Integrations)
export type RestaurantStatus = { sources: RestaurantSource[]; lookupsLeft: number | null; turnedOff: boolean };
export type MenuHit = { source: RestaurantSource; sourceId: string; chain: string; name: string; calories: number | null; cacheId: number | null; imageUrl: string | null };
export type MenuSearch = { items: MenuHit[]; lookupsLeft: number | null; errors: { source: RestaurantSource; message: string }[] };
export type RestaurantFavourites = { chains: { chain: string; foods: FoodResult[] }[] };

// Backups (Settings › Data), as GET /api/admin/backups sends them
export type Backup = { name: string; size: number; createdAt: string };
// problem: why the nightly backup needs looking at (the last one failed, or none for over 36 hours); null when fine
export type BackupList = { backups: Backup[]; keep: number; unreadableKeys: string[]; problem: string | null };
export type RestoreResult = { restored: { schema: number; users: number; photos: number }; unreadableKeys: string[] };

// Import weight history (Settings › Data, §19): POST /api/weight/import/preview and /api/weight/import (multipart).
// units: the file's; dateFormat: how 03/04/2025 is read (mdy = Month/Day/Year); dateFormatMatters: the file has such dates
export type WeightImportOptions = { dateColumn: number; weightColumn: number; units: "lb" | "kg"; dateFormat: "mdy" | "dmy" };
export type WeightImportPreview = WeightImportOptions & {
  columns: string[];
  dateFormatMatters: boolean;
  count: number;
  from: string | null;
  to: string | null;
  existingDays: number;
  unreadable: number;
  problems: { line: number; reason: string }[];
  // existing: the day already has a weigh-in in ByteSize
  rows: { day: string; weightKg: number; existing: boolean }[];
};
export type WeightImportResult = { imported: number; kept: number; replaced: number; from: string; to: string };

// Settings › App info (§29): GET /api/app-info. everyone: the admin's totals only; shots null: GLP-1 is off;
// weightLost null: no loss to show (in the person's units); countingSince: the day the counted numbers began
export type OutsideLookups = { total: number; off: number; usda: number; fatsecret: number; spoonacular: number; culury: number };
export type AppInfo = {
  you: {
    daysLogged: number; foodsLogged: number; differentFoods: number; myFoods: number; weighIns: number;
    weightLost: { amount: number; unit: "lb" | "kg" } | null;
    shots: number | null; longestStreak: number; memberSince: string;
    barcodesScanned: number; photosRead: number; aiEstimates: number; lookupsSaved: number; outsideLookups: OutsideLookups;
  };
  everyone?: { people: number; daysLogged: number; foodsLogged: number; barcodesScanned: number; outsideLookups: number; lookupsSaved: number };
  countingSince: string;
  version: string;
};

// Goals with a start and end (§40c): GET /api/goals. Progress is worked out by the server (live, or kept once the end
// has passed: frozen). Weight targets and values are kg.
export type GoalType = "logging_days" | "protein_days" | "calorie_days" | "water_days" | "weigh_ins" | "fiber_days" | "streak" | "steps" | "workouts" | "active_minutes" | "weight_by_date";
export type GoalPeriod = "week" | "month" | "stretch";
// unjudged: shown, never hit or missed (a partial week under 4 days, a month under 15, a stretch ended early)
export type GoalPeriodProgress = { start: string; end: string; value: number | null; target: number; status: "hit" | "missed" | "open" | "unjudged" };
export type GoalProgress = {
  // ended: ended early with nothing to judge (neither completed nor missed)
  state: "upcoming" | "active" | "completed" | "missed" | "ended";
  periods: GoalPeriodProgress[];
  current: GoalPeriodProgress | null;
  hit: number;
  done: number;
  of: number | null;
  // judged periods to hit to complete it (80% rounded up for each week / each month); null: ongoing
  needed: number | null;
  startKg: number | null;
  asOf: string;
};
export type Goal = {
  id: number;
  type: GoalType;
  name: string;
  target: number;
  period: GoalPeriod;
  measure: "total" | "average" | null;
  start: string;
  end: string | null;
  createdAt: string;
  endedEarly: boolean;
  frozen: boolean;
  progress: GoalProgress;
};
export type GoalsList = { active: Goal[]; past: Goal[] };
