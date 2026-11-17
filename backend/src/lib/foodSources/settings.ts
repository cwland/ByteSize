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
