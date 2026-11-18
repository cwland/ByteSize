import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "../../api";
import { announceCombined, type Combined } from "../../combined";
import { notifyDayChanged } from "../../day";
import { MEALS, MEAL_NAMES } from "../../meals";
import { addDays, dayLabel } from "../../selectedDay";
import type { Meal } from "../../types";
import { Choice } from "../ui/Choice";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { Sheet } from "../ui/Sheet";
import { primaryButton } from "../ui/styles";

// Move or copy entries to another day and meal → POST /api/log/move
export default function MoveSheet({ ids, copy, day: fromDay, meal: fromMeal, onClose }: { ids: number[]; copy: boolean; day: string; meal: Meal; onClose: () => void }) {
  const [day, setDay] = useState(fromDay);
  const [meal, setMeal] = useState<Meal>(fromMeal);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const arrow = "flex size-9 items-center justify-center rounded-full text-subtle hover:bg-pressed hover:text-ink";

  const go = async () => {
    setBusy(true);
    try {
      announceCombined(await api<{ combined?: Combined[] }>("POST", "/api/log/move", { ids, day, meal, copy }));
      notifyDayChanged();
      onClose();
    } catch (e) {
      setMsg(errorMsg(e));
      setBusy(false);
    }
  };

  return (
    <Sheet label={copy ? "Copy to…" : "Move to…"} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-center gap-2">
          <button type="button" aria-label="Earlier day" onClick={() => setDay((d) => addDays(d, -1))} className={arrow}>
            <ChevronLeft className="size-5" />
          </button>
          <span className="min-w-32 text-center font-bold tabular">{dayLabel(day)}</span>
          <button type="button" aria-label="Later day" onClick={() => setDay((d) => addDays(d, 1))} className={arrow}>
            <ChevronRight className="size-5" />
          </button>
        </div>
        <Choice label="Meal" value={meal} onChange={setMeal} options={MEALS.filter((m) => m !== "supplements").map((m) => ({ value: m, label: MEAL_NAMES[m] }))} />
        <Notice msg={msg} />
        <button type="button" disabled={busy} onClick={go} className={primaryButton}>
          {copy ? "Copy here" : "Move here"}
        </button>
      </div>
    </Sheet>
  );
}
