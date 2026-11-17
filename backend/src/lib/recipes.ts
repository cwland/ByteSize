// Recipes and quick meals: user_foods of kind "recipe" / "quick_meal" with their items in recipe_items.
// Each item keeps a live reference to its food plus a snapshot of it at save time. A recipe's stored
// numbers change only when it is saved again or recalculated; an item whose food is archived or gone
// falls back to its snapshot. Every query is limited to the caller's own foods.
import type { FastifyInstance } from "fastify";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/index.js";
import { foodCache, logEntries, recipeItems, userFoods, type RecipeItemSnapshot } from "../db/schema.js";
import { HttpError, badRequest } from "./errors.js";
import { COMPOUND_KINDS, ownFood, toResult, type FoodKind, type FoodResult } from "./foods.js";
import { amountFactor, NUTRIENT_KEYS, scaleNutrients, UnitError, type Nutrients, type Serving, type Unit } from "./nutrients.js";

type UserFoodRow = typeof userFoods.$inferSelect;
type ItemRow = typeof recipeItems.$inferSelect;
type Compound = (typeof COMPOUND_KINDS)[number];

// ---------- shapes ----------

export const UNITS = ["serving", "g", "oz", "ml", "fl_oz", "cup", "tbsp", "tsp"] as const;
const id = z.number().int().positive().max(2147483647);
/** An amount of a food: the same fields (and maths) as a log entry's portion. */
export const portionFields = {
  servingIndex: z.number().int().min(0).max(50),
  unit: z.enum(UNITS, { error: "Choose a unit" }),
  quantity: z.number().positive("Enter an amount above 0").max(100000),
  fraction: z.number().gt(0, "The fraction must be above 0").max(1, "The fraction can't be above 1"),
};
export const itemSchema = z.object({
  food: z.object({ kind: z.enum(["cache", "user_food"]), id }),
  servingIndex: portionFields.servingIndex.default(0),
  unit: portionFields.unit,
  quantity: portionFields.quantity,
  fraction: portionFields.fraction.default(1),
});
export type Item = z.infer<typeof itemSchema>;
type Ref = Item["food"];
type Portion = Omit<Item, "food">;

const name = z.string().trim().min(1, "Give it a name").max(200);
export const itemList = z.array(itemSchema).min(1, "Add at least one food").max(100, "That's too many items");
export const recipeBody = z.object({
  name,
  items: z.array(itemSchema).min(1, "Add at least one ingredient").max(100, "That's too many ingredients"),
  servings: z.number().positive("Enter how many servings it makes").max(1000),
  servingGrams: z.number().positive("Enter the weight of one serving").max(100000).nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
});
export const mealBody = z.object({ name, items: itemList });
export const fromEntriesBody = z.object({ name, ids: z.array(id).min(1, "Choose at least one entry").max(100) });

/** One item as the editors show it: its food now (or its snapshot when the food is archived or gone). */
export type ItemView = {
  food: Ref;
  foodKind: FoodKind;
  name: string;
  brand: string | null;
  icon: string;
  imageUrl: string | null;
  servingIndex: number;
  unit: Unit;
  quantity: number;
  fraction: number;
  servings: Serving[]; // the food's (for the amount picker)
  perServing: Nutrients; // the food's, per its servings[0]
  nutrients: Nutrients; // this item's amount, as stored when the recipe or meal was last saved
  available: boolean; // false: the food is archived or gone, and its saved values are used
};
/** A food as GET /api/my-foods/:id returns it; recipes and quick meals carry their items. */
export type FoodDetail = FoodResult & { notes: string | null; items?: ItemView[]; recipeServings?: number | null; servingGrams?: number | null };

export const MEASURE = "Choose an amount this food can be measured in";
const DEEP = "A recipe inside a recipe can't contain another recipe";
const NOT_FOUND = "Food not found";

const refKey = (r: { kind: string; id: number }) => `${r.kind}:${r.id}`;
const isCompound = (kind: string): kind is Compound => (COMPOUND_KINDS as readonly string[]).includes(kind);

// ---------- maths ----------

/** How many base servings of the food the portion is; an amount it can't be measured in is a 400. */
function factorOf(food: FoodResult, p: Portion): number {
  try {
    return amountFactor(food.servings, p.servingIndex, p.unit, p.quantity) * p.fraction;
  } catch (e) {
    if (e instanceof UnitError) throw badRequest(MEASURE);
    throw e;
  }
}

/** Whether the food can be measured in this amount; any error other than "can't measure" is thrown. */
export function canMeasure(food: Pick<FoodResult, "servings">, p: Portion): boolean {
  try {
    amountFactor(food.servings, p.servingIndex, p.unit, p.quantity);
    return true;
  } catch (e) {
    if (e instanceof UnitError) return false;
    throw e;
  }
}

/** Unrounded totals; a nutrient unknown on any part is unknown on the total (never 0). */
function rawTotal(parts: { per: Nutrients; factor: number }[]): Nutrients {
  const out: Nutrients = {};
  for (const k of NUTRIENT_KEYS) {
    if (!parts.every((p) => typeof p.per[k] === "number")) continue;
    out[k] = parts.reduce((sum, p) => sum + p.per[k]! * p.factor, 0);
  }
  return out;
}

const grams = (g: number) => String(Math.round(g * 10) / 10);
/** servings[0] is one serving (with its weight when known, plus a 100 g base for weighing). */
function recipeServingDefs(servingGrams: number | null): Serving[] {
  if (!servingGrams) return [{ label: "1 serving" }];
  return [
    { label: `1 serving (${grams(servingGrams)} g)`, grams: servingGrams },
    { label: "100 g", grams: 100 },
  ];
}
const MEAL_SERVINGS: Serving[] = [{ label: "1 meal" }];

// ---------- foods behind the items ----------

/** The foods the person may use now, by ref: any cached food, or their own active foods. */
async function liveFoods(db: Db, userId: number, refs: { kind: string; id: number }[]): Promise<Map<string, FoodResult>> {
  const ids = (kind: string) => [...new Set(refs.filter((r) => r.kind === kind && Number.isInteger(r.id)).map((r) => r.id))];
  const cacheIds = ids("cache");
  const userIds = ids("user_food");
  const cache = cacheIds.length ? await db.select().from(foodCache).where(inArray(foodCache.id, cacheIds)) : [];
  const mine = userIds.length
    ? await db
        .select()
        .from(userFoods)
        .where(and(inArray(userFoods.id, userIds), eq(userFoods.userId, userId), eq(userFoods.archived, false)))
    : [];
  return new Map<string, FoodResult>([...cache.map((r) => [`cache:${r.id}`, toResult(r, "cache")] as const), ...mine.map((r) => [`user_food:${r.id}`, toResult(r, "user_food")] as const)]);
}

function fromSnapshot(ref: Ref, s: RecipeItemSnapshot): FoodResult {
  return {
    kind: ref.kind,
    id: ref.id,
    name: s.name,
    brand: s.brand,
    icon: s.icon,
    barcode: null,
    servings: s.servings as Serving[],
    nutrients: s.perServing as Nutrients,
    aiFields: s.aiFields,
    imageUrl: null,
    override: false,
    source: "mine",
    foodKind: s.foodKind as FoodKind,
  };
}

const itemRows = (db: Db, recipeId: number) => db.select().from(recipeItems).where(eq(recipeItems.recipeId, recipeId)).orderBy(asc(recipeItems.position));
const toItem = (r: ItemRow): Item => ({ food: { kind: r.foodKind as Ref["kind"], id: r.foodId }, servingIndex: r.servingIndex, unit: r.unit as Unit, quantity: r.quantity, fraction: r.fraction });
const snapshotsOf = (rows: ItemRow[]) => new Map(rows.map((r) => [refKey({ kind: r.foodKind, id: r.foodId }), r.snapshot] as const));

type Resolved = { item: Item; food: FoodResult; live: boolean; factor: number };

/**
 * Each item's food now; a food that is archived or gone may still be used from `fallback` (the
 * recipe's or meal's own snapshot of it). Anything else the person can't use is a 404.
 */
async function resolveItems(db: Db, userId: number, items: Item[], fallback: Map<string, RecipeItemSnapshot>): Promise<Resolved[]> {
  const live = await liveFoods(db, userId, items.map((i) => i.food));
  return items.map((item) => {
    const key = refKey(item.food);
    const now = live.get(key);
    const snap = fallback.get(key);
    const food = now ?? (snap ? fromSnapshot(item.food, snap) : null);
    if (!food) throw new HttpError(404, NOT_FOUND);
    return { item, food, live: !!now, factor: factorOf(food, item) };
  });
}

/** Does this recipe hold a recipe among its items? */
async function holdsRecipe(db: Db, recipeId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: recipeItems.id })
    .from(recipeItems)
    .where(and(eq(recipeItems.recipeId, recipeId), sql`${recipeItems.snapshot}->>'foodKind' = 'recipe'`))
    .limit(1);
  return !!row;
}

/** Is this recipe an ingredient of one of the person's active recipes? */
async function insideRecipe(db: Db, userId: number, recipeId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: recipeItems.id })
    .from(recipeItems)
    .innerJoin(userFoods, eq(userFoods.id, recipeItems.recipeId))
    .where(and(eq(userFoods.userId, userId), eq(userFoods.kind, "recipe"), eq(userFoods.archived, false), eq(recipeItems.foodKind, "user_food"), eq(recipeItems.foodId, recipeId)))
    .limit(1);
  return !!row;
}

/** Recipes hold recipes one level deep and never quick meals; quick meals never hold quick meals. */
async function checkNesting(db: Db, userId: number, kind: Compound, selfId: number | null, resolved: Resolved[]) {
  for (const r of resolved) {
    const fk = r.food.foodKind;
    if (kind === "quick_meal") {
      if (fk === "quick_meal") throw badRequest("A quick meal can't contain another quick meal");
      continue;
    }
    if (fk === "quick_meal") throw badRequest("A recipe can't contain a quick meal");
    if (fk !== "recipe") continue;
    if (r.item.food.kind === "user_food" && r.item.food.id === selfId) throw badRequest("A recipe can't contain itself");
    if (r.live && (await holdsRecipe(db, r.item.food.id))) throw badRequest(DEEP);
    if (selfId !== null && (await insideRecipe(db, userId, selfId))) throw badRequest(DEEP);
  }
}

// ---------- reading ----------

/** A food with its details; recipes and quick meals with their items. */
export async function foodDetail(db: Db, userId: number, row: UserFoodRow): Promise<FoodDetail> {
  const base = { ...toResult(row, "user_food"), notes: row.notes };
  if (!isCompound(row.kind)) return base;
  const rows = await itemRows(db, row.id);
  const live = await liveFoods(db, userId, rows.map((r) => ({ kind: r.foodKind, id: r.foodId })));
  const items = rows.map((r): ItemView => {
    const s = r.snapshot;
    const now = live.get(refKey({ kind: r.foodKind, id: r.foodId }));
    return {
      food: { kind: r.foodKind as Ref["kind"], id: r.foodId },
      foodKind: now?.foodKind ?? (s.foodKind as FoodKind),
      name: now?.name ?? s.name,
      brand: now ? now.brand : s.brand,
      icon: now?.icon ?? s.icon,
      imageUrl: now?.imageUrl ?? null,
      servingIndex: r.servingIndex,
      unit: r.unit as Unit,
      quantity: r.quantity,
      fraction: r.fraction,
      servings: now?.servings ?? (s.servings as Serving[]),
      perServing: now?.nutrients ?? (s.perServing as Nutrients),
      nutrients: s.nutrients as Nutrients,
      available: !!now,
    };
  });
  return { ...base, items, recipeServings: row.recipeServings, servingGrams: row.servingGrams };
}

export async function getMyFood(db: Db, userId: number, foodId: number): Promise<FoodDetail> {
  return foodDetail(db, userId, await ownFood(db, userId, foodId));
}

async function ownCompound(db: Db, userId: number, foodId: number, kind: Compound): Promise<UserFoodRow> {
  const row = await ownFood(db, userId, foodId);
  if (row.kind !== kind) throw new HttpError(404, NOT_FOUND);
  return row;
}

// ---------- saving ----------

type CompoundFields = { name: string; items: Item[]; servings: number; servingGrams: number | null; notes: string | null };

/** Creates (or replaces, with `existing`) a recipe or quick meal from its items' foods as they are now. */
async function saveCompound(app: FastifyInstance, userId: number, kind: Compound, f: CompoundFields, existing?: UserFoodRow): Promise<FoodDetail> {
  const { db } = app;
  const fallback = existing ? snapshotsOf(await itemRows(db, existing.id)) : new Map<string, RecipeItemSnapshot>();
  const resolved = await resolveItems(db, userId, f.items, fallback);
  await checkNesting(db, userId, kind, existing?.id ?? null, resolved);

  const count = kind === "recipe" ? f.servings : 1;
  const servingGrams = kind === "recipe" ? f.servingGrams : null;
  const values = {
    kind,
    name: f.name,
    brand: null,
    barcode: null,
    category: null,
    servings: kind === "recipe" ? recipeServingDefs(servingGrams) : MEAL_SERVINGS,
    nutrients: scaleNutrients(rawTotal(resolved.map((r) => ({ per: r.food.nutrients, factor: r.factor }))), 1 / count),
    aiFields: [] as string[],
    notes: f.notes,
    recipeServings: count,
    servingGrams,
  };
  const items = resolved.map(({ item, food, factor }, position) => ({
    position,
    foodKind: item.food.kind,
    foodId: item.food.id,
    servingIndex: item.servingIndex,
    unit: item.unit,
    quantity: item.quantity,
    fraction: item.fraction,
    snapshot: {
      name: food.name,
      brand: food.brand,
      icon: food.icon,
      foodKind: food.foodKind,
      nutrients: scaleNutrients(food.nutrients, factor),
      perServing: food.nutrients,
      servings: food.servings,
      aiFields: food.aiFields,
    } satisfies RecipeItemSnapshot,
  }));

  const row = await db.transaction(async (tx) => {
    let saved: UserFoodRow;
    if (existing) {
      [saved] = await tx
        .update(userFoods)
        .set({ ...values, updatedAt: new Date() })
        .where(and(eq(userFoods.id, existing.id), eq(userFoods.userId, userId)))
        .returning();
      await tx.delete(recipeItems).where(eq(recipeItems.recipeId, existing.id));
    } else {
      [saved] = await tx
        .insert(userFoods)
        .values({ userId, ...values })
        .returning();
    }
    await tx.insert(recipeItems).values(items.map((i) => ({ ...i, recipeId: saved.id })));
    return saved;
  });
  return foodDetail(db, userId, row);
}

export function createRecipe(app: FastifyInstance, userId: number, b: z.infer<typeof recipeBody>) {
  return saveCompound(app, userId, "recipe", { name: b.name, items: b.items, servings: b.servings, servingGrams: b.servingGrams ?? null, notes: b.notes || null });
}

export async function updateRecipe(app: FastifyInstance, userId: number, foodId: number, b: z.infer<typeof recipeBody>) {
  const row = await ownCompound(app.db, userId, foodId, "recipe");
  return saveCompound(app, userId, "recipe", { name: b.name, items: b.items, servings: b.servings, servingGrams: b.servingGrams ?? null, notes: b.notes || null }, row);
}

export function createMeal(app: FastifyInstance, userId: number, b: z.infer<typeof mealBody>) {
  return saveCompound(app, userId, "quick_meal", { name: b.name, items: b.items, servings: 1, servingGrams: null, notes: null });
}

export async function updateMeal(app: FastifyInstance, userId: number, foodId: number, b: z.infer<typeof mealBody>) {
  const row = await ownCompound(app.db, userId, foodId, "quick_meal");
  return saveCompound(app, userId, "quick_meal", { name: b.name, items: b.items, servings: 1, servingGrams: null, notes: row.notes }, row);
}

/** Saves a recipe or quick meal again from its items' foods as they are now ("Recalculate"). */
export async function recalculate(app: FastifyInstance, userId: number, foodId: number) {
  const row = await ownFood(app.db, userId, foodId);
  if (!isCompound(row.kind)) throw badRequest("Only recipes and quick meals can be recalculated");
  const items = (await itemRows(app.db, row.id)).map(toItem);
  return saveCompound(app, userId, row.kind, { name: row.name, items, servings: row.recipeServings ?? 1, servingGrams: row.servingGrams, notes: row.notes }, row);
}

/**
 * "Save as a meal": a quick meal from logged entries, each item the entry's food with its logged
 * portion. Water, and entries whose food can't be found (archived, gone, or a quick meal), are left out.
 */
export async function mealFromEntries(app: FastifyInstance, userId: number, b: z.infer<typeof fromEntriesBody>) {
  const { db } = app;
  const ids = [...new Set(b.ids)];
  const rows = await db
    .select()
    .from(logEntries)
    .where(and(eq(logEntries.userId, userId), inArray(logEntries.id, ids)));
  if (rows.length !== ids.length) throw new HttpError(404, "Entry not found");
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = ids.map((i) => byId.get(i)!);
  const refOf = (ref: string | null) => {
    const [kind, raw] = (ref ?? "").split(":");
    const n = Number(raw);
    return (kind === "cache" || kind === "user_food") && Number.isInteger(n) && n > 0 ? { kind, id: n } as Ref : null;
  };
  const live = await liveFoods(db, userId, ordered.flatMap((r) => refOf(r.sourceRef) ?? []));

  const items: Item[] = [];
  const leftOut: string[] = [];
  for (const r of ordered) {
    const ref = r.source === "water" ? null : refOf(r.sourceRef);
    const food = ref ? live.get(refKey(ref)) : undefined;
    const portion: Portion = { servingIndex: r.servingIndex, unit: r.unit as Unit, quantity: r.quantity, fraction: r.fraction };
    if (!ref || !food || food.foodKind === "quick_meal" || !canMeasure(food, portion)) {
      leftOut.push(r.name);
      continue;
    }
    items.push({ food: ref, ...portion });
  }
  if (!items.length) throw badRequest("Nothing here can be saved as a meal");
  return { food: await createMeal(app, userId, { name: b.name, items }), leftOut };
}

// ---------- deleting ----------

/** Deletes a food never logged and not in a recipe or meal; otherwise archives (hides) it. */
/** Deletes the food, or archives (hides) it when it was logged or is an item; says which. */
export async function removeMyFood(app: FastifyInstance, userId: number, foodId: number): Promise<{ archived: boolean }> {
  const { db } = app;
  await ownFood(db, userId, foodId);
  const [logged] = await db
    .select({ id: logEntries.id })
    .from(logEntries)
    .where(and(eq(logEntries.userId, userId), or(eq(logEntries.sourceRef, `user_food:${foodId}`), eq(logEntries.groupRef, `quick:${foodId}`))))
    .limit(1);
  const [used] = await db
    .select({ id: recipeItems.id })
    .from(recipeItems)
    .innerJoin(userFoods, eq(userFoods.id, recipeItems.recipeId))
    .where(and(eq(userFoods.userId, userId), eq(recipeItems.foodKind, "user_food"), eq(recipeItems.foodId, foodId)))
    .limit(1);
  const mine = and(eq(userFoods.id, foodId), eq(userFoods.userId, userId));
  const archived = Boolean(logged || used);
  if (archived) await db.update(userFoods).set({ archived: true, updatedAt: new Date() }).where(mine);
  else await db.delete(userFoods).where(mine);
  return { archived };
}

// ---------- logging ----------

export type MealPart = { food: FoodResult; live: boolean; portion: Portion; nutrients: Nutrients };

/**
 * What logging a quick meal adds: one part per item (or per adjusted item), each from its food now,
 * or from the meal's snapshot when the food is archived or gone.
 */
export async function quickMealParts(db: Db, userId: number, mealId: number, adjusted?: Item[]): Promise<{ meal: UserFoodRow; parts: MealPart[] }> {
  const [meal] = await db
    .select()
    .from(userFoods)
    .where(and(eq(userFoods.id, mealId), eq(userFoods.userId, userId), eq(userFoods.archived, false), eq(userFoods.kind, "quick_meal")));
  if (!meal) throw new HttpError(404, NOT_FOUND);
  const stored = await itemRows(db, meal.id);
  const resolved = await resolveItems(db, userId, adjusted ?? stored.map(toItem), snapshotsOf(stored));
  if (resolved.some((r) => r.food.foodKind === "quick_meal")) throw badRequest("A quick meal can't contain another quick meal");
  return {
    meal,
    parts: resolved.map(({ item: { food: _ref, ...portion }, food, live, factor }) => ({ food, live, portion, nutrients: scaleNutrients(food.nutrients, factor) })),
  };
}
