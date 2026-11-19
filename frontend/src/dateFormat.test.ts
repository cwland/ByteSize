import { describe, expect, it } from "vitest";
import { DATE_FORMATS, DEFAULT_DATE_FORMAT, formatDate, formatDay, formatDayRange } from "./dateFormat";

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

// A day without its weekday, in the person's format (§40a goal date): "Dec 5"; the year when it isn't this year
const SHORT: Record<string, [string, string]> = {
  "weekday-long-month-short": ["Dec 5", "Apr 5, 2027"],
  "weekday-short-month-short": ["Dec 5", "Apr 5, 2027"],
  "weekday-long-month-long": ["December 5", "April 5, 2027"],
  "mdy-slash": ["12/05/2026", "04/05/2027"],
  "weekday-long-day-month-short": ["5 Dec", "5 Apr 2027"],
  "weekday-short-day-month-short": ["5 Dec", "5 Apr 2027"],
  "weekday-long-day-month-long": ["5 December", "5 April 2027"],
  "dmy-slash": ["05/12/2026", "05/04/2027"],
  "dmy-dot": ["05.12.2026", "05.04.2027"],
  iso: ["2026-12-05", "2027-04-05"],
};

describe("formatDay", () => {
  it.each(Object.entries(SHORT))("%s", (key, [thisYear, nextYear]) => {
    expect(formatDay("2026-12-05", key, DAY)).toBe(thisYear);
    expect(formatDay("2027-04-05", key, DAY)).toBe(nextYear);
  });

  it("an unknown key is the default look; the year goes by the calendar year, not by how far away", () => {
    expect(formatDay("2026-12-31", "nope", DAY)).toBe("Dec 31");
    expect(formatDay("2027-01-01", undefined, DAY)).toBe("Jan 1, 2027");
  });
});

describe("formatDayRange", () => {
  it("one year shown once at the end when both days are in the same year that isn't this one", () => {
    expect(formatDayRange("2027-06-02", "2027-08-23", undefined, DAY)).toBe("Jun 2 – Aug 23, 2027");
    expect(formatDayRange("2027-06-02", "2027-08-23", "weekday-long-day-month-long", DAY)).toBe("2 June – 23 August 2027");
    expect(formatDayRange("2026-12-02", "2026-12-23", undefined, DAY)).toBe("Dec 2 – Dec 23");
    expect(formatDayRange("2026-12-20", "2027-01-23", undefined, DAY)).toBe("Dec 20 – Jan 23, 2027");
    expect(formatDayRange("2027-12-20", "2028-01-23", undefined, DAY)).toBe("Dec 20, 2027 – Jan 23, 2028");
    expect(formatDayRange("2027-06-02", "2027-08-23", "iso", DAY)).toBe("2027-06-02 – 2027-08-23");
  });
});
