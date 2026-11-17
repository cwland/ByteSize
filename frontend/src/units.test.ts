import { describe, expect, it } from "vitest";
import { cmToFtIn, flOzToMl, formatWater, formatWeight, inToCm, kgToLb, lbToKg, mlToFlOz } from "./units";

describe("units", () => {
  it("round trips height: 5 ft 10 in is 177.8 cm", () => {
    expect(inToCm(5 * 12 + 10)).toBeCloseTo(177.8, 6);
    expect(cmToFtIn(177.8)).toEqual({ ft: 5, in: 10 });
    expect(cmToFtIn(182.8)).toEqual({ ft: 6, in: 0 }); // 71.97 in rounds up to 6 ft 0 in, not 5 ft 12 in
  });

  it("round trips weight: 250 lb is 113.398 kg", () => {
    expect(lbToKg(250)).toBeCloseTo(113.398, 3);
    expect(kgToLb(lbToKg(250))).toBeCloseTo(250, 9);
  });

  it("round trips water: 64 fl oz is about 1893 ml", () => {
    expect(Math.abs(flOzToMl(64) - 1893)).toBeLessThanOrEqual(1);
    expect(mlToFlOz(flOzToMl(64))).toBeCloseTo(64, 9);
  });

  it("formats weight and water in the person's units (imperial by default)", () => {
    expect(formatWeight(113.3980925, "imperial")).toBe("250 lb");
    expect(formatWeight(113.3980925, "metric")).toBe("113.4 kg");
    expect(formatWater(1893, "imperial")).toBe("64 fl oz");
    expect(formatWater(1893, "metric")).toBe("1,893 ml");
  });
});
