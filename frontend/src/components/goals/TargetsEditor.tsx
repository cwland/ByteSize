import { useState, type FormEvent } from "react";
import { api } from "../../api";
import { useSession } from "../../session";
import type { Body, Range, TargetRanges, Targets } from "../../types";
import { flOzToMl, kgToLb, waterUnit, waterValue } from "../../units";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { field, primaryButton, secondaryButton } from "../ui/styles";

type Draft = Partial<TargetRanges>;

// Sensible starting values for your own targets (calories are left to you and your care team)
export function defaultsFor(body: Body | null): Draft {
  const goalLb = body ? kgToLb(body.goalWeightKg) : null;
  return {
    ...(goalLb ? { protein_g: { min: Math.round(goalLb * 0.7), max: Math.round(goalLb) } } : {}),
    fiber_g: { min: 25, max: 38 },
    water_ml: { min: 1893, max: 3785 },
  };
}

const ROWS = [
  { key: "calories", label: "Calories", unit: "" },
  { key: "protein_g", label: "Protein", unit: "g" },
  { key: "fiber_g", label: "Fiber", unit: "g" },
  { key: "water_ml", label: "Water", unit: "water" },
] as const;

// Min and max for calories, protein, fiber and water → PUT /api/targets (the plan becomes "your own")
export default function TargetsEditor({ initial, onSaved, onCancel }: { initial: Draft | null; onSaved: (t: Targets) => void; onCancel?: () => void }) {
  const { user } = useSession();
  const shown = (key: (typeof ROWS)[number]["key"], v: number | undefined) =>
    v === undefined ? "" : String(key === "water_ml" ? waterValue(v, user.units) : Math.round(v));
  const [values, setValues] = useState(() =>
    Object.fromEntries(ROWS.flatMap((r) => [[`${r.key}.min`, shown(r.key, initial?.[r.key]?.min)], [`${r.key}.max`, shown(r.key, initial?.[r.key]?.max)]])),
  );
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const out: Record<string, Range> = {};
    for (const r of ROWS) {
      const [min, max] = [Number(values[`${r.key}.min`]), Number(values[`${r.key}.max`])];
      if (!values[`${r.key}.min`] || !values[`${r.key}.max`] || !(min > 0) || !(max > 0)) return setMsg({ ok: false, text: `Enter a min and max for ${r.label.toLowerCase()}` });
      if (min > max) return setMsg({ ok: false, text: `${r.label} min is above its max` });
      const toMl = (v: number) => Math.round(user.units === "metric" ? v : flOzToMl(v));
      out[r.key] = r.key === "water_ml" ? { min: toMl(min), max: toMl(max) } : { min, max };
    }
    setBusy(true);
    try {
      const res = await api<{ targets: Targets }>("PUT", "/api/targets", out);
      onSaved(res.targets);
    } catch (err) {
      setMsg(errorMsg(err));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-2xl bg-container p-5">
      <h2 className="text-xl font-bold">Your targets</h2>
      {ROWS.map((r) => {
        const unit = r.unit === "water" ? waterUnit(user.units) : r.unit;
        return (
          <fieldset key={r.key} className="grid grid-cols-[6rem_1fr_1fr] items-end gap-2">
            <legend className="sr-only">{r.label}</legend>
            <span className="pb-3 font-semibold">{r.label}</span>
            {(["min", "max"] as const).map((end) => {
              const label = `${r.label} ${end}${unit ? ` (${unit})` : ""}`;
              return (
                <label key={end} className="text-xs text-muted">
                  {end}
                  <input
                    aria-label={label}
                    type="number"
                    inputMode="numeric"
                    value={values[`${r.key}.${end}`]}
                    onChange={(e) => setValues((v) => ({ ...v, [`${r.key}.${end}`]: e.target.value }))}
                    className={field}
                  />
                </label>
              );
            })}
          </fieldset>
        );
      })}
      <Notice msg={msg} />
      <div className="mt-2 flex gap-3">
        <button type="submit" disabled={busy} className={primaryButton}>
          Save targets
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className={secondaryButton}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
