import { useEffect, useRef, useState } from "react";
import { apiLines } from "../../api";
import type { EstimateStep } from "../log/useEstimate";

// What Insights says while the AI works (never which service), with the turning wheel of Describe it (§23)
export const THINKING = { asking: "Thinking… asking AI", another: "Still thinking… trying another AI" };

/**
 * One AI request for Insights (Refresh or Ask), asked for as lines so the page can say when another AI service is
 * being asked. run() gives the answer, or null when cancelled (or the screen went away); errors are thrown.
 */
export function useInsightAi() {
  const [step, setStep] = useState<EstimateStep | null>(null);
  const current = useRef<AbortController | null>(null);
  useEffect(() => () => current.current?.abort(), []);

  const run = async <T,>(path: string, body: unknown): Promise<T | null> => {
    current.current?.abort();
    const mine = new AbortController();
    current.current = mine;
    setStep("asking");
    try {
      return await apiLines<T>("POST", path, body, { signal: mine.signal, onLine: (l) => !mine.signal.aborted && l.progress === "another" && setStep("another") });
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
