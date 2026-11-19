import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ChevronDown, Lightbulb, MessagesSquare, RefreshCw } from "lucide-react";
import { api } from "../../api";
import { dayRange, shortDay } from "../../format";
import { useSession } from "../../session";
import type { InsightsView, ProteinInsight, RecapInsight, WeekNumbers } from "../../types";
import { fmt } from "../../units";
import { useWide } from "../../wide";
import PageHeader from "../PageHeader";
import { AiWorking } from "../log/useEstimate";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { Toggle } from "../ui/Toggle";
import { secondaryButton } from "../ui/styles";
import AskChat from "./AskChat";
import { THINKING, useInsightAi } from "./useInsightAi";

// Insights (§43, #/insights): what the AI coach noticed. The weekly recap (with the week's numbers, worked out by the
// app, beside it), protein help and food swaps; asking is a chat sheet opened from the title area (AskChat.tsx, §47). On wide screens from the rail; on phones from the
// Insights widget. The AI service is never named; while it works: "Thinking… asking AI".

const plural = (n: number, one: string) => `${fmt(n)} ${one}${n === 1 ? "" : "s"}`;
const oneDecimal = (n: number) => `${Math.round(n * 10) / 10}`;
const minutesLeft = (sec: number) => `You can refresh again in ${plural(Math.max(1, Math.ceil(sec / 60)), "minute")}.`;
const daysIn = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

export default function InsightsPage() {
  const wide = useWide();
  const [view, setView] = useState<InsightsView | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [chatting, setChatting] = useState(false);
  const load = useCallback(
    () =>
      api<InsightsView>("GET", "/api/insights")
        .then(setView)
        .catch((e) => setMsg(errorMsg(e))),
    [],
  );
  useEffect(() => void load(), [load]);

  const setWeekly = async (on: boolean) => {
    setView((v) => v && { ...v, weeklyOn: on });
    try {
      await api("PUT", "/api/insights/settings", { weeklyOn: on });
    } catch (e) {
      setView((v) => v && { ...v, weeklyOn: !on });
      setMsg(errorMsg(e));
    }
  };
  const setEmail = async (on: boolean) => {
    setView((v) => v && { ...v, email: { ...v.email, on } });
    try {
      await api("PUT", "/api/insights/settings", { emailOn: on });
    } catch (e) {
      setView((v) => v && { ...v, email: { ...v.email, on: !on } });
      setMsg(errorMsg(e));
    }
  };
  // The email switch (§45) is there only when the server can send email; it needs an address on the account
  const weekly = view && (
    <div className="flex flex-col gap-2 sm:items-end">
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold text-subtle">Weekly recap</span>
        <Toggle label="Weekly recap" checked={view.weeklyOn} onChange={setWeekly} />
      </div>
      {view.email.available && (
        <div className="flex flex-col gap-1 sm:items-end">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-subtle">Email me my weekly recap</span>
            <Toggle label="Email me my weekly recap" checked={view.email.on && view.email.hasAddress} disabled={!view.email.hasAddress} onChange={setEmail} />
          </div>
          {!view.email.hasAddress && <span className="text-xs text-subtle">Add an email address in Settings › Profile</span>}
        </div>
      )}
    </div>
  );

  return (
    <div className={`flex flex-col ${wide ? "gap-5" : "gap-3"}`}>
      {wide ? (
        <PageHeader title="Insights" sub="What your coach noticed in your eating, weight and habits">
          {weekly}
        </PageHeader>
      ) : (
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Back" onClick={() => (window.location.hash = "#/")} className="rounded-full px-2 py-1 text-sm font-semibold text-link hover:bg-pressed">
            ‹ Back
          </button>
          <h1 className="flex-1 text-xl font-bold">Insights</h1>
          {weekly}
        </div>
      )}
      {/* Ask (§47): a sentence with an icon under the title opens the chat */}
      <button type="button" onClick={() => setChatting(true)} className="flex items-center gap-2 self-start rounded-full px-1 py-1 text-left font-semibold text-link hover:underline">
        <MessagesSquare aria-hidden="true" className="size-5 shrink-0" />
        Ask about your eating, weight or habits
      </button>
      <Notice msg={msg} />
      {view && !view.aiReady && <NoAi />}
      {view && (
        <div className={wide ? "grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" : "flex flex-col gap-3"}>
          <RecapCard view={view} onChanged={load} />
          <div className={`flex flex-col ${wide ? "gap-5" : "gap-3"}`}>
            <ProteinCard view={view} onChanged={load} />
          </div>
        </div>
      )}
      {chatting && view && <AskChat view={view} onChanged={load} onClose={() => setChatting(false)} />}
    </div>
  );
}

function NoAi() {
  const { user } = useSession();
  return (
    <p className="flex items-start gap-2 rounded-2xl bg-container px-4 py-3 text-subtle">
      <Lightbulb aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-action" />
      <span>
        Insights are written by AI, and no AI service is set up yet. {user.isAdmin ? "Set one up in " : "Ask your admin to set one up in "}
        <a href="#/settings/integrations" className="font-semibold text-link hover:underline">
          Settings › Integrations
        </a>
        . Your week&apos;s numbers below are worked out by ByteSize either way.
      </span>
    </p>
  );
}

// A card's title row: the title, the period under it, and Refresh at the right (only with AI)
function CardHead({ title, period, refresh }: { title: string; period?: ReactNode; refresh?: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <h2 className="text-lg font-bold">{title}</h2>
        {period && <p className="text-sm text-muted">{period}</p>}
      </div>
      {refresh}
    </div>
  );
}

function RefreshButton({ label, busy, wait, onClick }: { label: string; busy: boolean; wait: number; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={busy || wait > 0} onClick={onClick} className={`${secondaryButton} flex shrink-0 items-center gap-1.5 px-3.5 py-1.5 text-sm`}>
      <RefreshCw aria-hidden="true" className="size-4" />
      Refresh
    </button>
  );
}

/** Seconds left of a wait the server gave (`since`: the view it came with), counting down once a second. */
function useCountdown(seconds: number, since: unknown) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    setLeft(seconds);
    if (seconds <= 0) return;
    const start = Date.now();
    const timer = setInterval(() => {
      const now = Math.max(0, seconds - Math.floor((Date.now() - start) / 1000));
      setLeft(now);
      if (now === 0) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [seconds, since]);
  return left;
}

/** Refresh one card: the AI request with its working line, a plain error, then the page loaded again (a failed try counts too). */
function useRefresh(kind: "recap" | "protein", onChanged: () => Promise<unknown>) {
  const ai = useInsightAi();
  const [msg, setMsg] = useState<Msg>(null);
  const refresh = async () => {
    setMsg(null);
    try {
      if (await ai.run("/api/insights/refresh", { kind })) await onChanged();
    } catch (e) {
      setMsg(errorMsg(e));
      await onChanged(); // the wait it started
    }
  };
  return { ai, msg, refresh };
}

function RecapCard({ view, onChanged }: { view: InsightsView; onChanged: () => Promise<unknown> }) {
  const { ai, msg, refresh } = useRefresh("recap", onChanged);
  const [pastOpen, setPastOpen] = useState(false);
  const recap: RecapInsight | undefined = view.recaps[0];
  const numbers = recap?.content.numbers ?? view.week.numbers;
  const wait = useCountdown(view.limits.recapRefreshIn, view);
  const period = recap ? (recap.soFar ? "So far this week" : dayRange(recap.periodStart, recap.periodEnd)) : dayRange(view.week.from, view.week.to);
  const past = view.recaps.slice(1);
  return (
    <section aria-label="Weekly recap" className="flex flex-col gap-4 rounded-2xl bg-container p-5">
      <CardHead title="Weekly recap" period={period} refresh={view.aiReady && <RefreshButton label="Refresh weekly recap" busy={!!ai.step} wait={wait} onClick={refresh} />} />
      {view.aiReady && wait > 0 && !ai.step && <p className="-mt-2 text-sm text-muted">{minutesLeft(wait)}</p>}
      <AiWorking step={ai.step} onCancel={ai.cancel} texts={THINKING} />
      <Notice msg={msg} />
      {recap ? (
        <>
          <p className="text-lg">{recap.content.summary}</p>
          <Bullets title="What went well" items={recap.content.wentWell} />
          {recap.content.slipped.length > 0 && <Bullets title="What slipped" items={recap.content.slipped} />}
          <div>
            <h3 className="text-sm font-bold text-subtle">One thing to try</h3>
            <p className="mt-1 rounded-xl bg-active px-3 py-2 font-semibold">{recap.content.tryNext}</p>
          </div>
        </>
      ) : (
        <p className="text-subtle">
          {view.weeklyOn
            ? "Your first recap is written after your week ends (about 6 am, once you've logged at least 3 days that week)."
            : "Weekly recaps are off. Turn on Weekly recap above to get one each week."}
          {view.aiReady && " Refresh for this week so far."}
        </p>
      )}
      <Numbers n={numbers} />
      {past.length > 0 && (
        <div>
          <button type="button" aria-expanded={pastOpen} onClick={() => setPastOpen(!pastOpen)} className="flex items-center gap-1 text-sm font-semibold text-link hover:underline">
            Past recaps
            <ChevronDown aria-hidden="true" className={`size-4 transition ${pastOpen ? "rotate-180" : ""}`} />
          </button>
          {pastOpen && (
            <ul aria-label="Past recaps" className="mt-3 flex flex-col gap-3">
              {past.map((r) => (
                <li key={r.id} className="rounded-xl bg-page px-3 py-2">
                  <p className="text-sm font-semibold text-muted">{r.soFar ? `${dayRange(r.periodStart, r.periodEnd)} (so far)` : dayRange(r.periodStart, r.periodEnd)}</p>
                  <p className="mt-1">{r.content.summary}</p>
                  <p className="mt-1 text-sm text-subtle">{`Tried next: ${r.content.tryNext}`}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function Bullets({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3 className="text-sm font-bold text-subtle">{title}</h3>
      <ul aria-label={title} className="mt-1 list-disc pl-5">
        {items.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
    </div>
  );
}

// The week's numbers, from the app (never from the AI)
function Numbers({ n }: { n: WeekNumbers }) {
  const trend =
    n.trendChange === null ? "—" : n.trendChange === 0 ? `No change` : `${n.trendChange < 0 ? "−" : "+"}${oneDecimal(Math.abs(n.trendChange))} ${n.weightUnit}`;
  const stats: [string, string, string?][] = [
    ["Days logged", `${n.daysLogged} of ${daysIn(n.from, n.to)}`],
    ["Days in range", `${n.daysInRange}`],
    ["Average calories", n.avgCalories === null ? "—" : fmt(n.avgCalories), n.plan ? `Plan ${fmt(n.plan.calories.min)}–${fmt(n.plan.calories.max)}` : undefined],
    ["Average protein", n.avgProtein === null ? "—" : `${oneDecimal(n.avgProtein)} g`, n.plan ? `Minimum ${oneDecimal(n.plan.proteinMin)} g` : undefined],
    ["Water goal reached", plural(n.waterDays, "day")],
    ["Steps", n.steps.average === null ? "—" : `${fmt(n.steps.average)} a day`],
    ["Workouts", n.workouts.count ? `${n.workouts.count} (${fmt(n.workouts.minutes)} min)` : "None"],
    ["Trend weight", trend],
  ];
  return (
    <div role="group" aria-label="The week's numbers">
      <h3 className="text-sm font-bold text-subtle">The numbers</h3>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stats.map(([label, value, note]) => (
          <div key={label} role="group" aria-label={label} className="rounded-xl bg-page px-3 py-2">
            <p className="text-xs text-muted">{label}</p>
            <p className="font-bold tabular">{value}</p>
            {note && <p className="text-xs text-subtle">{note}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

function ProteinCard({ view, onChanged }: { view: InsightsView; onChanged: () => Promise<unknown> }) {
  const { ai, msg, refresh } = useRefresh("protein", onChanged);
  const p: ProteinInsight | null = view.protein;
  const wait = useCountdown(view.limits.proteinRefreshIn, view);
  const c = p?.content;
  return (
    <section aria-label="Protein help and food swaps" className="flex flex-col gap-4 rounded-2xl bg-container p-5">
      <CardHead
        title="Protein help and food swaps"
        period={p ? dayRange(p.periodStart, p.periodEnd) : undefined}
        refresh={view.aiReady && <RefreshButton label="Refresh protein help" busy={!!ai.step} wait={wait} onClick={refresh} />}
      />
      {view.aiReady && wait > 0 && !ai.step && <p className="-mt-2 text-sm text-muted">{minutesLeft(wait)}</p>}
      <AiWorking step={ai.step} onCancel={ai.cancel} texts={THINKING} />
      <Notice msg={msg} />
      {!c ? (
        view.aiReady && <p className="text-subtle">Refresh to get protein help from your last 4 weeks: where your protein comes from, and easy ways to get more.</p>
      ) : (
        <>
          {c.intro && <p>{c.intro}</p>}
          <div className="flex flex-col gap-4">
            <div>
              <h3 className="text-sm font-bold text-subtle">Top protein sources</h3>
              <ul aria-label="Top protein sources" className="mt-1 flex flex-col gap-1">
                {c.facts.topSources.map((s) => (
                  <li key={s.food} className="flex justify-between gap-2">
                    <span className="min-w-0">{s.food}</span>
                    <span className="shrink-0 text-sm text-subtle tabular">{`${fmt(Math.round(s.protein_g))} g · ${plural(s.times, "time")}`}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="text-sm font-bold text-subtle">Days protein fell short</h3>
              {c.facts.shortDays.length ? (
                <ul aria-label="Days protein fell short" className="mt-1 flex flex-col gap-1">
                  {c.facts.shortDays.map((d) => (
                    <li key={d.date} className="flex justify-between gap-2">
                      <span>{shortDay(d.date)}</span>
                      <span className="text-sm text-subtle tabular">{`${oneDecimal(d.protein_g)} g · ${oneDecimal(d.shortBy)} g short`}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-subtle">None: you reached your protein minimum on every logged day.</p>
              )}
            </div>
          </div>
          <Suggestions title="Try adding" items={c.additions.map((a) => [a.suggestion, a.why])} />
          {c.swaps.length > 0 && <Suggestions title="Swaps" items={c.swaps.map((s) => [`${s.food} → ${s.swap}`, s.saving])} />}
        </>
      )}
    </section>
  );
}

function Suggestions({ title, items }: { title: string; items: [string, string][] }) {
  return (
    <div>
      <h3 className="text-sm font-bold text-subtle">{title}</h3>
      <ul aria-label={title} className="mt-1 flex flex-col gap-2">
        {items.map(([head, why], i) => (
          <li key={i} className="rounded-xl bg-page px-3 py-2">
            <p className="font-semibold">{head}</p>
            {why && <p className="text-sm text-subtle">{why}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
