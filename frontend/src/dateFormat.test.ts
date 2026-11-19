import { describe, expect, it } from "vitest";
import { DATE_FORMATS, DEFAULT_DATE_FORMAT, formatDate, formatDay } from "./dateFormat";

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

// A day without its weekday, in the person's format (§40a goal date): "Apr 5"; the year only when it's a year or more away
const SHORT: Record<string, [string, string]> = {
  "weekday-long-month-short": ["Apr 5", "Apr 5, 2028"],
  "weekday-short-month-short": ["Apr 5", "Apr 5, 2028"],
  "weekday-long-month-long": ["April 5", "April 5, 2028"],
  "mdy-slash": ["04/05/2027", "04/05/2028"],
  "weekday-long-day-month-short": ["5 Apr", "5 Apr 2028"],
  "weekday-short-day-month-short": ["5 Apr", "5 Apr 2028"],
  "weekday-long-day-month-long": ["5 April", "5 April 2028"],
  "dmy-slash": ["05/04/2027", "05/04/2028"],
  "dmy-dot": ["05.04.2027", "05.04.2028"],
  iso: ["2027-04-05", "2028-04-05"],
};

describe("formatDay", () => {
  it.each(Object.entries(SHORT))("%s", (key, [soon, later]) => {
    expect(formatDay("2027-04-05", key, DAY)).toBe(soon);
    expect(formatDay("2028-04-05", key, DAY)).toBe(later);
  });

  it("an unknown key is the default look; a date 364 days away has no year, 365 days away has one", () => {
    expect(formatDay("2027-04-05", "nope", DAY)).toBe("Apr 5");
    expect(formatDay("2027-11-17", undefined, DAY)).toBe("Nov 17");
    expect(formatDay("2027-11-18", undefined, DAY)).toBe("Nov 18, 2027");
  });
});
