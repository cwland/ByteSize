// Small builders for the fake food web (Open Food Facts, USDA) and the fake AI used by the food tests.
import type { TestApp } from "./helpers.js";

export const OFF_PRODUCT = "https://world.openfoodfacts.org/api/v2/product/";
export const OFF_SEARCH = "https://search.openfoodfacts.org/search";
export const USDA = "https://api.nal.usda.gov/fdc/v1/foods/search";

/** An OFF product (per 100 g, with a serving) as the API sends it. */
export function offProduct(code: string, name: string, kcal: number, extra: Record<string, unknown> = {}) {
  return {
    code,
    product_name: name,
    brands: "Acme",
    categories_tags: ["en:snacks"],
    nutriments: { "energy-kcal_100g": kcal, proteins_100g: 10, carbohydrates_100g: 50, fat_100g: 20 },
    serving_size: "40 g",
    serving_quantity: 40,
    ...extra,
  };
}

/** A USDA search hit (per 100 g). */
export function usdaFood(fdcId: number, description: string, kcal: number, gtinUpc?: string) {
  return {
    fdcId,
    description,
    dataType: gtinUpc ? "Branded" : "Foundation",
    ...(gtinUpc ? { gtinUpc, brandOwner: "Farm Co", servingSize: 170, servingSizeUnit: "g", householdServingFullText: "3/4 cup" } : {}),
    foodCategory: "Dairy and Egg Products",
    foodNutrients: [
      { nutrientNumber: "208", unitName: "KCAL", value: kcal },
      { nutrientNumber: "203", unitName: "G", value: 9 },
    ],
  };
}

/**
 * A USDA search answer holding only the hits of the data types that request asked for, like the
 * real API (search asks for Foundation/SR Legacy and Branded in separate calls).
 */
export function usdaReply(call: { body: any }, foods: ReturnType<typeof usdaFood>[]) {
  const want: string[] = call.body?.dataType ?? [];
  return { status: 200, json: { foods: foods.filter((f) => want.includes(f.dataType)) } };
}

/** OFF knows these products by barcode (EAN-13); everything else is "not found". */
export function offKnows(t: TestApp, products: Record<string, ReturnType<typeof offProduct>>) {
  t.foodWeb.respond = (url) => {
    if (url.startsWith(OFF_PRODUCT)) {
      const code = url.slice(OFF_PRODUCT.length).split(".json")[0];
      const p = products[code];
      return p ? { status: 200, json: { code, status: 1, product: p } } : { status: 404, json: { code, status: 0, status_verbose: "product not found" } };
    }
    if (url.startsWith(OFF_SEARCH)) return { status: 200, json: { hits: [] } };
    if (url.startsWith(USDA)) return { status: 200, json: { foods: [] } };
    return { status: 404, json: {} };
  };
}

export const never = () => new Promise<never>(() => {});

export const HOME_AI = "http://10.0.0.5:11434/v1";
export const aiSettings = {
  enabled: true,
  mode: "manual",
  maxPerRun: 50,
  timeoutSec: 3,
  services: [{ name: "Home AI", provider: "local", baseUrl: HOME_AI, model: "qwen" }],
};

/** The fake AI answers every question with this JSON. */
export function aiAnswers(t: TestApp, json: unknown) {
  t.ai.respond = () => ({ status: 200, json: { choices: [{ message: { content: JSON.stringify(json) } }] } });
}

/** The system + user text of the last AI call (any provider shape). */
export function lastAiPrompt(t: TestApp): string {
  const call = t.ai.calls[t.ai.calls.length - 1];
  return JSON.stringify(call?.body ?? "");
}
