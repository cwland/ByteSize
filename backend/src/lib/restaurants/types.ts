// Restaurant menu sources (Spoonacular, FatSecret) behind one adapter shape, so another provider can replace either.
import { SourceError, type SourceFood } from "../foodSources/types.js";

export { SourceError };
export const RESTAURANT_SOURCES = ["spoonacular", "fatsecret"] as const;
export type RestaurantSource = (typeof RESTAURANT_SOURCES)[number];

/** One menu item as a search lists it (calories per item when the source gives them). */
export type MenuHit = { source: RestaurantSource; sourceId: string; chain: string; name: string; calories: number | null; imageUrl: string | null };

/** Today's points left (Spoonacular's X-API-Quota-Left). */
export type Quota = { left: number };

export interface RestaurantAdapter {
  source: RestaurantSource;
  /** Errors are SourceError with kind quota | down | bad_key | bad_data; never retried here. */
  search(q: string, limit?: number): Promise<{ items: MenuHit[]; quota?: Quota }>;
  item(id: string): Promise<{ food: SourceFood; quota?: Quota }>;
}

/** A source id is digits only (both sources use numeric ids); anything else never reaches a URL. */
export const SOURCE_ID = /^\d{1,19}$/;
