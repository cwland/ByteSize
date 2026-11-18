import { describe, expect, it } from "vitest";
import { DATE_FORMATS, DEFAULT_DATE_FORMAT, formatDate } from "./dateFormat";

// Wednesday, 18 November 2026
const DAY = "2026-11-18";
// Wednesday, 4 March 2026: a single-digit day and month
const EARLY = "2026-03-04";

const EXPECTED: Record<string, [string, string]> = {
  "weekday-long-month-short": ["Wednesday, Nov 18", "Wednesday, Mar 4"],
  "weekday-short-month-short": ["Wed, Nov 18", "Wed, Mar 4"],
  "weekday-long-month-long": ["Wednesday, November 18", "Wednesday, March 4"],
  "mdy-slash": ["11/18/2026", "03/04/2026"],
  "weekday-long-day-month-short": ["Wednesday 18 Nov", "Wednesday 4 Mar"],
  "weekday-short-day-month-short": ["Wed 18 Nov", "Wed 4 Mar"],
  "weekday-long-day-month-long": ["Wednesday 18 November", "Wednesday 4 March"],
  "dmy-slash": ["18/11/2026", "04/03/2026"],
  "dmy-dot": ["18.11.2026", "04.03.2026"],
  iso: ["2026-11-18", "2026-03-04"],
};

describe("formatDate", () => {
  it("has the ten choices, today's look first and the default", () => {
    expect(DATE_FORMATS.map((f) => f.key)).toEqual(Object.keys(EXPECTED));
    expect(DEFAULT_DATE_FORMAT).toBe("weekday-long-month-short");
  });
  it.each(Object.entries(EXPECTED))("%s", (key, [late, early]) => {
    expect(formatDate(DAY, key)).toBe(late);
    expect(formatDate(EARLY, key)).toBe(early);
  });
  it("an unknown or missing key is today's look", () => {
    expect(formatDate(DAY, "nope")).toBe("Wednesday, Nov 18");
    expect(formatDate(DAY, undefined)).toBe("Wednesday, Nov 18");
  });
  it("is the same in any browser time zone (a day is a calendar date, not a moment)", () => {
    expect(formatDate("2026-12-31", "weekday-short-day-month-short")).toBe("Thu 31 Dec");
    expect(formatDate("2027-01-01", "iso")).toBe("2027-01-01");
  });
});
