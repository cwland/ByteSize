import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, asc, desc, eq, gte, inArray, isNotNull, lte, ne, or, sql } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { foodCache, logEntries, userFoods, userSettings, users } from "../db/schema.js";
import { HttpError, badRequest } from "../lib/errors.js";
import { requireUser } from "../lib/guards.js";
import { addDays, DAY, localDay, mealFor, MEALS, streak, suggestedFor, todayFor, userTimezone, type Meal } from "../lib/days.js";
import { cleanNutrients, loadFood, toResult, type FoodResult } from "../lib/foods.js";
import { loadCuluryRecipe } from "../lib/culury.js";
import { itemList, portionFields, quickMealParts } from "../lib/recipes.js";
import { amountFactor, scaleNutrients, sumNutrients, UnitError, type Nutrients, type Serving, type Unit } from "../lib/nutrients.js";
import { DEFAULT_MEAL_WINDOWS } from "./settings-me.js";
import { signImageUrl, unsignImageUrl } from "../lib/photos.js";
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
};
type Portion = { servingIndex: number; unit: Unit; quantity: number; fraction: number };

const NOT_FOUND = "Entry not found";
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
});
const ESTIMATE_ONLY = "An estimate can only be sent for a Culury recipe without nutrition";
const mealLogBody = z.object({ day: DAY.optional(), meal: z.enum(MEALS).optional(), foodId: id, items: itemList.optional() });
const waterBody = z.object({
  day: DAY.optional(),
  meal: z.literal("supplements", { error: "Water goes with supplements" }).default("supplements"),
  water_ml: z.number().positive("Enter an amount above 0").max(10000, "That's more water than one entry can hold"),
});
const patchBody = z.object(portionFields).partial();
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
    icon: r.icon,
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
    icon: r.icon,
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
      food = await loadFood(db, userId, { kind: b.food.kind, id: b.food.id });
    }
    // A quick meal is logged as one entry per item (POST /api/log/meal), never as one opaque entry
    if (food.foodKind === "quick_meal") throw badRequest(QUICK_MEAL_HERE);
    const nutrients = portionNutrients(food.nutrients, food.servings, b);
    const meal = b.meal ?? (await mealNow(db, userId, timezone, now));
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
          imageUrl: unsignImageUrl(food.imageUrl),
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
    const rows = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(logEntries)
        .values(
          parts.map(({ food, portion, nutrients }) => ({
            userId,
            day,
            meal,
            name: food.name,
            brand: food.brand,
            icon: food.icon,
            imageUrl: unsignImageUrl(food.imageUrl), // stored plain; signed again when handed out
            source: food.kind,
            sourceRef: `${food.kind}:${food.id}`,
            ...portion,
            perServing: food.nutrients,
            servings: food.servings,
            nutrients,
            aiEstimated: food.aiFields.length > 0,
            groupRef: `quick:${quick.id}`,
            createdAt: now,
            updatedAt: now,
          }))
        )
        .returning();
      // Using the meal counts as using it, and each of the person's own foods in it
      const used = [quick.id, ...parts.filter((p) => p.live && p.food.kind === "user_food").map((p) => p.food.id)];
      for (const foodId of used) {
        await tx
          .update(userFoods)
          .set({ useCount: sql`${userFoods.useCount} + 1`, lastUsedAt: now })
          .where(and(eq(userFoods.id, foodId), eq(userFoods.userId, userId)));
      }
      return inserted.sort((x, y) => x.id - y.id);
    });
    return { entries: rows.map(toEntry) };
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
        // A copy is its own use of each food, not of the quick meal it came from
        const copies = ordered.map(({ id: _id, createdAt: _c, updatedAt: _u, ...rest }) => ({ ...rest, groupRef: null, day: b.day, meal: b.meal, createdAt: now, updatedAt: now }));
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
