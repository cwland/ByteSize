import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { api } from "../../api";
import { formatAmount } from "../../amounts";
import { amountFactor } from "../../nutrition";
import { useSession } from "../../session";
import { NUTRIENT_KEYS, type FoodRef, type FoodResult, type Item, type ItemView, type Nutrients, type Portion, type SearchResult } from "../../types";
import { fmt } from "../../units";
import AmountPicker from "../log/AmountPicker";
import FoodDetail, { nutrientsFor, startingPortion } from "../log/FoodDetail";
import FoodPic from "../log/FoodPic";
import FoodRow, { Tag, tagOf } from "../log/FoodRow";
import Pills from "../log/Pills";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { Sheet } from "../ui/Sheet";
import { field, noAutofill } from "../ui/styles";
import { IconButton } from "../ui/IconButton";

// The pieces the recipe and quick meal editors share (and Add Food's "Track meal"): an editable list of
// foods with amounts, live totals, and a food search to add one.

export type EditItem = Omit<ItemView, "nutrients" | keyof Portion> & { key: number; portion: Portion };

let nextKey = 1;
export const itemFromView = ({ nutrients: _saved, servingIndex, unit, quantity, fraction, ...rest }: ItemView): EditItem => ({
  ...rest,
  key: nextKey++,
  portion: { servingIndex, unit, quantity, fraction },
});
export const itemFromFood = (f: FoodResult, portion: Portion): EditItem => ({
  key: nextKey++,
  food: { kind: f.kind as FoodRef["kind"], id: f.id }, // FoodPicker never offers a RecipeHub recipe
  foodKind: f.foodKind,
  name: f.name,
  brand: f.brand,
  icon: f.icon,
  imageUrl: f.imageUrl,
  servings: f.servings,
  perServing: f.nutrients,
  available: true,
  portion,
});
export const itemBody = (i: EditItem): Item => ({ food: i.food, ...i.portion });

// This item's amount, worked out live from the food's per-serving numbers ({} when it can't be measured)
export const itemNutrients = (i: EditItem) => nutrientsFor({ servings: i.servings, nutrients: i.perServing }, i.portion);

// This item's amount, unrounded ({} when it can't be measured): totals add these and round once, like the server
function exactNutrients(i: EditItem): Nutrients {
  try {
    const f = amountFactor(i.servings, i.portion.servingIndex, i.portion.unit, i.portion.quantity) * i.portion.fraction;
    return Object.fromEntries(Object.entries(i.perServing).filter(([, v]) => typeof v === "number").map(([k, v]) => [k, (v as number) * f]));
  } catch {
    return {};
  }
}

// The exact sum of the items, to show (rounded only when shown); a nutrient an item doesn't say adds as 0
// (§31). No items: 0. (What's saved is the server's own sum.)
export function sumNutrients(items: EditItem[]): Nutrients {
  const each = items.map(exactNutrients);
  const out: Nutrients = {};
  for (const k of NUTRIENT_KEYS) out[k] = each.reduce((s, n) => s + (n[k] ?? 0), 0);
  return out;
}
export const divideNutrients = (n: Nutrients, by: number): Nutrients => (by > 0 ? Object.fromEntries(Object.entries(n).map(([k, v]) => [k, (v as number) / by])) : {});

const one = (v: number) => (Math.round(v * 10) / 10).toLocaleString("en-US");
const ROWS: [keyof Nutrients, string, (v: number) => string][] = [
  ["calories", "Calories", fmt],
  ["protein_g", "Protein", (v) => `${one(v)} g`],
  ["fiber_g", "Fiber", (v) => `${one(v)} g`],
  ["carbs_g", "Carbs", (v) => `${one(v)} g`],
  ["fat_g", "Fat", (v) => `${one(v)} g`],
];

// Live totals (a value not said is 0, §31)
export function Totals({ label, n }: { label: string; n: Nutrients }) {
  return (
    <section aria-label={label} className="rounded-2xl border border-line px-4 py-2">
      <h3 className="py-1 text-sm font-bold">{label}</h3>
      <div className="divide-y divide-line">
        {ROWS.map(([k, name, show]) => {
          const v = n[k];
          return (
            <p key={k} className="flex items-center justify-between py-2 text-sm">
              <span>{name}</span>
              <span className="font-semibold tabular">{show(v ?? 0)}</span>
            </p>
          );
        })}
      </div>
    </section>
  );
}

// The foods with their amounts: tap an amount to change it (one picker open at a time), the bin to remove
export function ItemList({ label, items, onChange, onRemove }: { label: string; items: EditItem[]; onChange: (key: number, p: Portion) => void; onRemove?: (key: number) => void }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <ul aria-label={label} className="flex flex-col gap-2">
      {items.map((i) => {
        const tag = tagOf(i.foodKind);
        const amount = formatAmount(i.servings, i.portion.servingIndex, i.portion.unit, i.portion.quantity, i.portion.fraction);
        return (
          <li key={i.key} className="rounded-2xl bg-pressed p-3">
            <div className="flex items-center gap-3">
              <FoodPic icon={i.icon} imageUrl={i.imageUrl} />
              <div className="min-w-0 flex-1">
                <p className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate font-semibold">{i.name}</span>
                  {tag && <Tag text={tag} />}
                </p>
                <button
                  type="button"
                  aria-expanded={open === i.key}
                  onClick={() => setOpen((o) => (o === i.key ? null : i.key))}
                  className="inline-flex items-center gap-1 rounded-full text-sm font-semibold text-link"
                >
                  {amount}
                  {open === i.key ? <ChevronUp aria-hidden="true" className="size-4" /> : <ChevronDown aria-hidden="true" className="size-4" />}
                </button>
                <div className="mt-1">
                  <Pills n={itemNutrients(i)} />
                </div>
              </div>
              {onRemove && (
                <IconButton label={`Remove ${i.name}`} onClick={() => onRemove(i.key)} className="flex size-9 shrink-0 items-center justify-center rounded-full text-subtle hover:bg-strong hover:text-error">
                  <Trash2 className="size-5" />
                </IconButton>
              )}
            </div>
            {!i.available && <p className="mt-2 text-xs text-muted">No longer in your foods — using its saved values</p>}
            {open === i.key && (
              <div className="mt-3">
                <AmountPicker servings={i.servings} portion={i.portion} onChange={(p) => onChange(i.key, p)} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// Changing and removing items in a list held in state
export function useItems(initial: EditItem[] = []) {
  const [items, setItems] = useState<EditItem[]>(initial);
  return {
    items,
    setItems,
    add: (i: EditItem) => setItems((xs) => [...xs, i]),
    change: (key: number, portion: Portion) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, portion } : x))),
    remove: (key: number) => setItems((xs) => xs.filter((x) => x.key !== key)),
  };
}

// A food search to add one item: tap a food to choose its amount, or + to add it at its usual amount.
// `allowed` drops foods that can't go in (a quick meal can't hold a quick meal; nor can a recipe).
export function FoodPicker({ title, allowed, onAdd, onClose }: { title: string; allowed: (f: FoodResult) => boolean; onAdd: (f: FoodResult, p: Portion) => void; onClose: () => void }) {
  const units = useSession().user?.units ?? "imperial";
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<SearchResult | null>(null);
  const [picked, setPicked] = useState<FoodResult | null>(null);
  const [msg, setMsg] = useState<Msg>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return setFound(null);
    let live = true;
    const t = setTimeout(async () => {
      try {
        const out = await api<SearchResult>("GET", `/api/foods/search?q=${encodeURIComponent(q)}`);
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

  if (picked) {
    return (
      <Sheet tall label={title} heading="Choose an amount" onClose={onClose} onBack={() => setPicked(null)}>
        <FoodDetail
          food={picked}
          initial={startingPortion(picked, units)}
          submitLabel="Add"
          onSubmit={async (p) => {
            onAdd(picked, p);
            onClose();
          }}
        />
      </Sheet>
    );
  }

  const groups = (found?.groups ?? []).map((g) => ({ ...g, foods: g.foods.filter((f) => f.kind !== "culury" && allowed(f)) })).filter((g) => g.foods.length);
  return (
    <Sheet
      tall
      label={title}
      onClose={onClose}
      bodyLabel="Foods"
      top={
        <>
          <input {...noAutofill} type="search" aria-label="Search foods" autoFocus placeholder="Search foods" value={query} onChange={(e) => setQuery(e.target.value)} className={`${field} mt-0 rounded-full`} />
          <Notice msg={msg} />
        </>
      }
    >
      {!found && <p className="mt-4 px-2 text-subtle">Search for a food to add.</p>}
      {found &&
        groups.map((g) => (
          <section key={g.source} className="mt-3">
            <h3 className="px-1 text-xs font-bold tracking-wide text-muted uppercase">{g.label}</h3>
            <ul className="mt-2 flex flex-col gap-2">
              {g.foods.map((f) => {
                const p = startingPortion(f, units);
                return (
                  <FoodRow
                    key={`${f.kind}${f.id}`}
                    name={f.name}
                    icon={f.icon}
                    imageUrl={f.imageUrl}
                    brand={f.brand}
                    tag={tagOf(f.foodKind)}
                    amount={formatAmount(f.servings, p.servingIndex, p.unit, p.quantity, p.fraction)}
                    nutrients={nutrientsFor(f, p)}
                    onOpen={() => setPicked(f)}
                    onQuickAdd={async () => onAdd(f, p)}
                  />
                );
              })}
            </ul>
          </section>
        ))}
      {found && groups.length === 0 && <p className="mt-4 px-2 text-subtle">No foods found. Try other words.</p>}
    </Sheet>
  );
}

// A page inside My Foods: "‹ My Foods" and the page's title
export function EditorHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <>
      <button type="button" onClick={onBack} className="inline-flex items-center rounded-full py-1 pr-3 text-sm font-semibold text-link hover:bg-pressed">
        ‹ My Foods
      </button>
      <h1 className="mt-2 px-1 text-2xl font-bold">{title}</h1>
    </>
  );
}

export const addButton = "inline-flex items-center gap-1.5 self-start rounded-full bg-pressed px-4 py-2 text-sm font-semibold text-ink hover:bg-strong";
