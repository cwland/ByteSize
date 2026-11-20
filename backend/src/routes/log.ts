import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, asc, desc, eq, gte, inArray, isNotNull, lt, lte, ne, or, sql } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { foodCache, logCombines, logEntries, logTrash, userFoods, userSettings, users } from "../db/schema.js";
import { HttpError, badRequest } from "../lib/errors.js";
import { requireUser } from "../lib/guards.js";
import { addDays, DAY, localDay, mealFor, MEALS, streak, suggestedFor, todayFor, userTimezone, type Meal } from "../lib/days.js";
import { cleanNutrients, loadFood, toResult, type FoodResult } from "../lib/foods.js";
import { wholeKeptFood } from "../lib/restaurants/index.js";
import { loadCuluryRecipe } from "../lib/culury.js";
import { itemList, portionFields, quickMealParts } from "../lib/recipes.js";
import { amountFactor, combineAmounts, scaleNutrients, sumNutrients, UnitError, type Nutrients, type Serving, type Unit } from "../lib/nutrients.js";
import { DEFAULT_MEAL_WINDOWS } from "./settings-me.js";
import { signImageUrl, unsignImageUrl } from "../lib/photos.js";
import { entryIcon } from "../lib/foodIcons.js";
import { targetsOn } from "./body-plans.js";
import { activityOn } from "./activity.js";
import { calorieWeeks } from "../lib/calorieDays.js";

// The food log: entries keep a snapshot of the food (per-serving nutrients and servings), so editing
// the food later never changes what was logged. Who is asking comes only from the login.

type Row = typeof logEntries.$inferSelect;
export type LogEntry = {
  id: number;
  day: string;
  meal: Meal;
  name: string;
  brand: string | null;
  icon: string;
  imageUrl: string | null;
  servingIndex: number;
  unit: Unit;
  quantity: number;
  fraction: number;
  servings: Serving[];
  nutrients: Nutrients;
  aiEstimated: boolean;
  source: string;
  sourceRef: string | null;
  treat: boolean; // §40b: paid from the weekly workout-calorie bank on purpose
};
type Portion = { servingIndex: number; unit: Unit; quantity: number; fraction: number };

const NOT_FOUND = "Entry not found";
const TOO_LATE = "That's too late to undo";
/** How long a deleted entry can be put back (iOS app's Undo) */
const TRASH_MS = 10 * 60 * 1000;
const CHANGED_SINCE = "This entry changed since — undo isn't possible";
const QUICK_MEAL_HERE = "Log a quick meal with its own items";
const RECENT_LIMIT = 30;
const FREQUENT_LIMIT = 20;
const FREQUENT_DAYS = 60;
// Water is logged as millilitres of a 1 ml "serving", so its amount can be edited like any food
const WATER_SERVINGS: Serving[] = [{ label: "1 ml", ml: 1 }];

const id = z.number().int().positive().max(2147483647);
const idParam = z.object({ id: z.coerce.number().int().positive().max(2147483647) });
const foodBody = z.object({
  day: DAY.optional(),
  meal: z.enum(MEALS).optional(),
  food: z.object({ kind: z.enum(["cache", "user_food", "culury"]), id }),
  servingIndex: portionFields.servingIndex.default(0),
  unit: portionFields.unit,
  quantity: portionFields.quantity,
  fraction: portionFields.fraction.default(1),
  // Only for a Culury recipe without nutrition: an AI estimate per serving (logged as AI-estimated)
  nutrients: z.record(z.string(), z.number().nonnegative().max(1000000)).optional(),
  // §40b: a treat, paid from the weekly bank (never combined with the same food logged as a normal entry)
  treat: z.boolean().default(false),
});
const ESTIMATE_ONLY = "An estimate can only be sent for a Culury recipe without nutrition";
const mealLogBody = z.object({ day: DAY.optional(), meal: z.enum(MEALS).optional(), foodId: id, items: itemList.optional() });
const waterBody = z.object({
  day: DAY.optional(),
  meal: z.literal("supplements", { error: "Water goes with supplements" }).default("supplements"),
  water_ml: z.number().positive("Enter an amount above 0").max(10000, "That's more water than one entry can hold"),
});
const patchBody = z.object({ ...portionFields, treat: z.boolean() }).partial();
const mealQuery = z.object({ meal: z.enum(MEALS, { error: "Choose a meal" }).optional() });
const MAX_LOGGED_DAYS = 62;
const loggedQuery = z.object({ from: DAY, to: DAY });
const moveBody = z.object({ ids: z.array(id).min(1, "Choose at least one entry").max(500), day: DAY, meal: z.enum(MEALS), copy: z.boolean().default(false) });

export function toEntry(r: Row): LogEntry {
  return {
    id: r.id,
    day: r.day,
    meal: r.meal as Meal,
    name: r.name,
    brand: r.brand,
    icon: entryIcon(r.name, r.icon),
    imageUrl: signImageUrl(r.imageUrl), // our photos signed on the way out (stored plain)
    servingIndex: r.servingIndex,
    unit: r.unit as Unit,
    quantity: r.quantity,
    fraction: r.fraction,
    servings: r.servings as Serving[],
    nutrients: r.nutrients as Nutrients,
    aiEstimated: r.aiEstimated,
    source: r.source,
    sourceRef: r.sourceRef,
    treat: r.treat,
  };
}

/** Nutrients for a portion of a snapshot; a unit the food can't be measured in is a 400. */
function portionNutrients(per: Nutrients, servings: Serving[], p: Portion): Nutrients {
  try {
    return scaleNutrients(per, amountFactor(servings, p.servingIndex, p.unit, p.quantity) * p.fraction);
  } catch (e) {
    if (e instanceof UnitError) throw badRequest(e.message);
    throw e;
  }
}

const isWater = (r: Row) => r.source === "water";

/** GET /api/day/:date: entries, totals (unknown counted for foods only), per-meal totals with suggestions, targets, streak. */
async function dayView(app: FastifyInstance, userId: number, day: string) {
  const rows = await app.db
    .select()
    .from(logEntries)
    .where(and(eq(logEntries.userId, userId), eq(logEntries.day, day)))
    .orderBy(asc(logEntries.createdAt), asc(logEntries.id));
  const entries = rows.map(toEntry);
  // The plan's targets, with the day's workout calories counted in (§40b: "add" grows the calorie range)
  const [planTargets, activity, weeks] = await Promise.all([targetsOn(app.db, userId, day), activityOn(app.db, userId, day), calorieWeeks(app.db, userId, day, day)]);
  const week = weeks[weeks.length - 1];
  const me = week.days[week.days.length - 1];
  const targets = planTargets && me.range ? { ...planTargets, calories: me.range } : planTargets;
  // Sums over every entry; "unknown" counts only foods (a water entry isn't missing fiber)
  const sums = sumNutrients(entries.map((e) => e.nutrients));
  const unknownCount = sumNutrients(rows.filter((r) => !isWater(r)).map((r) => r.nutrients as Nutrients)).unknownCount;
  const meals = Object.fromEntries(
    MEALS.map((m) => {
      const s = sumNutrients(entries.filter((e) => e.meal === m).map((e) => e.nutrients));
      return [m, { calories: s.calories ?? 0, protein_g: s.protein_g ?? 0, carbs_g: s.carbs_g ?? 0, fat_g: s.fat_g ?? 0, fiber_g: s.fiber_g ?? 0, suggested: suggestedFor(m, targets?.calories) }];
    })
  );
  const workoutCalories = {
    mode: me.mode,
    countPct: me.settings.countPct,
    weeklyCap: me.settings.weeklyCap,
    earned: activity.earned,
    added: me.added,
    planCalories: planTargets?.calories ?? null,
    status: me.status, // the day's calories against its range; a bank-covered day is "in"
    bank:
      me.mode === "bank"
        ? {
            weekStart: week.weekStart,
            balance: me.balance,
            deposited: week.deposited,
            spent: week.spent,
            weeklyCap: me.settings.weeklyCap,
            days: week.days.map((d) => ({ day: d.day, deposit: d.deposit, spent: d.treatSpent + d.covered })),
            thisDay: { overBy: me.overBy, covered: me.covered, treatSpent: me.treatSpent },
          }
        : null,
  };
  return { day, entries, totals: { ...sums, unknownCount }, meals, targets, exercise: { calories: activity.earned }, activity, workoutCalories, streak: await streak(app.db, userId, await todayFor(app, userId)) };
}

/**
 * The newest entry for each food the person logged (water left out), newest first; only that meal's
 * entries when given. Entries logged from a quick meal count as that meal (ref quick:<id>), once per
 * logging (they share their created_at), not as their items.
 */
function lastPerFood(db: Db, userId: number, opts: { since?: string; meal?: Meal } = {}) {
  const { since, meal } = opts;
  const where = and(
    eq(logEntries.userId, userId),
    or(isNotNull(logEntries.sourceRef), isNotNull(logEntries.groupRef)),
    since ? gte(logEntries.day, since) : undefined,
    meal ? eq(logEntries.meal, meal) : undefined
  );
  const key = sql<string>`coalesce(${logEntries.groupRef}, ${logEntries.sourceRef})`;
  const uses = sql<number>`count(distinct case when ${logEntries.groupRef} is null then ${logEntries.id}::text else ${logEntries.createdAt}::text end)::int`;
  const counts = db
    .select({ ref: key.as("ref"), uses: uses.as("uses"), lastId: sql<number>`max(${logEntries.id})`.as("last_id") })
    .from(logEntries)
    .where(where)
    .groupBy(key)
    .as("c");
  return db
    .select({ ref: counts.ref, uses: counts.uses, entry: logEntries })
    .from(counts)
    .innerJoin(logEntries, eq(logEntries.id, counts.lastId));
}

const ONE_MEAL: Portion = { servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 };

/** Resolves source refs to the current foods (archived or missing ones are skipped), each with its last portion; quick:<id> = that quick meal, 1 meal. */
async function resolveFoods(db: Db, userId: number, picks: { ref: string | null; entry: Row }[]) {
  const ids = (kind: string) => picks.map((p) => p.ref!.split(":")).filter(([k]) => k === kind).map(([, v]) => Number(v));
  const cacheIds = ids("cache");
  const userIds = [...ids("user_food"), ...ids("quick")];
  const cache = cacheIds.length ? await db.select().from(foodCache).where(inArray(foodCache.id, cacheIds)) : [];
  const mine = userIds.length
    ? await db
        .select()
        .from(userFoods)
        .where(and(inArray(userFoods.id, userIds), eq(userFoods.userId, userId), eq(userFoods.archived, false)))
    : [];
  // The person's own corrections of those database foods: a corrected food always shows as the correction
  const overrides = cacheIds.length
    ? await db
        .select()
        .from(userFoods)
        .where(and(eq(userFoods.userId, userId), eq(userFoods.archived, false), inArray(userFoods.baseCacheId, cacheIds)))
    : [];
  const overrideOf = new Map(overrides.map((r) => [r.baseCacheId!, toResult(r, "user_food")] as const));
  const found = new Map<string, FoodResult>([
    ...cache.map((r) => [`cache:${r.id}`, overrideOf.get(r.id) ?? toResult(r, "cache")] as const),
    ...mine.map((r) => [`user_food:${r.id}`, toResult(r, "user_food")] as const),
    ...mine.filter((r) => r.kind === "quick_meal").map((r) => [`quick:${r.id}`, toResult(r, "user_food")] as const),
    // Culury recipes are never copied: they come back as last logged (the entry's snapshot)
    ...picks.filter((p) => p.ref!.startsWith("culury:")).map((p) => [p.ref!, culurySnapshot(p.entry)] as const),
  ]);
  // In the order given (newest or most used first); a food reached twice (itself and via its database
  // original) appears once, at its first place
  const seen = new Set<string>();
  return picks.flatMap(({ ref, entry }) => {
    const food = found.get(ref!);
    if (!food || seen.has(`${food.kind}:${food.id}`)) return [];
    seen.add(`${food.kind}:${food.id}`);
    const last = ref!.startsWith("quick:") ? ONE_MEAL : { servingIndex: entry.servingIndex, unit: entry.unit as Unit, quantity: entry.quantity, fraction: entry.fraction };
    return [{ ...food, last }];
  });
}

/** A logged Culury recipe as a food, from the entry's own snapshot. */
function culurySnapshot(r: Row): FoodResult {
  const nutrients = r.perServing as Nutrients;
  return {
    kind: "culury",
    id: Number(r.sourceRef!.slice("culury:".length)),
    name: r.name,
    brand: r.brand,
    icon: entryIcon(r.name, r.icon),
    barcode: null,
    servings: r.servings as Serving[],
    nutrients,
    aiFields: r.aiEstimated ? Object.keys(nutrients) : [],
    imageUrl: null,
    override: false,
    source: "culury",
    foodKind: "recipe",
  };
}

/**
 * This person's newest snapshot of a Culury recipe, as the food to log when Culury can't be asked. A recipe
 * Culury says it doesn't have (404) isn't revived; never logged: Culury's own error stands.
 */
async function lastCuluryLogged(db: Db, userId: number, recipeId: number, err: unknown) {
  if (err instanceof HttpError && err.statusCode === 404) throw err;
  const [last] = await db
    .select()
    .from(logEntries)
    .where(and(eq(logEntries.userId, userId), eq(logEntries.sourceRef, `culury:${recipeId}`)))
    .orderBy(desc(logEntries.id))
    .limit(1);
  if (!last) throw err;
  const food = culurySnapshot(last);
  return { food, hasNutrition: Object.keys(food.nutrients).length > 0 }; // an AI-estimated snapshot stays flagged
}

/** The meal for this time of day, by the person's meal windows. */
async function mealNow(db: Db, userId: number, timezone: string, now: Date): Promise<Meal> {
  const [s] = await db.select({ mealWindows: userSettings.mealWindows }).from(userSettings).where(eq(userSettings.userId, userId));
  return mealFor(timezone, now, s?.mealWindows ?? DEFAULT_MEAL_WINDOWS);
}

// ---------- the same food added twice combines (§28) ----------

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** What a food being added is, for telling whether a meal already has it. */
type FoodSnapshot = { source: string; sourceRef: string | null; name: string; perServing: Nutrients; servings: Serving[]; treat?: boolean };
/**
 * What a combine did: its id (Undo: POST /api/log/combines/:id/undo), the grown entry, its amount before, the
 * amount added, and where Undo puts the addition back. The server keeps the same (log_combines), so Undo
 * splits back exactly what was added, whatever has changed in the food since.
 */
export type Combined = { id: number; entry: LogEntry; before: Portion; added: Portion; splitTo: { day: string; meal: Meal } };
// A combine can be undone for this long (the note offering Undo shows for seconds)
const COMBINE_KEPT_MS = 24 * 60 * 60 * 1000;
/** Test hooks: undoLocked runs once Undo holds its locks (tests hold it there to show who waits). */
export const logHooks = { undoLocked: async (): Promise<void> => {} };

const portionOf = (r: Row): Portion => ({ servingIndex: r.servingIndex, unit: r.unit as Unit, quantity: r.quantity, fraction: r.fraction });
const snapshotOf = (r: Row): FoodSnapshot => ({ source: r.source, sourceRef: r.sourceRef, name: r.name, perServing: r.perServing as Nutrients, servings: r.servings as Serving[], treat: r.treat });
// JSON with object keys in order, so { a, b } and { b, a } compare equal
const stable = (v: unknown) => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));

/**
 * The same food: the same reference with the same nutrients per serving (a food changed since, or a recipe
 * now with an estimate, stays its own entry so nothing is computed from numbers it no longer has); for foods
 * without a reference, the same name and the same nutrients per unit. Water never.
 */
function sameFood(food: FoodSnapshot, r: Row): boolean {
  if (food.source === "water" || isWater(r)) return false;
  // A treat stays its own entry (the bank shows it), and nothing grows into one
  if (food.treat || r.treat) return false;
  if (stable(food.perServing) !== stable(r.perServing)) return false;
  if (food.sourceRef || r.sourceRef) return food.sourceRef === r.sourceRef;
  return food.name === r.name && stable(food.servings) === stable(r.servings);
}

/**
 * Adds to a day and meal happen one at a time per person, day and meal (a transaction-long advisory lock), so
 * two adds of the same food racing in never both see an empty meal and both add a row. Every path that may
 * combine into a meal takes this first, before any row lock.
 */
async function lockMeal(tx: Tx, userId: number, at: { day: string; meal: Meal }) {
  await tx.execute(sql`select pg_advisory_xact_lock(${userId}::int, hashtext(${`combine:${at.day}:${at.meal}`}))`);
}

/** The ids' rows and every row of that day and meal, locked in id order (so two moves can't deadlock). */
async function lockRows(tx: Tx, userId: number, ids: number[], at: { day: string; meal: Meal }) {
  return tx
    .select()
    .from(logEntries)
    .where(and(eq(logEntries.userId, userId), or(ids.length ? inArray(logEntries.id, ids) : undefined, and(eq(logEntries.day, at.day), eq(logEntries.meal, at.meal)))))
    .orderBy(asc(logEntries.id))
    .for("update");
}

/**
 * Adds `added` of `food` to the first entry of that day and meal holding the same food (never one of `skip`),
 * when the two amounts can meet; nutrients are recomputed from that entry's own snapshot (unknown stays unknown).
 * What it did is recorded for Undo. null: nothing to combine with, so the caller adds a new entry.
 * The caller holds the meal's lock (lockMeal) and the rows' locks (lockRows).
 */
async function combineInto(tx: Tx, userId: number, at: { day: string; meal: Meal }, food: FoodSnapshot, added: Portion, splitTo: { day: string; meal: Meal }, now: Date, skip: number[] = []) {
  const rows = await tx
    .select()
    .from(logEntries)
    .where(and(eq(logEntries.userId, userId), eq(logEntries.day, at.day), eq(logEntries.meal, at.meal)))
    .orderBy(asc(logEntries.createdAt), asc(logEntries.id));
  for (const r of rows) {
    if (skip.includes(r.id) || !sameFood(food, r)) continue;
    const before = portionOf(r);
    const amount = combineAmounts(r.servings as Serving[], before, food.servings, added);
    if (!amount) continue;
    const nutrients = portionNutrients(r.perServing as Nutrients, r.servings as Serving[], amount);
    const [row] = await tx.update(logEntries).set({ ...amount, nutrients, updatedAt: now }).where(eq(logEntries.id, r.id)).returning();
    const addedPortion = { servingIndex: added.servingIndex, unit: added.unit, quantity: added.quantity, fraction: added.fraction };
    await tx.delete(logCombines).where(and(eq(logCombines.userId, userId), lt(logCombines.createdAt, new Date(now.getTime() - COMBINE_KEPT_MS))));
    const [record] = await tx
      .insert(logCombines)
      .values({ userId, entryId: r.id, before, after: portionOf(row), added: addedPortion, addedServings: food.servings, splitDay: splitTo.day, splitMeal: splitTo.meal, createdAt: now })
      .returning({ id: logCombines.id });
    const combined: Combined = { id: record.id, entry: toEntry(row), before, added: addedPortion, splitTo };
    return { row, combined };
  }
  return null;
}

/** The same amount (the same serving and unit, and the same quantity × fraction). */
const samePortion = (a: Portion, b: Portion) => a.unit === b.unit && a.servingIndex === b.servingIndex && Math.abs(a.quantity * a.fraction - b.quantity * b.fraction) < 1e-6;

async function ownEntry(db: Db, userId: number, entryId: number): Promise<Row> {
  const [row] = await db
    .select()
    .from(logEntries)
    .where(and(eq(logEntries.id, entryId), eq(logEntries.userId, userId)));
  if (!row) throw new HttpError(404, NOT_FOUND);
  return row;
}

export default async function foodLogRoutes(app: FastifyInstance) {
  const { db } = app;

  // "today" = the person's local date (users.timezone) right now
  app.get("/api/day/:date", async (req) => {
    const userId = requireUser(req);
    const { date } = req.params as { date: string };
    const day = date === "today" ? await todayFor(app, userId) : DAY.parse(date);
    return dayView(app, userId, day);
  });

  // Days in a range with at least one food entry (water doesn't count): the dots under the week strip
  app.get("/api/days/logged", async (req) => {
    const userId = requireUser(req);
    const { from, to } = loggedQuery.parse(req.query ?? {});
    if (from > to || addDays(from, MAX_LOGGED_DAYS - 1) < to) throw badRequest(`Choose up to ${MAX_LOGGED_DAYS} days`);
    const rows = await db
      .selectDistinct({ day: logEntries.day })
      .from(logEntries)
      .where(and(eq(logEntries.userId, userId), gte(logEntries.day, from), lte(logEntries.day, to), ne(logEntries.source, "water")))
      .orderBy(asc(logEntries.day));
    return { days: rows.map((r) => r.day) };
  });

  app.post("/api/log", async (req) => {
    const userId = requireUser(req);
    const raw = (req.body ?? {}) as Record<string, unknown>;
    const now = app.now();
    const timezone = await userTimezone(db, userId);

    if ("water_ml" in raw) {
      const b = waterBody.parse(raw);
      const [row] = await db
        .insert(logEntries)
        .values({
          userId,
          day: b.day ?? localDay(timezone, now),
          meal: b.meal,
          name: "Water",
          brand: null,
          icon: "💧",
          source: "water",
          sourceRef: null,
          servingIndex: 0,
          unit: "ml",
          quantity: b.water_ml,
          fraction: 1,
          perServing: { water_ml: 1 },
          servings: WATER_SERVINGS,
          nutrients: scaleNutrients({ water_ml: 1 }, b.water_ml),
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      return { entry: toEntry(row) };
    }

    const b = foodBody.parse(raw);
    let food: FoodResult;
    if (b.food.kind === "culury") {
      // Read live from the caller's own Culury, then snapshotted like any food; when Culury can't be asked
      // (down, or the link removed), the caller's own last snapshot of it is used
      const recipe = await loadCuluryRecipe(app, userId, b.food.id).catch((err) => lastCuluryLogged(db, userId, b.food.id, err));
      food = recipe.food;
      if (b.nutrients) {
        if (recipe.hasNutrition) throw badRequest(ESTIMATE_ONLY);
        const estimate = cleanNutrients(b.nutrients);
        food = { ...food, nutrients: estimate, aiFields: Object.keys(estimate) };
      }
    } else {
      if (b.nutrients) throw badRequest(ESTIMATE_ONLY);
      // A kept food is used now; a FatSecret search summary is fetched whole before it is snapshotted
      food = b.food.kind === "cache" ? await wholeKeptFood(app, userId, b.food.id) : await loadFood(db, userId, { kind: b.food.kind, id: b.food.id });
    }
    // A quick meal is logged as one entry per item (POST /api/log/meal), never as one opaque entry
    if (food.foodKind === "quick_meal") throw badRequest(QUICK_MEAL_HERE);
    const nutrients = portionNutrients(food.nutrients, food.servings, b);
    const meal = b.meal ?? (await mealNow(db, userId, timezone, now));
    const day = b.day ?? localDay(timezone, now);
    const sourceRef = `${food.kind}:${food.id}`;
    const { row, combined } = await db.transaction(async (tx) => {
      // Already in this meal: that entry grows instead
      await lockMeal(tx, userId, { day, meal });
      await lockRows(tx, userId, [], { day, meal });
      const grown = await combineInto(tx, userId, { day, meal }, { source: food.kind, sourceRef, name: food.name, perServing: food.nutrients, servings: food.servings, treat: b.treat }, b, { day, meal }, now);
      const [inserted] = grown
        ? [grown.row]
        : await tx
          .insert(logEntries)
          .values({
            userId,
            day,
            meal,
            name: food.name,
            brand: food.brand,
            icon: food.icon,
            imageUrl: unsignImageUrl(food.imageUrl),
            source: food.kind,
            sourceRef,
            servingIndex: b.servingIndex,
            unit: b.unit,
            quantity: b.quantity,
            fraction: b.fraction,
            perServing: food.nutrients,
            servings: food.servings,
            nutrients,
            aiEstimated: food.aiFields.length > 0,
            treat: b.treat,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
      if (food.kind === "user_food") {
        await tx
          .update(userFoods)
          .set({ useCount: sql`${userFoods.useCount} + 1`, lastUsedAt: now })
          .where(and(eq(userFoods.id, food.id), eq(userFoods.userId, userId)));
      }
      return { row: inserted, combined: grown?.combined };
    });
    return { entry: toEntry(row), ...(combined ? { combined } : {}) };
  });

  // A quick meal: one entry per item (or per adjusted item), each with its own snapshot, marked quick:<id>.
  // An item whose food is archived or gone is logged from the meal's snapshot of it.
  app.post("/api/log/meal", async (req) => {
    const userId = requireUser(req);
    const b = mealLogBody.parse(req.body ?? {});
    const now = app.now();
    const timezone = await userTimezone(db, userId);
    const { meal: quick, parts } = await quickMealParts(db, userId, b.foodId, b.items);
    const day = b.day ?? localDay(timezone, now);
    const meal = b.meal ?? (await mealNow(db, userId, timezone, now));
    const { rows, combined } = await db.transaction(async (tx) => {
      // Item by item: one already in this meal grows that entry; the rest are new entries
      // (never into an entry this meal just added: the same food twice in a meal stays as the meal has it)
      await lockMeal(tx, userId, { day, meal });
      await lockRows(tx, userId, [], { day, meal });
      const rows: Row[] = [];
      const combined: Combined[] = [];
      const added: number[] = [];
      for (const { food, portion, nutrients } of parts) {
        const sourceRef = `${food.kind}:${food.id}`;
        const grown = await combineInto(tx, userId, { day, meal }, { source: food.kind, sourceRef, name: food.name, perServing: food.nutrients, servings: food.servings }, portion, { day, meal }, now, added);
        if (grown) {
          // An entry grown twice is listed once, at its final amount, where it first appeared
          const at = rows.findIndex((r) => r.id === grown.row.id);
          if (at < 0) rows.push(grown.row);
          else rows[at] = grown.row;
          combined.push(grown.combined);
          continue;
        }
        const [inserted] = await tx
          .insert(logEntries)
          .values({
            userId,
            day,
            meal,
            name: food.name,
            brand: food.brand,
            icon: food.icon,
            imageUrl: unsignImageUrl(food.imageUrl), // stored plain; signed again when handed out
            source: food.kind,
            sourceRef,
            ...portion,
            perServing: food.nutrients,
            servings: food.servings,
            nutrients,
            aiEstimated: food.aiFields.length > 0,
            groupRef: `quick:${quick.id}`,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        added.push(inserted.id);
        rows.push(inserted);
      }
      // Using the meal counts as using it, and each of the person's own foods in it
      const used = [quick.id, ...parts.filter((p) => p.live && p.food.kind === "user_food").map((p) => p.food.id)];
      for (const foodId of used) {
        await tx
          .update(userFoods)
          .set({ useCount: sql`${userFoods.useCount} + 1`, lastUsedAt: now })
          .where(and(eq(userFoods.id, foodId), eq(userFoods.userId, userId)));
      }
      return { rows, combined };
    });
    return { entries: rows.map(toEntry), combined };
  });

  // A new portion, recomputed from the entry's own snapshot (never the food as it is now)
  app.patch("/api/log/:id", async (req) => {
    const userId = requireUser(req);
    const { id: entryId } = idParam.parse(req.params);
    const p = patchBody.parse(req.body ?? {});
    const row = await ownEntry(db, userId, entryId);
    if (p.treat && isWater(row)) throw badRequest("Water can't be a treat");
    const portion: Portion = {
      servingIndex: p.servingIndex ?? row.servingIndex,
      unit: p.unit ?? (row.unit as Unit),
      quantity: p.quantity ?? row.quantity,
      fraction: p.fraction ?? row.fraction,
    };
    const nutrients = portionNutrients(row.perServing as Nutrients, row.servings as Serving[], portion);
    const [updated] = await db
      .update(logEntries)
      .set({ ...portion, nutrients, ...(p.treat === undefined ? {} : { treat: p.treat }), updatedAt: app.now() })
      .where(and(eq(logEntries.id, entryId), eq(logEntries.userId, userId)))
      .returning();
    return { entry: toEntry(updated) };
  });

  // Delete: the row waits in the trash for TRASH_MS so it can be put back exactly (older trash of theirs is cleared)
  app.delete("/api/log/:id", async (req, reply) => {
    const userId = requireUser(req);
    const { id: entryId } = idParam.parse(req.params);
    const now = app.now();
    await db.transaction(async (tx) => {
      const gone = await tx
        .delete(logEntries)
        .where(and(eq(logEntries.id, entryId), eq(logEntries.userId, userId)))
        .returning();
      if (!gone.length) throw new HttpError(404, NOT_FOUND);
      await tx.delete(logTrash).where(and(eq(logTrash.userId, userId), lt(logTrash.deletedAt, new Date(now.getTime() - TRASH_MS))));
      await tx.insert(logTrash).values({ userId, entryId, row: gone[0] as unknown as Record<string, unknown>, deletedAt: now });
    });
    return reply.status(204).send();
  });

  // Undo a delete (within TRASH_MS): the same row again, id and time included
  app.post("/api/log/:id/restore", async (req) => {
    const userId = requireUser(req);
    const { id: entryId } = idParam.parse(req.params);
    const now = app.now();
    const row = await db.transaction(async (tx) => {
      const [kept] = await tx
        .select()
        .from(logTrash)
        .where(and(eq(logTrash.userId, userId), eq(logTrash.entryId, entryId), gte(logTrash.deletedAt, new Date(now.getTime() - TRASH_MS))))
        .orderBy(desc(logTrash.deletedAt))
        .limit(1)
        .for("update");
      if (!kept) throw new HttpError(404, TOO_LATE);
      const [taken] = await tx.select({ id: logEntries.id }).from(logEntries).where(eq(logEntries.id, entryId));
      if (taken) throw new HttpError(404, TOO_LATE);
      const saved = kept.row as Row & { createdAt: string | Date; updatedAt: string | Date };
      const [back] = await tx
        .insert(logEntries)
        .values({ ...saved, id: entryId, userId, createdAt: new Date(saved.createdAt), updatedAt: new Date(saved.updatedAt) })
        .returning();
      await tx.delete(logTrash).where(and(eq(logTrash.userId, userId), eq(logTrash.entryId, entryId)));
      return back;
    });
    return { entry: toEntry(row) };
  });

  // Move (or copy) entries to a day and meal: every id must be the caller's, or nothing changes
  app.post("/api/log/move", async (req) => {
    const userId = requireUser(req);
    const b = moveBody.parse(req.body ?? {});
    const ids = [...new Set(b.ids)];
    const now = app.now();
    const to = { day: b.day, meal: b.meal };
    const { rows, combined } = await db.transaction(async (tx) => {
      // The meal they go to first (as an add does), then their rows and that meal's, in id order: two moves in
      // opposite directions wait for each other instead of each holding a row the other needs
      await lockMeal(tx, userId, to);
      const own = (await lockRows(tx, userId, ids, to)).filter((r) => ids.includes(r.id));
      if (own.length !== ids.length) throw new HttpError(404, NOT_FOUND);
      const byId = new Map(own.map((r) => [r.id, r]));
      const ordered = ids.map((i) => byId.get(i)!);
      const rows: Row[] = [];
      const combined: Combined[] = [];
      const copies: number[] = [];
      for (const r of ordered) {
        if (b.copy) {
          // A copy is its own use of each food, not of the quick meal it came from. Into a meal that has the
          // food already, it grows that entry (never another copy made just now)
          const grown = await combineInto(tx, userId, to, snapshotOf(r), portionOf(r), to, now, copies);
          if (grown) {
            rows.push(grown.row);
            combined.push(grown.combined);
            continue;
          }
          const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = r;
          const [copy] = await tx.insert(logEntries).values({ ...rest, groupRef: null, ...to, createdAt: now, updatedAt: now }).returning();
          copies.push(copy.id);
          rows.push(copy);
          continue;
        }
        // Moved into a meal that has the food already (not one of those being moved): that entry grows, and
        // Undo puts this one back where it was. Already in that meal: nothing changes.
        const grown = r.day === b.day && r.meal === b.meal ? null : await combineInto(tx, userId, to, snapshotOf(r), portionOf(r), { day: r.day, meal: r.meal as Meal }, now, ids);
        if (grown) {
          await tx.delete(logEntries).where(eq(logEntries.id, r.id));
          rows.push(grown.row);
          combined.push(grown.combined);
          continue;
        }
        const [moved] = await tx.update(logEntries).set({ ...to, updatedAt: now }).where(eq(logEntries.id, r.id)).returning();
        rows.push(moved);
      }
      return { rows, combined };
    });
    return { entries: rows.map(toEntry), combined };
  });

  // Undo of a combine: the entry goes back to its amount before, and what was added becomes its own entry again
  // (as recorded when combining: its amount in the servings it was measured in) in the day and meal it came from.
  // Only while the entry is still what that combine made: once undone, or after the entry was edited, grew
  // again or was deleted, it's a 409 and nothing changes.
  app.post("/api/log/combines/:id/undo", async (req) => {
    const userId = requireUser(req);
    const { id: combineId } = idParam.parse(req.params);
    const now = app.now();
    const rows = await db.transaction(async (tx) => {
      const mine = and(eq(logCombines.id, combineId), eq(logCombines.userId, userId));
      const usable = (c: typeof logCombines.$inferSelect | undefined): c is typeof logCombines.$inferSelect => !!c && !c.undoneAt && c.entryId !== null && now.getTime() - c.createdAt.getTime() <= COMBINE_KEPT_MS;
      // Read first (no lock) for where the addition goes back to; then the locks in the order every combining
      // path takes them (the meal, then rows in id order); only then the record itself, checked again under its
      // lock: a delete of the entry (which locks the entry, then nulls this record) can't cross it
      const [seen] = await tx.select().from(logCombines).where(mine);
      if (!seen) throw new HttpError(404, NOT_FOUND);
      if (!usable(seen)) throw new HttpError(409, CHANGED_SINCE);
      const splitTo = { day: seen.splitDay, meal: seen.splitMeal as Meal };
      await lockMeal(tx, userId, splitTo);
      const [row] = (await lockRows(tx, userId, [seen.entryId!], splitTo)).filter((r) => r.id === seen.entryId);
      const [c] = await tx.select().from(logCombines).where(mine).for("update");
      if (!usable(c) || c.entryId !== seen.entryId || !row || !samePortion(portionOf(row), c.after as Portion)) throw new HttpError(409, CHANGED_SINCE);
      await logHooks.undoLocked();
      const per = row.perServing as Nutrients;
      const before = c.before as Portion;
      const added = c.added as Portion;
      const addedServings = c.addedServings as Serving[];
      const [back] = await tx
        .update(logEntries)
        .set({ ...before, nutrients: portionNutrients(per, row.servings as Serving[], before), updatedAt: now })
        .where(eq(logEntries.id, row.id))
        .returning();
      const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = row;
      const [split] = await tx
        .insert(logEntries)
        .values({ ...rest, ...added, servings: addedServings, nutrients: portionNutrients(per, addedServings, added), ...splitTo, groupRef: null, createdAt: now, updatedAt: now })
        .returning();
      await tx.update(logCombines).set({ undoneAt: now }).where(eq(logCombines.id, c.id));
      return [back, split];
    });
    return { entries: rows.map(toEntry) };
  });

  // The last 30 different foods logged, newest first, each with the portion used last time
  // (?meal=breakfast: only what was logged at breakfast, with the portion used there)
  app.get("/api/foods/recent", async (req) => {
    const userId = requireUser(req);
    const { meal } = mealQuery.parse(req.query ?? {});
    const picks = await lastPerFood(db, userId, { meal }).orderBy(desc(sql`last_id`)).limit(RECENT_LIMIT);
    return { foods: await resolveFoods(db, userId, picks) };
  });

  // The 20 foods logged most often in the last 60 days (ties: the one used last first); ?meal= as above
  app.get("/api/foods/frequent", async (req) => {
    const userId = requireUser(req);
    const { meal } = mealQuery.parse(req.query ?? {});
    const since = addDays(await todayFor(app, userId), -(FREQUENT_DAYS - 1));
    const picks = await lastPerFood(db, userId, { since, meal }).orderBy(desc(sql`uses`), desc(sql`last_id`)).limit(FREQUENT_LIMIT);
    return { foods: await resolveFoods(db, userId, picks) };
  });
}
