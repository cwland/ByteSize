import { Flame, GlassWater } from "lucide-react";
import { api } from "../../api";
import { notifyDayChanged, useDay, useSettingsMe } from "../../day";
import { useSelectedDay } from "../../selectedDay";
import { useSession } from "../../session";
import { fmt, waterUnit, waterValue } from "../../units";
import Gauge from "./Gauge";
import Ring from "./Ring";
import { useState } from "react";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { primaryButton, secondaryButton } from "../ui/styles";

// The selected day at a glance: calorie budget gauge, protein/fiber/water rings, water quick-add, streak
export default function Dashboard() {
  const { user } = useSession();
  const { day } = useSelectedDay();
  const { data, error } = useDay(day);
  const settings = useSettingsMe();
  const [msg, setMsg] = useState<Msg>(null);

  const addWater = async (ml: number) => {
    try {
      await api("POST", "/api/log", { day, meal: "supplements", water_ml: ml });
      notifyDayChanged();
    } catch (e) {
      setMsg(errorMsg(e));
    }
  };

  const t = data?.targets ?? null;
  const food = data?.totals.calories ?? 0;
  const unknown = data?.totals.unknownCount ?? {};
  const water = (ml: number) => waterValue(ml, user.units);
  const wUnit = waterUnit(user.units);
  const waterLabel = (ml: number) => (user.units === "metric" ? `+${fmt(ml)} ml` : `+${water(ml)} oz`);

  return (
    <div className="flex flex-col gap-3">
      <h1 className="sr-only">Dashboard</h1>
      {error && <Notice msg={{ ok: false, text: error }} />}
      <section aria-label="Budget" className="rounded-2xl bg-container p-5">
        <h2 className="text-lg font-bold">{t ? `Budget: ${fmt(t.calories.min)}–${fmt(t.calories.max)} cals` : "Budget"}</h2>
        {t ? (
          <div className="mt-3 grid grid-cols-[4.5rem_1fr_4.5rem] items-end gap-2">
            <div className="text-center">
              <p data-testid="food-calories" className="text-xl font-bold tabular">
                {fmt(food)}
              </p>
              <p className="text-xs text-muted">Food</p>
            </div>
            <Gauge food={food} min={t.calories.min} max={t.calories.max} />
            <div className="text-center">
              <p data-testid="exercise-calories" className="text-xl font-bold tabular">
                {fmt(data?.exercise.calories ?? 0)}
              </p>
              <p className="text-xs text-muted">Exercise</p>
            </div>
          </div>
        ) : (
          data && (
            <div className="mt-3 flex flex-col items-center gap-3 text-center">
              <p className="text-subtle">Pick a plan to see your budget</p>
              <button type="button" onClick={() => (window.location.hash = "#/goals/plan")} className={primaryButton}>
                Pick a plan
              </button>
            </div>
          )
        )}
        {data && (
          <div className="mt-6 grid grid-cols-3 gap-2">
            <Ring name="Protein" value={data.totals.protein_g ?? 0} min={t?.protein_g.min} max={t?.protein_g.max} unit="g" unknown={unknown.protein_g} />
            <Ring name="Fiber" value={data.totals.fiber_g ?? 0} min={t?.fiber_g.min} max={t?.fiber_g.max} unit="g" unknown={unknown.fiber_g} />
            <Ring
              name="Water"
              value={water(data.totals.water_ml ?? 0)}
              min={t ? water(t.water_ml.min) : undefined}
              max={t ? water(t.water_ml.max) : undefined}
              unit={wUnit}
            />
          </div>
        )}
      </section>
      <section aria-label="Water" className="flex items-center gap-3 rounded-2xl bg-container p-4">
        <GlassWater className="size-6 text-action" aria-hidden="true" />
        <span className="flex-1 font-semibold">Water</span>
        {settings.waterButtonsMl.map((ml) => (
          <button key={ml} type="button" onClick={() => addWater(ml)} className={`${secondaryButton} px-4 py-1.5 text-sm`}>
            {waterLabel(ml)}
          </button>
        ))}
      </section>
      <Notice msg={msg} />
      {data && (
        <section aria-label="Streak" className="flex items-center gap-2 rounded-2xl bg-container px-4 py-3">
          <Flame className={`size-5 ${data.streak > 0 ? "text-action" : "text-inactive"}`} aria-hidden="true" />
          <span className="font-semibold">{data.streak > 0 ? `${data.streak}-day streak` : "Log a food to start a streak"}</span>
        </section>
      )}
    </div>
  );
}
