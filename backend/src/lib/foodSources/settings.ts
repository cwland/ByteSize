import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { appSettings } from "../../db/schema.js";
import { decryptSecret, encryptSecret } from "../secrets.js";

// Food source settings, in app_settings under "food_sources". The USDA key is stored encrypted.
const KEY = "food_sources";
type Stored = { usdaApiKey?: string | null };

async function stored(app: FastifyInstance): Promise<Stored> {
  const [row] = await app.db.select().from(appSettings).where(eq(appSettings.key, KEY));
  return (row?.value as Stored) ?? {};
}

/** The USDA FoodData Central key, or null when none is set (or it can't be read after a JWT_SECRET change). */
export async function usdaKey(app: FastifyInstance): Promise<string | null> {
  const enc = (await stored(app)).usdaApiKey;
  return enc ? decryptSecret(enc, app.jwtSecret) : null;
}

export async function setUsdaKey(app: FastifyInstance, key: string | null) {
  const value: Stored = { ...(await stored(app)), usdaApiKey: key ? encryptSecret(key, app.jwtSecret) : null };
  await app.db
    .insert(appSettings)
    .values({ key: KEY, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}

// Restaurant sources: the Spoonacular key and FatSecret client id + secret, all encrypted like the USDA key.
type KeyField = "usdaApiKey" | "spoonacularApiKey" | "fatsecretClientId" | "fatsecretClientSecret";
export type SourceKeys = Partial<Record<KeyField, string | null>>;
export type RestaurantKeys = { spoonacular: string | null; fatsecret: { clientId: string; clientSecret: string } | null };

/** The restaurant credentials that are set (FatSecret only counts with both its id and secret). */
export async function restaurantKeys(app: FastifyInstance): Promise<RestaurantKeys> {
  const s = (await stored(app)) as Stored & SourceKeys;
  const open = (enc: string | null | undefined) => (enc ? decryptSecret(enc, app.jwtSecret) : null);
  const clientId = open(s.fatsecretClientId);
  const clientSecret = open(s.fatsecretClientSecret);
  return { spoonacular: open(s.spoonacularApiKey), fatsecret: clientId && clientSecret ? { clientId, clientSecret } : null };
}

/** Sets the keys given (null or blank removes one; a key left out is kept). */
export async function setSourceKeys(app: FastifyInstance, keys: SourceKeys) {
  const value: Record<string, unknown> = { ...(await stored(app)) };
  for (const [field, key] of Object.entries(keys)) {
    if (key === undefined) continue;
    value[field] = key ? encryptSecret(key, app.jwtSecret) : null;
  }
  await app.db
    .insert(appSettings)
    .values({ key: KEY, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}
