// GLP-1 sample data shaped like GET /api/glp1 (Task B). Today in these tests: Tue, Nov 17 2026 (Denver).
export const glp1Settings = { medication: "Ozempic", doseMg: 1, injectionWeekday: 5 };

export function glp1View(over: Record<string, unknown> = {}) {
  return {
    settings: glp1Settings,
    lastShot: { day: "2026-11-13", medication: "Ozempic", doseMg: 1, site: "abdomen_right", note: null },
    nextDue: "2026-11-20",
    status: "upcoming",
    overdueDays: 0,
    suggestedSite: "thigh_left",
    shots: [
      { day: "2026-11-13", medication: "Ozempic", doseMg: 1, site: "abdomen_right", note: null },
      { day: "2026-11-06", medication: "Ozempic", doseMg: 0.5, site: "abdomen_left", note: "Felt fine" },
    ],
    doseHistory: [
      { day: "2026-11-06", doseMg: 0.5, medication: "Ozempic" },
      { day: "2026-11-13", doseMg: 1, medication: "Ozempic" },
    ],
    ...over,
  };
}

export const noGlp1 = {
  settings: null,
  lastShot: null,
  nextDue: null,
  status: "none",
  overdueDays: 0,
  suggestedSite: "abdomen_left",
  shots: [],
  doseHistory: [],
};

const row = (offset: number, avgCalories: number | null, avgProtein: number | null, daysCounted: number) => ({ offset, avgCalories, avgProtein, daysCounted });
export const afterEnough = {
  enough: true,
  days: [row(0, 1850, 120.5, 2), row(1, 1400, 98, 2), row(2, 1300, 90.2, 2), row(3, null, null, 0), row(4, 1700, 110, 1), row(5, 1900, 125, 1), row(6, 2000, 130, 1)],
};
export const afterNotEnough = { enough: false, days: Array.from({ length: 7 }, (_, i) => row(i, null, null, 0)) };
