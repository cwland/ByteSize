import { useEffect, useState } from "react";
import { api } from "../../api";
import { notifyDayChanged } from "../../day";
import type { WorkoutCalorieSettings, WorkoutMode } from "../../types";
import { fmt } from "../../units";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { field, label, linkButton, noAutofill, primaryButton, secondaryButton } from "../ui/styles";

// Goals › Your plan › Workout calories (§40b): how calories earned by workouts count. A change applies from today
// on; past days keep what they had (like a plan change).
const MODES: { id: WorkoutMode; name: string; about: string }[] = [
  { id: "show", name: "Just show them", about: "See what you earned; your range stays the same." },
  { id: "add", name: "Add to that day", about: "The day's calorie range grows by part of what you earned." },
  { id: "bank", name: "Weekly bank", about: "Part of what you earn is saved for the week, to cover a day over your range or a treat. It starts fresh each week." },
];
const COUNTS = [25, 50, 75, 100] as const;
const MAX_CAP = 5000;

export function describeWorkoutCalories(s: WorkoutCalorieSettings): string {
  if (s.mode === "add") return `Add to that day: ${s.countPct}% of what you earn`;
  if (s.mode === "bank") return `Weekly bank: ${s.countPct}% of what you earn, up to ${fmt(s.weeklyCap)} a week`;
  return "Just show them";
}

export default function WorkoutCaloriesSetting() {
  const [settings, setSettings] = useState<WorkoutCalorieSettings | null>(null);
  const [draft, setDraft] = useState<WorkoutCalorieSettings | null>(null);
  const [cap, setCap] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ settings: WorkoutCalorieSettings }>("GET", "/api/workout-calories")
      .then((r) => setSettings(r.settings))
      .catch(() => setSettings(null)); // not shown when it can't be read
  }, []);
  if (!settings) return null;

  const open = () => {
    setDraft(settings);
    setCap(String(settings.weeklyCap));
    setMsg(null);
  };
  const capN = Number(cap);
  const capOk = cap.trim() !== "" && Number.isInteger(capN) && capN >= 0 && capN <= MAX_CAP;
  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setMsg(null);
    try {
      const body = { mode: draft.mode, countPct: draft.countPct, weeklyCap: draft.mode === "bank" ? capN : draft.weeklyCap };
      const r = await api<{ settings: WorkoutCalorieSettings }>("PUT", "/api/workout-calories", body);
      setSettings(r.settings);
      setDraft(null);
      notifyDayChanged(); // today's budget changes with it
    } catch (e) {
      setMsg(errorMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="group" aria-label="Workout calories" className="mt-5 border-t border-line pt-4">
      <p className="text-sm text-muted">Workout calories</p>
      {!draft ? (
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-semibold">{describeWorkoutCalories(settings)}</p>
          <button type="button" aria-label="Change workout calories" onClick={open} className={`${linkButton} text-sm`}>
            Change
          </button>
        </div>
      ) : (
        <div className="mt-2 flex flex-col gap-3">
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">How workout calories count</legend>
            {MODES.map((m) => (
              <label key={m.id} className="flex items-start gap-2 rounded-xl p-2 hover:bg-pressed">
                <input type="radio" name="workout-mode" checked={draft.mode === m.id} onChange={() => setDraft({ ...draft, mode: m.id })} className="mt-1" />
                <span>
                  <span className="font-semibold">{m.name}</span>
                  <span className="block text-sm text-subtle">{m.about}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {draft.mode !== "show" && (
            <label className={label}>
              Count
              <select value={draft.countPct} onChange={(e) => setDraft({ ...draft, countPct: Number(e.target.value) as WorkoutCalorieSettings["countPct"] })} className={field}>
                {COUNTS.map((n) => (
                  <option key={n} value={n}>{`${n}% of what you earn`}</option>
                ))}
              </select>
            </label>
          )}
          {draft.mode === "bank" && (
            <div>
              <label className={label}>
                Weekly cap
                <input type="number" inputMode="numeric" min={0} max={MAX_CAP} step={1} value={cap} onChange={(e) => setCap(e.target.value)} className={field} {...noAutofill} />
              </label>
              {!capOk && <p className="mt-1 text-xs text-error">Enter a cap from 0 to 5,000</p>}
            </div>
          )}
          <p className="text-sm text-subtle">Changes apply from today. Past days keep what they had.</p>
          <Notice msg={msg} />
          <div className="flex gap-2">
            <button type="button" disabled={busy || (draft.mode === "bank" && !capOk)} onClick={save} className={primaryButton}>
              Save
            </button>
            <button type="button" onClick={() => setDraft(null)} className={secondaryButton}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
