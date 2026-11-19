import { useEffect, useState } from "react";
import { Lightbulb } from "lucide-react";
import { api } from "../../api";
import { dayRange } from "../../format";
import type { LatestInsight } from "../../types";

/** A recap's first lines for the widget: up to two sentences, cut at a word past 160 characters. */
export function firstLines(text: string): string {
  const sentences = text.match(/[^.!?]+[.!?]+/g);
  const two = sentences ? sentences.slice(0, 2).join("").trim() : text.trim();
  if (two.length <= 160) return two;
  const cut = two.slice(0, 159);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 80)).trimEnd()}…`;
}

// The Insights widget (§43): the newest recap's first lines and "See all insights" (#/insights). In the Dashboard's
// default layout (phones reach the Insights page from here); offered on Goals too.
export default function InsightsWidget() {
  const [latest, setLatest] = useState<LatestInsight | null>(null);
  useEffect(() => {
    api<LatestInsight>("GET", "/api/insights/latest")
      .then(setLatest)
      .catch(() => setLatest(null)); // the link still takes them to the page, which says what's wrong
  }, []);
  const recap = latest?.recap;
  return (
    <section aria-label="Insights" className="rounded-2xl bg-container p-4">
      <div className="flex items-center gap-2">
        <Lightbulb aria-hidden="true" className="size-5 text-action" />
        <h2 className="flex-1 font-bold">Insights</h2>
        {recap && <span className="text-sm text-muted">{recap.soFar ? "So far this week" : dayRange(recap.periodStart, recap.periodEnd)}</span>}
      </div>
      {latest && (
        <p className="mt-2 text-subtle">
          {recap ? firstLines(recap.summary) : latest.aiReady ? "Your weekly recap shows here after your week ends." : "Insights need an AI service. An admin can set one up in Settings › Integrations."}
        </p>
      )}
      <a href="#/insights" className="mt-2 inline-block text-sm font-semibold text-link hover:underline">
        See all insights
      </a>
    </section>
  );
}
