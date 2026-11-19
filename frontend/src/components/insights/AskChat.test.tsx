import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InsightsPage from "./InsightsPage";
import { fakeServer } from "../../test/fakeServer";
import { renderWithSession } from "../../test/renderWithSession";
import { answerRow, insightsJson, streamed } from "../../test/insightsFixtures";

// §47 Insights: ask as a chat. A link-button in the title area opens "Ask ByteSize": bubbles, the stored history,
// Send / Enter, "Thinking… asking AI", Clear chat (asks first), closing only with X or Escape.

const TRIGGER = "Ask about your eating, weight or habits";
// newest first, as the API sends them
const history = () => [
  answerRow({ id: 12, question: "And last month?", content: { answer: "Last month was a little lower.", offTopic: false } }),
  answerRow({ id: 11, question: "How's my protein?", content: { answer: "You averaged 92 g of protein a day.", offTopic: false } }),
];
const page = (over: Record<string, unknown> = {}) => insightsJson({ answers: history(), ...over });
const scrolled = vi.fn();
beforeEach(() => {
  scrolled.mockClear();
  Element.prototype.scrollIntoView = scrolled;
});
afterEach(() => void vi.useRealTimers());

const open = async (user = userEvent.setup()) => {
  await user.click(await screen.findByRole("button", { name: TRIGGER }));
  return { user, chat: await screen.findByRole("dialog", { name: "Ask ByteSize" }) };
};

describe("the trigger", () => {
  it("the Ask a question card is gone; a chat link-button sits in the title area, above the cards", async () => {
    fakeServer({ "GET /api/insights": () => page() });
    renderWithSession(<InsightsPage />);
    const trigger = await screen.findByRole("button", { name: TRIGGER });
    expect(screen.queryByRole("region", { name: "Ask a question" })).not.toBeInTheDocument();
    expect(trigger.querySelector("svg")).not.toBeNull(); // the chat icon, beside the words
    const recap = screen.getByRole("region", { name: "Weekly recap" });
    expect(trigger.compareDocumentPosition(recap) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(trigger.compareDocumentPosition(screen.getByRole("heading", { level: 1, name: "Insights" })) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it("opens the chat sheet, titled Ask ByteSize", async () => {
    fakeServer({ "GET /api/insights": () => page() });
    renderWithSession(<InsightsPage />);
    const { chat } = await open();
    expect(within(chat).getByRole("heading", { name: "Ask ByteSize" })).toBeInTheDocument();
  });
});

describe("the conversation", () => {
  it("shows the stored questions and answers as bubbles, oldest first, newest at the bottom, scrolled down on open", async () => {
    fakeServer({ "GET /api/insights": () => page() });
    renderWithSession(<InsightsPage />);
    const { chat } = await open();
    const log = within(chat).getByRole("log", { name: "Conversation" });
    const bubbles = within(log).getAllByTestId("bubble");
    expect(bubbles.map((b) => b.textContent)).toEqual(["How's my protein?", "You averaged 92 g of protein a day.", "And last month?", "Last month was a little lower."]);
    // the person's on the right, the AI's on the left
    expect(bubbles.map((b) => b.getAttribute("data-from"))).toEqual(["you", "ai", "you", "ai"]);
    expect(bubbles[0]).toHaveClass("self-end");
    expect(bubbles[1]).toHaveClass("self-start");
    await waitFor(() => expect(scrolled).toHaveBeenCalled());
    expect(chat.textContent).not.toMatch(/OpenAI|Claude|Gemini/);
  });

  it("an empty chat says what to do", async () => {
    fakeServer({ "GET /api/insights": () => page({ answers: [] }) });
    renderWithSession(<InsightsPage />);
    const { chat } = await open();
    expect(within(chat).getByText(/Ask a question about your own logs/)).toBeInTheDocument();
    expect(within(chat).getByRole("button", { name: "Clear chat" })).toBeDisabled();
  });

  it("the same history is there when it is opened again", async () => {
    fakeServer({ "GET /api/insights": () => page() });
    renderWithSession(<InsightsPage />);
    const { user } = await open();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Ask ByteSize" })).not.toBeInTheDocument());
    const { chat } = await open(user);
    expect(within(chat).getAllByTestId("bubble")).toHaveLength(4);
  });
});

describe("asking", () => {
  const server = (answer = streamed()) => {
    let current = page();
    const s = fakeServer({
      "GET /api/insights": () => current,
      "POST /api/insights/ask": () => answer.response,
    });
    return { s, answer, set: (p: ReturnType<typeof page>) => (current = p) };
  };

  it("Send: the question appears at once, 'Thinking… asking AI' with the wheel, then the answer", async () => {
    const { s, answer, set } = server();
    renderWithSession(<InsightsPage />);
    const { user, chat } = await open();
    const box = within(chat).getByRole("textbox", { name: "Your question" });
    await user.type(box, "What about protein at dinner?");
    await user.click(within(chat).getByRole("button", { name: "Send" }));
    expect(s.writes()[0]).toMatchObject({ path: "/api/insights/ask", body: { question: "What about protein at dinner?" } });
    expect(box).toHaveValue("");
    const bubbles = within(chat).getAllByTestId("bubble");
    expect(bubbles.at(-1)).toHaveTextContent("What about protein at dinner?");
    expect(bubbles.at(-1)).toHaveAttribute("data-from", "you");
    const working = await within(chat).findByRole("status");
    expect(working).toHaveTextContent("Thinking… asking AI");
    expect(working.querySelector("svg")!.getAttribute("class")).toMatch(/animate-spin/);
    expect(within(chat).getByRole("button", { name: "Send" })).toBeDisabled();
    const made = answerRow({ id: 13, question: "What about protein at dinner?", content: { answer: "Dinner averaged 31 g.", offTopic: false } });
    set(page({ answers: [made, ...history()], limits: { ...insightsJson().limits, questionsLeft: 18 } }));
    answer.send({ insight: made });
    answer.end();
    await waitFor(() => expect(within(chat).getAllByTestId("bubble")).toHaveLength(6));
    const last = within(chat).getAllByTestId("bubble");
    expect(last.at(-1)).toHaveTextContent("Dinner averaged 31 g.");
    expect(last.at(-1)).toHaveAttribute("data-from", "ai");
    expect(within(chat).getByRole("status")).toHaveTextContent("");
  });

  it("Enter sends; Shift+Enter makes a new line", async () => {
    const { s } = server();
    renderWithSession(<InsightsPage />);
    const { user, chat } = await open();
    const box = within(chat).getByRole("textbox", { name: "Your question" });
    await user.type(box, "Line one{Shift>}{Enter}{/Shift}line two");
    expect(box).toHaveValue("Line one\nline two");
    expect(s.writes()).toHaveLength(0);
    await user.keyboard("{Enter}");
    expect(s.writes()[0]).toMatchObject({ body: { question: "Line one\nline two" } });
  });

  it("nothing to send while the box is empty", async () => {
    const { s } = server();
    renderWithSession(<InsightsPage />);
    const { user, chat } = await open();
    expect(within(chat).getByRole("button", { name: "Send" })).toBeDisabled();
    await user.type(within(chat).getByRole("textbox", { name: "Your question" }), "   {Enter}");
    expect(s.writes()).toHaveLength(0);
  });

  it("an error says so plainly and keeps what was typed", async () => {
    fakeServer({ "GET /api/insights": () => page(), "POST /api/insights/ask": () => ({ status: 502, json: { error: "Couldn't write your insights right now. Try again in a little while." } }) });
    renderWithSession(<InsightsPage />);
    const { user, chat } = await open();
    const box = within(chat).getByRole("textbox", { name: "Your question" });
    await user.type(box, "Will this work?{Enter}");
    expect(await within(chat).findByText("Couldn't write your insights right now. Try again in a little while.")).toBeInTheDocument();
    expect(box).toHaveValue("Will this work?");
    expect(within(chat).getAllByTestId("bubble")).toHaveLength(4); // the unanswered question isn't left as a bubble
  });

  it("20 a day: when they're used up it says so and Send is off", async () => {
    fakeServer({ "GET /api/insights": () => page({ limits: { ...insightsJson().limits, questionsLeft: 0 } }) });
    renderWithSession(<InsightsPage />);
    const { chat } = await open();
    expect(within(chat).getByText("You've asked 20 questions today. You can ask more tomorrow.")).toBeInTheDocument();
    expect(within(chat).getByRole("textbox", { name: "Your question" })).toBeDisabled();
    expect(within(chat).getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("no AI service: the chat says so and can't send", async () => {
    fakeServer({ "GET /api/insights": () => page({ aiReady: false }) });
    renderWithSession(<InsightsPage />);
    const { chat } = await open();
    expect(within(chat).getByText(/no AI service is set up/i)).toBeInTheDocument();
    expect(within(chat).getByRole("textbox", { name: "Your question" })).toBeDisabled();
    expect(within(chat).getByRole("button", { name: "Send" })).toBeDisabled();
  });
});

describe("focus", () => {
  it("the box has focus when the chat opens", async () => {
    fakeServer({ "GET /api/insights": () => page() });
    renderWithSession(<InsightsPage />);
    const { chat } = await open();
    await waitFor(() => expect(within(chat).getByRole("textbox", { name: "Your question" })).toHaveFocus());
  });

  it("stays in the box while the answer is awaited (read only, not disabled) and after it arrives", async () => {
    const answer = streamed();
    let current = page();
    fakeServer({ "GET /api/insights": () => current, "POST /api/insights/ask": () => answer.response });
    renderWithSession(<InsightsPage />);
    const { user, chat } = await open();
    const box = within(chat).getByRole("textbox", { name: "Your question" });
    await user.type(box, "Next question?{Enter}");
    await within(chat).findByRole("status");
    expect(box).toHaveAttribute("readonly");
    expect(box).not.toBeDisabled();
    expect(box).toHaveFocus();
    const made = answerRow({ id: 14, question: "Next question?", content: { answer: "Sure.", offTopic: false } });
    current = page({ answers: [made, ...history()] });
    answer.send({ insight: made });
    answer.end();
    await waitFor(() => expect(within(chat).getAllByTestId("bubble")).toHaveLength(6));
    expect(box).not.toHaveAttribute("readonly");
    expect(box).toHaveFocus();
  });

  it("after Clear chat the box has focus again", async () => {
    let current = page();
    fakeServer({ "GET /api/insights": () => current, "DELETE /api/insights/answers": () => ((current = page({ answers: [] })), { cleared: 2 }) });
    renderWithSession(<InsightsPage />);
    const { user, chat } = await open();
    await user.click(within(chat).getByRole("button", { name: "Clear chat" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Clear chat" }));
    await waitFor(() => expect(within(chat).queryAllByTestId("bubble")).toHaveLength(0));
    await waitFor(() => expect(within(chat).getByRole("textbox", { name: "Your question" })).toHaveFocus());
  });
});

describe("closing", () => {
  it("Close (X) and Escape close it; a click on the backdrop doesn't", async () => {
    fakeServer({ "GET /api/insights": () => page() });
    renderWithSession(<InsightsPage />);
    const { user, chat } = await open();
    await user.click(chat.parentElement!); // the dimmed backdrop
    expect(screen.getByRole("dialog", { name: "Ask ByteSize" })).toBeInTheDocument();
    await user.click(within(chat).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Ask ByteSize" })).not.toBeInTheDocument());
    await open(user);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Ask ByteSize" })).not.toBeInTheDocument());
  });
});

describe("Clear chat", () => {
  it("asks first; Cancel (or Escape) keeps the history, and Escape leaves the chat open", async () => {
    const s = fakeServer({ "GET /api/insights": () => page(), "DELETE /api/insights/answers": () => ({ cleared: 2 }) });
    renderWithSession(<InsightsPage />);
    const { user, chat } = await open();
    await user.click(within(chat).getByRole("button", { name: "Clear chat" }));
    const sure = await screen.findByRole("alertdialog", { name: "Clear this chat?" });
    await user.click(within(sure).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await user.click(within(chat).getByRole("button", { name: "Clear chat" }));
    await screen.findByRole("alertdialog");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Ask ByteSize" })).toBeInTheDocument();
    expect(s.writes()).toHaveLength(0);
    expect(within(chat).getAllByTestId("bubble")).toHaveLength(4);
  });

  it("clearing empties the history on the server and in the chat", async () => {
    let current = page();
    const s = fakeServer({
      "GET /api/insights": () => current,
      "DELETE /api/insights/answers": () => {
        current = page({ answers: [], limits: { ...insightsJson().limits, questionsLeft: 17 } });
        return { cleared: 2 };
      },
    });
    renderWithSession(<InsightsPage />);
    const { user, chat } = await open();
    await user.click(within(chat).getByRole("button", { name: "Clear chat" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Clear chat" }));
    expect(s.writes()[0]).toMatchObject({ method: "DELETE", path: "/api/insights/answers" });
    await waitFor(() => expect(within(chat).queryAllByTestId("bubble")).toHaveLength(0));
    expect(screen.getByRole("dialog", { name: "Ask ByteSize" })).toBeInTheDocument();
  });
});
