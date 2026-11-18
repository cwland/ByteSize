import { sql } from "drizzle-orm";
import { boolean, date, doublePrecision, index, integer, jsonb, pgTable, primaryKey, serial, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

// Shared tables. Every table that holds a person's own data has a user_id that cascades,
// so deleting a user removes everything they own.

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(), // stored trimmed and lowercased
  displayName: text("display_name"),
  email: text("email"),
  passwordHash: text("password_hash"), // null: invited by email and hasn't accepted yet (can't sign in)
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
  // The OAuth / OpenID Connect identity linked to this account (Settings › Security › Link my account)
  oauthIssuer: text("oauth_issuer"),
  oauthSubject: text("oauth_subject"),
  oauthEmail: text("oauth_email"), // what the provider called it, shown in Settings
}, (t) => [uniqueIndex("users_oauth_identity_idx").on(t.oauthIssuer, t.oauthSubject)]);

// App-wide settings (AI services, food source keys). Secrets inside are encrypted.
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Forgot password: one 6-digit code per account at a time, emailed. Only a keyed hash of the code is kept.
// Good for 15 minutes, once; 5 wrong tries end it. Never backed up.
export const passwordResetCodes = pgTable("password_reset_codes", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .unique() // a new request replaces the old code
    .references(() => users.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull(),
  wrongTries: integer("wrong_tries").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Invite by email (Settings › Users): one pending link per invited person (the person is a users row with no
// password until they accept). Only a hash of the link's token is kept. Good for 7 days, once; Resend replaces
// it, Cancel invite removes the person. Never backed up (the invited person's row is).
export const invites = pgTable("invites", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .unique() // a new link replaces the old one
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  invitedBy: integer("invited_by").references(() => users.id, { onDelete: "set null" }),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

// OAuth sign-ins on their way: from the button to the provider and back (10 minutes). Never backed up.
export const oauthFlows = pgTable("oauth_flows", {
  state: text("state").primaryKey(),
  purpose: text("purpose").$type<"login" | "link">().notNull(),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }), // Link my account: who
  verifier: text("verifier").notNull(), // PKCE
  nonce: text("nonce").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  appOrigin: text("app_origin").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

// After an OAuth sign-in the browser comes back with a one-time ticket (never the login token itself),
// which the page swaps for its token within a minute. Only a hash of the ticket is kept. Never backed up.
export const oauthTickets = pgTable("oauth_tickets", {
  ticketHash: text("ticket_hash").primaryKey(),
  sessionId: integer("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
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

// Settings › API keys: a person's own keys for their tools (lib/apiKeys.ts decides what a key may reach).
// A key acts as its owner only. key_hash (SHA-256) finds the key; key_enc (encryptSecret, from JWT_SECRET)
// lets the owner show it again with the eye. The key itself is never stored as it is. Backed up.
export const apiKeys = pgTable(
  "api_keys",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(), // the first characters, shown to tell keys apart ("bs_3f9aK2x…")
    keyHash: text("key_hash").notNull().unique(),
    keyEnc: text("key_enc").notNull(),
    access: text("access").$type<"read" | "log">().notNull().default("read"), // Read only, or Read and log
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [index("api_keys_user_idx").on(t.userId)]
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
  // The weight the current targets were set with (set when a plan is selected); null until then
  targetsWeightKg: doublePrecision("targets_weight_kg"),
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
  // How the date at the top of the app is written (a key of lib/dateFormats.ts)
  dateFormat: text("date_format").notNull().default("weekday-long-month-short"),
  culuryUrl: text("culury_url"),
  culuryKeyEnc: text("culury_key_enc"), // encrypted
  // The person's Culury switch (Settings › Integrations); null = never switched: on when linked
  culuryEnabled: boolean("culury_enabled"),
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
    source: text("source").notNull(), // off, usda, spoonacular, fatsecret
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
    // when someone last found, opened or tracked it: the cleanup leaves foods used in the last hour
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("food_cache_source_idx").on(t.source, t.sourceId), index("food_cache_barcode_idx").on(t.barcode)]
);

// A person's own foods: custom foods, AI estimates they saved, and corrections (overrides) of cached foods
export const userFoods = pgTable(
  "user_foods",
  {
    id: serial("id").primaryKey(),
    userId: userRef(),
    kind: text("kind").notNull(), // custom, ai, override, recipe, quick_meal
    name: text("name").notNull(),
    brand: text("brand"),
    barcode: text("barcode"), // normalized; one active food per barcode per person
    baseCacheId: integer("base_cache_id").references(() => foodCache.id, { onDelete: "set null" }),
    category: text("category"),
    servings: jsonb("servings").$type<ServingJson[]>().notNull(),
    nutrients: jsonb("nutrients").$type<NutrientsJson>().notNull(),
    aiFields: text("ai_fields").array().notNull().default(sql`'{}'::text[]`), // nutrient keys the AI guessed
    notes: text("notes"),
    imagePath: text("image_path"), // its photo: an upload's path under the uploads folder ("<user_id>/<upload id>.jpg")
    recipeServings: doublePrecision("recipe_servings"), // recipes: how many servings the ingredients make (quick meals: 1)
    servingGrams: doublePrecision("serving_grams"), // recipes: the weight of one serving, when known
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

// Uploaded photos (barcodes, labels), normalised to JPEG and kept as files under <data dir>/uploads/<path>.
// linked_at: when a food was saved with it; photos never linked are deleted after 24 h.
export const uploads = pgTable(
  "uploads",
  {
    id: uuid("id").primaryKey(),
    userId: userRef(),
    path: text("path").notNull(), // "<user_id>/<id>.jpg"
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    linkedAt: timestamp("linked_at", { withTimezone: true }),
  },
  (t) => [index("uploads_user_idx").on(t.userId), index("uploads_unlinked_idx").on(t.createdAt).where(sql`${t.linkedAt} is null`)]
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
    groupRef: text("group_ref"), // quick:<user_food id> when logged from a quick meal (one entry per item)
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("log_entries_user_day_idx").on(t.userId, t.day)]
);

/** What a recipe item remembers of its food at save time: used when the food is archived or gone. */
export type RecipeItemSnapshot = {
  name: string;
  brand: string | null;
  icon: string;
  foodKind: string;
  nutrients: NutrientsJson; // for the item's amount
  perServing: NutrientsJson; // the food's, per its servings[0]
  servings: ServingJson[];
  aiFields: string[];
};

// The ingredients of a recipe, or the foods of a quick meal (both are user_foods). Reached only
// through their recipe, so they belong to the recipe's owner.
export const recipeItems = pgTable(
  "recipe_items",
  {
    id: serial("id").primaryKey(),
    recipeId: integer("recipe_id")
      .notNull()
      .references(() => userFoods.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    foodKind: text("food_kind").notNull(), // user_food, cache
    foodId: integer("food_id").notNull(),
    servingIndex: integer("serving_index").notNull().default(0),
    unit: text("unit").notNull(),
    quantity: doublePrecision("quantity").notNull(),
    fraction: doublePrecision("fraction").notNull().default(1),
    snapshot: jsonb("snapshot").$type<RecipeItemSnapshot>().notNull(),
  },
  (t) => [index("recipe_items_recipe_idx").on(t.recipeId, t.position), index("recipe_items_food_idx").on(t.foodKind, t.foodId)]
);

// ---- Milestone 3: weight, GLP-1, badges, vacations ----
// Days are YYYY-MM-DD in the person's timezone; weights are kg.

// One weigh-in per person per day
export const weighIns = pgTable(
  "weigh_ins",
  {
    id: serial("id").primaryKey(),
    userId: userRef(),
    day: date("day", { mode: "string" }).notNull(),
    weightKg: doublePrecision("weight_kg").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("weigh_ins_user_day_idx").on(t.userId, t.day)]
);

// A person's GLP-1 medication (one row each; missing row = not using one)
export const glp1Settings = pgTable("glp1_settings", {
  userId: userRef().primaryKey(),
  medication: text("medication").notNull(),
  doseMg: doublePrecision("dose_mg").notNull(),
  injectionWeekday: integer("injection_weekday").notNull(), // 0 = Sunday ... 6 = Saturday
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Shots taken (medication and dose are snapshots, so a later dose change doesn't rewrite history)
export const glp1Shots = pgTable(
  "glp1_shots",
  {
    id: serial("id").primaryKey(),
    userId: userRef(),
    day: date("day", { mode: "string" }).notNull(),
    medication: text("medication").notNull(),
    doseMg: doublePrecision("dose_mg").notNull(),
    site: text("site").notNull(), // abdomen_left, abdomen_right, thigh_left, thigh_right, arm_left, arm_right
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("glp1_shots_user_day_idx").on(t.userId, t.day)]
);

// How a person felt on a day: effect name -> level 1-3
export const sideEffects = pgTable(
  "side_effects",
  {
    id: serial("id").primaryKey(),
    userId: userRef(),
    day: date("day", { mode: "string" }).notNull(),
    effects: jsonb("effects").$type<Record<string, 1 | 2 | 3>>().notNull(),
    note: text("note"),
  },
  (t) => [uniqueIndex("side_effects_user_day_idx").on(t.userId, t.day)]
);

// Badges earned; once earned, never removed
export const badges = pgTable(
  "badges",
  {
    userId: userRef(),
    badge: text("badge").notNull(),
    earnedOn: date("earned_on", { mode: "string" }).notNull(),
    seen: boolean("seen").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.userId, t.badge] })]
);

// Vacation mode ranges (inclusive): these days don't count toward or against streaks
export const vacations = pgTable(
  "vacations",
  {
    id: serial("id").primaryKey(),
    userId: userRef(),
    fromDay: date("from_day", { mode: "string" }).notNull(),
    toDay: date("to_day", { mode: "string" }).notNull(),
  },
  (t) => [index("vacations_user_from_idx").on(t.userId, t.fromDay)]
);

// Restaurant menu items a person starred (food_cache rows from Spoonacular or FatSecret), kept under their chain
export const restaurantFavourites = pgTable(
  "restaurant_favourites",
  {
    id: serial("id").primaryKey(),
    userId: userRef(),
    cacheId: integer("cache_id")
      .notNull()
      .references(() => foodCache.id, { onDelete: "cascade" }),
    chain: text("chain").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("restaurant_favourites_user_cache_idx").on(t.userId, t.cacheId)]
);

// Restaurant search answers (Spoonacular, FatSecret) kept for their source's hours, shared by everyone: not anyone's own data.
// query is lowercased with single spaces.
export const restaurantSearches = pgTable(
  "restaurant_searches",
  {
    id: serial("id").primaryKey(),
    source: text("source").notNull(),
    query: text("query").notNull(),
    results: jsonb("results").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("restaurant_searches_source_query_idx").on(t.source, t.query)]
);

// Typed-search answers per outside source (off, usda, fatsecret) and query (lowercased, single spaces), kept for
// that source's hours: the food_cache ids found, in order (basic: a USDA whole food). Shared; not backed up.
export const foodSearches = pgTable(
  "food_searches",
  {
    id: serial("id").primaryKey(),
    source: text("source").notNull(),
    query: text("query").notNull(),
    results: jsonb("results").$type<{ id: number; basic?: true }[]>().notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("food_searches_source_query_idx").on(t.source, t.query)]
);

// FatSecret: barcode (EAN-13) → FatSecret food id, kept for good (FatSecret's terms allow it), so a barcode whose
// food details were cleaned up costs one call (food.get) to fetch again.
export const fatsecretBarcodes = pgTable("fatsecret_barcodes", {
  barcode: text("barcode").primaryKey(),
  foodId: text("food_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// What a person has done with ByteSize that nothing else records (Settings › App info): barcodes scanned, photos
// read, AI estimates, lookups answered from a saved copy, outside calls per source. One row per person and key,
// counted from the day this shipped. Their own data: backed up, in "Download my data", gone with the person.
export const usageCounts = pgTable(
  "usage_counts",
  {
    userId: userRef(),
    key: text("key").notNull(), // see lib/usage.ts USAGE_KEYS
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })]
);
