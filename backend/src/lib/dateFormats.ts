// How the date at the top of the app is written (§33). A person picks one in Settings › Profile; it is stored by key.
// The web app formats with the same keys (frontend/src/dateFormat.ts).
export const DATE_FORMATS = [
  "weekday-long-month-short", // Wednesday, Nov 18 (today's look, and everyone's until they choose)
  "weekday-short-month-short", // Wed, Nov 18
  "weekday-long-month-long", // Wednesday, November 18
  "mdy-slash", // 11/18/2026
  "weekday-long-day-month-short", // Wednesday 18 Nov
  "weekday-short-day-month-short", // Wed 18 Nov
  "weekday-long-day-month-long", // Wednesday 18 November
  "dmy-slash", // 18/11/2026
  "dmy-dot", // 18.11.2026
  "iso", // 2026-11-18
] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];
export const DEFAULT_DATE_FORMAT: DateFormat = "weekday-long-month-short";
