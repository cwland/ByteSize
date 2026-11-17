import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, asc, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { foodCache, logEntries, userFoods, userSettings, users } from "../db/schema.js";
import { HttpError, badRequest } from "../lib/errors.js";
import { requireUser } from "../lib/guards.js";
import { addDays, DAY, localDay, mealFor, MEALS, streak, suggestedFor, type Meal } from "../lib/days.js";
import { toResult, type FoodResult } from "../lib/foods.js";
import { amountFactor, scaleNutrients, sumNutrients, UnitError, type Nutrients, type Serving, type Unit } from "../lib/nutrients.js";
import { DEFAULT_MEAL_WINDOWS } from "./settings-me.js";
import { targetsOn } from "./body-plans.js";

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
  servingIndex: number;
  unit: Unit;
  quantity: number;
  fraction: number;
  servings: Serving[];
  nutrients: Nutrients;
  aiEstimated: boolean;
  source: string;
  sourceRef: string | null;
};
type Portion = { servingIndex: number; unit: Unit; quantity: number; fraction: number };

const UNITS = ["serving", "g", "oz", "ml", "fl_oz", "cup", "tbsp", "tsp"] as const;
const NOT_FOUND = "Entry not found";
const RECENT_LIMIT = 30;
const FREQUENT_LIMIT = 20;
const FREQUENT_DAYS = 60;
// Water is logged as millilitres of a 1 ml "serving", so its amount can be edited like any food
const WATER_SERVINGS: Serving[] = [{ label: "1 ml", ml: 1 }];

const id = z.number().int().positive().max(2147483647);
const idParam = z.object({ id: z.coerce.number().int().positive().max(2147483647) });
const portionFields = {
  servingIndex: z.number().int().min(0).max(50),
  unit: z.enum(UNITS, { error: "Choose a unit" }),
  quantity: z.number().positive("Enter an amount above 0").max(100000),
  fraction: z.number().gt(0, "The fraction must be above 0").max(1, "The fraction can't be above 1"),
};
const foodBody = z.object({
  day: DAY.optional(),
  meal: z.enum(MEALS).optional(),
  food: z.object({ kind: z.enum(["cache", "user_food"]), id }),
  servingIndex: portionFields.servingIndex.default(0),
  unit: portionFields.unit,
  quantity: portionFields.quantity,
  fraction: portionFields.fraction.default(1),
});
const waterBody = z.object({
  day: DAY.optional(),
  meal: z.literal("supplements", { error: "Water goes with supplements" }).default("supplements"),
  water_ml: z.number().positive("Enter an amount above 0").max(10000, "That's more water than one entry can hold"),
});
const patchBody = z.object(portionFields).partial();
const mealQuery = z.object({ meal: z.enum(MEALS, { error: "Choose a meal" }).optional() });
const moveBody = z.object({ ids: z.array(id).min(1, "Choose at least one entry").max(500), day: DAY, meal: z.enum(MEALS), copy: z.boolean().default(false) });

export function toEntry(r: Row): LogEntry {
  return {
    id: r.id,
    day: r.day,
    meal: r.meal as Meal,
    name: r.name,
    brand: r.brand,
    icon: r.icon,
    servingIndex: r.servingIndex,
    unit: r.unit as Unit,
    quantity: r.quantity,
    fraction: r.fraction,
    servings: r.servings as Serving[],
    nutrients: r.nutrients as Nutrients,
    aiEstimated: r.aiEstimated,
    source: r.source,
    sourceRef: r.sourceRef,
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

async function userTimezone(db: Db, userId: number): Promise<string> {
  const [u] = await db.select({ timezone: users.timezone }).from(users).where(eq(users.id, userId));
  if (!u) throw new HttpError(401, "Not logged in");
  return u.timezone;
}

async function todayFor(app: FastifyInstance, userId: number) {
  return localDay(await userTimezone(app.db, userId), app.now());
}

/** The food the person may log: any cached food, or one of their own active foods. */
async function loadFood(db: Db, userId: number, ref: { kind: "cache" | "user_food"; id: number }): Promise<FoodResult> {
  if (ref.kind === "cache") {
    const [row] = await db.select().from(foodCache).where(eq(foodCache.id, ref.id));
    if (row) return toResult(row, "cache");
  } else {
    const [row] = await db
      .select()
      .from(userFoods)
      .where(and(eq(userFoods.id, ref.id), eq(userFoods.userId, userId), eq(userFoods.archived, false)));
    if (row) return toResult(row, "user_food");
  }
  throw new HttpError(404, "Food not found");
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
  const targets = await targetsOn(app.db, userId, day);
  // Sums over every entry; "unknown" counts only foods (a water entry isn't missing fiber)
  const sums = sumNutrients(entries.map((e) => e.nutrients));
  const unknownCount = sumNutrients(rows.filter((r) => !isWater(r)).map((r) => r.nutrients as Nutrients)).unknownCount;
  const meals = Object.fromEntries(
    MEALS.map((m) => {
      const s = sumNutrients(entries.filter((e) => e.meal === m).map((e) => e.nutrients));
      return [m, { calories: s.calories ?? 0, protein_g: s.protein_g ?? 0, carbs_g: s.carbs_g ?? 0, fat_g: s.fat_g ?? 0, fiber_g: s.fiber_g ?? 0, suggested: suggestedFor(m, targets?.calories) }];
    })
  );
  // Exercise is shown but never changes the budget (no exercise logging yet: always 0)
  return { day, entries, totals: { ...sums, unknownCount }, meals, targets, exercise: { calories: 0 }, streak: await streak(app.db, userId, await todayFor(app, userId)) };
}

/** The newest entry for each food the person logged (water left out), newest first; only that meal's entries when given. */
function lastPerFood(db: Db, userId: number, opts: { since?: string; meal?: Meal } = {}) {
  const { since, meal } = opts;
  const where = and(
    eq(logEntries.userId, userId),
    isNotNull(logEntries.sourceRef),
    since ? gte(logEntries.day, since) : undefined,
    meal ? eq(logEntries.meal, meal) : undefined
  );
  const counts = db
    .select({ ref: logEntries.sourceRef, uses: sql<number>`count(*)::int`.as("uses"), lastId: sql<number>`max(${logEntries.id})`.as("last_id") })
    .from(logEntries)
    .where(where)
    .groupBy(logEntries.sourceRef)
    .as("c");
  return db
    .select({ ref: counts.ref, uses: counts.uses, entry: logEntries })
    .from(counts)
    .innerJoin(logEntries, eq(logEntries.id, counts.lastId));
}

/** Resolves source refs to the current foods (archived or missing ones are skipped), each with its last portion. */
async function resolveFoods(db: Db, userId: number, picks: { ref: string | null; entry: Row }[]) {
  const ids = (kind: string) => picks.map((p) => p.ref!.split(":")).filter(([k]) => k === kind).map(([, v]) => Number(v));
  const cacheIds = ids("cache");
  const userIds = ids("user_food");
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
  ]);
  // In the order given (newest or most used first); a food reached twice (itself and via its database
  // original) appears once, at its first place
  const seen = new Set<string>();
  return picks.flatMap(({ ref, entry }) => {
    const food = found.get(ref!);
    if (!food || seen.has(`${food.kind}:${food.id}`)) return [];
    seen.add(`${food.kind}:${food.id}`);
    return [{ ...food, last: { servingIndex: entry.servingIndex, unit: entry.unit as Unit, quantity: entry.quantity, fraction: entry.fraction } }];
  });
}

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
    const food = await loadFood(db, userId, b.food);
    const nutrients = portionNutrients(food.nutrients, food.servings, b);
    let meal = b.meal;
    if (!meal) {
      const [s] = await db.select({ mealWindows: userSettings.mealWindows }).from(userSettings).where(eq(userSettings.userId, userId));
      meal = mealFor(timezone, now, s?.mealWindows ?? DEFAULT_MEAL_WINDOWS);
    }
    const row = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(logEntries)
        .values({
          userId,
          day: b.day ?? localDay(timezone, now),
          meal,
          name: food.name,
          brand: food.brand,
          icon: food.icon,
          source: food.kind,
          sourceRef: `${food.kind}:${food.id}`,
          servingIndex: b.servingIndex,
          unit: b.unit,
          quantity: b.quantity,
          fraction: b.fraction,
          perServing: food.nutrients,
          servings: food.servings,
          nutrients,
          aiEstimated: food.aiFields.length > 0,
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
      return inserted;
    });
    return { entry: toEntry(row) };
  });

  // A new portion, recomputed from the entry's own snapshot (never the food as it is now)
  app.patch("/api/log/:id", async (req) => {
    const userId = requireUser(req);
    const { id: entryId } = idParam.parse(req.params);
    const p = patchBody.parse(req.body ?? {});
    const row = await ownEntry(db, userId, entryId);
    const portion: Portion = {
      servingIndex: p.servingIndex ?? row.servingIndex,
      unit: p.unit ?? (row.unit as Unit),
      quantity: p.quantity ?? row.quantity,
      fraction: p.fraction ?? row.fraction,
    };
    const nutrients = portionNutrients(row.perServing as Nutrients, row.servings as Serving[], portion);
    const [updated] = await db
      .update(logEntries)
      .set({ ...portion, nutrients, updatedAt: app.now() })
      .where(and(eq(logEntries.id, entryId), eq(logEntries.userId, userId)))
      .returning();
    return { entry: toEntry(updated) };
  });

  app.delete("/api/log/:id", async (req, reply) => {
    const userId = requireUser(req);
    const { id: entryId } = idParam.parse(req.params);
    const gone = await db
      .delete(logEntries)
      .where(and(eq(logEntries.id, entryId), eq(logEntries.userId, userId)))
      .returning({ id: logEntries.id });
    if (!gone.length) throw new HttpError(404, NOT_FOUND);
    return reply.status(204).send();
  });

  // Move (or copy) entries to a day and meal: every id must be the caller's, or nothing changes
  app.post("/api/log/move", async (req) => {
    const userId = requireUser(req);
    const b = moveBody.parse(req.body ?? {});
    const ids = [...new Set(b.ids)];
    const now = app.now();
    const rows = await db.transaction(async (tx) => {
      const own = await tx
        .select()
        .from(logEntries)
        .where(and(eq(logEntries.userId, userId), inArray(logEntries.id, ids)))
        .for("update");
      if (own.length !== ids.length) throw new HttpError(404, NOT_FOUND);
      const byId = new Map(own.map((r) => [r.id, r]));
      const ordered = ids.map((i) => byId.get(i)!);
      if (b.copy) {
        const copies = ordered.map(({ id: _id, createdAt: _c, updatedAt: _u, ...rest }) => ({ ...rest, day: b.day, meal: b.meal, createdAt: now, updatedAt: now }));
        const inserted = await tx.insert(logEntries).values(copies).returning();
        return inserted.sort((x, y) => x.id - y.id);
      }
      const moved = await tx
        .update(logEntries)
        .set({ day: b.day, meal: b.meal, updatedAt: now })
        .where(and(eq(logEntries.userId, userId), inArray(logEntries.id, ids)))
        .returning();
      const movedById = new Map(moved.map((r) => [r.id, r]));
      return ids.map((i) => movedById.get(i)!);
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
