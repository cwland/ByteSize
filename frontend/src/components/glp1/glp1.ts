import type { DoseUnit, Glp1View, SideEffect, Site } from "../../types";

// Plain words for the API's GLP-1 values
export const SITE_LABELS: Record<Site, string> = {
  abdomen_left: "Belly, left",
  abdomen_right: "Belly, right",
  thigh_left: "Thigh, left",
  thigh_right: "Thigh, right",
  arm_left: "Arm, left",
  arm_right: "Arm, right",
};
export const EFFECT_LABELS: Record<SideEffect, string> = {
  nausea: "Nausea",
  low_appetite: "Low appetite",
  fatigue: "Fatigue",
  constipation: "Constipation",
  diarrhea: "Diarrhea",
  heartburn: "Heartburn",
  headache: "Headache",
};
export const LEVEL_LABELS = ["Off", "Mild", "Medium", "Strong"] as const; // index = level (0 = not felt)
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// "2026-11-20" -> "Fri, Nov 20" (and ", 2027" when it isn't this year)
export const shotDate = (day: string, now = new Date()) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", ...(Number(day.slice(0, 4)) !== now.getFullYear() ? { year: "numeric" } : {}) });

// The card's one line: "Next shot Thu, Nov 19" before, "Injection day" on the day, "Injection overdue by N days" after
export function statusText(v: Glp1View, now = new Date()): string | null {
  if (v.status === "due") return "Injection day";
  if (v.status === "overdue") return `Injection overdue by ${v.overdueDays} ${v.overdueDays === 1 ? "day" : "days"}`;
  if (v.status === "upcoming" && v.nextDue) return `Next shot ${shotDate(v.nextDue, now)}`;
  return null;
}

// 0.5 -> "0.5 mg", 2.25 -> "2.25 mg"
export const mg = (n: number) => `${Number(n.toFixed(3))} mg`;
// W1: 25 units, 0.5 ml, 2.5 mg
export const doseText = (n: number, unit: DoseUnit = "mg") => `${Number(n.toFixed(3))} ${unit}`;
export const DOSE_UNITS: DoseUnit[] = ["mg", "units", "ml"];
