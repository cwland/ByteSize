import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { apiLines } from "../../api";
import type { FoodResult } from "../../types";
import { secondaryButton } from "../ui/styles";

// The AI's estimate of a food from a few words (POST /api/ai/estimate). assumed: it took the words to mean
// something worth confirming ("Did you mean Cheerios?"), interpretedAs.
export type AiFood = Omit<FoodResult, "id" | "kind"> & { category: string };
export type Estimate = { food: AiFood; assumed?: boolean; interpretedAs?: string };
// Several foods from one description (POST /api/ai/estimate-items): each with its amount, and a short name for
// them together (null for one food)
export type EstimateItem = { food: AiFood; servingIndex: number; quantity: number };
export type ItemsEstimate = { items: EstimateItem[]; mealName: string | null; assumed?: boolean; interpretedAs?: string };

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

  const ask = async <T,>(path: string, text: string): Promise<T | null> => {
    current.current?.abort();
    const mine = new AbortController();
    current.current = mine;
    setStep("asking");
    try {
      return await apiLines<T>("POST", path, { text }, { signal: mine.signal, onLine: (l) => !mine.signal.aborted && l.progress === "another" && setStep("another") });
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
  // One food (RecipeHub's estimate, Restaurants), or the foods in a description (Describe it)
  const run = (text: string) => ask<Estimate>("/api/ai/estimate", text);
  const runItems = (text: string) => ask<ItemsEstimate>("/api/ai/estimate-items", text);
  const cancel = () => {
    current.current?.abort();
    current.current = null;
    setStep(null);
  };
  return { step, run, runItems, cancel };
}

// The line beside the estimate button while it works: a turning wheel (a pulse with reduced motion), what
// it's doing (never which AI service), and Cancel. The status region is always there (empty when idle), so
// screen readers announce the text when it appears; while idle it is taken out of the layout (no size, out of
// the flow), so it leaves no gap beside or under the button.
// texts: what it says (Insights: "Thinking… asking AI"); the default is Describe it's
const ESTIMATING = { asking: "Estimating… asking AI", another: "Still estimating… trying another AI" };
export function AiWorking({ step, onCancel, texts = ESTIMATING }: { step: EstimateStep | null; onCancel: () => void; texts?: { asking: string; another: string } }) {
  return (
    <div className={step ? "flex flex-wrap items-center gap-2" : "absolute size-0 overflow-hidden"}>
      <p role="status" className="flex items-center gap-2 text-sm font-semibold text-subtle">
        {step && (
          <>
            <Loader2 aria-hidden="true" className="size-5 shrink-0 animate-spin text-action motion-reduce:animate-pulse" />
            {step === "another" ? texts.another : texts.asking}
          </>
        )}
      </p>
      {step && (
        <button type="button" onClick={onCancel} className={`${secondaryButton} px-4 py-1.5 text-sm`}>
          Cancel
        </button>
      )}
    </div>
  );
}

// "Cherios!" and "  cherios " are the same words: only a real change of words is worth a "Did you mean"
const wordsOf = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
export const worthAsking = (typed: string, out: Estimate) => !!out.assumed && wordsOf(out.interpretedAs ?? out.food.name) !== wordsOf(typed);
