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
