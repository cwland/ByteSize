import { useState } from "react";
import { ArrowRightLeft, Copy, Trash2, Utensils, UtensilsCrossed } from "lucide-react";
import { api } from "../../api";
import { notifyDayChanged } from "../../day";
import { amountFactor } from "../../nutrition";
import type { LogEntry, Nutrients } from "../../types";
import FoodDetail from "./FoodDetail";
import { Sheet } from "../ui/Sheet";
import { Notice, errorMsg, type Msg } from "../ui/Notice";

// What one base serving of a logged food has (entries keep the scaled numbers; the preview needs per-serving)
function perServing(e: LogEntry): Nutrients {
  try {
    const f = amountFactor(e.servings, e.servingIndex, e.unit, e.quantity) * e.fraction;
    if (!(f > 0)) return e.nutrients;
    return Object.fromEntries(Object.entries(e.nutrients).map(([k, v]) => [k, (v as number) / f]));
  } catch {
    return e.nutrients;
  }
}

// Edit entry: change a logged food's portion (Save at the bottom). Move, Copy and Delete are icons in the
// title row, left of the X (§28); Delete still asks before deleting.
// bank: the weekly workout bank's balance when the day is on it (§40b: a Treat switch), else none
export default function EditEntrySheet({ entry, onClose, onMove, onDelete, bank = null }: { entry: LogEntry; onClose: () => void; onMove: (copy: boolean) => void; onDelete: () => void; bank?: number | null }) {
  const icon = (label: string, el: JSX.Element, onClick: () => void, className = "text-subtle hover:text-ink") => (
    <button type="button" aria-label={label} title={label} onClick={onClick} className={`flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-pressed ${className}`}>
      {el}
    </button>
  );
  // Restaurant tags: the person's own say on this brand ("Treat … as a restaurant" / "… is not a restaurant")
  const [restaurant, setRestaurant] = useState(!!entry.restaurant);
  const [markMsg, setMarkMsg] = useState<Msg>(null);
  async function mark(brand: string, on: boolean) {
    setMarkMsg(null);
    try {
      await api("PUT", "/api/restaurant-brands", { brand, restaurant: on });
      setRestaurant(on);
      setMarkMsg({ ok: true, text: on ? `${brand} is a restaurant` : `${brand} isn't a restaurant` });
      notifyDayChanged();
    } catch (err) {
      setMarkMsg(errorMsg(err));
    }
  }
  const heading = (
    <div className="flex items-center gap-1">
      <h2 className="flex-1 truncate text-lg font-bold">Edit entry</h2>
      {entry.brand &&
        (restaurant
          ? icon(`${entry.brand} is not a restaurant`, <UtensilsCrossed aria-hidden="true" className="size-5" />, () => mark(entry.brand!, false), "text-restaurant hover:text-ink")
          : icon(`Treat ${entry.brand} as a restaurant`, <Utensils aria-hidden="true" className="size-5" />, () => mark(entry.brand!, true)))}
      {icon("Move to another meal or day", <ArrowRightLeft aria-hidden="true" className="size-5" />, () => onMove(false))}
      {icon("Copy", <Copy aria-hidden="true" className="size-5" />, () => onMove(true))}
      {icon("Delete", <Trash2 aria-hidden="true" className="size-5" />, onDelete, "text-error")}
    </div>
  );
  return (
    <Sheet label="Edit portion" heading={heading} onClose={onClose}>
      <Notice msg={markMsg} />
      <FoodDetail
        food={{ name: entry.name, brand: entry.brand, restaurant, icon: entry.icon, imageUrl: entry.imageUrl, servings: entry.servings, nutrients: perServing(entry) }}
        initial={{ servingIndex: entry.servingIndex, unit: entry.unit, quantity: entry.quantity, fraction: entry.fraction }}
        submitLabel="Save"
        treat={bank !== null || entry.treat ? { initial: !!entry.treat, bank: bank ?? 0 } : undefined}
        onSubmit={async (p, treat) => {
          await api("PATCH", `/api/log/${entry.id}`, bank !== null || entry.treat ? { ...p, treat } : p);
          notifyDayChanged();
          onClose();
        }}
      />
    </Sheet>
  );
}
