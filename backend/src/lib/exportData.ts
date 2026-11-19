import { readFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { Column, eq, inArray, is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import { zipSync } from "fflate";
import * as schema from "../db/schema.js";
import { activitySteps, goals, glp1Shots, logEntries, recipeItems, sideEffects, uploads, userFoods, userSettings, users, weighIns, workouts } from "../db/schema.js";
import { HttpError } from "./errors.js";
import { MEALS, localDay } from "./days.js";
import { activityDays } from "./activity.js";
import { GOAL_NAMES, type GoalProgress, type GoalType } from "./goals.js";

// "Download my data": one zip with the person's own data as spreadsheets (CSV), everything as JSON, and their photos.
// Only this person's rows and files, and nothing that could sign anyone in.

type Cell = string | number | null | undefined;

/** RFC 4180 CSV. Text that starts with = + - @ (or a tab or line break) gets a leading ' so a spreadsheet shows it instead of running it. */
export function toCsv(rows: Cell[][]): string {
  const cell = (c: Cell): string => {
    if (c === null || c === undefined) return "";
    if (typeof c === "number") return Number.isFinite(c) ? String(c) : "";
    const text = /^[=+\-@\t\r]/.test(c) ? `'${c}` : c;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return rows.map((r) => r.map(cell).join(",") + "\r\n").join("");
}

const round = (n: number, places = 2) => Math.round(n * 10 ** places) / 10 ** places;
const num = (n: number | undefined | null) => (typeof n === "number" && Number.isFinite(n) ? round(n) : null);
const words = (s: string) => {
  const t = s.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
};

// The log's nutrient columns, in the order of the file: the ones people read most first
const NUTRIENT_COLUMNS: [string, string][] = [
  ["calories", "Calories"],
  ["protein_g", "Protein (g)"],
  ["carbs_g", "Carbs (g)"],
  ["fat_g", "Fat (g)"],
  ["fiber_g", "Fiber (g)"],
  ["sugar_g", "Sugar (g)"],
  ["sodium_mg", "Sodium (mg)"],
  ["saturated_fat_g", "Saturated fat (g)"],
  ["added_sugar_g", "Added sugar (g)"],
  ["sugar_alcohol_g", "Sugar alcohol (g)"],
  ["potassium_mg", "Potassium (mg)"],
  ["magnesium_mg", "Magnesium (mg)"],
  ["water_ml", "Water (ml)"],
];

// Never exported, whatever table they are in
const SECRET_COLUMN = /password|hash|secret|token|key_?enc|api_?key/i;
// Tables that hold sign-in material (and forgot-password codes, OAuth sign-ins and invite links on their way) and
// short-lived Undo state (what a combine did, kept a day), not the person's own records
const LEFT_OUT = new Set(["sessions", "passkeys", "login_events", "password_reset_codes", "oauth_flows", "invites", "log_combines"]);

function perPersonTables() {
  return (Object.values(schema) as unknown[])
    .filter((x: unknown): x is PgTable => is(x, PgTable))
    .filter((tbl) => getTableConfig(tbl).columns.some((c) => c.name === "user_id") && !LEFT_OUT.has(getTableConfig(tbl).name));
}

// The row keys (camelCase) of columns that must not leave the server: secrets by name, and the Culury address (it goes out as its own entry)
function hiddenKeys(tbl: PgTable): Set<string> {
  const hidden = new Set<string>();
  for (const [key, col] of Object.entries(tbl)) {
    if (is(col, Column) && (SECRET_COLUMN.test(col.name) || (getTableConfig(tbl).name === "user_settings" && col.name === "culury_url"))) hidden.add(key);
  }
  return hidden;
}

const unitText = (e: { unit: string; servings: { label: string }[]; servingIndex: number }) => (e.unit === "serving" ? `× ${e.servings[e.servingIndex]?.label ?? "serving"}` : e.unit);

export async function buildExport(app: FastifyInstance, userId: number): Promise<{ zip: Buffer; name: string }> {
  // One snapshot of everything, even while the person is logging something
  const data = await app.db.transaction(
    async (tx) => {
      const [me] = await tx.select().from(users).where(eq(users.id, userId));
      if (!me) throw new HttpError(401, "Not logged in");
      const tables: Record<string, unknown[]> = {};
      for (const tbl of perPersonTables()) {
        const rows = (await tx.select().from(tbl as any).where(eq((tbl as any).userId, userId))) as Record<string, unknown>[];
        const hidden = hiddenKeys(tbl);
        tables[getTableConfig(tbl).name] = rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !hidden.has(k))));
      }
      const foodIds = (tables.user_foods as { id: number }[]).map((f) => f.id);
      tables.recipe_items = foodIds.length ? await tx.select().from(recipeItems).where(inArray(recipeItems.recipeId, foodIds)) : [];
      const [settings] = await tx.select({ url: userSettings.culuryUrl }).from(userSettings).where(eq(userSettings.userId, userId));
      return { me, tables, culuryUrl: settings?.url ?? null };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
  const t = data.tables as unknown as {
    log_entries: (typeof logEntries.$inferSelect)[];
    weigh_ins: (typeof weighIns.$inferSelect)[];
    glp1_shots: (typeof glp1Shots.$inferSelect)[];
    side_effects: (typeof sideEffects.$inferSelect)[];
    user_foods: (typeof userFoods.$inferSelect)[];
    uploads: (typeof uploads.$inferSelect)[];
    activity_steps: (typeof activitySteps.$inferSelect)[];
    workouts: (typeof workouts.$inferSelect)[];
    goals: (typeof goals.$inferSelect)[];
  };

  const byDay = <T extends { day: string; id: number }>(rows: T[]) => [...rows].sort((a, b) => a.day.localeCompare(b.day) || a.id - b.id);
  const mealRank = (m: string) => MEALS.indexOf(m as (typeof MEALS)[number]);

  const foodLog = toCsv([
    ["Day", "Meal", "Food", "Brand", "Amount", ...NUTRIENT_COLUMNS.map(([, h]) => h), "AI estimated", "Treat"],
    ...[...t.log_entries]
      .sort((a, b) => a.day.localeCompare(b.day) || mealRank(a.meal) - mealRank(b.meal) || a.id - b.id)
      .map((e) => [e.day, e.meal, e.name, e.brand, `${round(e.quantity * e.fraction)} ${unitText(e)}`, ...NUTRIENT_COLUMNS.map(([k]) => num(e.nutrients[k])), e.aiEstimated ? "Yes" : "No", e.treat ? "Yes" : "No"]),
  ]);
  const weighInsCsv = toCsv([["Day", "Weight (kg)", "Weight (lb)", "Note"], ...byDay(t.weigh_ins).map((w) => [w.day, round(w.weightKg), round(w.weightKg * 2.2046226218, 1), w.note])]);
  const shotsCsv = toCsv([["Day", "Medication", "Dose", "Site", "Note"], ...byDay(t.glp1_shots).map((s) => [s.day, s.medication, `${s.doseMg} mg`, words(s.site), s.note])]);
  const effectRows: Cell[][] = [];
  for (const d of byDay(t.side_effects)) {
    const names = Object.keys(d.effects);
    if (!names.length) effectRows.push([d.day, null, null, d.note]);
    names.forEach((n, i) => effectRows.push([d.day, words(n), d.effects[n], i === 0 ? d.note : null]));
  }
  const sideEffectsCsv = toCsv([["Day", "Effect", "Severity", "Note"], ...effectRows]);
  // Activity (§40b): one line per day with steps or workouts, then every workout
  const from = (s: string) => (s === "health" ? "Health" : "Typed");
  const activeDays = [...new Set([...t.activity_steps.map((r) => r.day), ...t.workouts.map((r) => r.day)])].sort();
  const activityCsv = toCsv([
    ["Day", "Steps", "Steps from", "Workouts", "Active minutes", "Workout calories"],
    ...activeDays.map((d) => activityDays(t.activity_steps, t.workouts, d, d)[0]).map((a) => [a.day, a.steps, a.stepsSource && from(a.stepsSource), a.workouts, a.activeMinutes, a.earned]),
  ]);
  const typeName = (ty: string) => (ty === "hiit" ? "HIIT" : words(ty));
  const workoutsCsv = toCsv([["Day", "Type", "Minutes", "Calories", "From", "Note"], ...byDay(t.workouts).map((w) => [w.day, typeName(w.type), w.minutes, w.calories, from(w.source), w.note])]);
  // Goals (§40c): oldest start first; a finished one's kept result
  const PERIODS = { week: "Each week", month: "Each month", stretch: "Whole stretch" } as const;
  const goalsCsv = toCsv([
    ["Name", "Kind", "Target", "Period", "Start", "End", "Result", "Periods hit"],
    ...[...t.goals]
      .sort((a, b) => a.startDay.localeCompare(b.startDay) || a.id - b.id)
      .map((g) => {
        const r = g.result as GoalProgress | null;
        const kind = GOAL_NAMES[g.type as GoalType] ?? g.type;
        return [
          g.name,
          g.type === "steps" ? `${kind} (${g.measure === "average" ? "average per day" : "total"})` : kind,
          g.type === "weight_by_date" ? `${round(g.target)} kg` : g.target,
          PERIODS[g.period] ?? g.period,
          g.startDay,
          g.endDay,
          r ? (r.state === "completed" ? "Completed" : r.state === "ended" ? "Ended early" : "Missed") : g.endedAt ? "Ended" : "In progress",
          r && r.state !== "ended" ? `${r.hit} of ${r.of}` : null,
        ];
      }),
  ]);
  const myFoodsCsv = toCsv([
    ["Name", "Brand", "Kind", "Serving", "Calories", "Protein (g)", "Carbs (g)", "Fat (g)", "Fiber (g)"],
    ...[...t.user_foods].sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id).map((f) => [f.name, f.brand, f.kind, f.servings[0]?.label, num(f.nutrients.calories), num(f.nutrients.protein_g), num(f.nutrients.carbs_g), num(f.nutrients.fat_g), num(f.nutrients.fiber_g)]),
  ]);

  const exportedAt = app.now();
  const json = {
    app: "bytesize",
    format: 1,
    exportedAt: exportedAt.toISOString(),
    user: { name: data.me.displayName || data.me.username, email: data.me.email, timezone: data.me.timezone, units: data.me.units },
    culury: data.culuryUrl ? { url: data.culuryUrl } : null, // the address only, never the key
    tables: data.tables,
  };

  const enc = new TextEncoder();
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
    "food-log.csv": enc.encode(foodLog),
    "weigh-ins.csv": enc.encode(weighInsCsv),
    "shots.csv": enc.encode(shotsCsv),
    "side-effects.csv": enc.encode(sideEffectsCsv),
    "my-foods.csv": enc.encode(myFoodsCsv),
    "activity.csv": enc.encode(activityCsv),
    "workouts.csv": enc.encode(workoutsCsv),
    "goals.csv": enc.encode(goalsCsv),
    "bytesize-export.json": enc.encode(JSON.stringify(json, null, 2)),
  };
  // Photos (already compressed JPEGs): only this person's own folder; a missing file is skipped
  for (const u of t.uploads) {
    const [owner, file] = u.path.split("/");
    if (owner !== String(userId) || !file || file === "." || file === "..") continue;
    try {
      files[`photos/${path.basename(file)}`] = [new Uint8Array(await readFile(path.join(app.dataDir, "uploads", owner, file))), { level: 0 }];
    } catch {
      // the file is gone; the row still shows in the json
    }
  }

  const slug = (data.me.displayName || data.me.username).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "me";
  const day = localDay(data.me.timezone, exportedAt);
  return { zip: Buffer.from(zipSync(files, { mtime: exportedAt })), name: `bytesize-${slug}-${day}.zip` };
}
