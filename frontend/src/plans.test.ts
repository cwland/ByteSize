import { describe, expect, it } from "vitest";
import { planName, planPickerHref } from "./plans";

describe("planName", () => {
  it("a chosen plan by name (Goals adds 'plan'); targets set by hand are your own", () => {
    expect(planName({ plan: "steady" })).toBe("Steady");
    expect(planName({ plan: "steady" }, true)).toBe("Steady plan");
    expect(planName({ plan: null })).toBe("Your own targets");
    expect(planName({ plan: null }, true)).toBe("Your own targets");
  });
});

describe("planPickerHref", () => {
  it("opens Goals' plan picker, coming back to where it was opened from", () => {
    expect(planPickerHref("/")).toBe("#/goals/plan?from=/");
    expect(planPickerHref()).toBe("#/goals/plan");
  });
});
