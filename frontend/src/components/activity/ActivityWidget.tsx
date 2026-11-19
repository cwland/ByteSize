import { useCallback, useEffect, useState } from "react";
import { Activity as ActivityIcon, Bike, Dumbbell, Flower2, Footprints, Mountain, Timer, Trophy, Waves, Zap, type LucideIcon } from "lucide-react";
import { api } from "../../api";
import { notifyDayChanged, onDayChanged } from "../../day";
import { useSession } from "../../session";
import { todayIn } from "../../selectedDay";
import type { Day, DayActivity, Workout, WorkoutType } from "../../types";
import { fmt } from "../../units";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { Sheet } from "../ui/Sheet";
import { field, label, linkButton, noAutofill, primaryButton, secondaryButton } from "../ui/styles";

// Activity (§40b; a widget on the Dashboard and Goals): the viewed day's steps (Health's number when the phone sent
// one, else the typed one), with a small bar toward the person's step goal when they have one, and its workouts.
// + Steps sets the day's total; + Workout adds one (calories optional, with Estimate from type × minutes × weight).
// Tap steps or a workout to change it. Today and earlier days only.

export const WORKOUT_TYPES: { id: WorkoutType; name: string; Icon: LucideIcon }[] = [
  { id: "walk", name: "Walk", Icon: Footprints },
  { id: "run", name: "Run", Icon: Timer },
  { id: "cycling", name: "Cycling", Icon: Bike },
  { id: "strength", name: "Strength", Icon: Dumbbell },
  { id: "swim", name: "Swim", Icon: Waves },
  { id: "hike", name: "Hike", Icon: Mountain },
  { id: "yoga", name: "Yoga", Icon: Flower2 },
  { id: "hiit", name: "HIIT", Icon: Zap },
  { id: "sport", name: "Sport", Icon: Trophy },
  { id: "other", name: "Other", Icon: ActivityIcon },
];
const typeOf = (id: string) => WORKOUT_TYPES.find((t) => t.id === id) ?? WORKOUT_TYPES[WORKOUT_TYPES.length - 1];

// The day's activity: from the day the Dashboard loaded, else (Goals) loaded here and again when anything changes
function useActivity(day: string, data: Day | null) {
  const [own, setOwn] = useState<DayActivity | null>(null);
  const fromDay = data?.activity ?? null;
  const load = useCallback(() => {
    if (fromDay) return;
    api<DayActivity>("GET", `/api/activity/${day}`)
      .then(setOwn)
      .catch(() => setOwn(null));
  }, [day, fromDay]);
  useEffect(() => {
    load();
    return onDayChanged(load);
  }, [load]);
  return fromDay ?? own;
}

type Editing = { k: "steps" } | { k: "workout"; workout: Workout | null } | null;

export default function ActivityWidget({ day, data }: { day: string; data: Day | null }) {
  const { user } = useSession();
  const activity = useActivity(day, data);
  const [editing, setEditing] = useState<Editing>(null);
  const future = day > todayIn(user.timezone);
  if (!activity) return null;
  const { steps, stepGoal, workouts } = activity;

  return (
    <section aria-label="Activity" className="rounded-2xl bg-container p-5">
      <h2 className="text-lg font-bold">Activity</h2>
      <button
        type="button"
        disabled={future}
        aria-label={steps === null ? "Steps: none yet. Add" : `Steps: ${fmt(steps)}. Change`}
        onClick={() => setEditing({ k: "steps" })}
        className="mt-2 block w-full rounded-xl text-left hover:bg-pressed disabled:hover:bg-transparent"
      >
        {steps === null ? (
          <p className="text-subtle">No steps yet</p>
        ) : (
          <p className="flex items-baseline gap-2">
            <span data-testid="steps" className="text-2xl font-bold tabular">
              {fmt(steps)}
            </span>
            <span className="text-sm text-subtle">{activity.stepsSource === "health" ? "steps · from Health" : "steps"}</span>
            {stepGoal !== null && <span className="ml-auto text-sm text-subtle tabular">{`of ${fmt(stepGoal)}`}</span>}
          </p>
        )}
      </button>
      {stepGoal !== null && (
        <div role="progressbar" aria-label="Steps toward your goal" aria-valuemin={0} aria-valuemax={stepGoal} aria-valuenow={steps ?? 0} className="mt-2 h-2 overflow-hidden rounded-full bg-pressed">
          <div className="h-full rounded-full bg-action" style={{ width: `${Math.min(100, ((steps ?? 0) / Math.max(1, stepGoal)) * 100)}%` }} />
        </div>
      )}

      {workouts.length ? (
        <ul aria-label="Workouts" className="mt-3 divide-y divide-line">
          {workouts.map((w) => {
            const t = typeOf(w.type);
            return (
              <li key={w.id}>
                <button type="button" aria-label={`${t.name}, ${w.minutes} min. Edit`} onClick={() => setEditing({ k: "workout", workout: w })} className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-pressed">
                  <t.Icon aria-hidden="true" className="size-5 shrink-0 text-action" />
                  <span className="flex-1 font-semibold">{t.name}</span>
                  <span className="text-sm text-subtle tabular">{`${w.minutes} min · ${fmt(w.calories ?? 0)} cals` /* not given: 0 (§31) */}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-subtle">No workouts yet</p>
      )}

      {future ? (
        <p className="mt-3 text-sm text-subtle">Activity can be added for today or earlier days.</p>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => setEditing({ k: "steps" })} className={`${secondaryButton} px-4 py-1.5 text-sm`}>
            + Steps
          </button>
          <button type="button" onClick={() => setEditing({ k: "workout", workout: null })} className={`${secondaryButton} px-4 py-1.5 text-sm`}>
            + Workout
          </button>
        </div>
      )}

      {editing?.k === "steps" && <StepsSheet day={day} activity={activity} onClose={() => setEditing(null)} />}
      {editing?.k === "workout" && <WorkoutSheet day={day} workout={editing.workout} onClose={() => setEditing(null)} />}
    </section>
  );
}

const saved = (onClose: () => void) => {
  notifyDayChanged();
  onClose();
};

// + Steps: the day's total (typed). With Health's number there, that one is used; the typed one can still be set
function StepsSheet({ day, activity, onClose }: { day: string; activity: DayActivity; onClose: () => void }) {
  const [value, setValue] = useState(activity.typedSteps === null ? "" : String(activity.typedSteps));
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<unknown>) => {
    setBusy(true);
    setMsg(null);
    try {
      await f();
      saved(onClose);
    } catch (e) {
      setMsg(errorMsg(e));
      setBusy(false);
    }
  };
  const n = Number(value);
  const valid = value.trim() !== "" && Number.isInteger(n) && n >= 0;
  return (
    <Sheet label="Steps" onClose={onClose}>
      <div className="flex flex-col gap-3 pb-2">
        {activity.stepsSource === "health" && activity.steps !== null && (
          <p className="text-sm text-subtle">{`Your phone sent ${fmt(activity.steps)} steps for this day. That number is used while it's there.`}</p>
        )}
        <label className={label}>
          Steps for the day
          <input type="number" inputMode="numeric" min={0} step={1} value={value} onChange={(e) => setValue(e.target.value)} className={field} {...noAutofill} />
        </label>
        <Notice msg={msg} />
        <button type="button" disabled={busy || !valid} onClick={() => run(() => api("PUT", `/api/steps/${day}`, { steps: n }))} className={`${primaryButton} w-full`}>
          Save
        </button>
        {activity.typedSteps !== null && (
          <button type="button" disabled={busy} onClick={() => run(() => api("DELETE", `/api/steps/${day}`))} className={`${linkButton} text-error`}>
            Delete typed steps
          </button>
        )}
      </div>
    </Sheet>
  );
}

// + Workout / edit: type, minutes, calories (optional; Estimate asks the server: MET × weight × hours), note
function WorkoutSheet({ day, workout, onClose }: { day: string; workout: Workout | null; onClose: () => void }) {
  const [type, setType] = useState<WorkoutType>(workout?.type ?? "walk");
  const [minutes, setMinutes] = useState(String(workout?.minutes ?? 30));
  const [calories, setCalories] = useState(workout?.calories === null || workout?.calories === undefined ? "" : String(workout.calories));
  const [note, setNote] = useState(workout?.note ?? "");
  const [estimateNote, setEstimateNote] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const mins = Number(minutes);
  const minsOk = Number.isInteger(mins) && mins >= 1 && mins <= 1440;
  const cals = calories.trim() === "" ? null : Number(calories);
  const calsOk = cals === null || (Number.isInteger(cals) && cals >= 0 && cals <= 10000);

  const estimate = async () => {
    setMsg(null);
    try {
      const r = await api<{ calories: number }>("GET", `/api/workouts/estimate?type=${type}&minutes=${minsOk ? mins : 30}`);
      setCalories(String(r.calories));
      setEstimateNote(`About ${fmt(r.calories)} calories for ${minsOk ? mins : 30} minutes at your weight.`);
    } catch (e) {
      setMsg(errorMsg(e));
    }
  };
  const run = async (f: () => Promise<unknown>) => {
    setBusy(true);
    setMsg(null);
    try {
      await f();
      saved(onClose);
    } catch (e) {
      setMsg(errorMsg(e));
      setBusy(false);
    }
  };
  const body = { type, minutes: mins, calories: cals, note: note.trim() || null };
  const save = () => run(() => (workout ? api("PATCH", `/api/workouts/${workout.id}`, body) : api("POST", "/api/workouts", { day, ...body })));

  return (
    <Sheet label="Workout" heading={workout ? "Edit workout" : "Add a workout"} onClose={onClose}>
      <div className="flex flex-col gap-3 pb-2">
        {workout?.source === "health" && <p className="text-sm text-subtle">From your phone. If it sends this workout again, its numbers replace yours.</p>}
        <label className={label}>
          Type
          <select value={type} onChange={(e) => setType(e.target.value as WorkoutType)} className={field}>
            {WORKOUT_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Minutes
          <input type="number" inputMode="numeric" min={1} max={1440} step={1} value={minutes} onChange={(e) => setMinutes(e.target.value)} className={field} {...noAutofill} />
        </label>
        <div>
          <label className={label}>
            Calories (optional)
            <input type="number" inputMode="numeric" min={0} step={1} value={calories} onChange={(e) => (setCalories(e.target.value), setEstimateNote(null))} className={field} {...noAutofill} />
          </label>
          <div className="mt-1 flex items-center gap-3">
            <button type="button" onClick={estimate} className={`${linkButton} text-sm`}>
              Estimate
            </button>
            {estimateNote && <span className="text-xs text-subtle">{estimateNote}</span>}
          </div>
        </div>
        <label className={label}>
          Note (optional)
          <input type="text" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} className={field} {...noAutofill} />
        </label>
        <Notice msg={msg} />
        <button type="button" disabled={busy || !minsOk || !calsOk} onClick={save} className={`${primaryButton} w-full`}>
          Save
        </button>
        {workout && (
          <button type="button" disabled={busy} onClick={() => run(() => api("DELETE", `/api/workouts/${workout.id}`))} className={`${linkButton} text-error`}>
            Delete
          </button>
        )}
      </div>
    </Sheet>
  );
}
