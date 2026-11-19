// "Nov 16, 2026, 3:04 PM" in this browser's language
export const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Never");

// Calendar days (YYYY-MM-DD) for people: "Nov 8", "Nov 8–14", "Oct 29–Nov 4"; a year only when asked for
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const parts = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return { y, m: MONTHS[m - 1], d };
};
export const shortDay = (day: string, withYear = false) => {
  const p = parts(day);
  return withYear ? `${p.m} ${p.d}, ${p.y}` : `${p.m} ${p.d}`;
};
export const dayRange = (from: string, to: string, withYear = false) => {
  const a = parts(from);
  const b = parts(to);
  const end = a.m === b.m && a.y === b.y ? `${b.d}` : `${b.m} ${b.d}`;
  return `${a.m} ${a.d}–${end}${withYear ? `, ${b.y}` : ""}`;
};
