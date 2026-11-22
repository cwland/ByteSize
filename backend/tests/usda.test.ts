import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { normalizeUsda, usdaByBarcode, usdaSearch } from "../src/lib/foodSources/usda.js";
import { SourceError } from "../src/lib/foodSources/types.js";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const apple = fixture("usda-foundation-apple.json");
const yogurt = fixture("usda-branded-yogurt.json");
const page = (foods: unknown[]) => ({ totalHits: foods.length, currentPage: 1, totalPages: 1, pageList: [1], foodSearchCriteria: {}, foods, aggregations: {} });

function fakeFetch(answer: (url: string, init?: RequestInit) => { status: number; json: unknown } | Promise<{ status: number; json: unknown }>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = (async (input: any, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const r = await answer(url, init);
    return new Response(JSON.stringify(r.json), { status: r.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { f, calls };
}

describe("normalizeUsda", () => {
  it("a Foundation food per 100 g (energy from Atwater when 208 is missing)", () => {
    expect(normalizeUsda(apple)).toEqual({
      source: "usda",
      sourceId: "1750340",
      barcode: null,
      name: "Apples, fuji, with skin, raw",
      brand: null,
      category: "Fruits and Fruit Juices",
      servings: [{ label: "100 g", grams: 100 }],
      nutrients: { calories: 63, protein_g: 0.15, fiber_g: 2.1, carbs_g: 15.7, fat_g: 0.16, saturated_fat_g: 0.03, sugar_g: 13.3, sodium_mg: 0, potassium_mg: 109, magnesium_mg: 4.7 },
      imageUrl: null,
      raw: apple,
    });
  });

  it("a Branded food keeps its barcode, brand and household serving", () => {
    expect(normalizeUsda(yogurt)).toEqual({
      source: "usda",
      sourceId: "2346404",
      barcode: "0036632035676",
      name: "GREEK NONFAT YOGURT, PLAIN",
      brand: "OIKOS",
      category: "Yogurt",
      servings: [
        { label: "100 g", grams: 100 },
        { label: "3/4 cup", grams: 170 },
      ],
      nutrients: { calories: 53, protein_g: 10, fiber_g: 0, carbs_g: 3.53, fat_g: 0, saturated_fat_g: 0, sugar_g: 2.35, added_sugar_g: 0, sodium_mg: 35, potassium_mg: 141 },
      imageUrl: null,
      raw: yogurt,
    });
  });

  it("missing nutrients stay absent; a category object and a millilitre serving work", () => {
    const drink = {
      fdcId: 1,
      description: "Cold brew",
      dataType: "Branded",
      brandOwner: "Brew Co",
      foodCategory: { description: "Coffee" },
      servingSize: 355,
      servingSizeUnit: "MLT",
      foodNutrients: [{ nutrientNumber: "208", nutrientName: "Energy", unitName: "KCAL", value: 2 }],
    };
    const f = normalizeUsda(drink);
    expect(f.nutrients).toEqual({ calories: 2 });
    expect(f.brand).toBe("Brew Co");
    expect(f.category).toBe("Coffee");
    expect(f.servings).toEqual([
      { label: "100 ml", ml: 100 },
      { label: "355 ml", ml: 355 },
    ]);
  });
});

describe("usda clients", () => {
  it("search asks for basic foods and branded foods separately (in parallel) with the key", async () => {
    const noEnergy = { fdcId: 9, description: "No energy", dataType: "SR Legacy", foodNutrients: [] };
    // Like the real API: each call gets only the data types it asked for
    const { f, calls } = fakeFetch((_url, init) => {
      const want: string[] = JSON.parse(String(init?.body)).dataType;
      return { status: 200, json: page([apple, yogurt, noEnergy].filter((x) => want.includes(x.dataType))) };
    });
    const { foods, error } = await usdaSearch(f, "KEY123", "apple", 1000);
    expect(error).toBeNull();
    expect(foods.map((x) => [x.sourceId, x.basic])).toEqual([
      ["1750340", true],
      ["2346404", undefined],
    ]);
    expect(calls).toHaveLength(2);
    for (const c of calls) {
      expect(c.url).toBe("https://api.nal.usda.gov/fdc/v1/foods/search?api_key=KEY123");
      expect(c.init?.method).toBe("POST");
    }
    expect(calls.map((c) => JSON.parse(String(c.init?.body)))).toEqual([
      { query: "apple", pageSize: 5, dataType: ["Foundation", "SR Legacy"] },
      { query: "apple", pageSize: 10, dataType: ["Branded"] },
    ]);
  });

  it("a food both calls return is kept once, as a basic food", async () => {
    const { f } = fakeFetch(() => ({ status: 200, json: page([apple]) }));
    const { foods } = await usdaSearch(f, "KEY123", "apple", 1000);
    expect(foods.map((x) => [x.sourceId, x.basic])).toEqual([["1750340", true]]);
  });

  it("one call failing keeps the other's foods and reports the failure; both failing is an error", async () => {
    const failing = (bad: string) =>
      fakeFetch((_url, init) => {
        const want: string[] = JSON.parse(String(init?.body)).dataType;
        return want.includes(bad) ? { status: 500, json: {} } : { status: 200, json: page([apple, yogurt].filter((x) => want.includes(x.dataType))) };
      }).f;
    const brandedDown = await usdaSearch(failing("Branded"), "KEY123", "apple", 1000);
    expect(brandedDown.foods.map((x) => [x.sourceId, x.basic])).toEqual([["1750340", true]]);
    expect(brandedDown.error).toBeInstanceOf(SourceError);
    expect(brandedDown.error!.message).toBe("USDA answered with an error (500)");
    const basicDown = await usdaSearch(failing("Foundation"), "KEY123", "apple", 1000);
    expect(basicDown.foods.map((x) => x.sourceId)).toEqual(["2346404"]);
    expect(basicDown.error).toBeInstanceOf(SourceError);
  });

  it("the two calls run at the same time", async () => {
    let open = 0;
    let most = 0;
    const { f } = fakeFetch(async () => {
      most = Math.max(most, ++open);
      await new Promise((r) => setTimeout(r, 20));
      open--;
      return { status: 200, json: page([]) };
    });
    await usdaSearch(f, "KEY123", "apple", 1000);
    expect(most).toBe(2);
  });

  it("barcode searches Branded foods and keeps only a matching gtinUpc", async () => {
    const other = { ...yogurt, fdcId: 5, gtinUpc: "036632099999" };
    const { f, calls } = fakeFetch(() => ({ status: 200, json: page([other, yogurt]) }));
    const food = await usdaByBarcode(f, "KEY123", "0036632035676", 1000);
    expect(food?.sourceId).toBe("2346404");
    // USDA only matches the 12-digit UPC-A it stores, so a US code is asked for without its leading 0
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ query: "036632035676", pageSize: 10, dataType: ["Branded"] });
    expect(await usdaByBarcode(fakeFetch(() => ({ status: 200, json: page([other]) })).f, "KEY123", "0036632035676", 1000)).toBeNull();
  });

  it("a scanned 12-digit UPC is asked for as is; a true EAN-13 keeps all 13 digits", async () => {
    const upc = fakeFetch(() => ({ status: 200, json: page([yogurt]) }));
    expect((await usdaByBarcode(upc.f, "K", "036632035676", 1000))?.sourceId).toBe("2346404");
    expect(JSON.parse(String(upc.calls[0].init?.body)).query).toBe("036632035676");
    const ean = fakeFetch(() => ({ status: 200, json: page([]) }));
    await usdaByBarcode(ean.f, "K", "4006381333931", 1000);
    expect(JSON.parse(String(ean.calls[0].init?.body)).query).toBe("4006381333931");
  });

  it("errors are SourceErrors that never show the key; a hang times out", async () => {
    const err = await usdaSearch(fakeFetch(() => ({ status: 500, json: {} })).f, "SECRETKEY", "apple", 1000).catch((e) => e);
    expect(err).toBeInstanceOf(SourceError);
    expect(err.source).toBe("usda");
    expect(String(err.message)).not.toContain("SECRETKEY");
    const started = Date.now();
    await expect(usdaByBarcode(fakeFetch(() => new Promise<never>(() => {})).f, "K", "0036632035676", 50)).rejects.toBeInstanceOf(SourceError);
    expect(Date.now() - started).toBeLessThan(500);
  });
});
