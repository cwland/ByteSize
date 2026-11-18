import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { api } from "../../api";
import { notifyDayChanged } from "../../day";
import { dayRange } from "../../format";
import type { Vacation } from "../../types";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { field, label, noAutofill, secondaryButton } from "../ui/styles";

const newestFirst = (a: Vacation, b: Vacation) => (a.from === b.from ? b.id - a.id : a.from < b.from ? 1 : -1);

// Goals › Vacation mode: date ranges in which a day without food doesn't break the streak
export default function VacationMode() {
  const [list, setList] = useState<Vacation[] | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  useEffect(() => {
    api<{ vacations: Vacation[] }>("GET", "/api/vacations")
      .then((r) => setList(r.vacations))
      .catch((e) => setMsg(errorMsg(e)));
  }, []);

  const add = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const { vacation } = await api<{ vacation: Vacation }>("POST", "/api/vacations", { from, to });
      setList((l) => [...(l ?? []), vacation].sort(newestFirst));
      setFrom("");
      setTo("");
      notifyDayChanged(); // the streak may change
    } catch (e) {
      setMsg(errorMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (v: Vacation) => {
    setMsg(null);
    try {
      await api("DELETE", `/api/vacations/${v.id}`);
      setList((l) => (l ?? []).filter((x) => x.id !== v.id));
      notifyDayChanged();
    } catch (e) {
      setMsg(errorMsg(e));
    }
  };

  return (
    <section aria-label="Vacation mode" className="rounded-2xl bg-container p-5">
      <h2 className="text-lg font-bold">Vacation mode</h2>
      <p className="mt-1 text-subtle">Days off don't break your streak</p>
      {list && list.length === 0 && <p className="mt-3 text-sm text-muted">No vacations set</p>}
      {list && list.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {list.map((v) => {
            const text = dayRange(v.from, v.to, true);
            return (
              <li key={v.id} className="flex items-center justify-between rounded-xl bg-page px-3 py-2">
                <span className="font-semibold">{text}</span>
                <button type="button" aria-label={`Remove vacation ${text}`} onClick={() => remove(v)} className="rounded-full p-1.5 text-subtle hover:bg-pressed">
                  <X className="size-4" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className={label}>
          From
          <input {...noAutofill} type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={field} />
        </label>
        <label className={label}>
          To
          <input {...noAutofill} type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className={field} />
        </label>
      </div>
      <button type="button" onClick={add} disabled={!from || !to || busy} className={`${secondaryButton} mt-3`}>
        Add vacation
      </button>
      <Notice msg={msg} />
    </section>
  );
}
