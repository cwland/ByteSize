import { useState } from "react";
import { fmt } from "../../units";

// A progress ring that is full at the range minimum. Past the max it shows a small tick (no alarm).
// unknown = how many of the day's foods don't say how much of this they have.
export default function Ring({ name, value, min, max, unit, unknown = 0 }: { name: string; value: number; min?: number; max?: number; unit: string; unknown?: number }) {
  const [why, setWhy] = useState(false);
  const progress = min ? Math.min(1, value / min) : 0;
  const full = !!min && value >= min;
  const over = max !== undefined && value > max;
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex flex-col items-center text-center">
      <div className="relative">
        <svg
          viewBox="0 0 64 64"
          className="size-16 -rotate-90"
          role="img"
          aria-label={`${name} ${fmt(value)}${min ? ` of ${fmt(min)}` : ""} ${unit}${full ? ", reached" : ""}${over ? ", above the range" : ""}`}
          data-full={full}
        >
          <circle cx="32" cy="32" r={r} fill="none" stroke="var(--color-line)" strokeWidth="7" />
          {progress > 0 && (
            <circle cx="32" cy="32" r={r} fill="none" stroke="var(--color-success)" strokeWidth="7" strokeLinecap="round" strokeDasharray={`${progress * c} ${c}`} />
          )}
          {over && <line x1="58" y1="32" x2="64" y2="32" stroke="var(--color-ink)" strokeWidth="3" />}
        </svg>
        {unknown > 0 && (
          <button
            type="button"
            aria-label={`Why is ${name.toLowerCase()} uncertain?`}
            onClick={() => setWhy((w) => !w)}
            className="absolute -top-1 -right-1 flex size-5 items-center justify-center rounded-full bg-pressed text-xs font-bold text-subtle"
          >
            ?
          </button>
        )}
      </div>
      <p className="mt-1.5 text-sm font-semibold">{name}</p>
      <p className="text-xs text-subtle tabular">{min ? `${fmt(value)} / ${fmt(min)} ${unit}` : `${fmt(value)} ${unit}`}</p>
      {why && <p className="mt-1 text-xs text-muted">{`${unknown} ${unknown === 1 ? "food" : "foods"} missing ${name.toLowerCase()}`}</p>}
    </div>
  );
}
