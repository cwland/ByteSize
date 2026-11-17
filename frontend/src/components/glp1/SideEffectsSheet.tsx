import { useState } from "react";
import { api } from "../../api";
import { SIDE_EFFECTS, type SideEffect, type SideEffectDay } from "../../types";
import { dayLabel } from "../../selectedDay";
import { Choice } from "../ui/Choice";
import { Sheet } from "../ui/Sheet";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { field, label, primaryButton } from "../ui/styles";
import { EFFECT_LABELS, LEVEL_LABELS } from "./glp1";

type Level = "0" | "1" | "2" | "3";
const LEVEL_OPTIONS = LEVEL_LABELS.map((l, i) => ({ value: String(i) as Level, label: l }));

// "How are you feeling?": each side effect off / mild / medium / strong, and a note, for one day.
// Only the effects felt are sent; nothing felt and no note clears the day.
export default function SideEffectsSheet({ day, initial, onClose, onSaved }: { day: string; initial: SideEffectDay | null; onClose: () => void; onSaved: (d: SideEffectDay | null) => void }) {
  const [levels, setLevels] = useState<Record<SideEffect, Level>>(
    () => Object.fromEntries(SIDE_EFFECTS.map((e) => [e, String(initial?.effects[e] ?? 0) as Level])) as Record<SideEffect, Level>,
  );
  const [note, setNote] = useState(initial?.note ?? "");
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const effects = Object.fromEntries(SIDE_EFFECTS.filter((e) => levels[e] !== "0").map((e) => [e, Number(levels[e])]));
    setBusy(true);
    try {
      const r = await api<{ sideEffect: SideEffectDay | null }>("PUT", `/api/side-effects/${day}`, { effects, note: note.trim() });
      onSaved(r.sideEffect);
    } catch (e) {
      setMsg(errorMsg(e));
      setBusy(false);
    }
  };

  return (
    <Sheet label="How are you feeling?" onClose={onClose}>
      <p className="mb-3 text-sm text-muted">{dayLabel(day)}</p>
      <div className="flex flex-col gap-3 pb-2">
        {SIDE_EFFECTS.map((e) => (
          <div key={e}>
            <p className="mb-1 text-sm font-semibold">{EFFECT_LABELS[e]}</p>
            <Choice label={EFFECT_LABELS[e]} value={levels[e]} options={LEVEL_OPTIONS} onChange={(v) => setLevels((l) => ({ ...l, [e]: v }))} />
          </div>
        ))}
        <label className={label}>
          Note
          <input aria-label="Note" value={note} maxLength={500} onChange={(ev) => setNote(ev.target.value)} placeholder="Optional" className={field} />
        </label>
        <Notice msg={msg} />
        <button type="button" onClick={save} disabled={busy} className={primaryButton}>
          Save
        </button>
      </div>
    </Sheet>
  );
}
