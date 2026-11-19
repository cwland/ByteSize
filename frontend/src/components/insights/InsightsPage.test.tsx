import { afterEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InsightsPage from "./InsightsPage";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";
import { wideScreen } from "../../test/wide";
import { answerRow, insightsJson, proteinRow, recapRow, streamed, weekNumbers } from "../../test/insightsFixtures";

// Insights (§43): the weekly recap with the app's numbers, protein help and food swaps, ask a question

const stat = (card: HTMLElement, name: string) => within(card).getByRole("group", { name });

afterEach(() => void vi.useRealTimers());

describe("Insights page", () => {
  it("the Refresh wait counts down, and Refresh comes back on by itself", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    fakeServer({ "GET /api/insights": () => insightsJson({ limits: { ...insightsJson().limits, recapRefreshIn: 90 } }) });
    renderWithSession(<InsightsPage />);
    const card = await screen.findByRole("region", { name: "Weekly recap" });
    expect(within(card).getByRole("button", { name: "Refresh weekly recap" })).toBeDisabled();
    expect(within(card).getByText("You can refresh again in 2 minutes.")).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(31_000));
    expect(within(card).getByText("You can refresh again in 1 minute.")).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(60_000));
    expect(within(card).getByRole("button", { name: "Refresh weekly recap" })).toBeEnabled();
    expect(within(card).queryByText(/You can refresh again/)).not.toBeInTheDocument();
  });


  it("the weekly recap: what the AI wrote, and the week's numbers from the app beside it; past recaps below", async () => {
    fakeServer({ "GET /api/insights": () => insightsJson() });
    renderWithSession(<InsightsPage />);
    expect(await screen.findByRole("heading", { level: 1, name: "Insights" })).toBeInTheDocument();
    const card = await screen.findByRole("region", { name: "Weekly recap" });
    expect(within(card).getByText("Nov 8–14")).toBeInTheDocument();
    expect(within(card).getByText("A solid week: you logged 3 days and hit your range on 2.")).toBeInTheDocument();
    expect(within(within(card).getByRole("list", { name: "What went well" })).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Logged 3 days", "Protein on Wednesday"]);
    expect(within(within(card).getByRole("list", { name: "What slipped" })).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Tuesday was low"]);
    expect(within(card).getByRole("heading", { name: "One thing to try" }).nextSibling).toHaveTextContent("Add Greek yogurt at breakfast.");
    // The numbers (the app's, never the AI's)
    expect(stat(card, "Days logged")).toHaveTextContent("3 of 7");
    expect(stat(card, "Days in range")).toHaveTextContent("2");
    expect(stat(card, "Average calories")).toHaveTextContent("1,267");
    expect(stat(card, "Average calories")).toHaveTextContent("Plan 1,600–1,800");
    expect(stat(card, "Average protein")).toHaveTextContent("91.7 g");
    expect(stat(card, "Average protein")).toHaveTextContent("Minimum 120 g");
    expect(stat(card, "Water goal reached")).toHaveTextContent("1 day");
    expect(stat(card, "Steps")).toHaveTextContent("7,000 a day");
    expect(stat(card, "Workouts")).toHaveTextContent("1 (30 min)");
    expect(stat(card, "Trend weight")).toHaveTextContent("−2 lb");
    // Past recaps
    const past = within(card).getByText("Past recaps");
    await userEvent.setup().click(past);
    expect(within(card).getByText("The week before.")).toBeVisible();
    // Never names an AI service
    expect(document.body.textContent).not.toMatch(/OpenAI|Claude|Gemini|OpenRouter|Home AI/);
  });

  it("a recap of this week so far says so", async () => {
    fakeServer({ "GET /api/insights": () => insightsJson({ recaps: [recapRow({ soFar: true, source: "refresh", periodStart: "2026-11-15", periodEnd: "2026-11-18" })] }) });
    renderWithSession(<InsightsPage />);
    const card = await screen.findByRole("region", { name: "Weekly recap" });
    expect(within(card).getByText("So far this week")).toBeInTheDocument();
    expect(within(card).queryByText("Past recaps")).not.toBeInTheDocument();
  });

  it("no AI service: says so and links to Settings › Integrations; the week's numbers still show", async () => {
    fakeServer({ "GET /api/insights": () => insightsJson({ aiReady: false, recaps: [], protein: null, answers: [] }) });
    renderWithSession(<InsightsPage />);
    const note = await screen.findByText(/no AI service is set up/i);
    expect(within(note).getByRole("link", { name: "Settings › Integrations" })).toHaveAttribute("href", "#/settings/integrations");
    const card = screen.getByRole("region", { name: "Weekly recap" });
    expect(stat(card, "Days logged")).toHaveTextContent("3 of 7");
    expect(within(card).queryByRole("button", { name: "Refresh weekly recap" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Ask about your eating, weight or habits" })).toBeDisabled();
  });

  it("Refresh: 'Thinking… asking AI' with the turning wheel, then the new recap; another AI said plainly", async () => {
    const answer = streamed();
    let page = insightsJson();
    const server = fakeServer({ "GET /api/insights": () => page, "POST /api/insights/refresh": () => answer.response });
    renderWithSession(<InsightsPage />);
    const user = userEvent.setup();
    const card = await screen.findByRole("region", { name: "Weekly recap" });
    await user.click(within(card).getByRole("button", { name: "Refresh weekly recap" }));
    const working = await within(card).findByRole("status");
    expect(working).toHaveTextContent("Thinking… asking AI");
    expect(working.querySelector("svg")!.getAttribute("class")).toMatch(/animate-spin/);
    expect(within(card).getByRole("button", { name: "Refresh weekly recap" })).toBeDisabled();
    const sent = server.sent.find((s) => s.method === "POST")!;
    expect(sent.body).toEqual({ kind: "recap" });
    expect(sent.headers.accept).toMatch(/application\/x-ndjson/);
    answer.send({ progress: "another" });
    await waitFor(() => expect(working).toHaveTextContent("Still thinking… trying another AI"));
    const fresh = recapRow({ id: 5, soFar: true, source: "refresh", periodStart: "2026-11-15", periodEnd: "2026-11-18", content: { ...recapRow().content, summary: "Fresh words." } });
    page = insightsJson({ recaps: [fresh, ...insightsJson().recaps], limits: { ...insightsJson().limits, recapRefreshIn: 600 } });
    answer.send({ insight: fresh });
    answer.end();
    expect(await within(card).findByText("Fresh words.")).toBeInTheDocument();
    expect(within(card).getByRole("status")).toHaveTextContent("");
    // Once per 10 minutes: the button waits, and says when
    expect(within(card).getByRole("button", { name: "Refresh weekly recap" })).toBeDisabled();
    expect(within(card).getByText("You can refresh again in 10 minutes.")).toBeInTheDocument();
  });

  it("Refresh that fails: a plain message saying when to try again, the last good recap stays, and Refresh waits", async () => {
    let page = insightsJson();
    fakeServer({
      "GET /api/insights": () => page,
      "POST /api/insights/refresh": () => {
        page = insightsJson({ limits: { ...insightsJson().limits, recapRefreshIn: 600 } }); // the try counts
        return { status: 502, json: { error: "Couldn't write your insights right now. Try again in 10 minutes.", retryAfterSec: 600 } };
      },
    });
    renderWithSession(<InsightsPage />);
    const user = userEvent.setup();
    const card = await screen.findByRole("region", { name: "Weekly recap" });
    await user.click(within(card).getByRole("button", { name: "Refresh weekly recap" }));
    expect(await within(card).findByRole("alert")).toHaveTextContent("Couldn't write your insights right now. Try again in 10 minutes.");
    expect(within(card).getByText("A solid week: you logged 3 days and hit your range on 2.")).toBeInTheDocument();
    await waitFor(() => expect(within(card).getByRole("button", { name: "Refresh weekly recap" })).toBeDisabled());
  });

  it("no recap yet: when the first one comes, and the numbers for the week just ended", async () => {
    fakeServer({ "GET /api/insights": () => insightsJson({ recaps: [] }) });
    renderWithSession(<InsightsPage />);
    const card = await screen.findByRole("region", { name: "Weekly recap" });
    expect(within(card).getByText(/Your first recap is written after your week ends/)).toBeInTheDocument();
    expect(stat(card, "Days logged")).toHaveTextContent("3 of 7");
  });

  it("protein help: top sources and short days (from the app), additions and swaps", async () => {
    const server = fakeServer({ "GET /api/insights": () => insightsJson(), "POST /api/insights/refresh": () => ({ insight: proteinRow() }) });
    renderWithSession(<InsightsPage />);
    const card = await screen.findByRole("region", { name: "Protein help and food swaps" });
    expect(within(card).getByText("Protein fell short on 2 days.")).toBeInTheDocument();
    expect(within(within(card).getByRole("list", { name: "Top protein sources" })).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Chicken breast205 g · 2 times", "Cheese pizza70 g · 1 time"]);
    expect(within(within(card).getByRole("list", { name: "Days protein fell short" })).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Nov 970 g · 50 g short", "Nov 1080 g · 40 g short"]);
    expect(within(card).getByRole("list", { name: "Try adding" })).toHaveTextContent("Greek yogurt at breakfastcloses the gap on 2 of 2 short days");
    expect(within(card).getByRole("list", { name: "Swaps" })).toHaveTextContent("Cheese pizza → Thin-crust chicken pizzaabout 300 calories");
    await userEvent.setup().click(within(card).getByRole("button", { name: "Refresh protein help" }));
    await waitFor(() => expect(server.writes()[0]).toMatchObject({ path: "/api/insights/refresh", body: { kind: "protein" } }));
  });

  it("protein help not written yet: how to get it", async () => {
    fakeServer({ "GET /api/insights": () => insightsJson({ protein: null }) });
    renderWithSession(<InsightsPage />);
    const card = await screen.findByRole("region", { name: "Protein help and food swaps" });
    expect(within(card).getByText(/Refresh to get protein help/)).toBeInTheDocument();
  });

  it("ask a question: the answer comes from the person's data, newest first", async () => {
    let page = insightsJson();
    const server = fakeServer({ "GET /api/insights": () => page, "POST /api/insights/ask": (b: any) => {
      const made = answerRow({ id: 7, question: b.question, content: { answer: "Mostly chicken.", offTopic: false } });
      page = insightsJson({ answers: [made, answerRow()], limits: { ...insightsJson().limits, questionsLeft: 18 } });
      return { insight: made };
    } });
    renderWithSession(<InsightsPage />);
    const user = userEvent.setup();
    const card = await screen.findByRole("region", { name: "Ask a question" });
    const box = within(card).getByRole("textbox", { name: "Ask about your eating, weight or habits" });
    await user.type(box, "Where does my protein come from?");
    await user.click(within(card).getByRole("button", { name: "Ask" }));
    expect(server.writes()[0]).toMatchObject({ path: "/api/insights/ask", body: { question: "Where does my protein come from?" } });
    const answers = await within(card).findByRole("list", { name: "Your questions" });
    await waitFor(() => expect(within(answers).getAllByRole("listitem")).toHaveLength(2));
    expect(within(answers).getAllByRole("listitem")[0]).toHaveTextContent("Where does my protein come from?Mostly chicken.");
    expect(box).toHaveValue("");
  });

  it("20 questions a day: a friendly message when they're used up", async () => {
    fakeServer({ "GET /api/insights": () => insightsJson({ limits: { ...insightsJson().limits, questionsLeft: 0 } }) });
    renderWithSession(<InsightsPage />);
    const card = await screen.findByRole("region", { name: "Ask a question" });
    expect(within(card).getByText("You've asked 20 questions today. You can ask more tomorrow.")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Ask" })).toBeDisabled();
  });

  it("the weekly switch", async () => {
    const server = fakeServer({ "GET /api/insights": () => insightsJson(), "PUT /api/insights/settings": (b: any) => b });
    renderWithSession(<InsightsPage />);
    const toggle = await screen.findByRole("switch", { name: "Weekly recap" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await userEvent.setup().click(toggle);
    expect(server.writes()[0]).toMatchObject({ path: "/api/insights/settings", body: { weeklyOn: false } });
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"));
  });

  it("metric weights, and a gain is shown with a plus", async () => {
    fakeServer({ "GET /api/insights": () => insightsJson({ recaps: [recapRow({ content: { ...recapRow().content, numbers: weekNumbers({ trendChange: 0.4, weightUnit: "kg" }) } })] }) });
    renderWithSession(<InsightsPage />, { units: "metric" });
    const card = await screen.findByRole("region", { name: "Weekly recap" });
    expect(stat(card, "Trend weight")).toHaveTextContent("+0.4 kg");
  });

  it("wide screens: the page header with the switch", async () => {
    wideScreen();
    fakeServer({ "GET /api/insights": () => insightsJson() });
    renderWithSession(<InsightsPage />);
    const h1 = await screen.findByRole("heading", { level: 1, name: "Insights" });
    expect(h1.closest("header")).toContainElement(screen.getByRole("switch", { name: "Weekly recap" }));
  });
});
