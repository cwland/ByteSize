import { describe, expect, it } from "vitest";
import { statusText } from "./glp1";
import { glp1View as fixture } from "../../test/glp1Fixtures";
import type { Glp1View } from "../../types";

const glp1View = (over: Record<string, unknown>) => fixture(over) as unknown as Glp1View;

describe("the next shot line", () => {
  it("shows the date, not just the weekday; the year only when it isn't this year", () => {
    const now = new Date("2026-11-17T19:00:00Z");
    expect(statusText(glp1View({ status: "upcoming", nextDue: "2026-11-19" }), now)).toBe("Next shot Thu, Nov 19");
    expect(statusText(glp1View({ status: "upcoming", nextDue: "2027-01-02" }), now)).toBe("Next shot Sat, Jan 2, 2027");
    expect(statusText(glp1View({ status: "due", nextDue: "2026-11-17" }), now)).toBe("Injection day");
  });
});
