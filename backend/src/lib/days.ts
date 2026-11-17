// Days are the user's local dates (YYYY-MM-DD in users.timezone), never UTC dates.

/** The local date in `timeZone` at the moment `now`, as YYYY-MM-DD. */
export function localDay(timeZone: string, now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
