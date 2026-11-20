import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { amountFactor, UnitError, type Serving, type Unit } from "../src/lib/nutrients.js";

// The amount cases the server and the iPhone app both check (L1): the phone's "≈ N cal" must match what's logged.
// The iPhone package keeps a byte-identical copy (ios/ByteSizeKit/Tests/ByteSizeKitTests/Resources/amount-vectors.json).
type Vector = { name: string; servings: Serving[]; servingIndex: number; unit: Unit; quantity: number; factor: number | null };
const file = path.join(import.meta.dirname, "fixtures", "amount-vectors.json");
const vectors = JSON.parse(readFileSync(file, "utf8")) as Vector[];

describe("shared amount vectors", () => {
  it.each(vectors.map((v) => [v.name, v] as const))("%s", (_, v) => {
    const run = () => amountFactor(v.servings, v.servingIndex, v.unit, v.quantity);
    if (v.factor === null) expect(run).toThrow(UnitError);
    else expect(run()).toBeCloseTo(v.factor, 9);
  });

  it("the iPhone package has the same cases", () => {
    const copy = path.join(import.meta.dirname, "..", "..", "ios", "ByteSizeKit", "Tests", "ByteSizeKitTests", "Resources", "amount-vectors.json");
    expect(readFileSync(copy, "utf8")).toBe(readFileSync(file, "utf8"));
  });
});
