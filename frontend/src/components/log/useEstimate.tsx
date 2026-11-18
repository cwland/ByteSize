import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { apiLines } from "../../api";
import type { FoodResult } from "../../types";
import { secondaryButton } from "../ui/styles";

// The AI's estimate of a food from a few words (POST /api/ai/estimate). assumed: it took the words to mean
// something worth confirming ("Did you mean Cheerios?"), interpretedAs.
export type AiFood = Omit<FoodResult, "id" | "kind"> & { category: string };
export type Estimate = { food: AiFood; assumed?: boolean; interpretedAs?: string };

// What's happening while it works: the first AI asked, or another one after the first failed
export type EstimateStep = "asking" | "another";

/**
 * Asking the AI for an estimate, with Cancel. run() gives the estimate, or null when cancelled (or the
 * screen went away); errors are thrown. Leaving the screen stops the request too.
 */
export function useEstimate() {
  const [step, setStep] = useState<EstimateStep | null>(null);
  const current = useRef<AbortController | null>(null);
  useEffect(() => () => current.current?.abort(), []);

  const run = async (text: string): Promise<Estimate | null> => {
    current.current?.abort();
    const mine = new AbortController();
    current.current = mine;
    setStep("asking");
    try {
      return await apiLines<Estimate>("POST", "/api/ai/estimate", { text }, { signal: mine.signal, onLine: (l) => !mine.signal.aborted && l.progress === "another" && setStep("another") });
    } catch (e) {
      if (mine.signal.aborted) return null;
      throw e;
    } finally {
      if (current.current === mine) {
        current.current = null;
        setStep(null);
      }
    }
  };
  const cancel = () => {
    current.current?.abort();
    current.current = null;
    setStep(null);
  };
  return { step, run, cancel };
}

// The line beside the estimate button while it works: a turning wheel (a pulse with reduced motion), what
// it's doing (never which AI service), and Cancel
export function AiWorking({ step, onCancel }: { step: EstimateStep | null; onCancel: () => void }) {
  if (!step) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p role="status" className="flex items-center gap-2 text-sm font-semibold text-subtle">
        <Loader2 aria-hidden="true" className="size-5 shrink-0 animate-spin text-action motion-reduce:animate-pulse" />
        {step === "another" ? "Still estimating… trying another AI" : "Estimating… asking AI"}
      </p>
      <button type="button" onClick={onCancel} className={`${secondaryButton} px-4 py-1.5 text-sm`}>
        Cancel
      </button>
    </div>
  );
}
