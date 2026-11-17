import type { users } from "../db/schema.js";

// Usernames ignore capitalization and surrounding spaces: "  Cory " is "cory"
export const normalizeUsername = (s: string) => s.trim().toLowerCase();

// What the web app is told about a user (never the password hash or token version)
export const publicUser = (u: typeof users.$inferSelect) => ({
  id: u.id,
  username: u.username,
  displayName: u.displayName,
  email: u.email,
  isAdmin: u.isAdmin,
  theme: u.theme,
  colorMode: u.colorMode,
  units: u.units,
  timezone: u.timezone,
  setupDone: !!u.setupDoneAt,
});
