import { useState } from "react";
import { api } from "../../api";
import type { FoodResult } from "../../types";
import { errorMsg } from "../ui/Notice";
import { linkButton } from "../ui/styles";

// "Saved copy from Nov 17, 2026"
export const savedDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** Whether a food is a kept copy of an outside food (only those can be checked for changes). */
export const isSavedCopy = (f: FoodResult) => f.kind === "cache" && !!f.savedAt;

/**
 * A kept copy's note with Check for changes: the source is asked once for this food, the kept copy is replaced,
 * and the note says "Updated" or "Up to date" (onChecked gets the food as it is now). A failure says why.
 */
export function SavedCopyNote({ food, onChecked }: { food: FoodResult; onChecked: (f: FoodResult) => void }) {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  if (!isSavedCopy(food) && !said) return null;
  const check = async () => {
    setBusy(true);
    setSaid(null);
    let r: { result: "updated" | "up_to_date"; food: FoodResult };
    try {
      r = await api("POST", "/api/foods/refresh", { cacheId: food.id });
    } catch (e) {
      setSaid({ ok: false, text: errorMsg(e)?.text ?? "Couldn't check for changes" });
      return;
    } finally {
      setBusy(false);
    }
    setSaid({ ok: true, text: r.result === "updated" ? "Updated" : "Up to date" });
    onChecked(r.food);
  };
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
      {isSavedCopy(food) && (
        <>
          <span>Saved copy from {savedDate(food.savedAt!)}</span>
          <button type="button" aria-label={`Check ${food.name} for changes`} disabled={busy} onClick={() => void check()} className={linkButton}>
            {busy ? "Checking…" : "Check for changes"}
          </button>
        </>
      )}
      {said && (
        <span role="status" className={said.ok ? "font-semibold text-success" : "text-error"}>
          {said.text}
        </span>
      )}
    </p>
  );
}
