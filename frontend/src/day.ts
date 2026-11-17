import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import type { Day, SettingsMe } from "./types";

// Something changed the log (food, water, move): every screen showing a day reloads it
const EVENT = "bytesize:day-changed";
export const notifyDayChanged = () => window.dispatchEvent(new Event(EVENT));

// GET /api/day/:date for the given day, reloaded when the log changes
export function useDay(day: string) {
  const [data, setData] = useState<Day | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    let live = true;
    api<Day>("GET", `/api/day/${day}`)
      .then((d) => {
        if (live) {
          setData(d);
          setError(null);
        }
      })
      .catch((e) => live && setError((e as Error).message));
    return () => void (live = false);
  }, [day]);
  useEffect(() => {
    let stop = load();
    const on = () => {
      stop();
      stop = load();
    };
    window.addEventListener(EVENT, on);
    return () => {
      stop();
      window.removeEventListener(EVENT, on);
    };
  }, [load]);
  return { data, error };
}

export const DEFAULT_SETTINGS: SettingsMe = {
  mealWindows: { breakfast: "10:30", lunch: "14:30", snacks: "17:00", dinner: "21:00" },
  waterButtonsMl: [237, 473],
};

// Meal windows and water buttons (defaults until the server answers, or if it can't)
export function useSettingsMe() {
  const [s, setS] = useState<SettingsMe>(DEFAULT_SETTINGS);
  useEffect(() => {
    api<SettingsMe>("GET", "/api/settings/me")
      .then(setS)
      .catch(() => {});
  }, []);
  return s;
}
