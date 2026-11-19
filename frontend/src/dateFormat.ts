// How the date at the top of the app is written (§33). A person picks one in Settings › Profile; the server keeps the
// key (backend/src/lib/dateFormats.ts has the same list). The compact header date is the only place that uses it yet.
export const DATE_FORMATS = [
  { key: "weekday-long-month-short" }, // Wednesday, Nov 18 (today's look, and everyone's until they choose)
  { key: "weekday-short-month-short" }, // Wed, Nov 18
  { key: "weekday-long-month-long" }, // Wednesday, November 18
  { key: "mdy-slash" }, // 11/18/2026
  { key: "weekday-long-day-month-short" }, // Wednesday 18 Nov
  { key: "weekday-short-day-month-short" }, // Wed 18 Nov
  { key: "weekday-long-day-month-long" }, // Wednesday 18 November
  { key: "dmy-slash" }, // 18/11/2026
  { key: "dmy-dot" }, // 18.11.2026
  { key: "iso" }, // 2026-11-18
] as const;
export type DateFormat = (typeof DATE_FORMATS)[number]["key"];
export const DEFAULT_DATE_FORMAT: DateFormat = "weekday-long-month-short";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-11-18" written the way `key` says; an unknown or missing key is the default look. */
export function formatDate(day: string, key: string | undefined): string {
  const [y, m, d] = day.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const month = MONTHS[m - 1];
  const short = (s: string) => s.slice(0, 3);
  switch (key) {
    case "weekday-short-month-short":
      return `${short(weekday)}, ${short(month)} ${d}`;
    case "weekday-long-month-long":
      return `${weekday}, ${month} ${d}`;
    case "mdy-slash":
      return `${pad(m)}/${pad(d)}/${y}`;
    case "weekday-long-day-month-short":
      return `${weekday} ${d} ${short(month)}`;
    case "weekday-short-day-month-short":
      return `${short(weekday)} ${d} ${short(month)}`;
    case "weekday-long-day-month-long":
      return `${weekday} ${d} ${month}`;
    case "dmy-slash":
      return `${pad(d)}/${pad(m)}/${y}`;
    case "dmy-dot":
      return `${pad(d)}.${pad(m)}.${y}`;
    case "iso":
      return `${y}-${pad(m)}-${pad(d)}`;
    default:
      return `${weekday}, ${short(month)} ${d}`;
  }
}

const WORDED: Record<string, { month: "short" | "long"; dayFirst: boolean }> = {
  "weekday-long-month-short": { month: "short", dayFirst: false },
  "weekday-short-month-short": { month: "short", dayFirst: false },
  "weekday-long-month-long": { month: "long", dayFirst: false },
  "weekday-long-day-month-short": { month: "short", dayFirst: true },
  "weekday-short-day-month-short": { month: "short", dayFirst: true },
  "weekday-long-day-month-long": { month: "long", dayFirst: true },
};
const NUMERIC = new Set(["mdy-slash", "dmy-slash", "dmy-dot", "iso"]);

// "Apr 5" / "5 April", with ", 2027" / " 2027" when withYear
function worded(day: string, key: string | undefined, withYear: boolean) {
  const [y, m, d] = day.split("-").map(Number);
  const look = WORDED[key ?? ""] ?? WORDED[DEFAULT_DATE_FORMAT];
  const month = look.month === "long" ? MONTHS[m - 1] : MONTHS[m - 1].slice(0, 3);
  if (look.dayFirst) return withYear ? `${d} ${month} ${y}` : `${d} ${month}`;
  return withYear ? `${month} ${d}, ${y}` : `${month} ${d}`;
}
const yearOf = (day: string) => day.slice(0, 4);

/**
 * A day without its weekday, the way `key` writes dates (§40a: the goal date): "Apr 5", "5 April", "05/04/2027".
 * The worded forms add the year when it isn't `today`'s year; the numeric ones always have it.
 */
export function formatDay(day: string, key: string | undefined, today: string): string {
  if (key && NUMERIC.has(key)) return formatDate(day, key);
  return worded(day, key, yearOf(day) !== yearOf(today));
}

/** "Jun 2 – Aug 23, 2027": two days as formatDay writes them, a shared year (not this one) said once, at the end. */
export function formatDayRange(from: string, to: string, key: string | undefined, today: string): string {
  if (!(key && NUMERIC.has(key)) && yearOf(from) === yearOf(to)) return `${worded(from, key, false)} – ${formatDay(to, key, today)}`;
  return `${formatDay(from, key, today)} – ${formatDay(to, key, today)}`;
}
