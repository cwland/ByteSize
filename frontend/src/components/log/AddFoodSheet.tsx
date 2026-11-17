import { useEffect, useState } from "react";
import { Pencil, Plus, Sparkles } from "lucide-react";
import { api } from "../../api";
import { notifyDayChanged } from "../../day";
import { MEAL_NAMES } from "../../meals";
import type { FoodResult, Meal, Portion, RecentFood } from "../../types";
import { fmt } from "../../units";
import FoodForm, { draftOf, emptyDraft, type FoodDraft, type FoodFormMode } from "./FoodForm";
import PortionSheet, { defaultPortion } from "./PortionSheet";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { Sheet } from "../ui/Sheet";
import { field, primaryButton, secondaryButton } from "../ui/styles";

type Group = { source: string; label: string; foods: FoodResult[] };
type Found = { kind: "search"; groups: Group[]; errors: { source: string; message: string }[] } | { kind: "barcode"; code: string; food: FoodResult | null };
type View =
  | { k: "search" }
  | { k: "describe" }
  | { k: "form"; mode: FoodFormMode; draft: FoodDraft; fillRef?: { kind: "cache" | "user_food"; id: number } }
  | { k: "portion"; food: FoodResult; initial: Portion };

// Digits, spaces and dashes only: someone typing a barcode. Lookup only at a barcode's length.
const barcodeLike = (q: string) => /^[\d\s-]+$/.test(q);
const barcodeDigits = (q: string) => {
  const d = q.replace(/\D/g, "");
  return [8, 12, 13, 14].includes(d.length) ? d : null;
};

function FoodRow({ food, onPick, onEdit }: { food: FoodResult; onPick: () => void; onEdit?: () => void }) {
  return (
    <li className="flex items-center gap-2">
      <button type="button" onClick={onPick} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-pressed">
        {food.imageUrl ? (
          <img src={food.imageUrl} alt="" aria-hidden="true" className="size-9 shrink-0 rounded-lg object-cover" />
        ) : (
          <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center text-2xl">
            {food.icon}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{food.name}</span>
          <span className="block truncate text-sm text-subtle">
            {[food.brand, `${food.nutrients.calories === undefined ? "?" : fmt(food.nutrients.calories)} cal · ${food.servings[0]?.label ?? ""}`].filter(Boolean).join(" · ")}
          </span>
        </span>
      </button>
      {onEdit && (
        <button type="button" aria-label={`Edit ${food.name}`} title="Edit" onClick={onEdit} className="flex size-9 shrink-0 items-center justify-center rounded-full text-subtle hover:bg-pressed hover:text-ink">
          <Pencil className="size-4" />
        </button>
      )}
    </li>
  );
}

// One sheet for finding a food (recent, frequent, search, typed barcode, describe it, create) and logging it
export default function AddFoodSheet({ day, meal, onClose }: { day: string; meal: Meal; onClose: () => void }) {
  const [view, setView] = useState<View>({ k: "search" });
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const [recent, setRecent] = useState<RecentFood[]>([]);
  const [frequent, setFrequent] = useState<RecentFood[]>([]);
  const [describe, setDescribe] = useState("");
  const [msg, setMsg] = useState<Msg>(null);

  useEffect(() => {
    api<{ foods: RecentFood[] }>("GET", "/api/foods/recent").then((r) => setRecent(r.foods), () => {});
    api<{ foods: RecentFood[] }>("GET", "/api/foods/frequent").then((r) => setFrequent(r.foods), () => {});
  }, []);

  // Debounced (250 ms) search or barcode lookup
  useEffect(() => {
    const q = query.trim();
    const code = barcodeLike(q) ? barcodeDigits(q) : null;
    if (barcodeLike(q) ? !code : q.length < 2) return setFound(null);
    let live = true;
    const t = setTimeout(async () => {
      try {
        const out: Found = code
          ? { kind: "barcode", ...(await api<{ code: string; food: FoodResult | null }>("GET", `/api/foods/barcode/${code}`)) }
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
  }, [query]);

  const pick = (food: FoodResult, initial = defaultPortion(food.servings)) => setView({ k: "portion", food, initial });
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

  const log = async (food: FoodResult, p: Portion, m: Meal) => {
    await api("POST", "/api/log", { day, meal: m, food: { kind: food.kind, id: food.id }, servingIndex: p.servingIndex, unit: p.unit, quantity: p.quantity, fraction: p.fraction });
    notifyDayChanged();
    onClose();
  };

  const label = `Add food to ${MEAL_NAMES[meal]}`;
  const back = () => setView({ k: "search" });

  if (view.k === "portion") {
    return (
      <Sheet label={label} heading="Log it" onClose={onClose} onBack={back}>
        <PortionSheet food={view.food} initial={view.initial} meal={meal} submitLabel="Log" onSubmit={(p, m) => log(view.food, p, m)} />
      </Sheet>
    );
  }
  if (view.k === "form") {
    const heading = view.mode.kind === "override" ? "Correct this food" : view.mode.kind === "edit" ? "Edit food" : "New food";
    return (
      <Sheet label={label} heading={heading} onClose={onClose} onBack={back}>
        <FoodForm mode={view.mode} draft={view.draft} fillRef={view.fillRef} onSaved={(f) => pick(f)} />
      </Sheet>
    );
  }
  if (view.k === "describe") {
    return (
      <Sheet label={label} heading="Describe it" onClose={onClose} onBack={back}>
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

  const list = (title: string, foods: RecentFood[]) =>
    foods.length > 0 && (
      <section className="mt-3">
        <h3 className="px-2 text-sm font-bold text-muted uppercase">{title}</h3>
        <ul>
          {foods.map((f) => (
            <FoodRow key={`${f.kind}${f.id}`} food={f} onPick={() => pick(f, f.last)} onEdit={() => edit(f)} />
          ))}
        </ul>
      </section>
    );

  return (
    <Sheet label={label} onClose={onClose}>
      <input type="search" aria-label="Search foods" autoFocus placeholder="Search foods or type a barcode" value={query} onChange={(e) => setQuery(e.target.value)} className={field} />
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
          {list("Recent", recent)}
          {list("Frequent", frequent)}
        </>
      )}
      {found?.kind === "barcode" &&
        (found.food ? (
          <ul className="mt-3">
            <FoodRow food={found.food} onPick={() => pick(found.food!)} onEdit={() => edit(found.food!)} />
          </ul>
        ) : (
          <div className="mt-4 flex flex-col items-start gap-2 px-2">
            <p className="text-subtle">Nothing has barcode {found.code} yet.</p>
            <button type="button" onClick={() => setView({ k: "form", mode: { kind: "create" }, draft: emptyDraft({ barcode: found.code }) })} className={primaryButton}>
              Not found — create it
            </button>
          </div>
        ))}
      {found?.kind === "search" && (
        <>
          {found.groups.map((g) => (
            <section key={g.source} className="mt-3">
              <h3 className="px-2 text-sm font-bold text-muted uppercase">{g.label}</h3>
              <ul>
                {g.foods.map((f) => (
                  <FoodRow key={`${f.kind}${f.id}`} food={f} onPick={() => pick(f)} onEdit={() => edit(f)} />
                ))}
              </ul>
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
