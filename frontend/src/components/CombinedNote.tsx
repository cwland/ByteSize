import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { api } from "../api";
import { formatAmount } from "../amounts";
import { onCombined, type Combined } from "../combined";
import { notifyDayChanged } from "../day";
import { MEAL_NAMES } from "../meals";
import { useSession } from "../session";

const SHOW_MS = 10000;

// "Added to the egg white already in Breakfast (now 200 g)" with Undo, after the server combined an addition
// with the same food already in that meal. Undo splits each back off (the last first). Above any open window.
export default function CombinedNote() {
  const { user } = useSession();
  const [list, setList] = useState<Combined[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => onCombined((l) => (setList(l), setError(null))), []);
  useEffect(() => {
    if (!list) return;
    const t = setTimeout(() => setList(null), SHOW_MS);
    return () => clearTimeout(t);
  }, [list]);
  if (!list) return null;

  const undo = async () => {
    try {
      for (const c of [...list].reverse()) await api("POST", `/api/log/${c.entry.id}/split`, { before: c.before, added: c.added, ...c.splitTo });
      setList(null);
    } catch (e) {
      setError((e as Error).message || "Couldn't undo");
    }
    notifyDayChanged();
  };
  const [one] = list;
  const e = one.entry;
  const text =
    list.length === 1
      ? `Added to the ${e.name} already in ${MEAL_NAMES[e.meal]} (now ${formatAmount(e.servings, e.servingIndex, e.unit, e.quantity, e.fraction, user.units)})`
      : `Added to ${list.length} foods already there`;
  return (
    <div role="status" aria-label="Combined" className="pb-safe fixed inset-x-0 bottom-24 z-[60] flex justify-center px-3 lg:bottom-6">
      <div className="flex max-w-[560px] items-center gap-3 rounded-2xl bg-ink px-4 py-3 text-page shadow-lg shadow-black/40">
        <p className="text-sm">{error ?? text}</p>
        <button type="button" onClick={undo} className="shrink-0 rounded-full px-3 py-1.5 text-sm font-bold text-primary hover:bg-black/20">
          Undo
        </button>
        <button type="button" aria-label="Close" onClick={() => setList(null)} className="shrink-0 rounded-full p-1 hover:bg-black/20">
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
    </div>
  );
}
