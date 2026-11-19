import { useState } from "react";
import { api } from "../../api";
import { useSettingsMe } from "../../day";
import { formatDay } from "../../dateFormat";
import { notifyGoalsChanged, useGoalsData } from "../../goals";
import { addDays, todayIn } from "../../selectedDay";
import { useSession } from "../../session";
import type { Goal, GoalPeriod, GoalType } from "../../types";
import { weightToKg, weightValue } from "../../units";
import { Choice } from "../ui/Choice";
import { Confirm } from "../ui/Confirm";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { Sheet } from "../ui/Sheet";
import { field, label, linkButton, noAutofill, primaryButton } from "../ui/styles";
import { GOAL_KINDS, KIND_HINT, STRETCH_ONLY, TARGET_LABEL, kindName, targetText } from "./goalCopy";

// + New goal and Edit goal (§40c). New: the kind, steps as a total or an average a day, each week / each month / the
// whole stretch, the target, start and end (each-week and each-month goals may be ongoing), a name. A new goal of a
// kind already running replaces it (it ends today and moves to Past goals): the sheet says so first. Edit: the name,
// target and end date, End now, Delete.

const SUGGESTED: Record<GoalType, number> = {
  logging_days: 6,
  protein_days: 5,
  calorie_days: 5,
  water_days: 5,
  fiber_days: 5,
  weigh_ins: 3,
  streak: 7,
  steps: 70000,
  workouts: 3,
  active_minutes: 150,
  weight_by_date: 0,
};
const PERIODS: { value: GoalPeriod; label: string }[] = [
  { value: "week", label: "Each week" },
  { value: "month", label: "Each month" },
  { value: "stretch", label: "Whole stretch" },
];

export default function GoalSheet({ goal, onClose }: { goal?: Goal; onClose: () => void }) {
  const { user } = useSession();
  const { dateFormat } = useSettingsMe();
  const { active } = useGoalsData();
  const today = todayIn(user.timezone);
  const day = (d: string) => formatDay(d, dateFormat, today);
  const editing = !!goal;

  const [type, setType] = useState<GoalType>(goal?.type ?? "logging_days");
  const [measure, setMeasure] = useState<"total" | "average">(goal?.measure ?? "total");
  const [period, setPeriod] = useState<GoalPeriod>(goal?.period ?? "week");
  const shown = (t: GoalType, n: number) => (t === "weight_by_date" ? (n ? String(weightValue(n, user.units)) : "") : String(n));
  const [target, setTarget] = useState(goal ? shown(goal.type, goal.target) : String(SUGGESTED.logging_days));
  const [start, setStart] = useState(goal?.start ?? today);
  const [ongoing, setOngoing] = useState(goal ? goal.end === null : true);
  const [end, setEnd] = useState(goal?.end ?? addDays(today, 27));
  const [name, setName] = useState(goal?.name ?? "");
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"end" | "delete" | null>(null);

  const stretchOnly = STRETCH_ONLY.includes(type);
  const p: GoalPeriod = stretchOnly ? "stretch" : period;
  const hasEnd = p === "stretch" || !ongoing;
  const m = type === "steps" ? measure : null;
  const value = target.trim() === "" ? NaN : Number(target);
  const replaces = editing ? undefined : active.find((g) => g.type === type);

  const chooseType = (t: GoalType) => {
    setType(t);
    setTarget(shown(t, t === "steps" && measure === "average" ? 8000 : SUGGESTED[t]));
  };
  const chooseMeasure = (v: "total" | "average") => {
    setMeasure(v);
    if (!editing) setTarget(String(v === "average" ? 8000 : SUGGESTED.steps));
  };

  const run = async (f: () => Promise<unknown>) => {
    setBusy(true);
    setMsg(null);
    try {
      await f();
      notifyGoalsChanged();
      onClose();
    } catch (e) {
      setMsg(errorMsg(e));
      setBusy(false);
    }
  };
  const save = () => {
    if (!Number.isFinite(value)) return setMsg({ ok: false, text: "Enter a target" });
    const t = type === "weight_by_date" ? weightToKg(value, user.units) : value;
    const endDay = hasEnd ? end : null;
    if (goal) return run(() => api("PATCH", `/api/goals/${goal.id}`, { target: t, end: endDay, name: name.trim() }));
    return run(() => api("POST", "/api/goals", { type, target: t, period: p, ...(m ? { measure: m } : {}), start, end: endDay, ...(name.trim() ? { name: name.trim() } : {}) }));
  };

  return (
    <Sheet label={editing ? "Edit goal" : "New goal"} onClose={onClose}>
      <div className="flex flex-col gap-3 pb-2">
        {editing ? (
          <p className="text-sm text-subtle">{`${kindName(goal.type)} · ${targetText({ ...goal }, user.units, day)}`}</p>
        ) : (
          <>
            <label className={label}>
              Kind of goal
              <select value={type} onChange={(e) => chooseType(e.target.value as GoalType)} className={field}>
                {(["Habits", "Activity", "Weight"] as const).map((group) => (
                  <optgroup key={group} label={group}>
                    {GOAL_KINDS.filter((k) => k.group === group).map((k) => (
                      <option key={k.type} value={k.type}>
                        {k.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <p className="-mt-1 text-xs text-subtle">{KIND_HINT[type]}</p>
            {type === "steps" && (
              <div>
                <p className={label}>Count steps as</p>
                <div className="mt-1">
                  <Choice label="Count steps as" value={measure} onChange={chooseMeasure} options={[{ value: "total", label: "A total" }, { value: "average", label: "An average a day" }]} />
                </div>
              </div>
            )}
            {stretchOnly ? (
              <p className="text-sm text-subtle">Over the whole stretch, from the start to the end date.</p>
            ) : (
              <div>
                <p className={label}>How often</p>
                <div className="mt-1">
                  <Choice label="How often" value={period} onChange={setPeriod} options={PERIODS} />
                </div>
              </div>
            )}
          </>
        )}
        <label className={label}>
          {TARGET_LABEL(type, p, m, user.units)}
          <input type="number" inputMode="decimal" min={0} step="any" value={target} onChange={(e) => setTarget(e.target.value)} className={field} {...noAutofill} />
        </label>
        {!editing && (
          <label className={label}>
            Start
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={field} />
          </label>
        )}
        {p !== "stretch" && (
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={ongoing} onChange={(e) => setOngoing(e.target.checked)} className="size-4 accent-[var(--color-action)]" />
            No end date (ongoing)
          </label>
        )}
        {hasEnd && (
          <label className={label}>
            End
            <input type="date" value={end} min={today} onChange={(e) => setEnd(e.target.value)} className={field} />
          </label>
        )}
        <label className={label}>
          Name (optional)
          <input type="text" maxLength={60} value={name} placeholder={kindName(type)} onChange={(e) => setName(e.target.value)} className={field} {...noAutofill} />
        </label>
        {replaces && <p className="rounded-xl bg-pressed px-3 py-2 text-sm">{`This replaces your “${replaces.name}” goal: it ends today and moves to Past goals.`}</p>}
        <Notice msg={msg} />
        <button type="button" disabled={busy} onClick={save} className={`${primaryButton} w-full`}>
          {editing ? "Save" : "Add goal"}
        </button>
        {goal && (
          <div className="flex justify-center gap-6">
            {goal.progress.state !== "upcoming" && (
              <button type="button" disabled={busy} onClick={() => setConfirm("end")} className={linkButton}>
                End now
              </button>
            )}
            <button type="button" disabled={busy} onClick={() => setConfirm("delete")} className={`${linkButton} text-error`}>
              Delete goal
            </button>
          </div>
        )}
      </div>
      {goal && confirm === "end" && (
        <Confirm
          title="End this goal today?"
          text="It moves to Past goals. Today still counts; tomorrow its result is kept."
          confirmLabel="End now"
          onCancel={() => setConfirm(null)}
          onConfirm={() => (setConfirm(null), run(() => api("POST", `/api/goals/${goal.id}/end`)))}
        />
      )}
      {goal && confirm === "delete" && (
        <Confirm
          title="Delete this goal?"
          text="It's gone for good, with its progress."
          confirmLabel="Delete"
          onCancel={() => setConfirm(null)}
          onConfirm={() => (setConfirm(null), run(() => api("DELETE", `/api/goals/${goal.id}`)))}
        />
      )}
    </Sheet>
  );
}
