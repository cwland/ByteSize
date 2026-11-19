// GET /api/insights and its parts, as the API sends them (§43)

export const weekNumbers = (over: Record<string, unknown> = {}) => ({
  from: "2026-11-08",
  to: "2026-11-14",
  daysLogged: 3,
  daysInRange: 2,
  avgCalories: 1267,
  avgProtein: 91.7,
  plan: { calories: { min: 1600, max: 1800 }, proteinMin: 120 },
  waterDays: 1,
  steps: { days: 2, average: 7000 },
  workouts: { count: 1, minutes: 30 },
  trendChange: -2,
  weightUnit: "lb",
  ...over,
});

export const recapRow = (over: Record<string, unknown> = {}) => ({
  id: 1,
  kind: "recap",
  source: "weekly",
  soFar: false,
  periodStart: "2026-11-08",
  periodEnd: "2026-11-14",
  question: null,
  createdAt: "2026-11-15T13:05:00.000Z",
  content: {
    summary: "A solid week: you logged 3 days and hit your range on 2.",
    wentWell: ["Logged 3 days", "Protein on Wednesday"],
    slipped: ["Tuesday was low"],
    tryNext: "Add Greek yogurt at breakfast.",
    numbers: weekNumbers(),
  },
  ...over,
});

export const proteinRow = (over: Record<string, unknown> = {}) => ({
  id: 2,
  kind: "protein",
  source: "weekly",
  soFar: false,
  periodStart: "2026-10-18",
  periodEnd: "2026-11-14",
  question: null,
  createdAt: "2026-11-15T13:05:00.000Z",
  content: {
    intro: "Protein fell short on 2 days.",
    additions: [{ suggestion: "Greek yogurt at breakfast", why: "closes the gap on 2 of 2 short days" }],
    swaps: [{ food: "Cheese pizza", swap: "Thin-crust chicken pizza", saving: "about 300 calories" }],
    facts: {
      from: "2026-10-18",
      to: "2026-11-14",
      daysLogged: 3,
      topSources: [
        { food: "Chicken breast", protein_g: 204.6, times: 2 },
        { food: "Cheese pizza", protein_g: 70, times: 1 },
      ],
      shortDays: [
        { date: "2026-11-09", protein_g: 70, min: 120, shortBy: 50 },
        { date: "2026-11-10", protein_g: 80, min: 120, shortBy: 40 },
      ],
    },
  },
  ...over,
});

export const answerRow = (over: Record<string, unknown> = {}) => ({
  id: 3,
  kind: "answer",
  source: "ask",
  soFar: false,
  periodStart: "2026-10-22",
  periodEnd: "2026-11-18",
  question: "How's my protein?",
  createdAt: "2026-11-18T19:00:00.000Z",
  content: { answer: "You averaged 92 g of protein a day.", offTopic: false },
  ...over,
});

export const insightsJson = (over: Record<string, unknown> = {}) => ({
  aiReady: true,
  weeklyOn: true,
  email: { on: false, available: true, hasAddress: true },
  week: { from: "2026-11-08", to: "2026-11-14", numbers: weekNumbers() },
  recaps: [recapRow(), recapRow({ id: 9, periodStart: "2026-11-01", periodEnd: "2026-11-07", content: { ...recapRow().content, summary: "The week before." } })],
  protein: proteinRow(),
  answers: [answerRow()],
  limits: { questionsLeft: 19, questionsPerDay: 20, recapRefreshIn: 0, proteinRefreshIn: 0 },
  ...over,
});

/** An answer the server streams as lines; the test sends each line when it wants. */
export function streamed() {
  let ctrl!: ReadableStreamDefaultController<Uint8Array>;
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({ start: (c) => void (ctrl = c) });
  return {
    response: new Response(body, { headers: { "content-type": "application/x-ndjson" } }),
    send: (o: unknown) => ctrl.enqueue(enc.encode(`${JSON.stringify(o)}\n`)),
    end: () => ctrl.close(),
  };
}
