// GET /api/weight as the server sends it (kg, unrounded). Alex's last month, entered in lb.
const KG = 0.45359237;
const lb = (n: number) => n * KG;

export const sampleWeighIns = [
  ["2026-10-20", 226, 226],
  ["2026-10-25", 225.2, 225.6],
  ["2026-10-30", 224.6, 225.0],
  ["2026-11-04", 223.8, 224.2],
  ["2026-11-09", 223, 223.4],
  ["2026-11-13", 222.4, 222.8],
  ["2026-11-17", 221.4, 222.1],
].map(([day, w, t]) => ({ day: day as string, weightKg: lb(w as number), trendKg: lb(t as number), note: null as string | null }));

export function weightJson(over: Record<string, unknown> = {}) {
  return {
    weighIns: sampleWeighIns,
    start: { day: "2026-10-20", weightKg: lb(226) },
    latest: { day: "2026-11-17", weightKg: lb(221.4) },
    trendKg: lb(222.1),
    goalKg: lb(180),
    lostKg: lb(3.9),
    projection: { status: "ok", date: "2027-06-29", kgPerWeek: lb(1.2) },
    goalDate: { status: "ok", kgPerWeek: lb(1.2), toGoKg: lb(42.1), weeks: { min: 30, max: 35 }, date: "2027-06-29", earliest: "2027-06-08", latest: "2027-07-20" },
    replanHint: false,
    ...over,
  };
}

export const emptyWeightJson = {
  weighIns: [],
  start: null,
  latest: null,
  trendKg: null,
  goalKg: lb(180),
  lostKg: null,
  projection: { status: "not_enough" },
  goalDate: { status: "not_enough" },
  replanHint: false,
};
