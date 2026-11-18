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
  /** Rows that couldn't be read, in file order */
  problems: { line: number; reason: string }[];
}

/** A file that can't be read at all: the message is shown to the person as is. */
export class CsvError extends Error {}

const NOT_CSV = "That file isn't a CSV file. Choose the .csv file your old app exported.";
const EMPTY = "That file is empty.";
const NO_COLUMNS = "Couldn't find a date column and a weight column in that file.";
const NO_SUCH_COLUMN = "That file doesn't have that column.";
const SAME_COLUMNS = "Choose different columns for the date and the weight.";

const RANGE: Record<WeightUnit, { min: number; max: number }> = { lb: { min: 20, max: 700 }, kg: { min: 9, max: 318 } };
const NOTE_MAX = 500;
const SEPARATORS = ["\t", ";", ","] as const; // on a tie, the earlier one wins

/** The file's bytes as text; something that isn't UTF-8 text is refused. */
export function decodeCsv(buf: Buffer): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    throw new CsvError(NOT_CSV);
  }
  if (text.includes("\u0000")) throw new CsvError(NOT_CSV);
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
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let atCellStart = true;
  let line = 1;
  let rowLine = 1;
  const endCell = () => {
    cells.push(cell.trim());
    cell = "";
    atCellStart = true;
  };
  const endRow = () => {
    endCell();
    if (cells.some((c) => c !== "")) rows.push({ line: rowLine, cells });
    cells = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else {
        if (ch === "\n" || (ch === "\r" && text[i + 1] !== "\n")) line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && atCellStart && !cell.trim()) {
      quoted = true;
      cell = "";
      atCellStart = false;
    } else if (ch === separator) {
      endCell();
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRow();
      line++;
      rowLine = line;
    } else {
      cell += ch;
      if (ch.trim()) atCellStart = false;
    }
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
const NUMERIC = new RegExp(String.raw`^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})${END}`);
const MONTH_FIRST = new RegExp(String.raw`^([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})${END}`, "i");
const DAY_FIRST = new RegExp(String.raw`^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([a-z]{3,9})\.?,?[\s-]+(\d{4})${END}`, "i");
const WEEKDAY = /^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+/i;

/** A calendar day (YYYY-MM-DD) as written, whatever time follows it; null when it isn't a date. */
export function parseDay(text: string, format: DateFormat): string | null {
  const s = text.trim().replace(WEEKDAY, "");
  let m = YMD.exec(s);
  if (m) return isoDay(+m[1], +m[2], +m[3]);
  m = NUMERIC.exec(s);
  if (m) return format === "mdy" ? isoDay(+m[3], +m[1], +m[2]) : isoDay(+m[3], +m[2], +m[1]);
  m = MONTH_FIRST.exec(s);
  if (m) return monthNumber(m[1]) ? isoDay(+m[3], monthNumber(m[1]), +m[2]) : null;
  m = DAY_FIRST.exec(s);
  if (m) return monthNumber(m[2]) ? isoDay(+m[3], monthNumber(m[2]), +m[1]) : null;
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

const DATE_HEADER = /date|day|time/i;
const WEIGHT_HEADER = /weight|wt|body ?mass/i;
const NOTE_HEADER = /(?<![a-z])(notes?|comments?)(?![a-z])/i;

const clipText = (s: string) => (s.length > 30 ? `${s.slice(0, 30)}…` : s);

export function readWeightCsv(text: string, o: ReadOptions): WeightCsv {
  const { separator, rows } = splitCsv(text);
  const decimalComma = separator !== ",";
  const filled = (cells: string[]) => cells.filter((c) => c !== "").length;
  const anyDay = (s: string) => parseDay(s, "mdy") ?? parseDay(s, "dmy");

  // Title lines (one cell, like "Body" or "#Units:kg") come before the header
  const first = rows.findIndex((r) => filled(r.cells) >= 2);
  if (first < 0) throw new CsvError(NO_COLUMNS);
  const preamble = rows
    .slice(0, first)
    .map((r) => r.cells.join(" "))
    .join(" ");
  const top = rows[first].cells;
  // A first row that is already a date and a weight: the file has no header
  const headerless = top.some((c, i) => anyDay(c) && top.some((w, j) => j !== i && parseWeight(w, decimalComma) !== null));
  const data = rows.slice(headerless ? first : first + 1);
  const header = headerless ? [] : top.map((c, i) => (i === 0 ? c.replace(/^#\s*/, "") : c));
  const width = data.reduce((w, r) => Math.max(w, r.cells.length), header.length); // not Math.max(...): a big file has too many rows to spread
  const columns = Array.from({ length: width }, (_, i) => header[i] || `Column ${i + 1}`);
  if (width < 2) throw new CsvError(NO_COLUMNS);

  for (const c of [o.dateColumn, o.weightColumn]) if (c !== undefined && (!Number.isInteger(c) || c < 0 || c >= width)) throw new CsvError(NO_SUCH_COLUMN);
  if (o.dateColumn !== undefined && o.dateColumn === o.weightColumn) throw new CsvError(SAME_COLUMNS);

  const values = (col: number) =>
    data
      .map((r) => r.cells[col] ?? "")
      .filter((v) => v !== "")
      .slice(0, 20);
  const mostly = (col: number, ok: (v: string) => boolean) => {
    const vs = values(col);
    return vs.length > 0 && vs.filter(ok).length * 2 >= vs.length;
  };
  const cols = columns.map((_, i) => i);
  const guess = (not: number | undefined, byHeader: RegExp, byValue: (v: string) => boolean) => {
    const open = cols.filter((i) => i !== not);
    return open.find((i) => byHeader.test(header[i] ?? "")) ?? open.find((i) => mostly(i, byValue));
  };
  const plausible = (v: string) => {
    const n = parseWeight(v, decimalComma);
    return n !== null && n >= RANGE.kg.min && n <= RANGE.lb.max;
  };

  let dateColumn = o.dateColumn ?? guess(o.weightColumn, DATE_HEADER, (v) => !!anyDay(v));
  let weightColumn = o.weightColumn ?? guess(dateColumn, WEIGHT_HEADER, plausible);
  dateColumn ??= cols.find((i) => i !== weightColumn)!;
  weightColumn ??= cols.find((i) => i !== dateColumn)!;

  const firstUnitValue = data.map((r) => r.cells[weightColumn] ?? "").find((v) => unitsIn(v));
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
  const range = RANGE[units];
  const byDay = new Map<string, CsvWeighIn>();
  const problems: WeightCsv["problems"] = [];
  for (const { line, cells } of data) {
    const dateText = cells[dateColumn] ?? "";
    const weightText = cells[weightColumn] ?? "";
    const skip = (reason: string) => problems.push({ line, reason });
    if (!dateText) {
      skip("No date");
      continue;
    }
    const day = parseDay(dateText, dateFormat);
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
    if (value < range.min || value > range.max) {
      skip(`Weight must be between ${range.min} and ${range.max} ${units}`);
      continue;
    }
    if (day > o.today) {
      skip("Date is in the future");
      continue;
    }
    const note = noteColumn === null ? "" : (cells[noteColumn] ?? "").slice(0, NOTE_MAX);
    byDay.set(day, { line, day, weightKg: units === "lb" ? value * KG_PER_LB : value, note: note || null });
  }
  return { columns, dateColumn, weightColumn, noteColumn, units, dateFormat, dateFormatMatters, weighIns: [...byDay.values()], problems };
}
