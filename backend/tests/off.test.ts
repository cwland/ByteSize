import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { normalizeOff, offByBarcode, offSearch, OFF_FIELDS } from "../src/lib/foodSources/off.js";
import { SourceError } from "../src/lib/foodSources/types.js";
import { APP_VERSION } from "../src/lib/version.js";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const nutella = fixture("off-product-nutella.json");
const cola = fixture("off-product-cola.json");
const bar = fixture("off-product-nofiber.json");
const fairlife = fixture("off-product-fairlife.json");

// A fetch that answers from a table and records what it was asked
function fakeFetch(answer: (url: string, init?: RequestInit) => { status: number; json: unknown } | Promise<never>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = (async (input: any, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const r = await answer(url, init);
    return new Response(JSON.stringify(r.json), { status: r.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { f, calls };
}
const never = () => new Promise<never>(() => {});

describe("normalizeOff", () => {
  it("maps saturated fat (saturated-fat_100g)", () => {
    const f = normalizeOff(fairlife.product);
    expect(f.nutrients).toEqual({ calories: 50, protein_g: 5.4, carbs_g: 2.5, fat_g: 1.9, saturated_fat_g: 1.25, sugar_g: 2.5, sodium_mg: 50 });
    expect(f.servings).toEqual([{ label: "100 g", grams: 100 }, { label: "1 cup", grams: 240 }]);
    expect(f.category).toBe("en:milks");
  });

  it("a product per 100 g with a serving size", () => {
    expect(normalizeOff(nutella.product)).toEqual({
      source: "off",
      sourceId: "3017624010701",
      barcode: "3017624010701",
      name: "Nutella",
      brand: "Nutella",
      category: "en:breakfasts",
      servings: [
        { label: "100 g", grams: 100 },
        { label: "15 g", grams: 15 },
      ],
      nutrients: { calories: 539, protein_g: 6.3, fiber_g: 3.4, carbs_g: 57.5, fat_g: 30.9, saturated_fat_g: 10.6, sugar_g: 56.3, sodium_mg: 42.8 },
      imageUrl: "https://images.openfoodfacts.org/images/products/301/762/401/0701/front_en.81.200.jpg",
      raw: nutella.product,
    });
  });

  it("a beverage per 100 ml keeps millilitres and its can size", () => {
    expect(normalizeOff(cola.product)).toEqual({
      source: "off",
      sourceId: "5449000000996",
      barcode: "5449000000996",
      name: "Coca-Cola Original Taste",
      brand: "Coca-Cola",
      category: "en:beverages-and-beverages-preparations",
      servings: [
        { label: "100 ml", ml: 100 },
        { label: "330 ml", ml: 330 },
      ],
      nutrients: { calories: 42, protein_g: 0, carbs_g: 10.6, fat_g: 0, sugar_g: 10.6, sodium_mg: 0 },
      imageUrl: "https://images.openfoodfacts.org/images/products/544/900/000/0996/front_en.640.200.jpg",
      raw: cola.product,
    });
  });

  it("missing fiber stays unknown (absent, not 0); kJ-only energy and g→mg minerals convert", () => {
    const f = normalizeOff(bar.product);
    expect(f).toEqual({
      source: "off",
      sourceId: "0038000846731",
      barcode: "0038000846731",
      name: "Protein Bar Chocolate Peanut Butter",
      brand: "Sample Bars Co.",
      category: "en:snacks",
      servings: [
        { label: "100 g", grams: 100 },
        { label: "1 bar (40 g)", grams: 40 },
      ],
      nutrients: {
        calories: 400.1,
        protein_g: 37.5,
        carbs_g: 45,
        fat_g: 15,
        sugar_g: 5,
        added_sugar_g: 2.5,
        sugar_alcohol_g: 17.5,
        sodium_mg: 500,
        potassium_mg: 450,
        magnesium_mg: 75,
      },
      imageUrl: null,
      raw: bar.product,
    });
    expect("fiber_g" in f.nutrients).toBe(false);
  });

  it("a nameless product is called 'Unnamed product'; brands may be a list", () => {
    const f = normalizeOff({ code: "12345678", brands: ["Acme", "Acme Foods"], nutriments: { "energy-kcal_100g": 100 } });
    expect(f.name).toBe("Unnamed product");
    expect(f.brand).toBe("Acme");
    expect(f.category).toBeNull();
    expect(f.servings).toEqual([{ label: "100 g", grams: 100 }]);
  });
});

describe("offByBarcode", () => {
  it("asks the v2 product endpoint with the fields and ByteSize's User-Agent", async () => {
    const { f, calls } = fakeFetch(() => ({ status: 200, json: nutella }));
    const food = await offByBarcode(f, "3017624010701", 1000);
    expect(food?.name).toBe("Nutella");
    expect(calls[0].url).toBe(`https://world.openfoodfacts.org/api/v2/product/3017624010701.json?fields=${OFF_FIELDS}`);
    expect(OFF_FIELDS).toContain("nutriments");
    expect(new Headers(calls[0].init?.headers).get("user-agent")).toBe(`ByteSize/${APP_VERSION} (self-hosted; https://github.com/cwland/ByteSize)`);
  });

  it("status 0 (not found) and HTTP 404 are null", async () => {
    const notFound = { code: "0000000000000", status: 0, status_verbose: "product not found" };
    expect(await offByBarcode(fakeFetch(() => ({ status: 200, json: notFound })).f, "0000000000000", 1000)).toBeNull();
    expect(await offByBarcode(fakeFetch(() => ({ status: 404, json: notFound })).f, "0000000000000", 1000)).toBeNull();
  });

  it("a server error is a SourceError", async () => {
    await expect(offByBarcode(fakeFetch(() => ({ status: 503, json: {} })).f, "3017624010701", 1000)).rejects.toBeInstanceOf(SourceError);
  });

  it("a hanging server rejects with SourceError within the timeout", async () => {
    const started = Date.now();
    const err = await offByBarcode(fakeFetch(never).f, "3017624010701", 50).catch((e) => e);
    expect(err).toBeInstanceOf(SourceError);
    expect(err.source).toBe("off");
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("an unreachable server is a SourceError", async () => {
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await expect(offByBarcode(down, "3017624010701", 1000)).rejects.toBeInstanceOf(SourceError);
  });
});

describe("offSearch", () => {
  it("reads search-a-licious hits and drops items with no name or no energy", async () => {
    const hits = [nutella.product, { code: "111", nutriments: { "energy-kcal_100g": 50 } }, { code: "222", product_name: "Mystery", nutriments: { proteins_100g: 3 } }, cola.product];
    const { f, calls } = fakeFetch(() => ({ status: 200, json: { hits, count: 4, page: 1, page_size: 10, is_count_exact: true, timed_out: false } }));
    const foods = await offSearch(f, "choc spread", 1000);
    expect(foods.map((x) => x.name)).toEqual(["Nutella", "Coca-Cola Original Taste"]);
    expect(calls[0].url).toBe(`https://search.openfoodfacts.org/search?q=choc%20spread&page_size=10&fields=${OFF_FIELDS}`);
    expect(new Headers(calls[0].init?.headers).get("user-agent")).toMatch(/^ByteSize\//);
  });

  it("a hanging search rejects with SourceError within the timeout", async () => {
    const started = Date.now();
    await expect(offSearch(fakeFetch(never).f, "apple", 50)).rejects.toBeInstanceOf(SourceError);
    expect(Date.now() - started).toBeLessThan(500);
  });
});
