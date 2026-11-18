import { useCallback, useContext, useEffect, useState } from "react";
import { api } from "./api";
import { DEFAULT_DATE_FORMAT } from "./dateFormat";
import { SessionContext } from "./session";
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
  dateFormat: DEFAULT_DATE_FORMAT,
};

// The last settings the server gave (or that were saved): where a new mount starts, so the week
// strip doesn't draw Sunday-first and re-layout every time it comes back. Before the server first answers on
// a page load, the date format and week start remembered on this device (from the last answer) are used, so
// the header shows the person's format from the first paint instead of the default flashing first.
// Kept per person (bytesize-look:<user id>): someone else signing in on this device never sees it, and signing
// out forgets it (forgetSettings).
const lookKey = (userId: number) => `bytesize-look:${userId}`;
function rememberedLook(userId: number | null): Partial<SettingsMe> {
  if (userId === null) return {};
  try {
    const v = JSON.parse(localStorage.getItem(lookKey(userId)) ?? "null") as { dateFormat?: unknown; weekStart?: unknown } | null;
    const out: Partial<SettingsMe> = {};
    if (typeof v?.dateFormat === "string") out.dateFormat = v.dateFormat;
    if (Number.isInteger(v?.weekStart) && (v!.weekStart as number) >= 0 && (v!.weekStart as number) <= 6) out.weekStart = v!.weekStart as number;
    return out;
  } catch {
    return {};
  }
}
function rememberLook(userId: number | null, s: SettingsMe) {
  if (userId === null) return;
  try {
    localStorage.setItem(lookKey(userId), JSON.stringify({ dateFormat: s.dateFormat, weekStart: s.weekStart }));
  } catch {
    // no storage (private mode): the default shows first, as before
  }
}
// The last settings the server gave, and whose they were (another person's are never a starting point)
let lastKnown: { userId: number | null; settings: SettingsMe } | null = null;
const known = (userId: number | null): SettingsMe =>
  lastKnown && lastKnown.userId === userId ? lastKnown.settings : (lastKnown = { userId, settings: { ...DEFAULT_SETTINGS, ...rememberedLook(userId) } }).settings;
/** For tests: forget the remembered settings. */
export const resetSettingsCache = () => {
  lastKnown = null;
};
/** Signing out: this person's settings are forgotten, here and on this device. */
export function forgetSettings(userId: number) {
  lastKnown = null;
  try {
    localStorage.removeItem(lookKey(userId));
  } catch {
    // no storage
  }
}

// Meal windows, water buttons and week start (the last known ones until the server answers, or if it can't)
export function useSettingsMe() {
  const userId = useContext(SessionContext)?.user.id ?? null;
  const [s, setS] = useState<SettingsMe>(() => known(userId));
  useEffect(() => {
    let live = true;
    const load = () =>
      api<SettingsMe>("GET", "/api/settings/me")
        .then((r) => {
          const now: SettingsMe = { ...DEFAULT_SETTINGS, ...r };
          lastKnown = { userId, settings: now };
          rememberLook(userId, now);
          if (live) setS(now);
        })
        .catch(() => {});
    load();
    window.addEventListener(SETTINGS_EVENT, load);
    return () => {
      live = false;
      window.removeEventListener(SETTINGS_EVENT, load);
    };
  }, [userId]);
  return s;
}
