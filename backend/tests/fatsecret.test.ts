import { describe, expect, it } from "vitest";
import { fatsecret, type FatSecretToken } from "../src/lib/restaurants/fatsecret.js";
import { SourceError } from "../src/lib/foodSources/types.js";
import { FS_API, FS_TOKEN, fsFood, fsHit } from "./restaurantFakes.js";

type Reply = { status: number; json?: unknown; text?: string };
type Call = { url: string; method: string; headers: Record<string, string>; body: URLSearchParams };
function fakeFetch(api: (p: URLSearchParams, call: Call) => Reply, token: () => Reply = () => ({ status: 200, json: { access_token: "tok-1", token_type: "Bearer", expires_in: 86400 } })) {
  const calls: Call[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    const call = { url, method: init?.method ?? "GET", headers: Object.fromEntries(new Headers(init?.headers).entries()), body: new URLSearchParams(String(init?.body ?? "")) };
    calls.push(call);
    const r = url === FS_TOKEN ? token() : url === FS_API ? api(call.body, call) : { status: 404, json: {} };
    return new Response(r.text ?? JSON.stringify(r.json), { status: r.status });
  }) as typeof fetch;
  return { fetchFn, calls };
}

function setup(f: ReturnType<typeof fakeFetch>, start = Date.parse("2026-11-17T12:00:00Z")) {
  const clock = { ms: start };
  const tokens = new Map<string, FatSecretToken>();
  const make = () => fatsecret({ fetch: f.fetchFn, clientId: "fs-id", clientSecret: "fs-secret", timeoutMs: 3000, now: () => clock.ms, tokens });
  return { clock, tokens, make };
}

const burrito = fsFood(101, "Chicken Burrito", "Chipotle", [
  { serving_id: "1", serving_description: "1 burrito", metric_serving_amount: "510.000", metric_serving_unit: "g", number_of_units: "1.000", measurement_description: "burrito", calories: "1070", fat: "41.00", saturated_fat: "17.000", carbohydrate: "120.00", fiber: "13.0", sugar: "6.00", protein: "52.00", sodium: "2440", potassium: "980", cholesterol: "150" },
]);

describe("FatSecret adapter", () => {
  it("gets a client-credentials token (Basic auth) and reuses it until it expires", async () => {
    const f = fakeFetch(() => ({ status: 200, json: { foods: { food: [], max_results: "20", total_results: "0", page_number: "0" } } }));
    const { clock, make } = setup(f);
    await make().search("chipotle");
    await make().search("taco bell");
    const tokens = f.calls.filter((c) => c.url === FS_TOKEN);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].method).toBe("POST");
    expect(tokens[0].headers.authorization).toBe("Basic " + Buffer.from("fs-id:fs-secret").toString("base64"));
    expect(tokens[0].body.get("grant_type")).toBe("client_credentials");
    expect(tokens[0].body.get("client_secret")).toBeNull(); // only in the Basic header
    const api = f.calls.filter((c) => c.url === FS_API);
    expect(api.map((c) => c.headers.authorization)).toEqual(["Bearer tok-1", "Bearer tok-1"]);
    clock.ms += 86400 * 1000; // a day later the token has expired
    await make().search("wendys");
    expect(f.calls.filter((c) => c.url === FS_TOKEN)).toHaveLength(2);
  });

  it("searches restaurant (brand) foods only and reads calories from the description", async () => {
    const f = fakeFetch((p) => {
      expect(p.get("method")).toBe("foods.search");
      expect(p.get("search_expression")).toBe("burrito");
      expect(p.get("format")).toBe("json");
      expect(p.get("max_results")).toBe("20");
      return { status: 200, json: { foods: { food: [fsHit(101, "Chicken Burrito", "Chipotle", 1070), fsHit(5, "Burrito", null, 200, "100g"), fsHit(102, "Bean Burrito", "Taco Bell", 350)] } } };
    });
    const r = await setup(f).make().search("burrito");
    expect(r.items).toEqual([
      { source: "fatsecret", sourceId: "101", chain: "Chipotle", name: "Chicken Burrito", calories: 1070, imageUrl: null },
      { source: "fatsecret", sourceId: "102", chain: "Taco Bell", name: "Bean Burrito", calories: 350, imageUrl: null },
    ]);
    expect(r.quota).toBeUndefined();
  });

  it("a single hit (an object, not a list) and no hits both work", async () => {
    let reply: unknown = { foods: { food: fsHit(9, "Whopper", "Burger King", 670) } };
    const f = fakeFetch(() => ({ status: 200, json: reply }));
    const { make } = setup(f);
    expect((await make().search("whopper")).items.map((i) => i.name)).toEqual(["Whopper"]);
    reply = { foods: { max_results: "20", total_results: "0", page_number: "0" } };
    expect((await make().search("zzz")).items).toEqual([]);
  });

  it("maps an item's default serving: nutrients metric, grams from the metric amount", async () => {
    const f = fakeFetch((p) => {
      expect(p.get("method")).toBe("food.get.v2");
      expect(p.get("food_id")).toBe("101");
      return { status: 200, json: { food: burrito } };
    });
    const r = await setup(f).make().item("101");
    expect(r.food).toMatchObject({
      source: "fatsecret",
      sourceId: "101",
      name: "Chicken Burrito",
      brand: "Chipotle",
      servings: [{ label: "1 burrito", grams: 510 }],
      nutrients: { calories: 1070, fat_g: 41, saturated_fat_g: 17, carbs_g: 120, fiber_g: 13, sugar_g: 6, protein_g: 52, sodium_mg: 2440, potassium_mg: 980 },
      imageUrl: null,
    });
    expect(r.food.nutrients.added_sugar_g).toBeUndefined();
  });

  it("prefers the default serving and keeps servings-only without a metric weight", async () => {
    const food = fsFood(7, "Fries", "Wendy's", [
      { serving_description: "1 small", metric_serving_amount: "2.5", metric_serving_unit: "oz", calories: "230" },
      { serving_description: "1 medium", calories: "350", is_default: "1", fat: "" },
    ]);
    const r = await setup(fakeFetch(() => ({ status: 200, json: { food } }))).make().item("7");
    expect(r.food.servings).toEqual([{ label: "1 medium" }]);
    expect(r.food.nutrients).toEqual({ calories: 350 });
  });

  it("refused credentials are a bad key; an expired token is renewed once", async () => {
    const bad = fakeFetch(() => ({ status: 200, json: {} }), () => ({ status: 400, json: { error: "invalid_client" } }));
    const err = await setup(bad).make().search("x").catch((e) => e);
    expect(err).toBeInstanceOf(SourceError);
    expect(err.kind).toBe("bad_key");
    expect(err.message).not.toContain("fs-secret");

    let n = 0;
    const expired = fakeFetch(() => (++n === 1 ? { status: 200, json: { error: { code: 13, message: "Invalid access token" } } } : { status: 200, json: { foods: { food: [] } } }));
    const r = await setup(expired).make().search("x");
    expect(r.items).toEqual([]);
    expect(expired.calls.filter((c) => c.url === FS_TOKEN)).toHaveLength(2);
    expect(expired.calls.filter((c) => c.url === FS_API)).toHaveLength(2);
  });

  it("an IP not allowed is a bad key with a plain message; other errors and junk are down / bad_data, never retried", async () => {
    const ip = fakeFetch(() => ({ status: 200, json: { error: { code: 21, message: "Invalid IP address detected: '1.2.3.4'" } } }));
    const e1 = await setup(ip).make().search("x").catch((e) => e);
    expect(e1.kind).toBe("bad_key");
    expect(e1.message).toMatch(/IP address/);
    expect(ip.calls.filter((c) => c.url === FS_API)).toHaveLength(1);

    const junk = fakeFetch(() => ({ status: 200, text: "<html>" }));
    expect(await setup(junk).make().search("x").catch((e) => e.kind)).toBe("bad_data");
    const down = fakeFetch(() => ({ status: 503, json: {} }));
    expect(await setup(down).make().search("x").catch((e) => e.kind)).toBe("down");
    expect(down.calls.filter((c) => c.url === FS_API)).toHaveLength(1);
    const noFood = fakeFetch(() => ({ status: 200, json: { error: { code: 106, message: "Invalid ID" } } }));
    expect(await setup(noFood).make().item("1").catch((e) => e.kind)).toBe("bad_data");
  });

  it("drops hits whose id isn't a number", async () => {
    const f = fakeFetch(() => ({ status: 200, json: { foods: { food: [{ ...fsHit(1, "Evil", "X", 1), food_id: "1; drop" }, fsHit(2, "Fine", "Y", 5)] } } }));
    expect((await setup(f).make().search("abc")).items.map((i) => i.sourceId)).toEqual(["2"]);
  });
});
