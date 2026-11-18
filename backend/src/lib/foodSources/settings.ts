import type { FastifyInstance } from "fastify";
import { eq, sql } from "drizzle-orm";
import { appSettings } from "../../db/schema.js";
import { decryptSecret, encryptSecret } from "../secrets.js";

// Food source settings, in app_settings under "food_sources". The USDA key is stored encrypted.
// enabled: the admin's on/off switch per source (Settings › Integrations); a source never switched has none.
const KEY = "food_sources";
export const SWITCHED_SOURCES = ["off", "usda", "spoonacular", "fatsecret"] as const;
export type SwitchedSource = (typeof SWITCHED_SOURCES)[number];
export type SourceSwitches = Record<SwitchedSource, boolean>;
type Stored = { usdaApiKey?: string | null; enabled?: Partial<SourceSwitches> };

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
  await setSourceKeys(app, { usdaApiKey: key });
}

// Restaurant sources: the Spoonacular key and FatSecret client id + secret, all encrypted like the USDA key.
type KeyField = "usdaApiKey" | "spoonacularApiKey" | "fatsecretClientId" | "fatsecretClientSecret";
export type SourceKeys = Partial<Record<KeyField, string | null>>;
export type RestaurantKeys = { spoonacular: string | null; fatsecret: { clientId: string; clientSecret: string } | null };

/**
 * Writes the fields given into the stored value in one statement (a JSONB merge in the database, never a
 * read-modify-write), so a switch save and a key save at the same time can't undo each other. The
 * switches are merged one level down, inside "enabled". Fields left out stay as they are.
 */
async function merge(app: FastifyInstance, fields: Record<string, unknown>, switches: Partial<SourceSwitches> = {}) {
  const hasSwitches = Object.keys(switches).length > 0;
  const value = hasSwitches ? { ...fields, enabled: switches } : fields;
  const enabled = hasSwitches ? sql` || jsonb_build_object('enabled', coalesce(app_settings.value -> 'enabled', '{}'::jsonb) || ${JSON.stringify(switches)}::jsonb)` : sql``;
  await app.db
    .insert(appSettings)
    .values({ key: KEY, value })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: {
        value: sql`app_settings.value || ${JSON.stringify(fields)}::jsonb${enabled}`,
        updatedAt: new Date(),
      },
    });
}

/**
 * Whether each source is on. A source never switched follows the starting rule (also for servers set up
 * before the switches): Open Food Facts on; USDA, Spoonacular and FatSecret on when their key is saved.
 */
export async function sourceSwitches(app: FastifyInstance): Promise<SourceSwitches> {
  const s = await stored(app);
  const keys = await restaurantKeys(app);
  const set = s.enabled ?? {};
  return {
    off: set.off ?? true,
    usda: set.usda ?? (await usdaKey(app)) !== null,
    spoonacular: set.spoonacular ?? keys.spoonacular !== null,
    fatsecret: set.fatsecret ?? keys.fatsecret !== null,
  };
}

/** Turns the sources given on or off; the keys are never touched. */
export async function setSourceSwitches(app: FastifyInstance, switches: Partial<SourceSwitches>) {
  await merge(app, {}, switches);
}

/** The USDA key when USDA is on and has one; else null (USDA isn't asked). */
export async function usdaKeyInUse(app: FastifyInstance): Promise<string | null> {
  return (await sourceSwitches(app)).usda ? usdaKey(app) : null;
}

/** The restaurant credentials of the sources that are on (a source that is off counts as not set). */
export async function restaurantKeysInUse(app: FastifyInstance): Promise<RestaurantKeys> {
  const [keys, on] = [await restaurantKeys(app), await sourceSwitches(app)];
  return { spoonacular: on.spoonacular ? keys.spoonacular : null, fatsecret: on.fatsecret ? keys.fatsecret : null };
}

/** The keys as stored (encrypted), for the eye and copy buttons to open one at a time. */
export async function savedSourceKeys(app: FastifyInstance): Promise<SourceKeys> {
  return (await stored(app)) as SourceKeys;
}

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
  const fields: Record<string, string | null> = {};
  for (const [field, key] of Object.entries(keys)) {
    if (key === undefined) continue;
    fields[field] = key ? encryptSecret(key, app.jwtSecret) : null;
  }
  await merge(app, fields);
}
