import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { api } from "../api";
import { formatAmount } from "../amounts";
import { onCombined, type Combined } from "../combined";
import { notifyDayChanged } from "../day";
import { MEAL_NAMES } from "../meals";
import { useSession } from "../session";

const SHOW_MS = 10000;

// The open window (sheet) on top, if any: the note goes inside it, so keyboard and screen-reader users in
// that window can reach Undo (everything outside an aria-modal window is out of their reach)
const openWindow = () => {
  const all = document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]');
  return all.length ? all[all.length - 1] : null;
};
function useWindowHost(active: boolean) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!active) return;
    const check = () => setHost(openWindow());
    check();
    const watch = new MutationObserver(check);
    watch.observe(document.body, { childList: true, subtree: true });
    return () => watch.disconnect();
  }, [active]);
  return active ? host : null;
}

// "Added to the egg white already in Breakfast (now 200 g)" with Undo, after the server combined an addition
// with the same food already in that meal. Undo splits each back off, the last first, once: a split that
// worked is dropped from the list, so a retry after a failure only tries what's left.
export default function CombinedNote() {
  const { user } = useSession();
  const [list, setList] = useState<Combined[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  useEffect(() => onCombined((l) => (setList(l), setError(null))), []);
  useEffect(() => {
    if (!list || busy || error) return;
    const t = setTimeout(() => setList(null), SHOW_MS);
    return () => clearTimeout(t);
  }, [list, busy, error]);
  const host = useWindowHost(!!list);
  if (!list) return null;

  const undo = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    let left = list;
    try {
      while (left.length) {
        const c = left[left.length - 1];
        await api("POST", `/api/log/${c.entry.id}/split`, { before: c.before, added: c.added, ...c.splitTo });
        left = left.slice(0, -1);
      }
      setList(null);
    } catch (e) {
      setList(left);
      setError((e as Error).message || "Couldn't undo");
    }
    running.current = false;
    setBusy(false);
    notifyDayChanged();
  };
  // One food (perhaps grown twice): its name and amount now; several: how many
  const ids = new Set(list.map((c) => c.entry.id));
  const e = list[list.length - 1].entry;
  const text =
    ids.size === 1
      ? `Added to the ${e.name} already in ${MEAL_NAMES[e.meal]} (now ${formatAmount(e.servings, e.servingIndex, e.unit, e.quantity, e.fraction, user.units)})`
      : `Added to ${ids.size} foods already there`;
  const note = (
    <div role="status" aria-label="Combined" className="pb-safe fixed inset-x-0 bottom-24 z-[60] flex justify-center px-3 lg:bottom-6">
      <div className="flex max-w-[560px] items-center gap-2 rounded-2xl bg-ink py-1 pr-1 pl-4 text-page shadow-lg shadow-black/40">
        <p className="text-sm">{error ?? text}</p>
        <button type="button" disabled={busy} onClick={undo} className="min-h-11 shrink-0 rounded-full px-4 text-sm font-bold text-primary hover:bg-black/20 disabled:opacity-50">
          Undo
        </button>
        <button type="button" aria-label="Dismiss" onClick={() => setList(null)} className="flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-black/20">
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
    </div>
  );
  return host ? createPortal(note, host) : note;
}
