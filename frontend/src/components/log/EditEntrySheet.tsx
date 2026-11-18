import { api } from "../../api";
import { notifyDayChanged } from "../../day";
import { amountFactor } from "../../nutrition";
import type { LogEntry, Nutrients } from "../../types";
import FoodDetail from "./FoodDetail";
import { Sheet } from "../ui/Sheet";
import { secondaryButton } from "../ui/styles";

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

// Edit entry: change a logged food's portion (Save), or move, copy or delete it
export default function EditEntrySheet({ entry, onClose, onMove, onDelete }: { entry: LogEntry; onClose: () => void; onMove: (copy: boolean) => void; onDelete: () => void }) {
  return (
    <Sheet label="Edit portion" heading="Edit entry" onClose={onClose}>
      <FoodDetail
        food={{ name: entry.name, brand: entry.brand, icon: entry.icon, imageUrl: entry.imageUrl, servings: entry.servings, nutrients: perServing(entry) }}
        initial={{ servingIndex: entry.servingIndex, unit: entry.unit, quantity: entry.quantity, fraction: entry.fraction }}
        submitLabel="Save"
        onSubmit={async (p) => {
          await api("PATCH", `/api/log/${entry.id}`, p);
          notifyDayChanged();
          onClose();
        }}
      >
        {(["Move", "Copy"] as const).map((a) => (
          <button key={a} type="button" onClick={() => onMove(a === "Copy")} className={secondaryButton}>
            {a}
          </button>
        ))}
        <button type="button" onClick={onDelete} className={`${secondaryButton} text-error`}>
          Delete
        </button>
      </FoodDetail>
    </Sheet>
  );
}
