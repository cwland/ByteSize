import { createContext, useCallback, useContext, useMemo, useState, type ReactNode, useEffect } from "react";

// The day the app is showing (picked on the week strip in the top bar). Days are "YYYY-MM-DD" in the
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

// The 7 days of the week holding `day`, starting on the most recent `weekStart` (0 = Sunday … 6 = Saturday)
// on or before it: weekOf("2026-11-17", 1) -> ["2026-11-16" (Mon), …, "2026-11-22" (Sun)]
export const weekOf = (day: string, weekStart: number) => {
  const back = (new Date(`${day}T00:00:00Z`).getUTCDay() - weekStart + 7) % 7;
  const first = addDays(day, -back);
  return Array.from({ length: 7 }, (_, i) => addDays(first, i));
};

export interface SelectedDay {
  day: string;
  isToday: boolean;
  todayDay: string; // today's date in the user's time zone
  prev: () => void;
  next: () => void;
  today: () => void;
  select: (day: string) => void;
}

const SelectedDayContext = createContext<SelectedDay | null>(null);

export function SelectedDayProvider({ timeZone, children }: { timeZone: string; children: ReactNode }) {
  const [day, setDay] = useState(() => todayIn(timeZone));
  // The local date as last seen. An app left open overnight (a phone in a pocket) must not keep
  // logging to yesterday: when the date changes while you're on "today", follow it; a day you
  // picked on purpose stays put.
  const [currentToday, setCurrentToday] = useState(() => todayIn(timeZone));
  useEffect(() => {
    const check = () => {
      const now = todayIn(timeZone);
      setCurrentToday((was) => {
        if (was !== now) setDay((d) => (d === was ? now : d));
        return now;
      });
    };
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    const timer = window.setInterval(check, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
      window.clearInterval(timer);
    };
  }, [timeZone]);
  const prev = useCallback(() => setDay((d) => addDays(d, -1)), []);
  const next = useCallback(() => setDay((d) => addDays(d, 1)), []);
  const today = useCallback(() => setDay(todayIn(timeZone)), [timeZone]);
  const value = useMemo(
    () => ({ day, isToday: day === currentToday, todayDay: currentToday, prev, next, today, select: setDay }),
    [day, currentToday, prev, next, today],
  );
  return <SelectedDayContext.Provider value={value}>{children}</SelectedDayContext.Provider>;
}

export function useSelectedDay() {
  const s = useContext(SelectedDayContext);
  if (!s) throw new Error("useSelectedDay outside SelectedDayProvider");
  return s;
}
