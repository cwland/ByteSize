import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import type { Day, SettingsMe } from "./types";

// Something changed the log (food, water, move): every screen showing a day reloads it
const EVENT = "bytesize:day-changed";
export const notifyDayChanged = () => window.dispatchEvent(new Event(EVENT));
// Run `on` whenever the log changes; returns the unsubscribe
export const onDayChanged = (on: () => void) => {
  window.addEventListener(EVENT, on);
  return () => window.removeEventListener(EVENT, on);
};

// Your settings changed (Settings › Profile saved a week start): every useSettingsMe reloads
const SETTINGS_EVENT = "bytesize:settings-changed";
export const notifySettingsChanged = () => window.dispatchEvent(new Event(SETTINGS_EVENT));

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
  weekStart: 0,
};

// The last settings the server gave (or that were saved): where a new mount starts, so the week
// strip doesn't draw Sunday-first and re-layout every time it comes back
let lastKnown: SettingsMe = DEFAULT_SETTINGS;
/** For tests: forget the remembered settings. */
export const resetSettingsCache = () => {
  lastKnown = DEFAULT_SETTINGS;
};

// Meal windows, water buttons and week start (the last known ones until the server answers, or if it can't)
export function useSettingsMe() {
  const [s, setS] = useState<SettingsMe>(() => lastKnown);
  useEffect(() => {
    let live = true;
    const load = () =>
      api<SettingsMe>("GET", "/api/settings/me")
        .then((r) => {
          lastKnown = { ...DEFAULT_SETTINGS, ...r };
          if (live) setS(lastKnown);
        })
        .catch(() => {});
    load();
    window.addEventListener(SETTINGS_EVENT, load);
    return () => {
      live = false;
      window.removeEventListener(SETTINGS_EVENT, load);
    };
  }, []);
  return s;
}
