import { sql } from "drizzle-orm";
import { boolean, date, doublePrecision, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// Shared tables. Every table that holds a person's own data has a user_id that cascades,
// so deleting a user removes everything they own.

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(), // stored trimmed and lowercased
  displayName: text("display_name"),
  email: text("email"),
  passwordHash: text("password_hash").notNull(),
  isAdmin: boolean("is_admin").notNull().default(false), // runs the server: users, AI services, all logs
  disabled: boolean("disabled").notNull().default(false), // can't sign in; current sign-ins stop working
  // Bumped to sign out every device: login tokens carry the version they were issued with
  tokenVersion: integer("token_version").notNull().default(0),
  theme: text("theme"), // null: the default (avocado)
  colorMode: text("color_mode"), // light, dark or system (null: system)
  units: text("units").$type<"imperial" | "metric">().notNull().default("imperial"),
  timezone: text("timezone").notNull().default("America/Boise"), // decides where a day starts and ends
  setupDoneAt: timestamp("setup_done_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// App-wide settings (AI services, food source keys). Secrets inside are encrypted.
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Signed-in devices: one row per sign-in (each login token carries its row's tokenId).
export const sessions = pgTable(
  "sessions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenId: text("token_id").notNull().unique(),
    tokenVersion: integer("token_version").notNull(),
    how: text("how").notNull(), // password, setup, passkey, earlier sign-in
    userAgent: text("user_agent"),
    ip: text("ip"),
    lastIp: text("last_ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    deviceId: text("device_id"), // a random id the browser keeps, so one browser keeps one row
  },
  (t) => [index("sessions_user_idx").on(t.userId), uniqueIndex("sessions_user_device_idx").on(t.userId, t.deviceId)]
);

// Every sign-in attempt, good or bad (Settings > Security)
export const loginEvents = pgTable(
  "login_events",
  {
    id: serial("id").primaryKey(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    username: text("username"), // as typed
    success: boolean("success").notNull(),
    reason: text("reason"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    sessionId: integer("session_id").references(() => sessions.id, { onDelete: "set null" }),
  },
  (t) => [index("login_events_at_idx").on(t.at)]
);

// Passkeys (WebAuthn). Each belongs to the web address it was made on (rp_id).
export const passkeys = pgTable("passkeys", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  credentialId: text("credential_id").notNull().unique(),
  publicKey: text("public_key").notNull(),
  counter: integer("counter").notNull().default(0),
  transports: jsonb("transports").$type<string[]>(),
  rpId: text("rp_id").notNull(),
  name: text("name").notNull(),
  deviceType: text("device_type"),
  backedUp: boolean("backed_up").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
});

// Settings > Logs. Short descriptions only, never secrets. Kept 30 days.
// user_id: whose action it was (null: the server's own, e.g. a scheduled task).
export const appLog = pgTable(
  "app_log",
  {
    id: serial("id").primaryKey(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
    category: text("category").notNull(), // ai, api, auth, schedule, food
    level: text("level").notNull(), // info, warning, error
    source: text("source"),
    event: text("event").notNull(),
    detail: text("detail"),
  },
  (t) => [index("app_log_at_idx").on(t.at), index("app_log_user_at_idx").on(t.userId, t.at)]
);

// ---- Milestone 2a: body, targets, foods, log ----
// Everything is metric inside (cm, kg, g, ml, kcal). Nutrient jsonb is per serving, keyed like
// { calories, protein_g, fiber_g, ... }; a missing key means unknown, never 0.

export type NutrientsJson = Partial<Record<string, number>>;
export type ServingJson = { label: string; grams?: number; ml?: number };
export type MealWindows = { breakfast: string; lunch: string; snacks: string; dinner: string };

const userRef = () =>
  integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" });

// What the plan picker needs to know about a person (one row each)
export const userBody = pgTable("user_body", {
  userId: userRef().primaryKey(),
  sex: text("sex").$type<"male" | "female">().notNull(),
  birthDate: date("birth_date", { mode: "string" }).notNull(), // YYYY-MM-DD
  // Saved before birthdates and the new activity levels (migration 0003): plans wait until they check their details
  needsReview: boolean("needs_review").notNull().default(false),
  heightCm: doublePrecision("height_cm").notNull(),
  weightKg: doublePrecision("weight_kg").notNull(),
  goalWeightKg: doublePrecision("goal_weight_kg").notNull(),
  activity: text("activity").$type<"sitting" | "some" | "most" | "physical">().notNull(),
  glp1: boolean("glp1").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// A person's own settings (one row each; missing row = defaults)
export const userSettings = pgTable("user_settings", {
  userId: userRef().primaryKey(),
  // Meal time windows decide the default meal when logging (local times, end of each window)
  mealWindows: jsonb("meal_windows")
    .$type<MealWindows>()
    .notNull()
    .default({ breakfast: "10:30", lunch: "14:30", snacks: "17:00", dinner: "21:00" }),
  waterButtonsMl: jsonb("water_buttons_ml").$type<number[]>().notNull().default([237, 473]),
  // First day of the week in the day strip: 0 = Sunday ... 6 = Saturday
  weekStart: integer("week_start").notNull().default(0),
  culuryUrl: text("culury_url"),
  culuryKeyEnc: text("culury_key_enc"), // encrypted
});

// Daily targets. The targets in force on day D: the latest effective_from <= D (ties: highest id).
export const targets = pgTable(
  "targets",
  {
    id: serial("id").primaryKey(),
    userId: userRef(),
    effectiveFrom: date("effective_from").notNull(), // YYYY-MM-DD in the user's timezone
    plan: text("plan"), // relaxed, steady, accelerated, vigorous; null: set by hand
    caloriesMin: integer("calories_min").notNull(),
    caloriesMax: integer("calories_max").notNull(),
    proteinMin: doublePrecision("protein_min").notNull(),
    proteinMax: doublePrecision("protein_max").notNull(),
    fiberMin: doublePrecision("fiber_min").notNull(),
    fiberMax: doublePrecision("fiber_max").notNull(),
    waterMin: doublePrecision("water_min").notNull(),
    waterMax: doublePrecision("water_max").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("targets_user_from_idx").on(t.userId, t.effectiveFrom)]
);

// Foods fetched from outside sources (Open Food Facts, USDA), shared by everyone
export const foodCache = pgTable(
  "food_cache",
  {
    id: serial("id").primaryKey(),
    source: text("source").notNull(), // off, usda
    sourceId: text("source_id").notNull(),
    barcode: text("barcode"), // normalized (EAN-13)
    name: text("name").notNull(),
    brand: text("brand"),
    category: text("category"),
    servings: jsonb("servings").$type<ServingJson[]>().notNull(),
    nutrients: jsonb("nutrients").$type<NutrientsJson>().notNull(),
    imageUrl: text("image_url"),
    raw: jsonb("raw"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("food_cache_source_idx").on(t.source, t.sourceId), index("food_cache_barcode_idx").on(t.barcode)]
);

// A person's own foods: custom foods, AI estimates they saved, and corrections (overrides) of cached foods
export const userFoods = pgTable(
  "user_foods",
  {
    id: serial("id").primaryKey(),
    userId: userRef(),
    kind: text("kind").notNull(), // custom, ai, override
    name: text("name").notNull(),
    brand: text("brand"),
    barcode: text("barcode"), // normalized; one active food per barcode per person
    baseCacheId: integer("base_cache_id").references(() => foodCache.id, { onDelete: "set null" }),
    category: text("category"),
    servings: jsonb("servings").$type<ServingJson[]>().notNull(),
    nutrients: jsonb("nutrients").$type<NutrientsJson>().notNull(),
    aiFields: text("ai_fields").array().notNull().default(sql`'{}'::text[]`), // nutrient keys the AI guessed
    notes: text("notes"),
    useCount: integer("use_count").notNull().default(0),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    archived: boolean("archived").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("user_foods_user_idx").on(t.userId),
    uniqueIndex("user_foods_user_barcode_idx").on(t.userId, t.barcode).where(sql`${t.barcode} is not null and ${t.archived} = false`),
    index("user_foods_name_trgm_idx").using("gin", sql`lower(${t.name} || ' ' || coalesce(${t.brand}, '')) gin_trgm_ops`),
  ]
);

// What a person ate. Each entry keeps a snapshot (per_serving, servings, nutrients) so editing
// it never re-reads the food it came from.
export const logEntries = pgTable(
  "log_entries",
  {
    id: serial("id").primaryKey(),
    userId: userRef(),
    day: date("day").notNull(), // YYYY-MM-DD in the user's timezone
    meal: text("meal").notNull(), // breakfast, lunch, dinner, snacks, supplements
    name: text("name").notNull(),
    brand: text("brand"),
    icon: text("icon").notNull(),
    imageUrl: text("image_url"), // the food's photo when it had one (snapshot, like the name)
    source: text("source").notNull(), // cache, user_food, water
    sourceRef: text("source_ref"),
    servingIndex: integer("serving_index").notNull().default(0),
    unit: text("unit").notNull(), // serving, g, oz, ml, fl_oz, cup, tbsp, tsp
    quantity: doublePrecision("quantity").notNull(),
    fraction: doublePrecision("fraction").notNull().default(1),
    perServing: jsonb("per_serving").$type<NutrientsJson>().notNull(),
    servings: jsonb("servings").$type<ServingJson[]>().notNull(),
    nutrients: jsonb("nutrients").$type<NutrientsJson>().notNull(), // for the amount logged
    aiEstimated: boolean("ai_estimated").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("log_entries_user_day_idx").on(t.userId, t.day)]
);
