import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { useSession } from "../../session";
import { todayIn } from "../../selectedDay";
import type { Units, WeighIn, Weight } from "../../types";
import { kgToLb, weightToKg, weightUnit, weightValue } from "../../units";
import { notifyWeightChanged } from "../../weight";
import { Confirm } from "../ui/Confirm";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { Sheet } from "../ui/Sheet";
import { field, label as labelClass, primaryButton, secondaryButton } from "../ui/styles";

// The server's range (PUT /api/weigh-ins), as the person sees it: rounded inward to 0.1 so that every
// value the message allows is accepted (30 kg = 66.14 lb -> 66.2; 350 kg = 771.62 lb -> 771.6)
const MIN_KG = 30;
const MAX_KG = 350;
const inUnits = (kg: number, units: Units) => (units === "metric" ? kg : kgToLb(kg));
const n1 = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 1 });

// Weigh in (a new weigh-in, today by default) or edit/delete a past one (`initial`; its day is fixed).
// One weigh-in per day: choosing a day that already has one fills in its weight and note (unless you
// already typed them), and saving replaces it.
export default function WeighInSheet({ initial, onClose }: { initial?: WeighIn; onClose: () => void }) {
  const { user } = useSession();
  const today = todayIn(user.timezone);
  const unit = weightUnit(user.units);
  const shown = (w: WeighIn) => String(weightValue(w.weightKg, user.units));
  const [day, setDay] = useState(initial?.day ?? today);
  // The weigh-in being replaced: the one being edited, or the one already on the chosen day
  const [base, setBase] = useState<WeighIn | undefined>(initial);
  const [text, setText] = useState(initial ? shown(initial) : "");
  const [note, setNote] = useState(initial?.note ?? "");
  const touched = useRef({ weight: false, note: false });
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (initial || !day || day > today) return;
    let live = true;
    api<Weight>("GET", `/api/weight?from=${day}&to=${day}`)
      .then((r) => {
        if (!live) return;
        const found = r.weighIns.find((w) => w.day === day);
        setBase(found);
        if (!touched.current.weight) setText(found ? shown(found) : "");
        if (!touched.current.note) setNote(found?.note ?? "");
      })
      .catch(() => live && setBase(undefined));
    return () => void (live = false);
  }, [day]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    const value = Number(text);
    const lo = Math.ceil(inUnits(MIN_KG, user.units) * 10) / 10;
    const hi = Math.floor(inUnits(MAX_KG, user.units) * 10) / 10;
    if (!text.trim() || !Number.isFinite(value) || value < lo || value > hi) {
      return setMsg({ ok: false, text: `Enter a weight between ${n1(lo)} and ${n1(hi)} ${unit}` });
    }
    if (!day || day > today) return setMsg({ ok: false, text: "Choose today or an earlier day" });
    // An untouched weight keeps the exact stored kg (no drift from rounding to 0.1 lb)
    const weightKg = base && text === shown(base) ? base.weightKg : weightToKg(value, user.units);
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
        {!initial && base && <p className="-mt-1 text-sm text-subtle">You already weighed in that day — saving replaces it</p>}
        <label className={labelClass}>
          {`Weight (${unit})`}
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            aria-label={`Weight (${unit})`}
            value={text}
            onChange={(e) => {
              touched.current.weight = true;
              setText(e.target.value);
            }}
            autoFocus={!initial}
            className={`${field} tabular text-lg font-semibold`}
          />
        </label>
        <label className={labelClass}>
          Note (optional)
          <input type="text" aria-label="Note (optional)" maxLength={500} value={note} onChange={(e) => {
              touched.current.note = true;
              setNote(e.target.value);
            }} className={field} />
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
