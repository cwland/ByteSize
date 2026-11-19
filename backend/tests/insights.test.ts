import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { glp1Shots, insights, logEntries, targets, userBody, userSettings, users, weighIns } from "../src/db/schema.js";
import { INSIGHTS_SYSTEM, OFF_TOPIC } from "../src/lib/insights.js";
import { resetInsightRuns, weeklyInsightsCheck } from "../src/lib/insightsRun.js";
import { usageSettled } from "../src/lib/usage.js";
import { setupTestApp, type TestApp } from "./helpers.js";

// §43 Insights: the page's data, Refresh, Ask a question, the weekly run, limits and who may do what.

let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
afterAll(async () => t.close());

const NOON_WED = new Date("2026-11-18T19:00:00Z"); // Wednesday 18 Nov, 12:00 in Boise (UTC-7)
const RECAP = { summary: "A solid week: you logged 3 days and hit your range on 2.", wentWell: ["Logged 3 days", "Protein on Wednesday"], slipped: ["Tuesday was low"], tryNext: "Add Greek yogurt at breakfast." };
const PROTEIN = {
  intro: "Protein fell short on 2 days.",
  additions: [{ suggestion: "Greek yogurt at breakfast", why: "closes the gap on 2 of 2 short days" }],
  swaps: [
    { food: "Cheese pizza", swap: "Thin-crust chicken pizza", saving: "about 300 calories" },
    { food: "Made-up food", swap: "Something", saving: "lots" },
  ],
};

let replies: { recap: unknown; protein: unknown; answer: unknown };
const userText = (body: any): string => body.messages?.[1]?.content ?? "";
const reply = (content: unknown, finish = "stop") => ({ status: 200, json: { choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) }, finish_reason: finish }] } });
function answer(_url: string, body: any) {
  const text = userText(body);
  if (text.includes("Write a recap")) return reply(replies.recap);
  if (text.includes("Help this person get enough protein")) return reply(replies.protein);
  if (text.includes("The person asks")) return reply(replies.answer);
  return reply({ ok: true });
}
const aiServices = (services = [{ name: "Home AI", provider: "openai", apiKey: "sk-home-ai", model: "gpt" }]) => t.api("PUT", "/api/settings/ai", { enabled: true, mode: "auto", maxPerRun: 50, timeoutSec: 5, services });
const summaryOf = (call: { body: any }) => JSON.parse(/Data summary \(JSON\):\n(.*)\n/.exec(userText(call.body))![1]);

// The admin "cory" (user 1): a plan, last week (8-14 Nov, Sunday start) logged on 3 days, this week on 1
async function seed(userId = 1) {
  await t.db.insert(targets).values({ userId, effectiveFrom: "2026-11-01", plan: "steady", caloriesMin: 1600, caloriesMax: 1800, proteinMin: 120, proteinMax: 160, fiberMin: 25, fiberMax: 38, waterMin: 2000, waterMax: 3000 });
  await t.db.insert(userBody).values({ userId, sex: "male", birthDate: "1980-01-01", heightCm: 180, weightKg: 100, goalWeightKg: 85, activity: "some", glp1: true });
  const e = (day: string, meal: string, name: string, calories: number, protein_g: number) => ({ userId, day, meal, name, icon: "🍽", source: "cache", unit: "serving", quantity: 1, perServing: {}, servings: [{ label: "1 serving" }], nutrients: { calories, protein_g } });
  await t.db.insert(logEntries).values([
    e("2026-11-09", "dinner", "Cheese pizza", 1650, 70),
    e("2026-11-10", "lunch", "Chicken breast", 450, 80),
    e("2026-11-11", "lunch", "Chicken breast", 1700, 125),
    e("2026-11-16", "breakfast", "Greek yogurt", 150, 20),
  ]);
  await t.db.insert(weighIns).values([
    { userId, day: "2026-11-01", weightKg: 100, note: "PRIVATE NOTE" },
    { userId, day: "2026-11-12", weightKg: 99 },
  ]);
  await t.db.insert(glp1Shots).values({ userId, day: "2026-11-12", medication: "Mounjaro", doseMg: 5, site: "arm_left", note: "PRIVATE SHOT" });
}

beforeEach(async () => {
  await t.reset();
  resetInsightRuns(t.app);
  await t.login();
  t.clock.date = NOON_WED;
  replies = { recap: RECAP, protein: PROTEIN, answer: { answer: "You averaged 92 g of protein a day." } };
  t.ai.respond = answer as any;
});

describe("the Insights page's data", () => {
  it("no AI set up: says so, and the week's numbers (from the app) still show", async () => {
    await seed();
    const r = await t.api("GET", "/api/insights");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      aiReady: false,
      weeklyOn: true,
      week: { from: "2026-11-08", to: "2026-11-14", numbers: { daysLogged: 3, daysInRange: 2, avgCalories: 1267, avgProtein: 91.7, weightUnit: "lb" } },
      recaps: [],
      protein: null,
      answers: [],
      limits: { questionsLeft: 20, questionsPerDay: 20, recapRefreshIn: 0, proteinRefreshIn: 0 },
    });
    expect(t.ai.calls).toHaveLength(0);
    // Refresh and ask say how to set it up (never which service)
    const refresh = await t.api("POST", "/api/insights/refresh", { kind: "recap" });
    expect(refresh.status).toBe(503);
    expect(refresh.body.error).toMatch(/Settings › Integrations/);
    expect((await t.api("POST", "/api/insights/ask", { question: "How's my protein?" })).status).toBe(503);
    expect((await t.api("GET", "/api/insights/latest")).body).toEqual({ aiReady: false, recap: null });
  });

  it("the weekly switch: on by default, the person's own", async () => {
    expect((await t.api("PUT", "/api/insights/settings", { weeklyOn: false })).body).toEqual({ weeklyOn: false });
    expect((await t.api("GET", "/api/insights")).body.weeklyOn).toBe(false);
    expect((await t.api("PUT", "/api/insights/settings", { weeklyOn: true })).body).toEqual({ weeklyOn: true });
    expect((await t.api("PUT", "/api/insights/settings", { weeklyOn: "yes" })).status).toBe(400);
  });
});

describe("Refresh", () => {
  it("the recap: this week so far, written by the AI, with the app's own numbers beside it", async () => {
    await seed();
    await aiServices();
    const r = await t.api("POST", "/api/insights/refresh", { kind: "recap" });
    expect(r.status).toBe(200);
    expect(r.body.insight).toMatchObject({
      kind: "recap",
      soFar: true,
      periodStart: "2026-11-15",
      periodEnd: "2026-11-18",
      content: { ...RECAP, numbers: { from: "2026-11-15", to: "2026-11-18", daysLogged: 1, avgCalories: 150, avgProtein: 20 } },
    });
    // What the AI was sent: the coach's rules, and this week's summary only (no names, emails, notes or keys)
    expect(t.ai.calls).toHaveLength(1);
    const call = t.ai.calls[0];
    expect(call.body.messages[0]).toEqual({ role: "system", content: INSIGHTS_SYSTEM });
    expect(userText(call.body)).toMatch(/this week so far/);
    const summary = summaryOf(call);
    expect(summary.period).toEqual({ from: "2026-11-15", to: "2026-11-18" });
    expect(summary.days[1].meals.breakfast).toEqual([{ food: "Greek yogurt", amount: "1 × 1 serving", calories: 150, protein_g: 20 }]);
    for (const bad of ["cory", "example.com", "PRIVATE", "sk-home-ai", "arm_left"]) expect(userText(call.body)).not.toContain(bad);
    // The answer never names the service
    expect(JSON.stringify(r.body)).not.toMatch(/Home AI|openai|gpt/i);

    const page = (await t.api("GET", "/api/insights")).body;
    expect(page.recaps).toHaveLength(1);
    expect(page.recaps[0]).toMatchObject({ soFar: true, content: { summary: RECAP.summary } });
    expect((await t.api("GET", "/api/insights/latest")).body).toEqual({ aiReady: true, recap: { periodStart: "2026-11-15", periodEnd: "2026-11-18", soFar: true, summary: RECAP.summary, createdAt: expect.any(String) } });
    await usageSettled();
    expect((await t.api("GET", "/api/app-info")).body.you.aiInsights).toBe(1);
  });

  it("protein help: top sources and short days from the app; swaps only of foods in the data", async () => {
    await seed();
    await aiServices();
    const r = await t.api("POST", "/api/insights/refresh", { kind: "protein" });
    expect(r.status).toBe(200);
    expect(r.body.insight).toMatchObject({ kind: "protein", periodStart: "2026-10-22", periodEnd: "2026-11-18" });
    const c = r.body.insight.content;
    expect(c.facts.topSources[0]).toEqual({ food: "Chicken breast", protein_g: 205, times: 2 });
    expect(c.facts.shortDays.map((d: any) => [d.date, d.shortBy])).toEqual([["2026-11-09", 50], ["2026-11-10", 40], ["2026-11-16", 100]]);
    expect(c.additions).toEqual(PROTEIN.additions);
    expect(c.swaps).toEqual([PROTEIN.swaps[0]]);
    // A second refresh replaces it (the newest only)
    t.clock.date = new Date(NOON_WED.getTime() + 11 * 60_000);
    await t.api("POST", "/api/insights/refresh", { kind: "protein" });
    expect(await t.db.select().from(insights).where(eq(insights.kind, "protein"))).toHaveLength(1);
  });

  it("once per 10 minutes per card: the other card can still be refreshed", async () => {
    await seed();
    await aiServices();
    expect((await t.api("POST", "/api/insights/refresh", { kind: "recap" })).status).toBe(200);
    t.clock.date = new Date(NOON_WED.getTime() + 4 * 60_000);
    const again = await t.api("POST", "/api/insights/refresh", { kind: "recap" });
    expect(again.status).toBe(429);
    expect(again.body).toMatchObject({ error: expect.stringMatching(/in 6 minutes/), retryAfterSec: 360 });
    expect((await t.api("GET", "/api/insights")).body.limits).toMatchObject({ recapRefreshIn: 360, proteinRefreshIn: 0 });
    expect((await t.api("POST", "/api/insights/refresh", { kind: "protein" })).status).toBe(200);
    t.clock.date = new Date(NOON_WED.getTime() + 10 * 60_000);
    expect((await t.api("POST", "/api/insights/refresh", { kind: "recap" })).status).toBe(200);
    // Still one "so far" recap for this week: the new one replaced the old
    expect(await t.db.select().from(insights).where(eq(insights.kind, "recap"))).toHaveLength(1);
    expect((await t.api("POST", "/api/insights/refresh", { kind: "answer" })).status).toBe(400);
  });

  it("an answer that can't be used: a friendly error, the last good card kept, and the try doesn't use up the 10 minutes", async () => {
    await seed();
    await aiServices();
    await t.api("POST", "/api/insights/refresh", { kind: "recap" });
    t.clock.date = new Date(NOON_WED.getTime() + 11 * 60_000);
    for (const bad of ["Sorry, I can't do that.", { summary: "No tip" }, { summary: 5, wentWell: [], tryNext: "" }]) {
      replies.recap = bad;
      const r = await t.api("POST", "/api/insights/refresh", { kind: "recap" });
      expect(r.status).toBe(502);
      expect(r.body.error).toBe("Couldn't write your insights right now. Try again in a little while.");
    }
    const page = (await t.api("GET", "/api/insights")).body;
    expect(page.recaps).toHaveLength(1);
    expect(page.recaps[0].content.summary).toBe(RECAP.summary);
    replies.recap = { ...RECAP, summary: "Fresh." };
    expect((await t.api("POST", "/api/insights/refresh", { kind: "recap" })).body.insight.content.summary).toBe("Fresh.");
  });

  it("an answer cut off for room is asked again with more room", async () => {
    await seed();
    await aiServices();
    let n = 0;
    t.ai.respond = ((_url: string, body: any) => (++n === 1 ? reply('{"summary": "A solid we', "length") : answer(_url, body))) as any;
    const r = await t.api("POST", "/api/insights/refresh", { kind: "recap" });
    expect(r.status).toBe(200);
    expect(t.ai.calls.map((c) => c.body.max_tokens)).toEqual([3000, 6000]);
  });

  it("the next AI service answers when the first is down, and the page is told another is being asked (lines)", async () => {
    await seed();
    await aiServices([
      { name: "Home AI", provider: "local", baseUrl: "http://10.0.0.5:11434/v1", model: "qwen" } as any,
      { name: "Cloud", provider: "openai", apiKey: "sk-cloud", model: "gpt" },
    ]);
    t.ai.respond = ((url: string, body: any) => (url.startsWith("http://10.0.0.5") ? { status: 503, json: { error: { message: "loading" } } } : answer(url, body))) as any;
    const r = await t.api("POST", "/api/insights/refresh", { kind: "recap" }, { accept: "application/x-ndjson" });
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(/application\/x-ndjson/);
    const lines = String(r.body).trim().split("\n").map((l) => JSON.parse(l));
    expect(lines[0]).toEqual({ progress: "another" });
    expect(lines[1].insight.content.summary).toBe(RECAP.summary);
    expect(String(r.body)).not.toMatch(/Home AI|Cloud|loading/);
    // Every service down: a friendly line, no service named
    t.ai.respond = (() => ({ status: 503, json: { error: { message: "loading" } } })) as any;
    t.clock.date = new Date(NOON_WED.getTime() + 11 * 60_000);
    const down = await t.api("POST", "/api/insights/refresh", { kind: "recap" }, { accept: "application/x-ndjson" });
    const last = String(down.body).trim().split("\n").map((l) => JSON.parse(l)).at(-1);
    expect(last).toEqual({ error: "Couldn't write your insights right now. Try again in a little while.", status: 502 });
  });
});

describe("Ask a question", () => {
  it("answered from the person's data for the range the question implies (default the last 4 weeks)", async () => {
    await seed();
    await aiServices();
    const r = await t.api("POST", "/api/insights/ask", { question: "How's my protein?" });
    expect(r.status).toBe(200);
    expect(r.body.insight).toMatchObject({ kind: "answer", question: "How's my protein?", periodStart: "2026-10-22", periodEnd: "2026-11-18", content: { answer: "You averaged 92 g of protein a day.", offTopic: false } });
    expect(userText(t.ai.calls[0].body)).toContain('The person asks: "How\'s my protein?"');
    await t.api("POST", "/api/insights/ask", { question: "How was last week?" });
    expect(summaryOf(t.ai.calls[1]).period).toEqual({ from: "2026-11-08", to: "2026-11-14" });
    const page = (await t.api("GET", "/api/insights")).body;
    expect(page.answers.map((a: any) => a.question)).toEqual(["How was last week?", "How's my protein?"]);
    expect(page.limits.questionsLeft).toBe(18);
  });

  it("a question about something else gets the polite reply", async () => {
    await aiServices();
    replies.answer = { offTopic: true };
    const r = await t.api("POST", "/api/insights/ask", { question: "Write me a poem about cars" });
    expect(r.body.insight.content).toEqual({ answer: OFF_TOPIC, offTopic: true });
    expect(OFF_TOPIC).toMatch(/I can only help with your ByteSize data/);
  });

  it("20 questions a day (the person's day), and the last 20 are kept", async () => {
    await aiServices();
    expect((await t.api("POST", "/api/insights/ask", { question: "" })).status).toBe(400);
    for (let i = 0; i < 20; i++) {
      t.clock.date = new Date(NOON_WED.getTime() + i * 1000);
      expect((await t.api("POST", "/api/insights/ask", { question: `Question ${i}?` })).status).toBe(200);
    }
    const over = await t.api("POST", "/api/insights/ask", { question: "One more?" });
    expect(over.status).toBe(429);
    expect(over.body.error).toMatch(/20 questions today/);
    expect((await t.api("GET", "/api/insights")).body.limits.questionsLeft).toBe(0);
    // 11:30 pm in Boise is still today; 12:05 am is tomorrow
    t.clock.date = new Date("2026-11-19T06:30:00Z");
    expect((await t.api("POST", "/api/insights/ask", { question: "Still today?" })).status).toBe(429);
    t.clock.date = new Date("2026-11-19T07:05:00Z");
    expect((await t.api("POST", "/api/insights/ask", { question: "Tomorrow?" })).status).toBe(200);
    const kept = await t.db.select().from(insights).where(eq(insights.kind, "answer"));
    expect(kept).toHaveLength(20);
    expect(kept.map((k) => k.question)).not.toContain("Question 0?");
    expect(kept.map((k) => k.question)).toContain("Tomorrow?");
  });
});

describe("the weekly run", () => {
  // Last week: Sun 8 - Sat 14 Nov. It's written about 6 am on Sunday 15 Nov in the person's time zone.
  const at = (iso: string) => (t.clock.date = new Date(iso));

  it("writes each person's recap (and protein help) once, after 6 am the day after their week ends", async () => {
    await seed();
    await aiServices();
    at("2026-11-15T12:30:00Z"); // 5:30 am in Boise
    expect(await weeklyInsightsCheck(t.app)).toEqual([]);
    at("2026-11-15T13:05:00Z"); // 6:05 am
    expect(await weeklyInsightsCheck(t.app)).toEqual([1]);
    const rows = await t.db.select().from(insights);
    expect(rows.map((r) => [r.kind, r.source, r.periodStart, r.periodEnd]).sort()).toEqual([
      ["protein", "weekly", "2026-10-18", "2026-11-14"],
      ["recap", "weekly", "2026-11-08", "2026-11-14"],
    ]);
    expect(rows.find((r) => r.kind === "recap")!.content).toMatchObject({ ...RECAP, numbers: { daysLogged: 3, daysInRange: 2 } });
    expect(userText(t.ai.calls[0].body)).toMatch(/the week that just ended/);
    // Once per person per week: later checks (and the next day) write nothing
    at("2026-11-15T14:05:00Z");
    expect(await weeklyInsightsCheck(t.app)).toEqual([]);
    at("2026-11-17T14:05:00Z");
    expect(await weeklyInsightsCheck(t.app)).toEqual([]);
    expect(t.ai.calls).toHaveLength(2);
    const page = (await t.api("GET", "/api/insights")).body;
    expect(page.recaps[0]).toMatchObject({ soFar: false, periodStart: "2026-11-08" });
  });

  it("the person's own time zone and week start", async () => {
    await seed();
    await aiServices();
    await t.db.update(users).set({ timezone: "Europe/London" });
    await t.db.insert(userSettings).values({ userId: 1, weekStart: 1 }); // Monday: last week is Mon 9 - Sun 15
    at("2026-11-16T05:30:00Z"); // 5:30 am Monday in London
    expect(await weeklyInsightsCheck(t.app)).toEqual([]);
    at("2026-11-16T06:10:00Z");
    expect(await weeklyInsightsCheck(t.app)).toEqual([1]);
    const [recap] = await t.db.select().from(insights).where(eq(insights.kind, "recap"));
    expect([recap.periodStart, recap.periodEnd]).toEqual(["2026-11-09", "2026-11-15"]);
  });

  it("skipped under 3 logged days, with the switch off, or without AI", async () => {
    await seed();
    at("2026-11-15T13:05:00Z");
    expect(await weeklyInsightsCheck(t.app)).toEqual([]); // no AI
    await aiServices();
    await t.api("PUT", "/api/insights/settings", { weeklyOn: false });
    expect(await weeklyInsightsCheck(t.app)).toEqual([]);
    await t.api("PUT", "/api/insights/settings", { weeklyOn: true });
    await t.db.delete(logEntries).where(eq(logEntries.day, "2026-11-11"));
    expect(await weeklyInsightsCheck(t.app)).toEqual([]);
    expect(t.ai.calls).toHaveLength(0);
  });

  it("a failure is tried again hourly, up to 3 more times", async () => {
    await seed();
    await aiServices();
    replies.recap = "not json";
    at("2026-11-15T13:05:00Z");
    expect(await weeklyInsightsCheck(t.app)).toEqual([]);
    expect(t.ai.calls).toHaveLength(1);
    at("2026-11-15T13:35:00Z"); // under an hour: not yet
    await weeklyInsightsCheck(t.app);
    expect(t.ai.calls).toHaveLength(1);
    for (const hour of ["14:06", "15:07", "16:08"]) {
      at(`2026-11-15T${hour}:00Z`);
      await weeklyInsightsCheck(t.app);
    }
    expect(t.ai.calls).toHaveLength(4);
    at("2026-11-15T17:09:00Z"); // 3 retries done: no more
    expect(await weeklyInsightsCheck(t.app)).toEqual([]);
    expect(t.ai.calls).toHaveLength(4);
    expect(await t.db.select().from(insights)).toHaveLength(0);
    const logs = (await t.api("GET", "/api/logs?category=schedule")).body;
    expect(JSON.stringify(logs)).toMatch(/weekly recap/i);
  });

  it("a weekly recap replaces that week's \"so far\" one", async () => {
    await seed();
    await aiServices();
    at("2026-11-14T19:00:00Z"); // Saturday: Refresh writes "so far" for 8-14 Nov
    await t.api("POST", "/api/insights/refresh", { kind: "recap" });
    at("2026-11-15T13:05:00Z");
    await weeklyInsightsCheck(t.app);
    const recaps = await t.db.select().from(insights).where(eq(insights.kind, "recap"));
    expect(recaps.map((r) => [r.source, r.periodStart])).toEqual([["weekly", "2026-11-08"]]);
  });
});
