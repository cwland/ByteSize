import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { userSettings, type MealWindows } from "../db/schema.js";
import { requireUser } from "../lib/guards.js";

// Your own logging settings: meal windows (end time of each meal, local "HH:MM") and the water buttons
export const DEFAULT_MEAL_WINDOWS: MealWindows = { breakfast: "10:30", lunch: "14:30", snacks: "17:00", dinner: "21:00" };
export const DEFAULT_WATER_BUTTONS_ML = [237, 473];
export const DEFAULT_WEEK_START = 0; // Sunday

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 14:30 (00:00 to 23:59)");

const settingsSchema = z.object({
  mealWindows: z
    .object({ breakfast: time, lunch: time, snacks: time, dinner: time })
    // Zero-padded HH:MM compares correctly as text
    .refine((w) => w.breakfast < w.lunch && w.lunch < w.snacks && w.snacks < w.dinner, "Meal times must go breakfast, lunch, snacks, dinner, each later than the one before"),
  waterButtonsMl: z.array(z.number().positive("Water amounts must be above 0").max(5000, "Water amounts must be 5,000 ml or less")).min(1, "Keep at least one water button").max(4, "Up to 4 water buttons"),
  weekStart: z.number().int("Choose a day of the week").min(0, "Choose a day of the week").max(6, "Choose a day of the week").optional(),
});

export default async function settingsMeRoutes(app: FastifyInstance) {
  const { db } = app;

  app.get("/api/settings/me", async (req) => {
    const userId = requireUser(req);
    const [row] = await db.select().from(userSettings).where(eq(userSettings.userId, userId));
    return { mealWindows: row?.mealWindows ?? DEFAULT_MEAL_WINDOWS, waterButtonsMl: row?.waterButtonsMl ?? DEFAULT_WATER_BUTTONS_ML, weekStart: row?.weekStart ?? DEFAULT_WEEK_START };
  });

  app.put("/api/settings/me", async (req) => {
    const userId = requireUser(req);
    const s = settingsSchema.parse(req.body ?? {});
    // weekStart left out keeps the saved one (or Sunday for a first save)
    const [saved] = await db
      .insert(userSettings)
      .values({ userId, mealWindows: s.mealWindows, waterButtonsMl: s.waterButtonsMl, weekStart: s.weekStart ?? DEFAULT_WEEK_START })
      .onConflictDoUpdate({
        target: userSettings.userId,
        set: { mealWindows: s.mealWindows, waterButtonsMl: s.waterButtonsMl, ...(s.weekStart === undefined ? {} : { weekStart: s.weekStart }) },
      })
      .returning({ weekStart: userSettings.weekStart });
    return { mealWindows: s.mealWindows, waterButtonsMl: s.waterButtonsMl, weekStart: saved.weekStart };
  });
}
