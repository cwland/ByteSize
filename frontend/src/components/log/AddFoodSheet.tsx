import { useEffect, useRef, useState } from "react";
import { CalendarDays, Camera, ChevronDown, Plus, ScanBarcode, Sparkles, Utensils } from "lucide-react";
import { ApiError, api } from "../../api";
import { formatAmount } from "../../amounts";
import { notifyDayChanged } from "../../day";
import { MEALS, MEAL_NAMES } from "../../meals";
import { addDays, dayLabel, todayIn } from "../../selectedDay";
import { useSession } from "../../session";
import type { CuluryLink, CuluryRecipe, Day, FoodResult, Item, LogEntry, Meal, Nutrients, PhotoDraft, PhotoMode, Portion, RecentFood, RestaurantStatus, SearchResult, SourceError } from "../../types";
import FoodForm, { draftOf, emptyDraft, type FoodDraft, type FoodFormMode } from "./FoodForm";
import FoodDetail, { nutrientsFor, startingPortion } from "./FoodDetail";
import FoodRow, { QuickAddButton, tagOf, useQuickAdd } from "./FoodRow";
import { SavedCopyNote } from "./SavedCopy";
import { TrackMeal } from "../myfoods/QuickMealEditor";
import Pills from "./Pills";
import { NothingFrom, SourcePills, useSourceChoice, viewOf } from "./SourcePills";
import MealPlanView from "./MealPlanView";
import CuluryTrack from "./CuluryTrack";
import RestaurantsView, { newRestaurantsMemo } from "./RestaurantsView";
import PhotoPicker, { MAX_PHOTOS, analyzePhotos, usePhotoInput } from "./PhotoPicker";
import FoodPic from "./FoodPic";
import { AiWorking, useEstimate, type Estimate } from "./useEstimate";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { Sheet } from "../ui/Sheet";
import { field, primaryButton, secondaryButton } from "../ui/styles";

type Found = ({ kind: "search" } & SearchResult) | { kind: "barcode"; code: string; food: FoodResult | null; errors?: SourceError[] };
type View =
  | { k: "search" }
  // guess: the AI's estimate when it assumed what was meant ("Did you mean Cheerios?"), waiting for Yes or No
  | { k: "describe"; from?: "restaurants"; guess?: Estimate }
  | { k: "photo"; files: File[]; mode: PhotoMode }
  // photos: the photo(s) a label draft was read from, so a barcode photo can still be added
  // barcodeFill: the barcode a barcode photo added to that draft found, merged into the form as it stands
  // from: where Back goes (a restaurant item's Track food and Edit food go back to Restaurants)
  | { k: "form"; mode: FoodFormMode; draft: FoodDraft; fillRef?: { kind: "cache" | "user_food"; id: number }; photos?: File[]; barcodeFill?: string; from?: "restaurants" }
  | { k: "detail"; food: FoodResult; initial: Portion; from?: "restaurants" }
  | { k: "restaurants" }
  | { k: "meal"; food: FoodResult } // a quick meal: adjust its foods, then Track
  | { k: "plan" } // Culury's meal plan
  | { k: "culury"; recipe: CuluryRecipe; from: CuluryFrom; initial: Portion; stale?: boolean }; // a Culury recipe, read live
type CuluryFrom = "plan" | "search" | "recent";
const ONE_SERVING: Portion = { servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 };

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

// A label draft from a photo as the New food form's draft: AI-estimated values, the photo to link on Save
const photoDraft = (d: PhotoDraft): FoodDraft => ({ ...draftOf(d), photoId: d.photoId });

// "Add a barcode photo" over a label draft that has no barcode: the barcode photo is sent alone (mode
// barcode) and only the barcode it finds goes into the form, so the person's edits to the draft stay
function AddBarcodePhoto({ onBarcode }: { onBarcode: (code: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const photo = usePhotoInput(async (f) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await analyzePhotos([f], "barcode");
      if (r.barcode) onBarcode(r.barcode);
      else setMsg({ ok: false, text: "No barcode found in that photo" });
    } catch (e) {
      setMsg(errorMsg(e));
    } finally {
      setBusy(false);
    }
  });
  return (
    <div className="mb-3 flex flex-col gap-2 rounded-2xl bg-pressed px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {photo.input}
        <span className="flex-1 text-subtle">Has a barcode? Add its photo so scanning finds this food next time.</span>
        <button type="button" disabled={busy} onClick={photo.open} className="rounded-full px-2 py-1 font-semibold text-link hover:bg-strong">
          {busy ? "Reading your photo…" : "Add a barcode photo"}
        </button>
      </div>
      <Notice msg={msg} />
    </div>
  );
}

// One sheet for finding a food (same as yesterday, recently tracked for this meal, search, barcode,
// photo, describe it, create) and tracking it. Quick add (+) logs as shown and keeps the sheet open.
// photo: a photo already chosen (Dashboard's Photo button) opens straight on the photo step with it.
// start: the view to open on (the wide Dashboard's quick buttons): a barcode or label photo, or Restaurants.
export type AddFoodStart = "search" | "barcode" | "label" | "restaurants";
export default function AddFoodSheet({ day, meal: initialMeal, photo, start = "search", onClose }: { day: string; meal: Meal; photo?: File; start?: AddFoodStart; onClose: () => void }) {
  const { user } = useSession();
  const units = user?.units ?? "imperial";
  const sources = useSourceChoice(user.id);
  const [meal, setMeal] = useState<Meal>(initialMeal);
  const [view, setView] = useState<View>(() => {
    if (photo) return { k: "photo", files: [photo], mode: "auto" };
    if (start === "barcode" || start === "label") return { k: "photo", files: [], mode: start };
    return start === "restaurants" ? { k: "restaurants" } : { k: "search" };
  });
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
  const [culury, setCulury] = useState(false); // on and linked: the Meal plan button shows
  const [opening, setOpening] = useState<number | null>(null); // the Culury recipe a row is opening
  const viewSeq = useRef(0); // bumps on every view change, so a late Culury answer can tell it's stale
  useEffect(() => void viewSeq.current++, [view]);

  useEffect(() => {
    api<CuluryLink>("GET", "/api/settings/culury").then((l) => setCulury(l.enabled && !!l.url && l.hasKey), () => {});
  }, []);

  const [restaurants, setRestaurants] = useState<RestaurantStatus | null>(null);
  const restaurantsMemo = useRef(newRestaurantsMemo());

  useEffect(() => void api<RestaurantStatus>("GET", "/api/restaurants/status").then(setRestaurants, () => {}), []);

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
          : { kind: "search", ...(await api<SearchResult>("GET", `/api/foods/search?q=${encodeURIComponent(q)}`)) };
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

  // The portion a food starts at: the last one used for this meal, else its own serving (a recipe: 1 serving)
  const startPortion = (food: FoodResult) => recent.find((r) => r.kind === food.kind && r.id === food.id)?.last ?? startingPortion(food, units);
  // A Culury recipe is read live: from Recently tracked at its last portion, and when Culury can't answer
  // (anything but "not found") from the saved copy; from the plan or search at 1 serving. An answer that
  // arrives after the person moved to another view is dropped.
  const openCulury = async (id: number, from: CuluryFrom, saved?: RecentFood) => {
    const seq = viewSeq.current;
    const initial = saved?.last ?? ONE_SERVING;
    let next: View;
    try {
      next = { k: "culury", recipe: await api<CuluryRecipe>("GET", `/api/culury/recipes/${id}`), from, initial };
    } catch (e) {
      if (!saved || (e instanceof ApiError && e.status === 404)) {
        if (seq === viewSeq.current) throw e;
        return;
      }
      const { last: _last, ...food } = saved;
      next = { k: "culury", recipe: { food, hasNutrition: true, outdated: false }, from, initial, stale: true };
    }
    if (seq === viewSeq.current) setView(next);
  };
  const openRow = async (food: FoodResult, saved?: RecentFood) => {
    setOpening(food.id);
    try {
      await openCulury(food.id, saved ? "recent" : "search", saved);
    } finally {
      setOpening(null);
    }
  };
  const pick = (food: FoodResult, initial = startPortion(food), from?: "restaurants") => {
    if (food.kind === "culury") return void openRow(food).catch((e) => setMsg(errorMsg(e)));
    // A FatSecret search summary: the whole food (fiber, the serving's weight…) is fetched once before it opens
    if (food.summary)
      return void api<{ food: FoodResult }>("GET", `/api/foods/cache/${food.id}`).then(
        ({ food: whole }) => {
          checked(whole);
          setView({ k: "detail", food: whole, initial: startPortion(whole), from });
        },
        (e) => setMsg(errorMsg(e)),
      );
    setView(food.foodKind === "quick_meal" ? { k: "meal", food } : { k: "detail", food, initial, from });
  };
  const edit = (food: FoodResult, from?: "restaurants") =>
    setView({
      from,
      k: "form",
      mode: food.kind === "cache" ? { kind: "override", cacheId: food.id } : { kind: "edit", id: food.id },
      draft: draftOf(food),
      fillRef: { kind: food.kind as "cache" | "user_food", id: food.id }, // never a Culury recipe (its own view)
    });

  const estimating = useEstimate();
  const estimate = async (from?: "restaurants") => {
    setMsg(null);
    try {
      const out = await estimating.run(describe);
      if (!out) return; // cancelled
      setView(out.assumed ? { k: "describe", from, guess: out } : { k: "form", mode: { kind: "create" }, draft: draftOf(out.food) });
    } catch (e) {
      setMsg(errorMsg(e));
    }
  };

  // A quick meal logs one entry per food (its items as saved, or as adjusted)
  const logMeal = async (food: FoodResult, items?: Item[]) => {
    await api("POST", "/api/log/meal", { day, meal, foodId: food.id, ...(items ? { items } : {}) });
    notifyDayChanged();
  };
  // estimate: per-serving AI nutrients for a Culury recipe that has none
  const log = async (food: FoodResult, p: Portion, estimate?: Nutrients) => {
    if (food.foodKind === "quick_meal") return logMeal(food);
    await api("POST", "/api/log", { day, meal, food: { kind: food.kind, id: food.id }, servingIndex: p.servingIndex, unit: p.unit, quantity: p.quantity, fraction: p.fraction, ...(estimate ? { nutrients: estimate } : {}) });
    notifyDayChanged();
  };
  const copyYesterday = async (entries: LogEntry[]) => {
    await api("POST", "/api/log/move", { ids: entries.map((e) => e.id), day, meal, copy: true });
    notifyDayChanged();
  };

  // A kept copy checked for changes: the search results show it as it is now
  const checked = (food: FoodResult) =>
    setFound((fd) => {
      const same = (f: FoodResult) => (f.kind === food.kind && f.id === food.id ? food : f);
      if (fd?.kind === "search") return { ...fd, groups: fd.groups.map((g) => ({ ...g, foods: g.foods.map(same) })) };
      return fd?.kind === "barcode" && fd.food ? { ...fd, food: same(fd.food) } : fd;
    });

  const label = `Add food to ${MEAL_NAMES[meal]}`;
  const back = () => setView((view.k === "detail" || view.k === "form" || view.k === "describe") && view.from ? { k: view.from } : { k: "search" });

  if (view.k === "detail") {
    return (
      <Sheet tall label={label} heading="Track food" onClose={onClose} onBack={back}>
        <FoodDetail
          food={view.food}
          initial={view.initial}
          submitLabel="Track"
          note={<SavedCopyNote food={view.food} onChecked={(food) => (setView({ ...view, food }), checked(food))} />}
          // recipes are changed in their own editor in My Foods
          onEditFood={view.food.foodKind === "recipe" ? undefined : () => edit(view.food, view.from)}
          onSubmit={async (p) => {
            await log(view.food, p);
            onClose();
          }}
        />
      </Sheet>
    );
  }
  if (view.k === "plan") {
    return (
      <Sheet tall label={label} heading="Meal plan" onClose={onClose} onBack={back}>
        <MealPlanView day={day} meal={meal} onOpen={(id) => openCulury(id, "plan")} />
      </Sheet>
    );
  }
  if (view.k === "culury") {
    return (
      <Sheet tall label={label} heading="Track food" onClose={onClose} onBack={() => setView(view.from === "plan" ? { k: "plan" } : { k: "search" })}>
        <CuluryTrack
          recipe={view.recipe}
          initial={view.initial}
          stale={view.stale}
          onTrack={async (p, estimate) => {
            await log(view.recipe.food, p, estimate);
            onClose();
          }}
        />
      </Sheet>
    );
  }
  // No restaurant source set up (the wide Dashboard's Restaurants button): the search, which says how to add one
  if (view.k === "restaurants" && restaurants?.sources.length) {
    return (
      <RestaurantsView label={label} onClose={onClose} onBack={back} status={restaurants} memo={restaurantsMemo.current} onDescribe={() => setView({ k: "describe", from: "restaurants" })} onPick={(food) => pick(food, undefined, "restaurants")} />
    );
  }
  if (view.k === "meal") {
    return (
      <Sheet tall label={label} heading="Track meal" onClose={onClose} onBack={back}>
        <TrackMeal
          id={view.food.id}
          onTrack={async (items) => {
            await logMeal(view.food, items);
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
        {view.photos && view.photos.length < MAX_PHOTOS && !view.draft.barcode && !view.barcodeFill && <AddBarcodePhoto onBarcode={(code) => setView({ ...view, barcodeFill: code })} />}
        <FoodForm mode={view.mode} draft={view.draft} fillRef={view.fillRef} barcodeFill={view.barcodeFill} onSaved={(f) => pick(f, startingPortion(f, units), view.from)} />
      </Sheet>
    );
  }
  if (view.k === "photo") {
    return (
      <Sheet tall label={label} heading="Photo" onClose={onClose} onBack={back}>
        <PhotoPicker
          files={view.files}
          mode={view.mode}
          onSend={(files, mode) => setView({ k: "photo", files, mode })}
          onFood={(food) => pick(food)}
          onDraft={(d, files) => setView({ k: "form", mode: { kind: "create" }, draft: photoDraft(d), photos: files })}
          onCreate={(barcode) => setView({ k: "form", mode: { kind: "create" }, draft: emptyDraft({ barcode }) })}
        />
      </Sheet>
    );
  }
  if (view.k === "describe" && view.guess) {
    const { food, interpretedAs } = view.guess;
    return (
      <Sheet tall label={label} heading="Describe it" onClose={onClose} onBack={back}>
        <div className="flex flex-col gap-3">
          <h3 className="text-lg font-bold">Did you mean {interpretedAs ?? food.name}?</h3>
          <div className="flex items-center gap-3 rounded-2xl bg-pressed p-3">
            <FoodPic icon={food.icon} imageUrl={food.imageUrl} />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{food.name}</p>
              <p className="text-sm text-subtle">{[food.brand, food.servings[0]?.label].filter(Boolean).join(" · ")}</p>
              <div className="mt-1.5">
                <Pills n={food.nutrients} />
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setView({ k: "form", mode: { kind: "create" }, draft: draftOf(food) })} className={primaryButton}>
              Yes
            </button>
            <button type="button" onClick={() => setView({ k: "describe", from: view.from })} className={secondaryButton}>
              No, change it
            </button>
          </div>
        </div>
      </Sheet>
    );
  }
  if (view.k === "describe") {
    const from = view.from;
    return (
      <Sheet tall label={label} heading="Describe it" onClose={onClose} onBack={back}>
        <div className="flex flex-col gap-3">
          <textarea aria-label="Describe the food" autoFocus rows={3} placeholder="A large banana" value={describe} onChange={(e) => setDescribe(e.target.value)} className={field} />
          <Notice msg={msg} />
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" disabled={!describe.trim() || !!estimating.step} onClick={() => void estimate(from)} className={primaryButton}>
              Estimate
            </button>
            <AiWorking step={estimating.step} onCancel={estimating.cancel} />
          </div>
        </div>
      </Sheet>
    );
  }

  // saved: the row is from Recently tracked. A Culury row with no nutrition opens on + too (to offer the estimate).
  // A found food (search or barcode) that is a kept copy says so, with Check for changes.
  const culuryRow = (f: FoodResult) => f.kind === "culury";
  const row = (f: FoodResult, p: Portion, saved?: RecentFood) => (
    <FoodRow
      key={`${f.kind}${f.id}`}
      name={f.name}
      icon={f.icon}
      imageUrl={f.imageUrl}
      amount={amountOf(f.servings, p)}
      brand={f.brand}
      tag={f.kind === "culury" ? "Culury" : tagOf(f.foodKind)}
      nutrients={nutrientsFor(f, p)}
      busy={culuryRow(f) && opening === f.id}
      onOpen={() => (culuryRow(f) ? void openRow(f, saved).catch((e) => setMsg(errorMsg(e))) : pick(f, p))}
      onQuickAdd={() => (culuryRow(f) && !Object.keys(f.nutrients).length ? openRow(f, saved) : log(f, p))}
      note={saved ? undefined : <SavedCopyNote food={f} onChecked={checked} />}
    />
  );
  const sameMeal = yesterday.filter((e) => e.meal === meal);

  return (
    <Sheet
      tall
      label={label}
      heading={<MealTitle meal={meal} day={day} onPick={setMeal} />}
      onClose={onClose}
      bodyLabel="Foods"
      top={
        <>
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
        <button
          type="button"
          aria-label="Photo"
          title="Photo of a barcode or nutrition label"
          onClick={() => setView({ k: "photo", files: [], mode: "auto" })}
          className="flex size-11 shrink-0 items-center justify-center rounded-full border border-line text-ink hover:bg-pressed"
        >
          <Camera aria-hidden="true" className="size-5" />
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
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => setView({ k: "describe" })} className={`${secondaryButton} inline-flex items-center gap-1.5 px-4 py-1.5 text-sm`}>
          <Sparkles className="size-4" /> Describe it
        </button>
        <button type="button" onClick={() => setView({ k: "form", mode: { kind: "create" }, draft: emptyDraft() })} className={`${secondaryButton} inline-flex items-center gap-1.5 px-4 py-1.5 text-sm`}>
          <Plus className="size-4" /> Create food
        </button>
        {culury && (
          <button type="button" onClick={() => setView({ k: "plan" })} className={`${secondaryButton} inline-flex items-center gap-1.5 px-4 py-1.5 text-sm`}>
            <CalendarDays className="size-4" /> Meal plan
          </button>
        )}
        {!!restaurants?.sources.length && (
          <button type="button" onClick={() => setView({ k: "restaurants" })} className={`${secondaryButton} inline-flex items-center gap-1.5 px-4 py-1.5 text-sm`}>
            <Utensils className="size-4" /> Restaurants
          </button>
        )}
      </div>
      {restaurants?.sources.length === 0 && (
        <p className="mt-2 px-1 text-xs text-muted">{restaurants.turnedOff
            ? user?.isAdmin
              ? "Turn on FatSecret or Spoonacular in Settings › Integrations."
              : "Ask an admin to turn on restaurant menus."
            : user?.isAdmin
              ? "Add a restaurant data key in Settings › Integrations to search restaurant menus."
              : "Ask an admin to add a restaurant data key to search restaurant menus."}</p>
      )}
      <Notice msg={msg} />
        </>
      }
    >
      {!found && (
        <>
          {sameMeal.length > 0 && <SameAsYesterday key={meal} entries={sameMeal} onAdd={() => copyYesterday(sameMeal)} />}
          {recent.length > 0 && (
            <section aria-labelledby="recently-tracked" className="mt-4">
              <h3 id="recently-tracked" className="px-1 text-xs font-bold tracking-wide text-muted uppercase">
                Recently tracked
              </h3>
              <ul className="mt-2 flex flex-col gap-2">{recent.map((f) => row(f, f.last, f))}</ul>
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
                  Couldn't check {found.errors.map((e) => (e.source === "usda" ? "USDA" : e.source === "fatsecret" ? "FatSecret" : "Open Food Facts")).join(" or ")} for barcode {found.code} just now.
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
      {found?.kind === "search" && (() => {
        const seen = viewOf(found, sources.choice);
        return (
          <>
            <SourcePills pills={seen.pills} onToggle={sources.toggle} />
            {found.suggestion && (
              <p className="mt-3 px-1">
                <button type="button" onClick={() => setQuery(found.suggestion!)} className="rounded-full px-2 py-1 text-sm font-semibold text-link hover:bg-pressed">
                  Did you mean {found.suggestion}?
                </button>
              </p>
            )}
            {seen.groups.map((g) => (
              <section key={g.source} className="mt-3">
                <h3 className="px-1 text-xs font-bold tracking-wide text-muted uppercase">{g.label}</h3>
                <ul className="mt-2 flex flex-col gap-2">{g.foods.map((f) => row(f, startPortion(f)))}</ul>
              </section>
            ))}
            {seen.nothing && <NothingFrom nothing={seen.nothing} />}
            {found.groups.length === 0 && <p className="mt-4 px-2 text-subtle">No foods found. Try other words, or create it.</p>}
            {seen.errors.map((e) => (
              <p key={e.source} className="mt-2 px-2 text-xs text-muted">
                {e.message}
              </p>
            ))}
          </>
        );
      })()}
    </Sheet>
  );
}
