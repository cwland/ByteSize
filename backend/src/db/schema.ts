import { boolean, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

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
  timezone: text("timezone").notNull().default("America/Denver"), // decides where a day starts and ends
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
