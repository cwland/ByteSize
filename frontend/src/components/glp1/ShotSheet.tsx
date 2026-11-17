import { useState } from "react";
import { api } from "../../api";
import { useSession } from "../../session";
import { todayIn } from "../../selectedDay";
import type { Glp1View, Site } from "../../types";
import { Sheet } from "../ui/Sheet";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { field, label, primaryButton } from "../ui/styles";
import SitePicker from "./SitePicker";

// Log shot: the day (today unless changed), the dose (the current one), where it went (the suggested site
// chosen, the last used marked) and a note. Saving upserts that day's shot and hands back the new view.
export default function ShotSheet({ view, onClose, onSaved }: { view: Glp1View; onClose: () => void; onSaved: (v: Glp1View) => void }) {
  const { user } = useSession();
  const today = todayIn(user.timezone);
  const [day, setDay] = useState(today);
  const [dose, setDose] = useState(String(view.settings?.doseMg ?? view.lastShot?.doseMg ?? ""));
  const [site, setSite] = useState<Site>(view.suggestedSite);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const doseMg = Number(dose);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return setMsg({ ok: false, text: "Pick the day of the shot" });
    if (day > today) return setMsg({ ok: false, text: "That day hasn't happened yet" });
    if (!(doseMg > 0)) return setMsg({ ok: false, text: "Enter the dose in mg" });
    setBusy(true);
    try {
      onSaved(await api<Glp1View>("PUT", `/api/glp1/shots/${day}`, { site, doseMg, note: note.trim() }));
    } catch (e) {
      setMsg(errorMsg(e));
      setBusy(false);
    }
  };

  return (
    <Sheet label="Log shot" onClose={onClose}>
      <div className="flex flex-col gap-4 pb-2">
        <div className="grid grid-cols-2 gap-3">
          <label className={label}>
            Date
            <input aria-label="Date" type="date" value={day} max={today} onChange={(e) => setDay(e.target.value)} className={field} />
          </label>
          <label className={label}>
            Dose (mg)
            <input aria-label="Dose (mg)" type="number" inputMode="decimal" min="0" step="any" value={dose} onChange={(e) => setDose(e.target.value)} className={field} />
          </label>
        </div>
        <div>
          <p className={label}>Where did it go?</p>
          <div className="mt-1">
            <SitePicker value={site} last={view.lastShot?.site ?? null} onChange={setSite} />
          </div>
        </div>
        <label className={label}>
          Note
          <input aria-label="Note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Optional" className={field} />
        </label>
        <Notice msg={msg} />
        <button type="button" onClick={save} disabled={busy} className={primaryButton}>
          Save shot
        </button>
      </div>
    </Sheet>
  );
}
