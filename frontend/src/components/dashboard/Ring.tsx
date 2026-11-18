import { fmt } from "../../units";

// A progress ring that is full at the range minimum. Past the max it shows a small tick (no alarm).
export default function Ring({ name, value, min, max, unit }: { name: string; value: number; min?: number; max?: number; unit: string }) {
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
      </div>
      <p className="mt-1.5 text-sm font-semibold">{name}</p>
      <p className="text-xs text-subtle tabular">{min ? `${fmt(value)} / ${fmt(min)} ${unit}` : `${fmt(value)} ${unit}`}</p>
    </div>
  );
}
