import { useEffect, useRef, useState } from "react";
import { ChevronDown, Plus, ScanBarcode, Sparkles } from "lucide-react";
import { api } from "../../api";
import { formatAmount } from "../../amounts";
import { notifyDayChanged } from "../../day";
import { MEALS, MEAL_NAMES } from "../../meals";
import { addDays, dayLabel, todayIn } from "../../selectedDay";
import { useSession } from "../../session";
import type { Day, FoodResult, LogEntry, Meal, Nutrients, Portion, RecentFood } from "../../types";
import FoodForm, { draftOf, emptyDraft, type FoodDraft, type FoodFormMode } from "./FoodForm";
import FoodDetail, { defaultPortion, nutrientsFor } from "./FoodDetail";
import FoodRow, { QuickAddButton, useQuickAdd } from "./FoodRow";
import Pills from "./Pills";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { Sheet } from "../ui/Sheet";
import { field, primaryButton, secondaryButton } from "../ui/styles";

type Group = { source: string; label: string; foods: FoodResult[] };
type SourceError = { source: string; message: string };
type Found = { kind: "search"; groups: Group[]; errors: SourceError[] } | { kind: "barcode"; code: string; food: FoodResult | null; errors?: SourceError[] };
type View =
  | { k: "search" }
  | { k: "describe" }
  | { k: "form"; mode: FoodFormMode; draft: FoodDraft; fillRef?: { kind: "cache" | "user_food"; id: number } }
  | { k: "detail"; food: FoodResult; initial: Portion };

// Digits, spaces and dashes only: someone typing a barcode. Lookup only at a barcode's length.
const barcodeLike = (q: string) => /^[\d\s-]+$/.test(q);
const barcodeDigits = (q: string) => {
  const d = q.replace(/\D/g, "");
  return [8, 12, 13, 14].includes(d.length) ? d : null;
};

const amountOf = (servings: FoodResult["servings"], p: Portion) => formatAmount(servings, p.servingIndex, p.unit, p.quantity, p.fraction);

// Totals of several entries; a nutrient any of them doesn't know stays unknown (never a partial sum)
function totalOf(entries: LogEntry[]): Nutrients {
  const out: Nutrients = {};
  for (const k of ["calories", "protein_g", "fiber_g"] as const) {
    if (entries.every((e) => e.nutrients[k] !== undefined)) out[k] = entries.reduce((s, e) => s + (e.nutrients[k] as number), 0);
  }
  return out;
}

// "Same as yesterday?": yesterday's entries of this meal, one + copies them all into this day and meal
function SameAsYesterday({ entries, onAdd }: { entries: LogEntry[]; onAdd: () => Promise<void> }) {
  const quick = useQuickAdd(onAdd);
  return (
    <section aria-labelledby="same-as-yesterday" className="mt-4">
      <h3 id="same-as-yesterday" className="px-1 text-xs font-bold tracking-wide text-muted uppercase">
        Same as yesterday?
      </h3>
      <div className="mt-2 rounded-2xl bg-pressed p-3">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="line-clamp-3 font-semibold">{entries.map((e) => e.name).join(", ")}</p>
            <div className="mt-1.5">
              <Pills n={totalOf(entries)} />
            </div>
          </div>
          <QuickAddButton label="Quick add same as yesterday" added={quick.added} onClick={quick.run} />
        </div>
        {quick.error && (
          <p role="alert" className="mt-2 rounded-xl bg-error-subtle px-3 py-1.5 text-sm text-error">
            {quick.error}
          </p>
        )}
      </div>
    </section>
  );
}

// The title: the meal as a dropdown (changes where food goes), the day under it
function MealTitle({ meal, day, onPick }: { meal: Meal; day: string; onPick: (m: Meal) => void }) {
  const { user } = useSession();
  const [open, setOpen] = useState(false);
  const short = new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
  const when = day === todayIn(user.timezone) ? `Today, ${short}` : dayLabel(day);
  const choose = (m: Meal) => {
    onPick(m);
    setOpen(false);
  };
  return (
    <div className="relative text-center">
      <h2 className="text-xl font-bold">
        <button type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1 rounded-full px-2 hover:bg-pressed">
          {MEAL_NAMES[meal]}
          <ChevronDown aria-hidden="true" className="size-5" />
        </button>
      </h2>
      <p className="text-sm text-subtle">{when}</p>
      {open && (
        <ul role="listbox" aria-label="Meal" className="absolute top-full left-1/2 z-10 mt-1 w-56 -translate-x-1/2 rounded-2xl border border-line bg-container p-1 text-left shadow-lg">
          {MEALS.map((m) => (
            <li
              key={m}
              role="option"
              aria-selected={m === meal}
              tabIndex={0}
              onClick={() => choose(m)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), choose(m))}
              className={`cursor-pointer rounded-xl px-3 py-2 font-semibold hover:bg-pressed ${m === meal ? "text-link" : ""}`}
            >
              {MEAL_NAMES[m]}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// One sheet for finding a food (same as yesterday, recently tracked for this meal, search, barcode,
// describe it, create) and tracking it. Quick add (+) logs as shown and keeps the sheet open.
export default function AddFoodSheet({ day, meal: initialMeal, onClose }: { day: string; meal: Meal; onClose: () => void }) {
  const [meal, setMeal] = useState<Meal>(initialMeal);
  const [view, setView] = useState<View>({ k: "search" });
  const [query, setQuery] = useState("");
  const [barcodeOpen, setBarcodeOpen] = useState(false);
  const [code, setCode] = useState("");
  const codeRef = useRef<HTMLInputElement>(null);
  const [found, setFound] = useState<Found | null>(null);
  const [recent, setRecent] = useState<RecentFood[]>([]);
  const [yesterday, setYesterday] = useState<LogEntry[]>([]);
  const [describe, setDescribe] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [attempt, setAttempt] = useState(0); // "Try again" re-runs the lookup

  useEffect(() => {
    let live = true;
    setRecent([]);
    api<{ foods: RecentFood[] }>("GET", `/api/foods/recent?meal=${meal}`).then((r) => live && setRecent(r.foods), () => {});
    return () => void (live = false);
  }, [meal]);

  useEffect(() => {
    let live = true;
    api<Day>("GET", `/api/day/${addDays(day, -1)}`).then((d) => live && setYesterday(d.entries), () => {});
    return () => void (live = false);
  }, [day]);

  useEffect(() => {
    if (barcodeOpen) codeRef.current?.focus();
  }, [barcodeOpen]);

  // Debounced (250 ms) search or barcode lookup
  const lookup = barcodeOpen && code.trim() ? code : query;
  useEffect(() => {
    const q = lookup.trim();
    const code = barcodeLike(q) ? barcodeDigits(q) : null;
    if (barcodeLike(q) ? !code : q.length < 2) return setFound(null);
    let live = true;
    const t = setTimeout(async () => {
      try {
        const out: Found = code
          ? { kind: "barcode", ...(await api<{ code: string; food: FoodResult | null; errors?: SourceError[] }>("GET", `/api/foods/barcode/${code}`)) }
          : { kind: "search", ...(await api<{ groups: Group[]; errors: { source: string; message: string }[] }>("GET", `/api/foods/search?q=${encodeURIComponent(q)}`)) };
        if (live) {
          setFound(out);
          setMsg(null);
        }
      } catch (e) {
        if (live) setMsg(errorMsg(e));
      }
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [lookup, attempt]);

  // The portion a food starts at: the last one used for this meal, else its own serving
  const startPortion = (food: FoodResult) => recent.find((r) => r.kind === food.kind && r.id === food.id)?.last ?? defaultPortion(food.servings);
  const pick = (food: FoodResult, initial = startPortion(food)) => setView({ k: "detail", food, initial });
  const edit = (food: FoodResult) =>
    setView({
      k: "form",
      mode: food.kind === "cache" ? { kind: "override", cacheId: food.id } : { kind: "edit", id: food.id },
      draft: draftOf(food),
      fillRef: { kind: food.kind, id: food.id },
    });

  const estimate = async () => {
    try {
      const out = await api<{ food: Omit<FoodResult, "id" | "kind"> & { category: string } }>("POST", "/api/ai/estimate", { text: describe });
      setView({ k: "form", mode: { kind: "create" }, draft: draftOf({ ...out.food, kind: "user_food", id: 0 }) });
      setMsg(null);
    } catch (e) {
      setMsg(errorMsg(e));
    }
  };

  const log = async (food: FoodResult, p: Portion) => {
    await api("POST", "/api/log", { day, meal, food: { kind: food.kind, id: food.id }, servingIndex: p.servingIndex, unit: p.unit, quantity: p.quantity, fraction: p.fraction });
    notifyDayChanged();
  };
  const copyYesterday = async (entries: LogEntry[]) => {
    await api("POST", "/api/log/move", { ids: entries.map((e) => e.id), day, meal, copy: true });
    notifyDayChanged();
  };

  const label = `Add food to ${MEAL_NAMES[meal]}`;
  const back = () => setView({ k: "search" });

  if (view.k === "detail") {
    return (
      <Sheet tall label={label} heading="Track food" onClose={onClose} onBack={back}>
        <FoodDetail
          food={view.food}
          initial={view.initial}
          submitLabel="Track"
          onEditFood={() => edit(view.food)}
          onSubmit={async (p) => {
            await log(view.food, p);
            onClose();
          }}
        />
      </Sheet>
    );
  }
  if (view.k === "form") {
    const heading = view.mode.kind === "override" ? "Correct this food" : view.mode.kind === "edit" ? "Edit food" : "New food";
    return (
      <Sheet tall label={label} heading={heading} onClose={onClose} onBack={back}>
        <FoodForm mode={view.mode} draft={view.draft} fillRef={view.fillRef} onSaved={(f) => pick(f, defaultPortion(f.servings))} />
      </Sheet>
    );
  }
  if (view.k === "describe") {
    return (
      <Sheet tall label={label} heading="Describe it" onClose={onClose} onBack={back}>
        <div className="flex flex-col gap-3">
          <textarea aria-label="Describe the food" autoFocus rows={3} placeholder="A large banana" value={describe} onChange={(e) => setDescribe(e.target.value)} className={field} />
          <Notice msg={msg} />
          <button type="button" disabled={!describe.trim()} onClick={estimate} className={`${primaryButton} self-start`}>
            Estimate
          </button>
        </div>
      </Sheet>
    );
  }

  const row = (f: FoodResult, p: Portion) => (
    <FoodRow
      key={`${f.kind}${f.id}`}
      name={f.name}
      icon={f.icon}
      imageUrl={f.imageUrl}
      amount={amountOf(f.servings, p)}
      brand={f.brand}
      nutrients={nutrientsFor(f, p)}
      onOpen={() => pick(f, p)}
      onQuickAdd={() => log(f, p)}
    />
  );
  const sameMeal = yesterday.filter((e) => e.meal === meal);

  return (
    <Sheet tall label={label} heading={<MealTitle meal={meal} day={day} onPick={setMeal} />} onClose={onClose}>
      <div className="flex items-center gap-2">
        <input type="search" aria-label="Search foods" autoFocus placeholder="Search and track food" value={query} onChange={(e) => setQuery(e.target.value)} className={`${field} mt-0 flex-1 rounded-full`} />
        <button
          type="button"
          aria-label="Barcode"
          aria-pressed={barcodeOpen}
          onClick={() => setBarcodeOpen((o) => !o)}
          className={`flex size-11 shrink-0 items-center justify-center rounded-full border border-line ${barcodeOpen ? "bg-active text-link" : "text-ink hover:bg-pressed"}`}
        >
          <ScanBarcode aria-hidden="true" className="size-5" />
        </button>
      </div>
      {barcodeOpen && (
        <input
          ref={codeRef}
          type="text"
          inputMode="numeric"
          aria-label="Barcode number"
          placeholder="Type the barcode number"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className={`${field} mt-2 tabular`}
        />
      )}
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={() => setView({ k: "describe" })} className={`${secondaryButton} inline-flex items-center gap-1.5 px-4 py-1.5 text-sm`}>
          <Sparkles className="size-4" /> Describe it
        </button>
        <button type="button" onClick={() => setView({ k: "form", mode: { kind: "create" }, draft: emptyDraft() })} className={`${secondaryButton} inline-flex items-center gap-1.5 px-4 py-1.5 text-sm`}>
          <Plus className="size-4" /> Create food
        </button>
      </div>
      <Notice msg={msg} />
      {!found && (
        <>
          {sameMeal.length > 0 && <SameAsYesterday key={meal} entries={sameMeal} onAdd={() => copyYesterday(sameMeal)} />}
          {recent.length > 0 && (
            <section aria-labelledby="recently-tracked" className="mt-4">
              <h3 id="recently-tracked" className="px-1 text-xs font-bold tracking-wide text-muted uppercase">
                Recently tracked
              </h3>
              <ul className="mt-2 flex flex-col gap-2">{recent.map((f) => row(f, f.last))}</ul>
            </section>
          )}
        </>
      )}
      {found?.kind === "barcode" &&
        (found.food ? (
          <ul className="mt-3 flex flex-col gap-2">{row(found.food, startPortion(found.food))}</ul>
        ) : (
          <div className="mt-4 flex flex-col items-start gap-2 px-2">
            {found.errors?.length ? (
              <>
                {/* a source couldn't be checked, so "not found" isn't certain: creating now could hide the real product */}
                <p className="text-subtle">
                  Couldn't check {found.errors.map((e) => (e.source === "usda" ? "USDA" : "Open Food Facts")).join(" or ")} for barcode {found.code} just now.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => setAttempt((n) => n + 1)} className={primaryButton}>
                    Try again
                  </button>
                  <button type="button" onClick={() => setView({ k: "form", mode: { kind: "create" }, draft: emptyDraft({ barcode: found.code }) })} className={secondaryButton}>
                    Create it anyway
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-subtle">Nothing has barcode {found.code} yet.</p>
                <button type="button" onClick={() => setView({ k: "form", mode: { kind: "create" }, draft: emptyDraft({ barcode: found.code }) })} className={primaryButton}>
                  Not found — create it
                </button>
              </>
            )}
          </div>
        ))}
      {found?.kind === "search" && (
        <>
          {found.groups.map((g) => (
            <section key={g.source} className="mt-3">
              <h3 className="px-1 text-xs font-bold tracking-wide text-muted uppercase">{g.label}</h3>
              <ul className="mt-2 flex flex-col gap-2">{g.foods.map((f) => row(f, startPortion(f)))}</ul>
            </section>
          ))}
          {found.groups.length === 0 && <p className="mt-4 px-2 text-subtle">No foods found. Try other words, or create it.</p>}
          {found.errors.map((e) => (
            <p key={e.source} className="mt-2 px-2 text-xs text-muted">
              {e.message}
            </p>
          ))}
        </>
      )}
    </Sheet>
  );
}
