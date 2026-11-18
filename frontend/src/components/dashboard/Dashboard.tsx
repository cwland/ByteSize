import { Camera, Flame, GlassWater, ScanBarcode, Search, Utensils } from "lucide-react";
import { api } from "../../api";
import { notifyDayChanged, useDay, useSettingsMe } from "../../day";
import { useSelectedDay } from "../../selectedDay";
import { useSession } from "../../session";
import { fmt, waterUnit, waterValue } from "../../units";
import Gauge from "./Gauge";
import Ring from "./Ring";
import NewBadge from "./NewBadge";
import { useState } from "react";
import { mealFor } from "../../meals";
import type { Meal } from "../../types";
import AddFoodSheet, { type AddFoodStart } from "../log/AddFoodSheet";
import { usePhotoInput } from "../log/PhotoPicker";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { primaryButton, secondaryButton } from "../ui/styles";
import WeightCard from "../weight/WeightCard";
import Glp1Card from "../glp1/Glp1Card";
import PageHeader, { longDate } from "../PageHeader";
import TodaysFood from "./TodaysFood";
import { useWide } from "../../wide";

// "Good evening": by the hour in the person's time zone
function greeting(timeZone: string) {
  let hour = new Date().getHours();
  try {
    hour = Number(new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(new Date()));
  } catch {
    // an unknown zone: the browser's clock
  }
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

// The wide Dashboard's quick buttons: each opens Add food at that view for the meal of the moment
const QUICK: { start: AddFoodStart; label: string; Icon: typeof Search }[] = [
  { start: "search", label: "Search food", Icon: Search },
  { start: "barcode", label: "Barcode photo", Icon: ScanBarcode },
  { start: "label", label: "Label photo", Icon: Camera },
  { start: "restaurants", label: "Restaurants", Icon: Utensils },
];

// The selected day at a glance: calorie budget gauge, protein/fiber/water rings, water quick-add, streak.
// Wide screens: a header (the day, a greeting, the week strip) and three columns — budget and quick
// buttons; the day's food; water, weight (with a trend line), GLP-1 and streak.
export default function Dashboard() {
  const { user } = useSession();
  const { day, isToday } = useSelectedDay();
  const wide = useWide();
  // Add food opened from the wide Dashboard (quick buttons, an empty meal's + Add food)
  const [adding, setAdding] = useState<{ meal: Meal; start: AddFoodStart } | null>(null);
  const { data, error } = useDay(day);
  const settings = useSettingsMe();
  const mealNow = () => mealFor(user.timezone, new Date(), settings.mealWindows);
  const [msg, setMsg] = useState<Msg>(null);
  // Photo: the file picker opens straight away; the chosen photo then opens Add Food for the meal of the moment
  const [photo, setPhoto] = useState<{ file: File; meal: Meal } | null>(null);
  const photoInput = usePhotoInput((file) => setPhoto({ file, meal: mealNow() }));

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
  const [calWhy, setCalWhy] = useState(false);
  const water = (ml: number) => waterValue(ml, user.units);
  const wUnit = waterUnit(user.units);
  const waterLabel = (ml: number) => (user.units === "metric" ? `+${fmt(ml)} ml` : `+${water(ml)} oz`);

  const budget = (
    <section aria-label="Budget" className="rounded-2xl bg-container p-5">
      <h2 className="text-lg font-bold">{t ? `Budget: ${fmt(t.calories.min)}–${fmt(t.calories.max)} cals` : "Budget"}</h2>
      {t ? (
        <div className="mt-3 grid grid-cols-[4.5rem_1fr_4.5rem] items-end gap-2">
          <div className="text-center">
            <p data-testid="food-calories" className="text-xl font-bold tabular">
              {fmt(food)}
              {(unknown.calories ?? 0) > 0 && (
                <button
                  type="button"
                  aria-label="Why are calories uncertain?"
                  onClick={() => setCalWhy((w) => !w)}
                  className="ml-1 inline-flex size-5 items-center justify-center rounded-full bg-pressed align-top text-xs font-bold text-subtle"
                >
                  ?
                </button>
              )}
            </p>
            <p className="text-xs text-muted">Food</p>
            {calWhy && <p className="mt-1 text-xs text-muted">{`${unknown.calories} ${unknown.calories === 1 ? "food" : "foods"} missing calories`}</p>}
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
  );
  const waterCard = (
    <section aria-label="Water" className="flex items-center gap-3 rounded-2xl bg-container p-4">
      <GlassWater className="size-6 text-action" aria-hidden="true" />
      <span className="flex-1 font-semibold">Water</span>
      {settings.waterButtonsMl.map((ml) => (
        <button key={ml} type="button" onClick={() => addWater(ml)} className={`${secondaryButton} px-4 py-1.5 text-sm`}>
          {waterLabel(ml)}
        </button>
      ))}
    </section>
  );
  const streakCard = data && (
    <section aria-label="Streak" className="flex items-center gap-2 rounded-2xl bg-container px-4 py-3">
      <Flame className={`size-5 ${data.streak > 0 ? "text-action" : "text-inactive"}`} aria-hidden="true" />
      <span className="font-semibold">{data.streak > 0 ? `${data.streak}-day streak` : "Log a food to start a streak"}</span>
    </section>
  );

  if (wide) {
    const streakNote = data && data.streak > 0 ? ` · ${data.streak}-day streak` : "";
    const column = "flex min-w-0 flex-col gap-4";
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title={longDate(day)} sub={`${greeting(user.timezone)}, ${user.displayName ?? user.username}${streakNote}`} days />
        {error && <Notice msg={{ ok: false, text: error }} />}
        <NewBadge />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,19rem),1fr))] items-start gap-5">
          <div data-testid="dashboard-column" className={column}>
            {budget}
            <div className="grid grid-cols-2 gap-3">
              {QUICK.map(({ start, label, Icon }) => (
                <button
                  key={start}
                  type="button"
                  onClick={() => setAdding({ meal: mealNow(), start })}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-container px-3 py-3.5 font-bold hover:bg-pressed"
                >
                  <Icon aria-hidden="true" className="size-5 shrink-0 text-action" /> {label}
                </button>
              ))}
            </div>
          </div>
          <div data-testid="dashboard-column" className={column}>
            <TodaysFood data={data} isToday={isToday} units={user.units} onAdd={(meal) => setAdding({ meal, start: "search" })} />
          </div>
          <div data-testid="dashboard-column" className={column}>
            {waterCard}
            <Notice msg={msg} />
            <WeightCard trend />
            <Glp1Card />
            {streakCard}
          </div>
        </div>
        {adding && <AddFoodSheet day={day} meal={adding.meal} start={adding.start} onClose={() => setAdding(null)} />}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <h1 className="sr-only">Dashboard</h1>
      {error && <Notice msg={{ ok: false, text: error }} />}
      <NewBadge />
      {budget}
      <div className="flex gap-2">
        {photoInput.input}
        <button type="button" onClick={photoInput.open} className={`${secondaryButton} inline-flex items-center gap-1.5`}>
          <Camera aria-hidden="true" className="size-5" /> Photo
        </button>
      </div>
      {waterCard}
      <Notice msg={msg} />
      <Glp1Card />
      <WeightCard />
      {streakCard}
      {photo && <AddFoodSheet day={day} meal={photo.meal} photo={photo.file} onClose={() => setPhoto(null)} />}
    </div>
  );
}
