import type { Nutrients } from "../../types";
import { fmt } from "../../units";

const pill = "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold tabular whitespace-nowrap";

// Calories (orange), protein and fiber (their own colours) for an amount; a missing value is "?", never 0
export default function Pills({ n }: { n: Nutrients }) {
  const g = (v: number | undefined) => (v === undefined ? "?" : fmt(v));
  return (
    <span className="flex flex-wrap gap-1.5">
      <span className={`${pill} bg-primary text-on-primary`}>{`${n.calories === undefined ? "?" : fmt(n.calories)} cal`}</span>
      <span className={`${pill} bg-protein/15 text-protein`}>{`${g(n.protein_g)} g protein`}</span>
      <span className={`${pill} bg-fiber/15 text-fiber`}>{`${g(n.fiber_g)} g fiber`}</span>
    </span>
  );
}
