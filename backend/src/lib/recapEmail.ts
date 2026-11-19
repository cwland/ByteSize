// §45: the weekly recap as an email (HTML and plain text). Pure: lib/insightsRun.ts sends it. Every value put in the
// HTML is escaped; the plain text carries the same words. Nothing here names an AI service.
import { escapeHtml } from "./mail.js";
import type { WeekNumbers } from "./insights.js";

export type RecapContent = { summary?: unknown; wentWell?: unknown; slipped?: unknown; tryNext?: unknown; numbers?: Partial<WeekNumbers> };
export type RecapEmailInput = { name: string; from: string; to: string; dateFormat: string; content: RecapContent; link: string | null };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WORDED: Record<string, { long: boolean; dayFirst: boolean }> = {
  "weekday-long-month-short": { long: false, dayFirst: false },
  "weekday-short-month-short": { long: false, dayFirst: false },
  "weekday-long-month-long": { long: true, dayFirst: false },
  "weekday-long-day-month-short": { long: false, dayFirst: true },
  "weekday-short-day-month-short": { long: false, dayFirst: true },
  "weekday-long-day-month-long": { long: true, dayFirst: true },
};
const pad = (n: number) => String(n).padStart(2, "0");
const parts = (day: string) => day.split("-").map(Number) as [number, number, number];

/** One day written the way the person's date format writes it, without its weekday ("Nov 8", "8 Nov", "08.11.2026"). */
export function dayText(day: string, key: string, withYear = false): string {
  const [y, m, d] = parts(day);
  switch (key) {
    case "mdy-slash":
      return `${pad(m)}/${pad(d)}/${y}`;
    case "dmy-slash":
      return `${pad(d)}/${pad(m)}/${y}`;
    case "dmy-dot":
      return `${pad(d)}.${pad(m)}.${y}`;
    case "iso":
      return `${y}-${pad(m)}-${pad(d)}`;
  }
  const look = WORDED[key] ?? WORDED["weekday-long-month-short"];
  const month = look.long ? MONTHS[m - 1] : MONTHS[m - 1].slice(0, 3);
  if (look.dayFirst) return `${d} ${month}${withYear ? ` ${y}` : ""}`;
  return `${month} ${d}${withYear ? `, ${y}` : ""}`;
}

/** A week in the person's date format: "Nov 8–14", "8–14 Nov", "Nov 29 – Dec 5", "2026-11-08–2026-11-14". */
export function weekText(from: string, to: string, key: string): string {
  const numeric = ["mdy-slash", "dmy-slash", "dmy-dot", "iso"].includes(key);
  if (numeric) return `${dayText(from, key)}–${dayText(to, key)}`;
  const [fy, fm] = parts(from);
  const [ty, tm, td] = parts(to);
  if (fy !== ty) return `${dayText(from, key, true)} – ${dayText(to, key, true)}`;
  if (fm !== tm) return `${dayText(from, key)} – ${dayText(to, key)}`;
  const dayFirst = WORDED[key]?.dayFirst ?? false;
  const f = dayText(from, key);
  return dayFirst ? `${f.split(" ")[0]}–${td} ${f.split(" ")[1]}` : `${f}–${td}`;
}

export const recapSubject = (from: string, to: string, key: string) => `Your ByteSize week: ${weekText(from, to, key)}`;

export const FOOTER = "You're getting this because you turned on weekly recap emails in ByteSize. Turn them off in Insights.";

const n0 = (n: number) => Math.round(n).toLocaleString("en-US");
const n1 = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 1 });
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : []);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** The app's numbers as label/value lines (those the week has). */
export function numberLines(nums: Partial<WeekNumbers> | undefined, days: number): [string, string][] {
  if (!nums) return [];
  const out: [string, string][] = [];
  if (typeof nums.daysLogged === "number") out.push(["Days logged", `${nums.daysLogged} of ${days}`]);
  if (typeof nums.daysInRange === "number") out.push(["Days in range", `${nums.daysInRange} of ${days}`]);
  const plan = nums.plan;
  if (typeof nums.avgCalories === "number") out.push(["Average calories", `${n0(nums.avgCalories)}${plan ? ` (plan ${n0(plan.calories.min)}–${n0(plan.calories.max)})` : ""}`]);
  if (typeof nums.avgProtein === "number") out.push(["Average protein", `${n1(nums.avgProtein)} g${plan ? ` (plan at least ${n1(plan.proteinMin)} g)` : ""}`]);
  if (plan && typeof nums.waterDays === "number") out.push(["Water on plan", `${nums.waterDays} of ${days} days`]);
  if (nums.steps?.average != null) out.push(["Steps", `${n0(nums.steps.average)} a day (${nums.steps.days} day${nums.steps.days === 1 ? "" : "s"} with steps)`]);
  if (nums.workouts && nums.workouts.count > 0) out.push(["Workouts", `${nums.workouts.count} (${nums.workouts.minutes} min)`]);
  if (typeof nums.trendChange === "number") {
    const unit = nums.weightUnit ?? "lb";
    out.push(["Trend weight", nums.trendChange === 0 ? "no change" : `${nums.trendChange < 0 ? "down" : "up"} ${n1(Math.abs(nums.trendChange))} ${unit}`]);
  }
  return out;
}

export function buildRecapEmail(i: RecapEmailInput): { subject: string; text: string; html: string } {
  const [fy, fm, fd] = parts(i.from);
  const [ty, tm, td] = parts(i.to);
  const days = Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000) + 1;
  const subject = recapSubject(i.from, i.to, i.dateFormat);
  const week = weekText(i.from, i.to, i.dateFormat);
  const summary = str(i.content.summary);
  const well = strings(i.content.wentWell);
  const slipped = strings(i.content.slipped);
  const next = str(i.content.tryNext);
  const lines = numberLines(i.content.numbers, days);

  const text = [
    `Hi ${i.name},`,
    `Your ByteSize week: ${week}`,
    summary,
    well.length ? `What went well\n${well.map((w) => `- ${w}`).join("\n")}` : "",
    slipped.length ? `What slipped\n${slipped.map((w) => `- ${w}`).join("\n")}` : "",
    next ? `One thing to try\n${next}` : "",
    lines.length ? `The numbers\n${lines.map(([k, v]) => `${k}: ${v}`).join("\n")}` : "",
    i.link ? `Open Insights: ${i.link}` : "",
    FOOTER,
  ]
    .filter(Boolean)
    .join("\n\n");

  const e = escapeHtml;
  const h2 = (t: string) => `<h3 style="margin:20px 0 6px;font-size:15px;color:#3f7d3a">${e(t)}</h3>`;
  const list = (items: string[]) => `<ul style="margin:0;padding-left:20px">${items.map((x) => `<li>${e(x)}</li>`).join("")}</ul>`;
  const html = [
    `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:560px;margin:0 auto;color:#222;line-height:1.5">`,
    `<p>Hi ${e(i.name)},</p>`,
    `<h2 style="margin:0 0 8px">${e(`Your ByteSize week: ${week}`)}</h2>`,
    summary ? `<p>${e(summary)}</p>` : "",
    well.length ? h2("What went well") + list(well) : "",
    slipped.length ? h2("What slipped") + list(slipped) : "",
    next ? h2("One thing to try") + `<p style="margin:0">${e(next)}</p>` : "",
    lines.length ? h2("The numbers") + `<table style="border-collapse:collapse">${lines.map(([k, v]) => `<tr><td style="padding:2px 16px 2px 0;color:#666">${e(k)}</td><td style="padding:2px 0"><b>${e(v)}</b></td></tr>`).join("")}</table>` : "",
    i.link ? `<p style="margin:24px 0"><a href="${e(i.link)}" style="display:inline-block;padding:10px 20px;border-radius:999px;background:#3f7d3a;color:#fff;text-decoration:none;font-weight:bold">Open Insights</a></p>` : "",
    `<p style="margin-top:24px;font-size:12px;color:#777">${e(FOOTER)}</p>`,
    `</div>`,
  ]
    .filter(Boolean)
    .join("");
  return { subject, text, html };
}
