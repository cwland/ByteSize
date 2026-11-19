import { useEffect, useRef, useState } from "react";
import type { InsightsView } from "../../types";
import { fmt } from "../../units";
import { AiWorking } from "../log/useEstimate";
import { Confirm } from "../ui/Confirm";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { Sheet } from "../ui/Sheet";
import { field, primaryButton } from "../ui/styles";
import { api } from "../../api";
import { THINKING, useInsightAi } from "./useInsightAi";

// Ask ByteSize (§47): the Insights questions as a chat. The history is the stored questions and answers (§43), shown
// oldest first with the newest at the bottom; the person's bubbles on the right, the AI's on the left. Only X and
// Escape close it. The AI service is never named. Limits and privacy are as before (20 questions a day).

const bubble = "max-w-[85%] whitespace-pre-line break-words rounded-2xl px-3.5 py-2";

export default function AskChat({ view, onChanged, onClose }: { view: InsightsView; onChanged: () => Promise<unknown>; onClose: () => void }) {
  const ai = useInsightAi();
  const [text, setText] = useState("");
  const [asking, setAsking] = useState<string | null>(null); // the question waiting for its answer
  const [msg, setMsg] = useState<Msg>(null);
  const [confirming, setConfirming] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const exchanges = [...view.answers].reverse(); // the page sends the newest first
  const left = view.limits.questionsLeft;
  const used = view.aiReady && left <= 0;
  const blocked = !view.aiReady || left <= 0;

  useEffect(() => void end.current?.scrollIntoView?.({ block: "end" }), [exchanges.length, asking]);

  const send = async () => {
    const question = text.trim();
    if (!question || blocked || ai.step) return;
    setMsg(null);
    setText("");
    setAsking(question);
    try {
      if (await ai.run("/api/insights/ask", { question })) await onChanged();
      else setText(question); // cancelled: what was typed comes back
    } catch (err) {
      setText(question);
      setMsg(errorMsg(err));
      void onChanged(); // (today's questions may have run out)
    } finally {
      setAsking(null);
    }
  };

  const clear = async () => {
    setConfirming(false);
    setMsg(null);
    try {
      await api("DELETE", "/api/insights/answers");
      await onChanged();
    } catch (err) {
      setMsg(errorMsg(err));
    }
  };

  return (
    <>
      <Sheet
        label="Ask ByteSize"
        tall
        onClose={onClose}
        top={
          <div className="flex justify-end pb-2">
            <button type="button" onClick={() => setConfirming(true)} disabled={exchanges.length === 0 || !!ai.step} className="rounded-full px-3 py-1 text-sm font-semibold text-link hover:bg-pressed disabled:opacity-50">
              Clear chat
            </button>
          </div>
        }
        bodyLabel="Chat"
        bottom={
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
            className="flex flex-col gap-2"
          >
            <Notice msg={msg} />
            {!view.aiReady && <p className="text-sm text-subtle">No AI service is set up yet, so questions can&apos;t be answered. An admin can set one up in Settings › Integrations.</p>}
            {used && <p className="text-sm text-subtle">{`You've asked ${view.limits.questionsPerDay} questions today. You can ask more tomorrow.`}</p>}
            <div className="flex items-end gap-2">
              <textarea
                aria-label="Your question"
                placeholder="Ask about your eating, weight or habits"
                value={text}
                maxLength={300}
                rows={2}
                disabled={blocked || !!ai.step}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void send();
                  }
                }}
                className={`${field} mt-0 resize-none`}
              />
              <button type="submit" disabled={blocked || !!ai.step || !text.trim()} className={`${primaryButton} py-2.5`}>
                Send
              </button>
            </div>
            <AiWorking step={ai.step} onCancel={ai.cancel} texts={THINKING} />
            {view.aiReady && left > 0 && left <= 5 && !ai.step && <p className="text-sm text-muted">{`${fmt(left)} question${left === 1 ? "" : "s"} left today`}</p>}
          </form>
        }
      >
        <div role="log" aria-label="Conversation" className="flex min-h-full flex-col justify-end gap-2 py-1">
          {exchanges.length === 0 && !asking && <p className="py-6 text-center text-subtle">Ask a question about your own logs, weight or habits. Answers come only from your data.</p>}
          {exchanges.map((a) => (
            <div key={a.id} className="flex flex-col gap-2">
              <div data-testid="bubble" data-from="you" className={`${bubble} self-end bg-primary text-on-primary`}>
                {a.question}
              </div>
              <div data-testid="bubble" data-from="ai" className={`${bubble} self-start bg-page`}>
                {a.content.answer}
              </div>
            </div>
          ))}
          {asking && (
            <div data-testid="bubble" data-from="you" className={`${bubble} self-end bg-primary text-on-primary`}>
              {asking}
            </div>
          )}
          <div ref={end} />
        </div>
      </Sheet>
      {confirming && <Confirm title="Clear this chat?" text="This removes your questions and the answers from this chat, on every device. Today's question count isn't reset." confirmLabel="Clear chat" onConfirm={() => void clear()} onCancel={() => setConfirming(false)} />}
    </>
  );
}
