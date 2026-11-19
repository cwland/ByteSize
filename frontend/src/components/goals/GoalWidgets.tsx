import { useState } from "react";
import { Check, Minus, Pencil, Plus, Target, Trash2, X } from "lucide-react";
import { api } from "../../api";
import { useSettingsMe } from "../../day";
import { formatDay, formatDayRange } from "../../dateFormat";
import { notifyGoalsChanged, useGoalsData } from "../../goals";
import { todayIn } from "../../selectedDay";
import { useSession } from "../../session";
import type { Goal, GoalPeriodProgress } from "../../types";
import { Confirm } from "../ui/Confirm";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { linkButton, secondaryButton } from "../ui/styles";
import GoalSheet from "./GoalSheet";
import { datesText, goalSummary, neededText, overallText, periodNote, progressText, resultText, ringFraction, targetText } from "./goalCopy";

// Goals (§40c) as widgets: each active goal (a ring for the current period, a small chart of its periods, the result
// so far), the Goals list (active goals and + New goal) and Past goals (finished ones, newest first, ✓ or ✗).

function useDayFormat() {
  const { user } = useSession();
  const { dateFormat } = useSettingsMe();
  const today = todayIn(user.timezone);
  return { day: (d: string) => formatDay(d, dateFormat, today), range: (a: string, b: string) => formatDayRange(a, b, dateFormat, today), units: user.units };
}

function GoalRing({ fraction, hit, label }: { fraction: number; hit: boolean; label: string }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 64 64" className="size-16 shrink-0 -rotate-90" role="img" aria-label={label} data-hit={hit || undefined}>
      <circle cx="32" cy="32" r={r} fill="none" stroke="var(--color-line)" strokeWidth="7" />
      {fraction > 0 && <circle cx="32" cy="32" r={r} fill="none" stroke={hit ? "var(--color-success)" : "var(--color-action)"} strokeWidth="7" strokeLinecap="round" strokeDasharray={`${fraction * c} ${c}`} />}
    </svg>
  );
}

const PERIOD_NAME = { week: "Week", month: "Month", stretch: "So far" } as const;
const MAX_BARS = 12;

// A bar per period (the last 12): its share of the target; hit filled, missed hollow, the current one lighter, a short
// one (not counted) faint
function PeriodBars({ goal, range }: { goal: Goal; range: (a: string, b: string) => string }) {
  const periods = goal.progress.periods.slice(-MAX_BARS);
  if (goal.period === "stretch" || periods.length < 2) return null;
  const hit = periods.filter((p) => p.status === "hit").length;
  const missed = periods.filter((p) => p.status === "missed").length;
  const short = periods.filter((p) => p.status === "unjudged").length;
  const summary = `${PERIOD_NAME[goal.period]}s: ${hit} hit, ${missed} missed${periods.some((p) => p.status === "open") ? ", this one under way" : ""}${short ? `, ${short} too short to count` : ""}`;
  return (
    <div role="img" aria-label={summary} className="mt-3 flex h-10 items-end gap-1">
      {periods.map((p) => {
        const share = ringFraction(goal, p);
        const said = `${range(p.start, p.end)}: ${progressText(goal, p, undefined, "")}`;
        return (
          <span key={p.start} title={said} data-status={p.status} className={`relative flex h-10 flex-1 items-end rounded-sm ${p.status === "missed" ? "border border-strong" : "bg-pressed"}`}>
            <span className={`w-full rounded-sm ${p.status === "hit" ? "bg-success" : p.status === "open" ? "bg-action/60" : p.status === "unjudged" ? "bg-strong/40" : "bg-strong"}`} style={{ height: `${Math.max(p.status === "hit" ? 1 : share, 0.04) * 100}%` }} />
          </span>
        );
      })}
    </div>
  );
}

const shownPeriod = (g: Goal): GoalPeriodProgress | null => g.progress.current ?? g.progress.periods[g.progress.periods.length - 1] ?? null;

/** One active goal's widget (on Goals by default; can be added to the Dashboard) */
export function GoalWidget({ goal }: { goal: Goal }) {
  const { day, range, units } = useDayFormat();
  const [editing, setEditing] = useState(false);
  const p = shownPeriod(goal);
  const upcoming = goal.progress.state === "upcoming";
  const overall = overallText(goal);
  const needed = neededText(goal);
  const note = p ? periodNote(goal, p) : null;
  return (
    <section aria-label={goal.name} className="rounded-2xl bg-container p-5">
      <div className="flex items-start gap-2">
        <h2 className="flex min-w-0 flex-1 items-center gap-2 text-lg font-bold">
          <Target aria-hidden="true" className="size-5 shrink-0 text-action" /> <span className="truncate">{goal.name}</span>
        </h2>
        <button type="button" aria-label={`Edit ${goal.name}`} title="Edit goal" onClick={() => setEditing(true)} className="-mr-2 -mt-1 flex size-9 items-center justify-center rounded-full text-subtle hover:bg-pressed hover:text-ink">
          <Pencil aria-hidden="true" className="size-4" />
        </button>
      </div>
      <p className="text-sm text-subtle">{targetText(goal, units, day)}</p>
      {upcoming || !p ? (
        <p className="mt-3">{datesText(goal, day, range)}</p>
      ) : (
        <>
          <div className="mt-3 flex items-center gap-4">
            <GoalRing fraction={ringFraction(goal, p)} hit={p.status === "hit"} label={`${progressText(goal, p, units)}${p.status === "hit" ? ", reached" : ""}`} />
            <div className="min-w-0">
              <p className="font-semibold tabular">{progressText(goal, p, units)}</p>
              {p.status === "hit" && <p className="text-sm text-success">{goal.period === "stretch" ? "Reached" : `${PERIOD_NAME[goal.period]} hit`}</p>}
              {note && <p className="text-xs text-muted">{note}</p>}
              {overall && <p className="text-sm text-subtle">{overall}</p>}
              {needed && <p className="text-sm text-subtle">{needed}</p>}
            </div>
          </div>
          <PeriodBars goal={goal} range={range} />
          <p className="mt-2 text-xs text-muted">{datesText(goal, day, range)}</p>
        </>
      )}
      {editing && <GoalSheet goal={goal} onClose={() => setEditing(false)} />}
    </section>
  );
}

/** Goals: the active goals with a line of progress each, and + New goal */
export function GoalsListWidget() {
  const { active, loaded } = useGoalsData();
  const { day, units } = useDayFormat();
  const [open, setOpen] = useState<Goal | "new" | null>(null);
  return (
    <section aria-label="Goals" className="rounded-2xl bg-container p-5">
      <div className="flex items-center gap-2">
        <h2 className="flex-1 text-lg font-bold">Goals</h2>
        <button type="button" onClick={() => setOpen("new")} className={`${secondaryButton} inline-flex items-center gap-1.5 px-4 py-1.5 text-sm`}>
          <Plus aria-hidden="true" className="size-4" /> New goal
        </button>
      </div>
      {loaded && !active.length && <p className="mt-2 text-subtle">No goals yet. Set one for logging, protein, steps, workouts and more.</p>}
      {active.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1">
          {active.map((g) => (
            <li key={g.id}>
              <button type="button" onClick={() => setOpen(g)} className="flex w-full flex-col rounded-xl px-2 py-1.5 text-left hover:bg-pressed">
                <span className="font-semibold">{g.name}</span>
                <span className="text-sm text-subtle tabular">{goalSummary(g, units, day)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && <GoalSheet goal={open === "new" ? undefined : open} onClose={() => setOpen(null)} />}
    </section>
  );
}

/** Past goals: finished ones, newest first, completed (✓) or missed (✗) with the dates and final numbers; delete */
export function PastGoalsWidget() {
  const { past, loaded } = useGoalsData();
  const { day, range, units } = useDayFormat();
  const [deleting, setDeleting] = useState<Goal | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const remove = async (g: Goal) => {
    setDeleting(null);
    setMsg(null);
    try {
      await api("DELETE", `/api/goals/${g.id}`);
      notifyGoalsChanged();
    } catch (e) {
      setMsg(errorMsg(e));
    }
  };
  return (
    <section aria-label="Past goals" className="rounded-2xl bg-container p-5">
      <h2 className="text-lg font-bold">Past goals</h2>
      {loaded && !past.length && <p className="mt-2 text-subtle">Goals you finish or end show here.</p>}
      <Notice msg={msg} />
      {past.length > 0 && (
        <ul className="mt-3 flex flex-col gap-3">
          {past.map((g) => {
            const r = resultText(g, units);
            return (
              <li key={g.id} aria-label={g.name} className="flex items-start gap-3">
                <span
                  role="img"
                  aria-label={r.met === null ? (g.progress.state === "ended" ? "Ended early" : "Ended today") : r.met ? "Completed" : "Missed"}
                  className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ${r.met ? "bg-success text-white" : r.met === false ? "bg-pressed text-subtle" : "bg-pressed text-ink"}`}
                >
                  {r.met === false ? <X aria-hidden="true" className="size-4" /> : r.met ? <Check aria-hidden="true" className="size-4" /> : <Minus aria-hidden="true" className="size-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{g.name}</p>
                  <p className="text-sm text-subtle">{datesText(g, day, range, { past: true })}</p>
                  <p className="text-sm tabular">{r.text}</p>
                </div>
                <button type="button" aria-label={`Delete ${g.name}`} title="Delete" onClick={() => setDeleting(g)} className="flex size-9 shrink-0 items-center justify-center rounded-full text-subtle hover:bg-pressed hover:text-error">
                  <Trash2 aria-hidden="true" className="size-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {deleting && <Confirm title="Delete this goal?" text={`“${deleting.name}” and its result are gone for good.`} confirmLabel="Delete" onCancel={() => setDeleting(null)} onConfirm={() => remove(deleting)} />}
    </section>
  );
}

// The Goals page's own + New goal (beside Edit page)
export function NewGoalButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`${linkButton} inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm hover:bg-pressed hover:no-underline`}>
        <Plus aria-hidden="true" className="size-4" /> New goal
      </button>
      {open && <GoalSheet onClose={() => setOpen(false)} />}
    </>
  );
}
