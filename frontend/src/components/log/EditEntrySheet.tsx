import { ArrowRightLeft, Copy, Trash2 } from "lucide-react";
import { api } from "../../api";
import { notifyDayChanged } from "../../day";
import { amountFactor } from "../../nutrition";
import type { LogEntry, Nutrients } from "../../types";
import FoodDetail from "./FoodDetail";
import { Sheet } from "../ui/Sheet";

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
export default function EditEntrySheet({ entry, onClose, onMove, onDelete }: { entry: LogEntry; onClose: () => void; onMove: (copy: boolean) => void; onDelete: () => void }) {
  const icon = (label: string, el: JSX.Element, onClick: () => void, className = "text-subtle hover:text-ink") => (
    <button type="button" aria-label={label} title={label} onClick={onClick} className={`flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-pressed ${className}`}>
      {el}
    </button>
  );
  const heading = (
    <div className="flex items-center gap-1">
      <h2 className="flex-1 truncate text-lg font-bold">Edit entry</h2>
      {icon("Move to another meal or day", <ArrowRightLeft aria-hidden="true" className="size-5" />, () => onMove(false))}
      {icon("Copy", <Copy aria-hidden="true" className="size-5" />, () => onMove(true))}
      {icon("Delete", <Trash2 aria-hidden="true" className="size-5" />, onDelete, "text-error")}
    </div>
  );
  return (
    <Sheet label="Edit portion" heading={heading} onClose={onClose}>
      <FoodDetail
        food={{ name: entry.name, brand: entry.brand, icon: entry.icon, imageUrl: entry.imageUrl, servings: entry.servings, nutrients: perServing(entry) }}
        initial={{ servingIndex: entry.servingIndex, unit: entry.unit, quantity: entry.quantity, fraction: entry.fraction }}
        submitLabel="Save"
        onSubmit={async (p) => {
          await api("PATCH", `/api/log/${entry.id}`, p);
          notifyDayChanged();
          onClose();
        }}
      />
    </Sheet>
  );
}
