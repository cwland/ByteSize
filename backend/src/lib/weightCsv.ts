// Reading a weight history CSV exported from another app (design §19). Pure: no database, no clock.
// The file is read as rows (comma, semicolon or tab; quotes; a byte-order mark; any line ends), then the
// date and weight columns are guessed (or taken as chosen) and every row becomes a weigh-in or a reason it can't.

import { KG_PER_LB } from "./weight.js";

export type WeightUnit = "lb" | "kg";
/** How a numeric date like 03/04/2025 is read: Month/Day/Year or Day/Month/Year */
export type DateFormat = "mdy" | "dmy";

export interface ReadOptions {
  dateColumn?: number;
  weightColumn?: number;
  units?: WeightUnit;
  dateFormat?: DateFormat;
  /** The person's own units setting: the guess when the file doesn't say */
  defaultUnits: WeightUnit;
  /** The person's today: later days are skipped */
  today: string;
}

export interface CsvWeighIn {
  line: number;
  day: string;
  weightKg: number;
  note: string | null;
}

export interface WeightCsv {
  columns: string[];
  dateColumn: number;
  weightColumn: number;
  noteColumn: number | null;
  units: WeightUnit;
  dateFormat: DateFormat;
  /** The file has dates like 03/04/2025, so the date format changes what they mean */
  dateFormatMatters: boolean;
  /** One per day (the file's last row for that day wins), in the order the days first appear in the file */
  weighIns: CsvWeighIn[];
  /** The first rows that couldn't be read (at most 100), in file order */
  problems: { line: number; reason: string }[];
  /** How many rows couldn't be read */
  unreadable: number;
}

/** A file that can't be read at all: the message is shown to the person as is. */
export class CsvError extends Error {}

const NOT_CSV = "That file isn't a CSV file. Choose the .csv file your old app exported.";
const EMPTY = "That file is empty.";
const NO_COLUMNS = "Couldn't find a date column and a weight column in that file.";
const NO_SUCH_COLUMN = "That file doesn't have that column.";
const SAME_COLUMNS = "Choose different columns for the date and the weight.";
const TOO_WIDE = "This file has more than 50 columns. Export just the date and weight, or remove extra columns.";
const MAX_COLUMNS = 50;
const SAMPLE = 20; // values looked at per column when guessing...
const SAMPLE_ROWS = 1000; // ...among the first rows
const KEEP_PROBLEMS = 100; // a file of junk rows needn't hold a reason for each
const HEADERLESS_CELLS = 10; // cells of the first row looked at to tell a header from data

// The weigh-in form's range (routes/weight.ts), so every imported weigh-in can be edited and saved again.
// In lb: the whole tenths inside it (66.14 lb is under 30 kg).
const MIN_KG = 30;
const MAX_KG = 350;
const RANGE_TEXT: Record<WeightUnit, string> = {
  kg: `${MIN_KG} and ${MAX_KG} kg`,
  lb: `${Math.ceil((MIN_KG / KG_PER_LB) * 10) / 10} and ${Math.floor((MAX_KG / KG_PER_LB) * 10) / 10} lb`,
};
const NOTE_MAX = 500;
const SEPARATORS = ["\t", ";", ","] as const; // on a tie, the earlier one wins

/**
 * The file's bytes as text: UTF-16 with its byte-order mark (Excel's "Unicode Text"), else UTF-8, else
 * Windows-1252 (older Windows exports). Something that isn't text (control characters) is refused.
 */
export function decodeCsv(buf: Buffer): string {
  let text: string;
  if (buf[0] === 0xff && buf[1] === 0xfe) text = new TextDecoder("utf-16le").decode(buf);
  else if (buf[0] === 0xfe && buf[1] === 0xff) text = new TextDecoder("utf-16be").decode(buf);
  else {
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
    } catch {
      text = new TextDecoder("windows-1252").decode(buf);
    }
  }
  // Text has no control characters besides tab, line ends and form feed
  if (/[\u0000-\u0008\u000b\u000e-\u001f\u007f\u0081\u008d\u008f\u0090\u009d]/.test(text)) throw new CsvError(NOT_CSV);
  if (!text.trim()) throw new CsvError(EMPTY);
  return text;
}

// How many times c appears outside quotes
function countOutsideQuotes(line: string, c: string) {
  let n = 0;
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === c && !quoted) n++;
  }
  return n;
}

// The separator that splits the first lines the same number of times (lines with none, like a title, don't count)
function detectSeparator(text: string): string {
  const lines = text
    .slice(0, 64 * 1024) // the first lines are enough
    .split(/\r\n|\r|\n/)
    .filter((l) => SEPARATORS.some((s) => countOutsideQuotes(l, s) > 0))
    .slice(0, 10);
  let best: { sep: string; score: number; mode: number } = { sep: ",", score: 0, mode: 0 };
  for (const sep of SEPARATORS) {
    const counts = lines.map((l) => countOutsideQuotes(l, sep));
    const tally = new Map<number, number>();
    for (const c of counts) if (c > 0) tally.set(c, (tally.get(c) ?? 0) + 1);
    let mode = 0;
    let score = 0;
    for (const [c, n] of tally) if (n > score || (n === score && c > mode)) [mode, score] = [c, n];
    if (score > best.score || (score === best.score && score > 0 && mode > best.mode)) best = { sep, score, mode };
  }
  return best.sep;
}

/** The file as rows of trimmed cells, each with the line it starts on. Blank rows are left out. */
export function splitCsv(raw: string): { separator: string; rows: { line: number; cells: string[] }[] } {
  const text = raw.startsWith("﻿") ? raw.slice(1) : raw;
  const separator = detectSeparator(text);
  const rows: { line: number; cells: string[] }[] = [];
  const n = text.length;
  const endsCell = (c: string) => c === separator || c === "\r" || c === "\n";
  const lineBreaks = (s: string) => (s.match(/\r\n|\r|\n/g) ?? []).length;
  let cells: string[] = [];
  let line = 1;
  let rowLine = 1;
  const endRow = () => {
    if (cells.some((c) => c !== "")) rows.push({ line: rowLine, cells });
    cells = [];
  };
  // Cell by cell, slicing rather than adding a character at a time (a 5 MB file must stay quick)
  let i = 0;
  for (;;) {
    let j = i;
    while (j < n && (text[j] === " " || (text[j] === "\t" && separator !== "\t"))) j++;
    let cell: string;
    if (text[j] === '"') {
      // Quoted: separators and line breaks inside are text; "" is a quote
      let quotedText = "";
      let k = j + 1;
      for (;;) {
        const q = text.indexOf('"', k);
        if (q < 0) throw new CsvError(`Line ${line} has a quote that is never closed.`);
        quotedText += text.slice(k, q);
        if (text[q + 1] === '"') {
          quotedText += '"';
          k = q + 2;
        } else {
          k = q + 1;
          break;
        }
      }
      line += lineBreaks(text.slice(j, k));
      let e = k;
      while (e < n && !endsCell(text[e])) e++;
      cell = quotedText + text.slice(k, e); // anything after the closing quote stays with the cell
      i = e;
    } else {
      let e = j;
      while (e < n && !endsCell(text[e])) e++;
      cell = text.slice(i, e);
      i = e;
    }
    cells.push(cell.trim());
    if (i >= n) break;
    if (text[i] === separator) {
      i++;
      continue;
    }
    i += text[i] === "\r" && text[i + 1] === "\n" ? 2 : 1;
    endRow();
    line++;
    rowLine = line;
  }
  endRow();
  return { separator, rows };
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const monthNumber = (name: string) => {
  const n = name.toLowerCase();
  return n.length >= 3 ? MONTHS.findIndex((m) => m.startsWith(n)) + 1 : 0;
};
const pad = (n: number) => String(n).padStart(2, "0");

function isoDay(y: number, m: number, d: number): string | null {
  if (y < 1900 || m < 1 || m > 12 || d < 1) return null;
  if (d > new Date(Date.UTC(y, m, 0)).getUTCDate()) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

// The date part ends at the end, or at a time / comma after it
const END = String.raw`(?=$|[T\s,])`;
const YMD = new RegExp(String.raw`^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})${END}`);
const NUMERIC = new RegExp(String.raw`^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})${END}`);
const MONTH_FIRST = new RegExp(String.raw`^([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4}|\d{2})${END}`, "i");
const DAY_FIRST = new RegExp(String.raw`^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([a-z]{3,9})\.?,?[\s-]+(\d{4}|\d{2})${END}`, "i");
const WEEKDAY = /^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+/i;

/**
 * A calendar day (YYYY-MM-DD) as written, whatever time follows it; null when it isn't a date.
 * A two-digit year is 20YY, or 19YY when 20YY would be after today.
 */
export function parseDay(text: string, format: DateFormat, today?: string): string | null {
  const s = text.trim().replace(WEEKDAY, "");
  const day = (y: string, m: number, d: number) => {
    if (y.length === 4) return isoDay(+y, m, d);
    const recent = isoDay(2000 + +y, m, d);
    return recent && today && recent > today ? isoDay(1900 + +y, m, d) : recent;
  };
  let m = YMD.exec(s);
  if (m) return isoDay(+m[1], +m[2], +m[3]);
  m = NUMERIC.exec(s);
  if (m) return format === "mdy" ? day(m[3], +m[1], +m[2]) : day(m[3], +m[2], +m[1]);
  m = MONTH_FIRST.exec(s);
  if (m) return monthNumber(m[1]) ? day(m[3], monthNumber(m[1]), +m[2]) : null;
  m = DAY_FIRST.exec(s);
  if (m) return monthNumber(m[2]) ? day(m[3], monthNumber(m[2]), +m[1]) : null;
  return null;
}

const WEIGHT_TEXT = /^(\d+(?:[.,]\d+)?)\s*([a-z][a-z. ]*)?$/i;

/** A weight as written (any units text after it ignored); a decimal comma only when the separator isn't a comma. */
export function parseWeight(text: string, decimalComma: boolean): number | null {
  const m = WEIGHT_TEXT.exec(text.trim());
  if (!m) return null;
  if (m[1].includes(",") && !decimalComma) return null;
  return Number(m[1].replace(",", "."));
}

// Units named in a piece of text (a header, a title line, a value like "180 lb")
function unitsIn(text: string): WeightUnit | null {
  if (/(?<![a-z])(lbs?|pounds?)(?![a-z])/i.test(text)) return "lb";
  if (/(?<![a-z])(kgs?|kilos?|kilograms?)(?![a-z])/i.test(text)) return "kg";
  return null;
}

// An exact header wins over one that only contains the word ("Weekday,Date" → Date; "Lean weight,Weight" → Weight)
const DATE_EXACT = /^(date|day)$/i;
const WEIGHT_EXACT = /^(body )?weight( \((lbs?|kg)\))?$/i;
const DATE_HEADER = /date|day|time/i;
const WEIGHT_HEADER = /weight|wt|body ?mass/i;
const NOTE_HEADER = /(?<![a-z])(notes?|comments?)(?![a-z])/i;

const clipText = (s: string) => (s.length > 30 ? `${s.slice(0, 30)}…` : s);

export function readWeightCsv(text: string, o: ReadOptions): WeightCsv {
  const { separator, rows } = splitCsv(text);
  const decimalComma = separator !== ",";
  const filled = (cells: string[]) => cells.filter((c) => c !== "").length;
  const anyDay = (s: string) => parseDay(s, "mdy", o.today) ?? parseDay(s, "dmy", o.today);

  // Title lines (one cell, like "Body" or "#Units:kg") come before the header
  const first = rows.findIndex((r) => filled(r.cells) >= 2);
  if (first < 0) throw new CsvError(NO_COLUMNS);
  const preamble = rows
    .slice(0, first)
    .map((r) => r.cells.join(" "))
    .join(" ");
  // Not Math.max(...): a big file has too many rows to spread. Checked first: everything after looks at each column.
  const width = rows.reduce((w, r, i) => (i < first ? w : Math.max(w, r.cells.length)), 0);
  if (width > MAX_COLUMNS) throw new CsvError(TOO_WIDE);
  const top = rows[first].cells;
  // A first row that is already a date and a weight: the file has no header
  const lead = top.slice(0, HEADERLESS_CELLS);
  const isDay = lead.map((c) => !!anyDay(c));
  const isWeight = lead.map((c) => parseWeight(c, decimalComma) !== null);
  const headerless = isDay.some((d, i) => d && isWeight.some((w, j) => w && j !== i));
  const data = rows.slice(headerless ? first : first + 1);
  const header = headerless ? [] : top.map((c, i) => (i === 0 ? c.replace(/^#\s*/, "") : c));
  const columns = Array.from({ length: width }, (_, i) => header[i] || `Column ${i + 1}`);
  if (width < 2) throw new CsvError(NO_COLUMNS);

  for (const c of [o.dateColumn, o.weightColumn]) if (c !== undefined && (!Number.isInteger(c) || c < 0 || c >= width)) throw new CsvError(NO_SUCH_COLUMN);
  if (o.dateColumn !== undefined && o.dateColumn === o.weightColumn) throw new CsvError(SAME_COLUMNS);

  // The column's first non-empty values, from the first rows only (a mostly empty column doesn't mean reading the whole file)
  const values = (col: number) => {
    const out: string[] = [];
    for (const r of data.slice(0, SAMPLE_ROWS)) {
      const v = r.cells[col] ?? "";
      if (v !== "" && out.push(v) >= SAMPLE) break;
    }
    return out;
  };
  const mostly = (col: number, ok: (v: string) => boolean) => {
    const vs = values(col);
    return vs.length > 0 && vs.filter(ok).length * 2 >= vs.length;
  };
  const cols = columns.map((_, i) => i);
  const guess = (not: number | undefined, exact: RegExp, byHeader: RegExp, byValue: (v: string) => boolean) => {
    const open = cols.filter((i) => i !== not);
    const head = (i: number) => (header[i] ?? "").trim();
    return open.find((i) => exact.test(head(i))) ?? open.find((i) => byHeader.test(head(i))) ?? open.find((i) => mostly(i, byValue));
  };
  // A number that could be a weight in kg or lb
  const plausible = (v: string) => {
    const n = parseWeight(v, decimalComma);
    return n !== null && n >= MIN_KG && n <= MAX_KG / KG_PER_LB;
  };

  let dateColumn = o.dateColumn ?? guess(o.weightColumn, DATE_EXACT, DATE_HEADER, (v) => !!anyDay(v));
  let weightColumn = o.weightColumn ?? guess(dateColumn, WEIGHT_EXACT, WEIGHT_HEADER, plausible);
  dateColumn ??= cols.find((i) => i !== weightColumn)!;
  weightColumn ??= cols.find((i) => i !== dateColumn)!;

  const firstUnitValue = values(weightColumn).find((v) => unitsIn(v));
  const units = o.units ?? unitsIn(header[weightColumn] ?? "") ?? unitsIn(preamble) ?? (firstUnitValue ? unitsIn(firstUnitValue) : null) ?? o.defaultUnits;

  // A first number above 12 can only be a day; a second above 12 only a day too, the other way round
  let dateFormatMatters = false;
  let dayFirst = false;
  let monthFirst = false;
  for (const r of data) {
    const m = NUMERIC.exec((r.cells[dateColumn] ?? "").trim());
    if (!m) continue;
    dateFormatMatters = true;
    if (+m[1] > 12 && +m[2] <= 12) dayFirst = true;
    if (+m[2] > 12 && +m[1] <= 12) monthFirst = true;
  }
  const dateFormat = o.dateFormat ?? (dayFirst && !monthFirst ? "dmy" : "mdy");

  const noteColumn = headerless ? null : (cols.find((i) => i !== dateColumn && i !== weightColumn && NOTE_HEADER.test(header[i] ?? "")) ?? null);
  const byDay = new Map<string, CsvWeighIn>();
  const problems: WeightCsv["problems"] = [];
  let unreadable = 0;
  for (const { line, cells } of data) {
    const dateText = cells[dateColumn] ?? "";
    const weightText = cells[weightColumn] ?? "";
    const skip = (reason: string) => {
      if (++unreadable <= KEEP_PROBLEMS) problems.push({ line, reason });
    };
    if (!dateText) {
      skip("No date");
      continue;
    }
    const day = parseDay(dateText, dateFormat, o.today);
    if (!day) {
      skip(`Can't read the date "${clipText(dateText)}"`);
      continue;
    }
    if (!weightText) {
      skip("No weight");
      continue;
    }
    const value = parseWeight(weightText, decimalComma);
    if (value === null) {
      skip(`Can't read the weight "${clipText(weightText)}"`);
      continue;
    }
    const weightKg = units === "lb" ? value * KG_PER_LB : value;
    if (weightKg < MIN_KG || weightKg > MAX_KG) {
      skip(`Weight must be between ${RANGE_TEXT[units]}`);
      continue;
    }
    if (day > o.today) {
      skip("Date is in the future");
      continue;
    }
    const note = noteColumn === null ? "" : (cells[noteColumn] ?? "").slice(0, NOTE_MAX);
    byDay.set(day, { line, day, weightKg, note: note || null });
  }
  return { columns, dateColumn, weightColumn, noteColumn, units, dateFormat, dateFormatMatters, weighIns: [...byDay.values()], problems, unreadable };
}
