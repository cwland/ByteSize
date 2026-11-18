import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CsvError, decodeCsv, parseDay, parseWeight, readWeightCsv, splitCsv, type ReadOptions } from "../src/lib/weightCsv.js";

// The weight-history CSV reader (design §19): separators, quotes, dates, weights, units, columns.
const KG_PER_LB = 0.45359237;
const today = "2026-11-17";
const opts = (over: Partial<ReadOptions> = {}): ReadOptions => ({ defaultUnits: "lb", today, ...over });
const fixture = (name: string) => readFileSync(path.join(import.meta.dirname, "fixtures", "weight-csv", name));
const read = (text: string, over: Partial<ReadOptions> = {}) => readWeightCsv(text, opts(over));
const days = (r: ReturnType<typeof readWeightCsv>) => r.weighIns.map((w) => w.day);

describe("splitCsv", () => {
  it("detects a comma, a semicolon or a tab", () => {
    expect(splitCsv("Date,Weight\n2025-01-03,180").separator).toBe(",");
    expect(splitCsv("Date;Weight\n2025-01-03;98,4\n2025-01-04;98,1").separator).toBe(";");
    expect(splitCsv("Date\tWeight\n2025-01-03\t180").separator).toBe("\t");
  });

  it("reads quoted fields with separators, escaped quotes and line breaks inside, and numbers lines as in the file", () => {
    const { rows } = splitCsv('a,b,c\n"x, y","say ""hi""","two\nlines"\nlast,1,2');
    expect(rows).toEqual([
      { line: 1, cells: ["a", "b", "c"] },
      { line: 2, cells: ["x, y", 'say "hi"', "two\nlines"] },
      { line: 4, cells: ["last", "1", "2"] },
    ]);
  });

  it("drops a byte-order mark and reads Windows and old-Mac line ends", () => {
    const { rows } = splitCsv("﻿Date,Weight\r\n2025-01-03,180\r2025-01-04,181\r\n");
    expect(rows.map((r) => r.cells)).toEqual([
      ["Date", "Weight"],
      ["2025-01-03", "180"],
      ["2025-01-04", "181"],
    ]);
    expect(rows[2].line).toBe(3);
  });

  it("says which line has a quote that is never closed, instead of reading the rest of the file as one cell", () => {
    expect(() => splitCsv('Date,Weight,Note\n2025-01-03,180,ok\n2025-01-04,181,"oops\n2025-01-05,182,fine')).toThrow("Line 3 has a quote that is never closed.");
    expect(() => splitCsv('Date,Weight\n2025-01-03,180')).not.toThrow();
  });

  it("skips blank lines (and lines of only separators) but keeps counting them", () => {
    const { rows } = splitCsv("Date,Weight\n\n2025-01-03,180\n , \n,\n2025-01-04,181\n\n");
    expect(rows.map((r) => r.line)).toEqual([1, 3, 6]);
  });
});

describe("decodeCsv", () => {
  it("reads UTF-8 text", () => {
    expect(decodeCsv(Buffer.from("Date,Weight\n2025-01-03,180"))).toBe("Date,Weight\n2025-01-03,180");
  });

  it("reads Excel's UTF-16 exports (little- and big-endian, with their byte-order mark)", () => {
    const text = "Date\tWeight\tNote\n2025-01-03\t180\tcaf\u00e9";
    const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
    expect(decodeCsv(le)).toBe(text);
    const be = Buffer.from(le);
    be.swap16(); // FF FE + LE pairs -> FE FF + BE pairs
    expect(decodeCsv(be)).toBe(text);
  });

  it("falls back to Windows-1252 when the bytes aren't UTF-8", () => {
    const bytes = Buffer.concat([Buffer.from("Date,Weight,Note\n2025-01-03,180,caf"), Buffer.from([0xe9, 0x20, 0x97]), Buffer.from(" ok")]); // é, em dash
    expect(decodeCsv(bytes)).toBe("Date,Weight,Note\n2025-01-03,180,caf\u00e9 \u2014 ok");
  });

  it("refuses something that isn't text with a plain message", () => {
    expect(() => decodeCsv(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0xff, 0xfe]))).toThrow(CsvError);
    expect(() => decodeCsv(Buffer.from("Date,Weight\u0000\n"))).toThrow("That file isn't a CSV file");
    expect(() => decodeCsv(Buffer.from("  \n\n"))).toThrow("That file is empty");
    expect(() => decodeCsv(Buffer.from([0x44, 0x61, 0x74, 0x65, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15]))).toThrow(CsvError);
  });
});

describe("parseDay", () => {
  it("reads YYYY-MM-DD and YYYY/MM/DD, with or without a time, keeping the calendar day as written", () => {
    expect(parseDay("2025-01-03", "mdy")).toBe("2025-01-03");
    expect(parseDay("2025/1/3", "mdy")).toBe("2025-01-03");
    expect(parseDay("2025-01-03 07:12:33", "mdy")).toBe("2025-01-03");
    expect(parseDay("2025-01-03T23:50:00.000Z", "mdy")).toBe("2025-01-03");
    expect(parseDay("2025-01-03T23:50:00-08:00", "dmy")).toBe("2025-01-03");
  });

  it("reads M/D/YYYY or D/M/YYYY per the chosen format, with or without a time", () => {
    expect(parseDay("03/04/2025", "mdy")).toBe("2025-03-04");
    expect(parseDay("03/04/2025", "dmy")).toBe("2025-04-03");
    expect(parseDay("3/4/2025 7:15 AM", "mdy")).toBe("2025-03-04");
    expect(parseDay("01-03-2025", "mdy")).toBe("2025-01-03");
    expect(parseDay("04.03.2025", "dmy")).toBe("2025-03-04");
    expect(parseDay("13/04/2025", "mdy")).toBeNull(); // no 13th month
    expect(parseDay("13/04/2025", "dmy")).toBe("2025-04-13");
  });

  it("reads month-name forms", () => {
    expect(parseDay("Jan 3, 2025", "mdy")).toBe("2025-01-03");
    expect(parseDay("January 3 2025", "dmy")).toBe("2025-01-03");
    expect(parseDay("3 Jan 2025", "mdy")).toBe("2025-01-03");
    expect(parseDay("3-Sep-2025", "mdy")).toBe("2025-09-03");
    expect(parseDay("Sept. 30, 2025 6:00 PM", "mdy")).toBe("2025-09-30");
    expect(parseDay("Fri, Jan 3, 2025", "mdy")).toBe("2025-01-03");
  });

  it("reads two-digit years as 20YY, or 19YY when 20YY would be after today", () => {
    expect(parseDay("1/3/25", "mdy", "2026-11-17")).toBe("2025-01-03");
    expect(parseDay("03-Jan-25", "mdy", "2026-11-17")).toBe("2025-01-03");
    expect(parseDay("Jan 3, 25", "mdy", "2026-11-17")).toBe("2025-01-03");
    expect(parseDay("3.1.25 07:00", "dmy", "2026-11-17")).toBe("2025-01-03");
    expect(parseDay("12/1/26", "mdy", "2026-11-17")).toBe("1926-12-01"); // Dec 1, 2026 is still to come
    expect(parseDay("11/17/26", "mdy", "2026-11-17")).toBe("2026-11-17");
    expect(parseDay("5/6/97", "mdy", "2026-11-17")).toBe("1997-05-06");
  });

  it("refuses days that don't exist and things that aren't dates", () => {
    expect(parseDay("2025-02-30", "mdy")).toBeNull();
    expect(parseDay("2/30/2025", "mdy")).toBeNull();
    expect(parseDay("Foo 3, 2025", "mdy")).toBeNull();
    expect(parseDay("180.4", "mdy")).toBeNull();
    expect(parseDay("", "mdy")).toBeNull();
    expect(parseDay("yesterday", "mdy")).toBeNull();
  });
});

describe("parseWeight", () => {
  it("reads a number, ignoring units text after it", () => {
    expect(parseWeight("180.4", false)).toBe(180.4);
    expect(parseWeight(" 180 ", false)).toBe(180);
    expect(parseWeight("180.4 lb", false)).toBe(180.4);
    expect(parseWeight("81.6kg", false)).toBe(81.6);
    expect(parseWeight("180 lbs.", false)).toBe(180);
  });

  it("accepts a decimal comma only when the separator isn't a comma", () => {
    expect(parseWeight("98,4", true)).toBe(98.4);
    expect(parseWeight("98,4", false)).toBeNull();
  });

  it("refuses what isn't a weight", () => {
    for (const s of ["", "abc", "-80", "lb 180", "1,234.5", "12/3"]) expect(parseWeight(s, true)).toBeNull();
  });
});

describe("readWeightCsv", () => {
  it("guesses the date and weight columns from the header and converts lb to kg exactly", () => {
    const r = read("Date,Weight (lb)\n2025-01-03,180.4\n2025-01-04,180");
    expect(r).toMatchObject({ columns: ["Date", "Weight (lb)"], dateColumn: 0, weightColumn: 1, noteColumn: null, units: "lb" });
    expect(r.weighIns).toEqual([
      { line: 2, day: "2025-01-03", weightKg: 180.4 * KG_PER_LB, note: null },
      { line: 3, day: "2025-01-04", weightKg: 180 * KG_PER_LB, note: null },
    ]);
    expect(r.problems).toEqual([]);
  });

  it("guesses columns from the values when the header doesn't say", () => {
    const r = read("Index,When,Value\n1,2025-01-03,180\n2,2025-01-04,181");
    expect([r.dateColumn, r.weightColumn]).toEqual([1, 2]);
    expect(days(r)).toEqual(["2025-01-03", "2025-01-04"]);
  });

  it("takes the first matching header: weight, wt, body mass; date, day, time", () => {
    expect(read("Day,Wt\n2025-01-03,180")).toMatchObject({ dateColumn: 0, weightColumn: 1 });
    expect(read("BMI,Time,Body mass\n25,2025-01-03,180")).toMatchObject({ dateColumn: 1, weightColumn: 2 });
    expect(read("date;weight;weight trend\n2025-01-03;98,4;98,2", { units: "kg" }).weighIns[0].weightKg).toBe(98.4);
  });

  it("prefers an exact header (date, day, weight, weight (lb), weight (kg), body weight) over one that only contains the word", () => {
    expect(read("Weekday,Date,Weight\nFri,2025-01-03,180")).toMatchObject({ dateColumn: 1, weightColumn: 2 });
    expect(read("Date,Lean weight,Weight\n2025-01-03,150,180")).toMatchObject({ dateColumn: 0, weightColumn: 2 });
    expect(read("Time,Weight trend,Body Weight\n2025-01-03,179,180")).toMatchObject({ weightColumn: 2 });
    expect(read("Timestamp,Day,Weight (kg)\n1,2025-01-03,80")).toMatchObject({ dateColumn: 1, weightColumn: 2 });
  });

  it("uses the person's choice of columns over the guess", () => {
    const r = read("Date,Weight,Trend\n2025-01-03,180,179", { weightColumn: 2 });
    expect(r.weightColumn).toBe(2);
    expect(r.weighIns[0].weightKg).toBe(179 * KG_PER_LB);
  });

  it("guesses units from the header, else the values' units text, else the person's setting; a choice wins", () => {
    expect(read("Date,Weight (kg)\n2025-01-03,81").units).toBe("kg");
    expect(read("Date,Kilograms\n2025-01-03,81").units).toBe("kg");
    expect(read("Date,Weight in pounds\n2025-01-03,181").units).toBe("lb");
    expect(read("Date,Lbs\n2025-01-03,181", { defaultUnits: "kg" }).units).toBe("lb");
    expect(read("Date,Weight\n2025-01-03,81 kg").units).toBe("kg");
    expect(read("Date,Weight\n2025-01-03,81", { defaultUnits: "kg" }).units).toBe("kg");
    expect(read("Date,Weight\n2025-01-03,181").units).toBe("lb");
    const chosen = read("Date,Weight (kg)\n2025-01-03,181", { units: "lb" });
    expect(chosen.units).toBe("lb");
    expect(chosen.weighIns[0].weightKg).toBe(181 * KG_PER_LB);
  });

  it("keeps kg as written", () => {
    expect(read("Date,Weight (kg)\n2025-01-03,81.65").weighIns[0].weightKg).toBe(81.65);
  });

  it("guesses the date format: a first number above 12 settles Day/Month, a second above 12 Month/Day, else Month/Day", () => {
    const ambiguous = read("Date,Weight\n03/04/2025,180\n05/06/2025,181");
    expect(ambiguous).toMatchObject({ dateFormat: "mdy", dateFormatMatters: true });
    expect(days(ambiguous)).toEqual(["2025-03-04", "2025-05-06"]);
    const dmy = read("Date,Weight\n03/04/2025,180\n25/04/2025,181");
    expect(dmy).toMatchObject({ dateFormat: "dmy", dateFormatMatters: true });
    expect(days(dmy)).toEqual(["2025-04-03", "2025-04-25"]);
    expect(read("Date,Weight\n03/04/2025,180\n04/25/2025,181").dateFormat).toBe("mdy");
    expect(read("Date,Weight\n2025-03-04,180")).toMatchObject({ dateFormat: "mdy", dateFormatMatters: false });
  });

  it("uses the chosen date format; rows it can't read are listed", () => {
    const r = read("Date,Weight\n03/04/2025,180\n25/04/2025,181", { dateFormat: "mdy" });
    expect(days(r)).toEqual(["2025-03-04"]);
    expect(r.problems).toEqual([{ line: 3, reason: 'Can\'t read the date "25/04/2025"' }]);
  });

  it("skips weights outside the app's 30–350 kg (66.2–771.6 lb), unreadable weights and empty cells, saying why", () => {
    const lb = read("Date,Weight\n2025-01-01,66.1\n2025-01-02,66.2\n2025-01-03,771.6\n2025-01-04,771.7\n2025-01-05,abc\n2025-01-06,\n,180");
    expect(days(lb)).toEqual(["2025-01-02", "2025-01-03"]);
    expect(lb.problems).toEqual([
      { line: 2, reason: "Weight must be between 66.2 and 771.6 lb" },
      { line: 5, reason: "Weight must be between 66.2 and 771.6 lb" },
      { line: 6, reason: 'Can\'t read the weight "abc"' },
      { line: 7, reason: "No weight" },
      { line: 8, reason: "No date" },
    ]);
    const kg = read("Date,Weight (kg)\n2025-01-01,29.9\n2025-01-02,30\n2025-01-03,350\n2025-01-04,350.1");
    expect(days(kg)).toEqual(["2025-01-02", "2025-01-03"]);
    expect(kg.problems.map((p) => p.reason)).toEqual(["Weight must be between 30 and 350 kg", "Weight must be between 30 and 350 kg"]);
  });

  it("counts every unreadable row but keeps the reasons for the first 100", () => {
    const r = read(["Date,Weight", ...Array.from({ length: 150 }, () => "2025-01-03,abc")].join("\n"));
    expect(r.unreadable).toBe(150);
    expect(r.problems).toHaveLength(100);
    expect(r.problems[99].line).toBe(101);
  });

  it("skips future days (today is fine)", () => {
    const r = read(`Date,Weight\n${today},180\n2026-11-18,181`);
    expect(days(r)).toEqual([today]);
    expect(r.problems).toEqual([{ line: 3, reason: "Date is in the future" }]);
  });

  it("keeps the last row of a day, in the day's first place", () => {
    const r = read("Date,Weight,Notes\n2025-01-03,180,morning\n2025-01-04,179,\n2025-01-03 21:00,182,evening");
    expect(r.weighIns.map((w) => [w.day, w.weightKg / KG_PER_LB, w.note])).toEqual([
      ["2025-01-03", 182, "evening"],
      ["2025-01-04", 179, null],
    ]);
  });

  it("reads notes from a note, notes or comment column", () => {
    expect(read("Date,Weight,Note\n2025-01-03,180,hi").weighIns[0].note).toBe("hi");
    expect(read("Date,Weight,Comments\n2025-01-03,180,  hi  ").weighIns[0].note).toBe("hi");
    expect(read("Date,Weight,Comments\n2025-01-03,180,").weighIns[0].note).toBeNull();
    expect(read(`Date,Weight,Note\n2025-01-03,180,${"x".repeat(600)}`).weighIns[0].note).toHaveLength(500);
  });

  it("reads a file without a header row", () => {
    const r = read("2025-01-03,180\n2025-01-04,181");
    expect(r.columns).toEqual(["Column 1", "Column 2"]);
    expect(days(r)).toEqual(["2025-01-03", "2025-01-04"]);
    expect(r.weighIns[0].line).toBe(1);
  });

  it("ignores title lines above the header", () => {
    const r = read("Body\nDate,Weight\n2025-01-03,180");
    expect(r.columns).toEqual(["Date", "Weight"]);
    expect(days(r)).toEqual(["2025-01-03"]);
  });

  it("refuses a file with more than 50 columns", () => {
    const head = Array.from({ length: 51 }, (_, i) => `c${i}`).join(",");
    expect(() => read(`${head}\n2025-01-03,180`)).toThrow("This file has more than 50 columns. Export just the date and weight, or remove extra columns.");
    expect(() => read(`Date,Weight\n2025-01-03,180${",x".repeat(60)}`)).toThrow(/more than 50 columns/);
    expect(read(`${Array.from({ length: 50 }, (_, i) => (i === 0 ? "Date" : i === 1 ? "Weight" : `c${i}`)).join(",")}\n2025-01-03,180`).weighIns).toHaveLength(1);
  });

  it("refuses a file without two columns, or columns it doesn't have, with a plain message", () => {
    expect(() => read("just some text\nand more")).toThrow("Couldn't find a date column and a weight column in that file");
    expect(() => read("Date,Weight\n2025-01-03,180", { weightColumn: 5 })).toThrow(CsvError);
    expect(() => read("Date,Weight\n2025-01-03,180", { dateColumn: 1, weightColumn: 1 })).toThrow("Choose different columns for the date and the weight");
  });
});

// Files shaped like the exports people bring from other apps
describe("known exports", () => {
  const load = (name: string, over: Partial<ReadOptions> = {}) => readWeightCsv(decodeCsv(fixture(name)), opts(over));
  const lb = (r: ReturnType<typeof readWeightCsv>) => r.weighIns.map((w) => [w.day, Math.round((w.weightKg / KG_PER_LB) * 10) / 10]);

  it("Lose It (Date, Weight; M/D/YYYY, newest first)", () => {
    const r = load("lose-it.csv");
    expect(r).toMatchObject({ dateColumn: 0, weightColumn: 1, units: "lb", dateFormat: "mdy", problems: [] });
    expect(lb(r)).toEqual([
      ["2026-11-16", 214.2],
      ["2026-11-15", 214.8],
      ["2025-01-03", 251],
    ]);
  });

  it("MyFitnessPal measurements (Date, Weight; YYYY-MM-DD), in the person's units", () => {
    const r = load("myfitnesspal.csv", { defaultUnits: "kg" });
    expect(r.units).toBe("kg");
    expect(r.weighIns.map((w) => [w.day, w.weightKg])).toEqual([
      ["2025-01-03", 251],
      ["2025-01-10", 248.6],
      ["2025-01-17", 247],
    ]);
  });

  it("Happy Scale (month-name dates, a notes column with a comma in it)", () => {
    const r = load("happy-scale.csv");
    expect(r).toMatchObject({ dateColumn: 0, weightColumn: 1, noteColumn: 4 });
    expect(r.weighIns.map((w) => [w.day, w.note])).toEqual([
      ["2025-01-03", "Day one, here we go"],
      ["2025-01-04", null],
    ]);
  });

  it("Libra (semicolons, # lines, decimal commas, kg from the preamble, UTC times kept as written)", () => {
    const r = load("libra.csv");
    expect(r).toMatchObject({ columns: ["date", "weight", "weight trend", "body fat", "body fat trend", "muscle mass", "muscle mass trend", "log"], dateColumn: 0, weightColumn: 1, units: "kg", problems: [] });
    expect(r.weighIns.map((w) => [w.day, w.weightKg])).toEqual([
      ["2025-01-03", 98.4],
      ["2025-01-04", 98.1],
    ]);
  });

  it("Withings (quoted, CRLF, Weight (lb), two weigh-ins in a day: the last wins with its comment)", () => {
    const r = load("withings.csv", { defaultUnits: "kg" });
    expect(r).toMatchObject({ units: "lb", noteColumn: 6, problems: [] });
    expect(r.weighIns.map((w) => [w.day, Math.round((w.weightKg / KG_PER_LB) * 10) / 10, w.note])).toEqual([
      ["2026-11-16", 215, "after dinner"],
      ["2026-11-15", 214.8, null],
    ]);
  });

  it("Fitbit (a title line, quoted MM-DD-YYYY)", () => {
    const r = load("fitbit.csv");
    expect(r).toMatchObject({ columns: ["Date", "Weight", "BMI", "Fat"], weightColumn: 1, dateFormat: "mdy", dateFormatMatters: true });
    expect(lb(r)).toEqual([
      ["2025-01-03", 251],
      ["2025-01-04", 250.4],
    ]);
  });

  it("a hand-made two-column sheet without a header and with a blank line", () => {
    const r = load("hand-made.csv");
    expect(lb(r)).toEqual([
      ["2025-01-03", 251],
      ["2025-01-10", 248.6],
      ["2025-01-17", 247],
    ]);
  });
});
