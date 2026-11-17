import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

// The day the app is showing (the ‹ date › switcher in the top bar). Days are "YYYY-MM-DD" in the
// user's time zone; "today" starts and ends at midnight there.

export const todayIn = (timeZone: string, now = new Date()) => {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  }
};

// "2026-11-16" + 1 -> "2026-11-17" (calendar math in UTC, so no daylight-saving surprises)
export const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// "2026-11-16" -> "Mon, Nov 16"
export const dayLabel = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });

export interface SelectedDay {
  day: string;
  isToday: boolean;
  prev: () => void;
  next: () => void;
  today: () => void;
}

const SelectedDayContext = createContext<SelectedDay | null>(null);

export function SelectedDayProvider({ timeZone, children }: { timeZone: string; children: ReactNode }) {
  const [day, setDay] = useState(() => todayIn(timeZone));
  const prev = useCallback(() => setDay((d) => addDays(d, -1)), []);
  const next = useCallback(() => setDay((d) => addDays(d, 1)), []);
  const today = useCallback(() => setDay(todayIn(timeZone)), [timeZone]);
  const value = useMemo(() => ({ day, isToday: day === todayIn(timeZone), prev, next, today }), [day, timeZone, prev, next, today]);
  return <SelectedDayContext.Provider value={value}>{children}</SelectedDayContext.Provider>;
}

export function useSelectedDay() {
  const s = useContext(SelectedDayContext);
  if (!s) throw new Error("useSelectedDay outside SelectedDayProvider");
  return s;
}
