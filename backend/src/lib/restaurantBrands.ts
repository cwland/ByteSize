import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, eq, inArray } from "drizzle-orm";
import { foodCache, restaurantBrands, restaurantFavourites } from "../db/schema.js";

// Restaurant tags (2026-11-25 design §3): a food or log entry whose brand is a restaurant shows a restaurant tag.
// A brand is a restaurant when the person marked it so; else when it's on the built-in chain list (unless they
// marked it "not a restaurant"); and a Spoonacular menu item, or one starred in Restaurants, always is.

/** A brand as one comparable key: lower case, "&" → "and", apostrophes and dots dropped, other punctuation a space, no leading "the". */
export function brandKey(brand: string): string {
  return brand
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // accents
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’‘ʼ`´.]/g, "") // "P.F. Chang's" → "pf changs"
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^the /, "");
}

// Big US restaurant chains, as brand keys. A brand matches a chain when it is the chain's key, or the chain's key
// followed by restaurant words only ("Chipotle Mexican Grill", "Starbucks Coffee", "Sonic Drive-In") — so "Sonic
// Bloom" or "Just Salad Dressing" don't. Chains better known for grocery products (Cracker Barrel cheese, Bob Evans
// sides) stay off the list; a chain's own grocery products show as restaurants until the person marks them not.
const CHAINS = [
  // burgers, chicken, sandwiches
  "mcdonalds", "mc donalds", "burger king", "wendys", "five guys", "in n out", "in n out burger", "shake shack", "whataburger",
  "carls jr", "hardees", "jack in the box", "sonic", "sonic drive in", "culvers", "white castle", "krystal",
  "smashburger", "habit burger grill", "fatburger", "steak n shake", "checkers", "rallys",
  "freddys frozen custard and steakburgers", "freddys", "red robin", "fuddruckers", "dairy queen",
  "kfc", "kentucky fried chicken", "chick fil a", "popeyes", "raising canes", "wingstop", "buffalo wild wings",
  "zaxbys", "bojangles", "churchs chicken", "el pollo loco", "pollo tropical", "boston market", "golden chick",
  "slim chickens", "daves hot chicken", "hooters", "wing stop", "pdq",
  "subway", "jimmy johns", "jersey mikes", "firehouse subs", "potbelly", "quiznos", "jasons deli", "mcalisters deli",
  "schlotzskys", "arbys", "panera bread", "panera", "au bon pain", "which wich", "capriottis", "penn station",
  "portillos", "nathans famous", "wienerschnitzel",
  // mexican, asian, mediterranean
  "taco bell", "chipotle", "chipotle mexican grill", "qdoba", "qdoba mexican eats", "moes southwest grill",
  "del taco", "taco john s", "taco johns", "taco cabana", "tijuana flats", "on the border", "chuys", "chevys",
  "el torito", "baja fresh", "rubios", "costa vida", "cafe rio", "torchys tacos", "velvet taco",
  "panda express", "pf changs", "pei wei", "benihana", "pick up stix", "noodles and company", "noodles and co",
  "teriyaki madness", "flame broiler", "waba grill", "yoshinoya", "sarku japan", "kona grill", "ra sushi",
  "cava", "zoes kitchen", "the halal guys", "halal guys", "garbanzo", "pita pit", "taziki s", "tazikis",
  // pizza, italian
  "dominos", "dominos pizza", "pizza hut", "papa johns", "little caesars", "papa murphys", "marcos pizza",
  "round table pizza", "hungry howies", "jets pizza", "blaze pizza", "mod pizza", "pieology", "sbarro",
  "cicis", "cicis pizza", "chuck e cheese", "california pizza kitchen", "uno pizzeria and grill", "unos",
  "olive garden", "carrabbas", "carrabbas italian grill", "maggianos", "maggianos little italy", "buca di beppo",
  "fazolis", "romanos macaroni grill", "macaroni grill",
  // casual dining, steak, seafood
  "applebees", "chilis", "tgi fridays", "ruby tuesday", "olive garden", "red lobster", "outback",
  "outback steakhouse", "longhorn steakhouse", "texas roadhouse", "logans roadhouse", "saltgrass steak house",
  "ruths chris", "mortons steakhouse", "mortons the steakhouse", "chuck e cheeses", "moes", "churchs", "ruths chris steak house", "the capital grille", "capital grille", "flemings",
  "cheesecake factory", "bjs restaurant", "bjs restaurant and brewhouse", "yard house", "dave and busters",
  "dennys", "ihop", "waffle house", "perkins", "first watch", "huddle house",
  "village inn", "black bear diner", "bonefish grill", "joes crab shack", "bubba gump", "landrys",
  "long john silvers", "captain ds", "red robin gourmet burgers", "twin peaks", "miller s ale house",
  "millers ale house", "bar louie", "hooters", "o charleys", "ocharleys", "famous daves", "sonny s bbq",
  "sonnys bbq", "dickeys barbecue pit", "dickeys", "golden corral", "sizzler", "denny s", "friendlys",
  "houlihans", "true food kitchen", "seasons 52", "eddie v s", "eddie vs", "first watch daytime cafe",
  "hot n juicy crawfish", "kona ice",
  // coffee, bakery, dessert, drinks
  "starbucks", "dunkin", "dunkin donuts", "tim hortons", "peets coffee", "caribou coffee", "dutch bros",
  "dutch bros coffee", "the coffee bean and tea leaf", "coffee bean and tea leaf", "scooters coffee", "biggby coffee",
  "krispy kreme", "shipley do nuts", "shipley donuts", "einstein bros bagels", "einstein bros", "brueggers",
  "cinnabon", "auntie annes", "wetzels pretzels", "crumbl", "crumbl cookies", "insomnia cookies", "nothing bundt cakes",
  "baskin robbins", "cold stone creamery", "marble slab creamery", "menchies", "yogurtland", "pinkberry",
  "rita s italian ice", "ritas italian ice", "jamba", "jamba juice", "smoothie king", "tropical smoothie cafe",
  "orange julius", "sweetgreen", "salata", "chopt", "just salad", "mendocino farms", "corner bakery cafe",
  "corner bakery", "la madeleine", "le pain quotidien", "potbelly sandwich shop", "pret a manger", "kolache factory",
  "andys frozen custard", "kopps", "bahama buck s", "bahama bucks", "swig", "sharetea", "kung fu tea", "gong cha",
  // convenience food counters
  "wawa", "sheetz", "quiktrip", "buc ees", "bucees", "7 eleven", "casey s", "caseys", "caseys general store",
] as const;

const CHAIN_SET = new Set<string>(CHAINS.map(brandKey));

// Words that can follow a chain's name and still mean the restaurant
const RESTAURANT_WORDS = new Set([
  "restaurant", "restaurants", "grill", "grille", "kitchen", "cafe", "coffee", "coffeehouse", "pizza", "pizzeria", "burger", "burgers",
  "tacos", "taqueria", "cantina", "bbq", "barbecue", "steakhouse", "steak", "house", "diner", "bakery", "bagels", "donuts", "eatery",
  "deli", "subs", "sandwiches", "chicken", "wings", "express", "drive", "in", "bar", "brewhouse", "tavern", "co", "company",
  "inc", "llc", "us", "usa", "the", "and", "mexican", "italian", "chinese", "japanese", "bistro", "shack", "joint", "roadhouse",
]);

/** Whether a brand key is a chain on the built-in list, or one followed only by restaurant words. */
export function isChain(key: string): boolean {
  if (!key) return false;
  if (CHAIN_SET.has(key)) return true;
  const words = key.split(" ");
  for (let n = words.length - 1; n >= 1; n--) {
    if (CHAIN_SET.has(words.slice(0, n).join(" ")) && words.slice(n).every((w) => RESTAURANT_WORDS.has(w))) return true;
  }
  return false;
}

/** The person's marks: brand key → restaurant or not. */
export async function marksFor(app: FastifyInstance, userId: number): Promise<Map<string, boolean>> {
  const rows = await app.db.select({ key: restaurantBrands.brandKey, on: restaurantBrands.isRestaurant }).from(restaurantBrands).where(eq(restaurantBrands.userId, userId));
  return new Map(rows.map((r) => [r.key, r.on]));
}

type Flaggable = { brand: string | null; restaurant?: boolean; kind?: string; id?: number; source?: string; sourceRef?: string | null };

// A food result (it has a foodKind) or a log entry (it has a sourceRef), anywhere in a response
const isFlaggable = (o: Record<string, unknown>): o is Flaggable & Record<string, unknown> =>
  "brand" in o && "name" in o && ("foodKind" in o || "sourceRef" in o) && (o.brand === null || typeof o.brand === "string");

function collect(value: unknown, out: Flaggable[], depth = 0) {
  if (depth > 6 || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const v of value) collect(v, out, depth + 1);
    return;
  }
  const o = value as Record<string, unknown>;
  if (isFlaggable(o)) out.push(o);
  for (const v of Object.values(o)) if (v && typeof v === "object") collect(v, out, depth + 1);
}

const cacheIdOf = (f: Flaggable): number | null => {
  if (f.kind === "cache" && typeof f.id === "number" && !("sourceRef" in f)) return f.id;
  const m = /^cache:(\d+)$/.exec(f.sourceRef ?? "");
  return m ? Number(m[1]) : null;
};

/** Sets `restaurant` on every food result and log entry in a response, for the person asking. */
export async function flagRestaurants(app: FastifyInstance, userId: number, payload: unknown): Promise<void> {
  const found: Flaggable[] = [];
  collect(payload, found);
  if (!found.length) return;
  const marks = await marksFor(app, userId);
  // Menu items: Spoonacular rows, and anything starred in Restaurants (FatSecret also has grocery foods, so not all of it)
  const cacheIds = [...new Set(found.map(cacheIdOf).filter((id): id is number => id !== null))];
  const menu = new Set<number>();
  if (cacheIds.length) {
    const [spoon, starred] = await Promise.all([
      app.db.select({ id: foodCache.id }).from(foodCache).where(and(inArray(foodCache.id, cacheIds), eq(foodCache.source, "spoonacular"))),
      app.db.select({ id: restaurantFavourites.cacheId }).from(restaurantFavourites).where(and(eq(restaurantFavourites.userId, userId), inArray(restaurantFavourites.cacheId, cacheIds))),
    ]);
    for (const r of [...spoon, ...starred]) menu.add(r.id);
  }
  for (const f of found) {
    const key = f.brand ? brandKey(f.brand) : "";
    const marked = key ? marks.get(key) : undefined;
    const id = cacheIdOf(f);
    f.restaurant = marked ?? ((f.source === "spoonacular" || (id !== null && menu.has(id))) || isChain(key));
  }
}

// Responses that are files or whole-account copies keep their shape
const SKIP = ["/api/export", "/api/admin/backups", "/api/backups"];

/** Adds the restaurant flag to every signed-in /api answer that holds foods or log entries. */
export function restaurantFlagsHook(app: FastifyInstance) {
  app.addHook("preSerialization", async (req: FastifyRequest, _reply, payload) => {
    if (!req.auth || !req.url.startsWith("/api/") || SKIP.some((p) => req.url.startsWith(p))) return payload;
    try {
      await flagRestaurants(app, req.auth.userId, payload);
    } catch (err) {
      // The tags are a nicety: the answer (maybe a log just written) still goes back, untagged
      req.log.warn({ err }, "restaurant tags skipped");
    }
    return payload;
  });
}
