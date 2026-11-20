import { afterEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InsightsPage from "./InsightsPage";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";
import { wideScreen } from "../../test/wide";
import { answerRow, insightsJson, proteinRow, recapRow, streamed, weekNumbers } from "../../test/insightsFixtures";

// Insights (§43): the weekly recap with the app's numbers, protein help and food swaps; asking is a chat (AskChat.test.tsx)

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
    // Let React run the countdown's effect first: on a slow machine it could otherwise start after the clock jumped
    await act(async () => {});
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
    expect(within(card).getByRole("button", { name: "Refresh weekly recap" })).toBeDisabled();
  });

  describe("no AI service set up (or all switched off)", () => {
    const noAi = (over: Record<string, unknown> = {}) => fakeServer({ "GET /api/insights": () => insightsJson({ aiReady: false, weeklyOn: true, email: { on: true, available: true, hasAddress: true }, ...over }) });

    it("the Weekly recap and Email switches show off and disabled, described by the note", async () => {
      noAi();
      renderWithSession(<InsightsPage />);
      const note = await screen.findByText(/no AI service is set up/i);
      for (const name of ["Weekly recap", "Email me my weekly recap"]) {
        const toggle = screen.getByRole("switch", { name });
        expect(toggle).toBeDisabled();
        expect(toggle).toHaveAttribute("aria-checked", "false");
        expect(toggle).toHaveAccessibleDescription(note.textContent!);
      }
    });

    it("both Refresh buttons are there but disabled, described by the note", async () => {
      noAi();
      renderWithSession(<InsightsPage />);
      const note = await screen.findByText(/no AI service is set up/i);
      for (const [region, name] of [["Weekly recap", "Refresh weekly recap"], ["Protein help and food swaps", "Refresh protein help"]]) {
        const button = within(screen.getByRole("region", { name: region })).getByRole("button", { name });
        expect(button).toBeDisabled();
        expect(button).toHaveAccessibleDescription(note.textContent!);
      }
    });

    it("what was stored stays visible, and the chat opens read-only with its history", async () => {
      noAi();
      renderWithSession(<InsightsPage />);
      expect(await screen.findByText("A solid week: you logged 3 days and hit your range on 2.")).toBeInTheDocument();
      await userEvent.setup().click(screen.getByRole("button", { name: "Ask about your eating, weight or habits" }));
      const chat = await screen.findByRole("dialog", { name: "Ask ByteSize" });
      expect(within(chat).getAllByTestId("bubble")).toHaveLength(2);
      expect(within(chat).getByRole("textbox", { name: "Your question" })).toBeDisabled();
      expect(within(chat).getByRole("button", { name: "Send" })).toBeDisabled();
    });

    it("a switch isn't saved when clicked (nothing is sent)", async () => {
      const server = noAi();
      renderWithSession(<InsightsPage />);
      await screen.findByText(/no AI service is set up/i);
      await userEvent.setup().click(screen.getByRole("switch", { name: "Weekly recap" }));
      expect(server.writes()).toHaveLength(0);
    });

    it("with a service set up again (next page load) everything is enabled", async () => {
      fakeServer({ "GET /api/insights": () => insightsJson({ aiReady: true, email: { on: false, available: true, hasAddress: true } }) });
      renderWithSession(<InsightsPage />);
      await screen.findByRole("region", { name: "Weekly recap" });
      expect(screen.getByRole("switch", { name: "Weekly recap" })).toBeEnabled();
      expect(screen.getByRole("switch", { name: "Email me my weekly recap" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "Refresh weekly recap" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "Refresh protein help" })).toBeEnabled();
    });
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
    expect(within(within(card).getByRole("list", { name: "Top protein sources" })).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Chicken breast205 g · 2 times", "Cheese pizza70 g · 1 time"]); // whole grams (204.6 → 205)
    // Names are never cut off: the two lists stack instead of sitting side by side
    for (const name of within(within(card).getByRole("list", { name: "Top protein sources" })).getAllByText(/./, { selector: "li > span:first-child" })) expect(name.className).not.toMatch(/truncate/);
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

  it("the weekly switch", async () => {
    const server = fakeServer({ "GET /api/insights": () => insightsJson(), "PUT /api/insights/settings": (b: any) => b });
    renderWithSession(<InsightsPage />);
    const toggle = await screen.findByRole("switch", { name: "Weekly recap" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await userEvent.setup().click(toggle);
    expect(server.writes()[0]).toMatchObject({ path: "/api/insights/settings", body: { weeklyOn: false } });
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"));
  });

  describe("Email me my weekly recap (§45)", () => {
    const withEmail = (email: Record<string, unknown>) => ({ "GET /api/insights": () => insightsJson({ email: { on: false, available: true, hasAddress: true, ...email } }) });

    it("a switch under Weekly recap, off by default; turning it on saves it", async () => {
      const server = fakeServer({ ...withEmail({}), "PUT /api/insights/settings": (b: any) => b });
      renderWithSession(<InsightsPage />);
      const toggle = await screen.findByRole("switch", { name: "Email me my weekly recap" });
      expect(toggle).toHaveAttribute("aria-checked", "false");
      expect(toggle).toBeEnabled();
      const weekly = screen.getByRole("switch", { name: "Weekly recap" });
      expect(weekly.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      await userEvent.setup().click(toggle);
      expect(server.writes()[0]).toMatchObject({ path: "/api/insights/settings", body: { emailOn: true } });
      expect(server.writes()[0].body).not.toHaveProperty("weeklyOn");
      await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
    });

    it("shows it on when it is on", async () => {
      fakeServer(withEmail({ on: true }));
      renderWithSession(<InsightsPage />);
      expect(await screen.findByRole("switch", { name: "Email me my weekly recap" })).toHaveAttribute("aria-checked", "true");
    });

    it("hidden when the server's email isn't set up", async () => {
      fakeServer(withEmail({ available: false }));
      renderWithSession(<InsightsPage />);
      await screen.findByRole("switch", { name: "Weekly recap" });
      expect(screen.queryByRole("switch", { name: "Email me my weekly recap" })).not.toBeInTheDocument();
    });

    it("disabled, saying why, when the account has no email address", async () => {
      fakeServer(withEmail({ hasAddress: false }));
      renderWithSession(<InsightsPage />);
      const toggle = await screen.findByRole("switch", { name: "Email me my weekly recap" });
      expect(toggle).toBeDisabled();
      expect(screen.getByText("Add an email address in Settings › Profile")).toBeInTheDocument();
    });

    it("a refused save puts the switch back and says why", async () => {
      fakeServer({ ...withEmail({}), "PUT /api/insights/settings": () => new Response(JSON.stringify({ error: "Add an email address in Settings › Profile" }), { status: 409, headers: { "content-type": "application/json" } }) });
      renderWithSession(<InsightsPage />);
      const toggle = await screen.findByRole("switch", { name: "Email me my weekly recap" });
      await userEvent.setup().click(toggle);
      expect(await screen.findByText("Add an email address in Settings › Profile")).toBeInTheDocument();
      expect(toggle).toHaveAttribute("aria-checked", "false");
    });
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
