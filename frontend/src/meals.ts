import type { Meal, MealWindows } from "./types";

// The meal a new entry goes to by default, from the local time in the person's time zone and their
// meal windows (before breakfast's end → breakfast, … after dinner's end → snacks). Same rules as the
// API's days.mealFor.
export function mealFor(timeZone: string, now: Date, windows: MealWindows): Meal {
  let hhmm: string;
  try {
    hhmm = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  } catch {
    hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  }
  if (hhmm < windows.breakfast) return "breakfast";
  if (hhmm < windows.lunch) return "lunch";
  if (hhmm < windows.snacks) return "snacks";
  if (hhmm < windows.dinner) return "dinner";
  return "snacks";
}

export const MEAL_NAMES: Record<Meal, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snacks: "Snacks",
  supplements: "Supplements & water",
};
export const MEALS: Meal[] = ["breakfast", "lunch", "dinner", "snacks", "supplements"];
