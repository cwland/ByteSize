import { SITES, type Site } from "../../types";
import { SITE_LABELS } from "./glp1";

// Where the shot went: a 2×3 grid (belly / thigh / arm × left / right, the person's own left and right).
// The chosen site is filled; the last one used is marked so the rotation is easy to follow.
export default function SitePicker({ value, last, onChange }: { value: Site; last: Site | null; onChange: (s: Site) => void }) {
  return (
    <div role="radiogroup" aria-label="Injection site" className="grid grid-cols-2 gap-2">
      {SITES.map((s) => {
        const on = s === value;
        return (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={SITE_LABELS[s]}
            onClick={() => onChange(s)}
            className={`flex min-h-14 flex-col items-center justify-center rounded-2xl border-2 px-2 py-2 text-center ${
              on ? "border-primary bg-primary text-on-primary" : "border-line bg-page text-ink hover:bg-pressed"
            }`}
          >
            <span className="font-semibold">{SITE_LABELS[s]}</span>
            {s === last && <span className={`text-xs ${on ? "text-on-primary" : "text-muted"}`}>Last used</span>}
          </button>
        );
      })}
    </div>
  );
}
