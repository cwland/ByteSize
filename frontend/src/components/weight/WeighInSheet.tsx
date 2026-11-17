import { useState } from "react";
import { api } from "../../api";
import { useSession } from "../../session";
import { todayIn } from "../../selectedDay";
import type { WeighIn } from "../../types";
import { weightToKg, weightUnit, weightValue } from "../../units";
import { notifyWeightChanged } from "../../weight";
import { Confirm } from "../ui/Confirm";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { Sheet } from "../ui/Sheet";
import { field, label as labelClass, primaryButton, secondaryButton } from "../ui/styles";

const MIN_KG = 20;
const MAX_KG = 500;

// Weigh in (a new weigh-in, today by default) or edit/delete a past one (`initial`; its day is fixed).
// One weigh-in per day: saving a day that already has one replaces it.
export default function WeighInSheet({ initial, onClose }: { initial?: WeighIn; onClose: () => void }) {
  const { user } = useSession();
  const today = todayIn(user.timezone);
  const unit = weightUnit(user.units);
  const startText = initial ? String(weightValue(initial.weightKg, user.units)) : "";
  const [day, setDay] = useState(initial?.day ?? today);
  const [text, setText] = useState(startText);
  const [note, setNote] = useState(initial?.note ?? "");
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const save = async () => {
    const value = Number(text);
    // An untouched weight keeps the exact stored kg (no drift from rounding to 0.1 lb)
    const weightKg = initial && text === startText ? initial.weightKg : weightToKg(value, user.units);
    if (!text.trim() || !Number.isFinite(value) || weightKg < MIN_KG || weightKg > MAX_KG) {
      const lo = Math.ceil(weightValue(MIN_KG, user.units));
      const hi = Math.floor(weightValue(MAX_KG, user.units));
      return setMsg({ ok: false, text: `Enter a weight between ${lo.toLocaleString("en-US")} and ${hi.toLocaleString("en-US")} ${unit}` });
    }
    if (!day || day > today) return setMsg({ ok: false, text: "Choose today or an earlier day" });
    setBusy(true);
    try {
      await api("PUT", `/api/weigh-ins/${day}`, { weightKg, note: note.trim() || null });
      notifyWeightChanged();
      onClose();
    } catch (e) {
      setMsg(errorMsg(e));
      setBusy(false);
    }
  };

  const remove = async () => {
    setConfirming(false);
    setBusy(true);
    try {
      await api("DELETE", `/api/weigh-ins/${initial!.day}`);
      notifyWeightChanged();
      onClose();
    } catch (e) {
      setMsg(errorMsg(e));
      setBusy(false);
    }
  };

  return (
    <Sheet label={initial ? "Edit weigh-in" : "Weigh in"} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        className="flex flex-col gap-3 pb-1"
      >
        <label className={labelClass}>
          Date
          <input type="date" aria-label="Date" value={day} max={today} disabled={!!initial} onChange={(e) => setDay(e.target.value)} className={`${field} disabled:opacity-70`} />
        </label>
        <label className={labelClass}>
          {`Weight (${unit})`}
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            aria-label={`Weight (${unit})`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus={!initial}
            className={`${field} tabular text-lg font-semibold`}
          />
        </label>
        <label className={labelClass}>
          Note (optional)
          <input type="text" aria-label="Note (optional)" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} className={field} />
        </label>
        <Notice msg={msg} />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button type="submit" disabled={busy} className={primaryButton}>
            Save
          </button>
          {initial && (
            <button type="button" disabled={busy} onClick={() => setConfirming(true)} className={secondaryButton}>
              Delete
            </button>
          )}
        </div>
      </form>
      {confirming && <Confirm title="Delete this weigh-in?" confirmLabel="Delete" onConfirm={() => void remove()} onCancel={() => setConfirming(false)} />}
    </Sheet>
  );
}
