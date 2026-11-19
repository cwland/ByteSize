import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { insights, logEntries, targets } from "../src/db/schema.js";
import { INSIGHTS_OFF, resetInsightRuns, weeklyInsightsCheck } from "../src/lib/insightsRun.js";
import { setupTestApp, type TestApp } from "./helpers.js";

// No AI service set up (or all switched off): the Insights switches, Refresh and Ask can't be used, the weekly run
// and its email don't run, what is stored stays visible, and everything works again once a service is set up.

let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
afterAll(async () => t.close());

const gmail = { enabled: true, host: "smtp.gmail.com", port: 587, security: "starttls", username: "cory@gmail.com", password: "app-password-123", fromName: "ByteSize", fromAddress: "cory@gmail.com", appUrl: "https://bytesize.example.com" };
const service = { name: "Home AI", provider: "openai", apiKey: "sk-home-ai", model: "gpt" };
const ai = (enabled: boolean, services = [service]) => t.api("PUT", "/api/settings/ai", { enabled, mode: "auto", maxPerRun: 50, timeoutSec: 5, services });
const RECAP = { summary: "A solid week.", wentWell: ["Logged 3 days"], slipped: [], tryNext: "Add yogurt." };
const reply = (c: unknown) => ({ status: 200, json: { choices: [{ message: { content: JSON.stringify(c) }, finish_reason: "stop" }] } });
const answer = (_u: string, body: any) => reply((body.messages?.[1]?.content ?? "").includes("Write a recap") ? RECAP : (body.messages?.[1]?.content ?? "").includes("<question>") ? { answer: "Fine." } : { intro: "x", additions: [{ suggestion: "Yogurt", why: "gap" }], swaps: [] });

beforeEach(async () => {
  await t.reset();
  resetInsightRuns(t.app);
  await t.login();
  t.ai.respond = answer as any;
  t.clock.date = new Date("2026-11-18T19:00:00Z");
  await t.db.insert(insights).values([
    { userId: 1, kind: "recap", source: "weekly", periodStart: "2026-11-01", periodEnd: "2026-11-07", content: { ...RECAP, summary: "Stored recap." } },
    { userId: 1, kind: "answer", source: "ask", periodStart: "2026-10-22", periodEnd: "2026-11-18", question: "Stored question?", content: { answer: "Stored answer.", offTopic: false } },
  ]);
});

const off = {
  "no AI service ever set up": async () => {},
  "every AI service switched off": async () => void (await ai(true), await ai(false)),
  "AI turned off with its services kept": async () => void (await ai(false)),
};

for (const [name, setUp] of Object.entries(off)) {
  describe(name, () => {
    beforeEach(setUp);

    it("the page says AI isn't ready, and what is stored stays visible", async () => {
      const page = (await t.api("GET", "/api/insights")).body;
      expect(page.aiReady).toBe(false);
      expect(page.recaps.map((r: any) => r.content.summary)).toEqual(["Stored recap."]);
      expect(page.answers.map((a: any) => a.question)).toEqual(["Stored question?"]);
    });

    it("can't turn the weekly recap or its email on (409, saying how to set AI up); turning off is fine", async () => {
      await t.api("POST", "/api/settings/email/test", { settings: gmail });
      await t.api("PUT", "/api/settings/email", gmail);
      for (const body of [{ weeklyOn: true }, { emailOn: true }, { weeklyOn: true, emailOn: true }]) {
        const r = await t.api("PUT", "/api/insights/settings", body);
        expect(r.status).toBe(409);
        expect(r.body.error).toBe(INSIGHTS_OFF);
      }
      expect((await t.api("PUT", "/api/insights/settings", { weeklyOn: false, emailOn: false })).status).toBe(200);
    });

    it("Refresh and Ask are refused, and nothing is sent to an AI", async () => {
      const calls = t.ai.calls.length;
      for (const [url, body] of [["/api/insights/refresh", { kind: "recap" }], ["/api/insights/refresh", { kind: "protein" }], ["/api/insights/ask", { question: "How am I doing?" }]] as const) {
        const r = await t.api("POST", url, body);
        expect(r.status).toBe(503);
        expect(r.body.error).toBe(INSIGHTS_OFF);
      }
      expect(t.ai.calls.length).toBe(calls);
    });

    it("the weekly run does nothing, for anyone", async () => {
      await t.db.insert(targets).values({ userId: 1, effectiveFrom: "2026-11-01", plan: "steady", caloriesMin: 1600, caloriesMax: 1800, proteinMin: 120, proteinMax: 160, fiberMin: 25, fiberMax: 38, waterMin: 2000, waterMax: 3000 });
      const e = (day: string) => ({ userId: 1, day, meal: "lunch", name: "Chicken", icon: "🍽", source: "cache", unit: "serving", quantity: 1, perServing: {}, servings: [{ label: "1 serving" }], nutrients: { calories: 1700, protein_g: 125 } });
      await t.db.insert(logEntries).values(["2026-11-09", "2026-11-10", "2026-11-11"].map(e));
      t.clock.date = new Date("2026-11-15T13:05:00Z");
      expect(await weeklyInsightsCheck(t.app)).toEqual([]);
      expect((await t.db.select().from(insights)).filter((r) => r.periodStart === "2026-11-08")).toHaveLength(0);
    });
  });
}

describe("when an AI service is set up again", () => {
  it("everything works on the next page load, no restart, and the person's earlier choices are kept", async () => {
    await ai(true);
    expect((await t.api("PUT", "/api/insights/settings", { weeklyOn: false })).status).toBe(200);
    await ai(false, []);
    expect((await t.api("GET", "/api/insights")).body.aiReady).toBe(false);
    expect((await t.api("POST", "/api/insights/ask", { question: "Anything?" })).status).toBe(503);
    await ai(true);
    const page = (await t.api("GET", "/api/insights")).body;
    expect(page.aiReady).toBe(true);
    expect(page.weeklyOn).toBe(false); // what they chose before is still there
    expect((await t.api("PUT", "/api/insights/settings", { weeklyOn: true })).status).toBe(200);
    expect((await t.api("POST", "/api/insights/ask", { question: "Anything?" })).status).toBe(200);
    expect((await t.api("POST", "/api/insights/refresh", { kind: "recap" })).status).toBe(200);
  });
});
