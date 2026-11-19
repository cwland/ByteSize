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
    expect(planPickerHref("/")).toBe("#/goals/plan?from=%2F");
    // URL-encoded (§46): a route with its own ?, & or # comes back whole
    expect(planPickerHref("/log/my-foods?from=/&x=1")).toBe("#/goals/plan?from=%2Flog%2Fmy-foods%3Ffrom%3D%2F%26x%3D1");
    expect(new URLSearchParams(planPickerHref("/a?b=1&c=2").split("?").slice(1).join("?")).get("from")).toBe("/a?b=1&c=2");
    expect(planPickerHref()).toBe("#/goals/plan");
  });
});
