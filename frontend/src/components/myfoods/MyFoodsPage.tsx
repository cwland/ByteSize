import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api } from "../../api";
import { myFoodsFrom, useHash } from "../../routes";
import type { FoodResult } from "../../types";
import FoodForm, { draftOf, emptyDraft } from "../log/FoodForm";
import FoodPic from "../log/FoodPic";
import { Tag, tagOf } from "../log/FoodRow";
import Pills from "../log/Pills";
import { Choice } from "../ui/Choice";
import { Confirm } from "../ui/Confirm";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { field } from "../ui/styles";
import { EditorHeader, addButton } from "./items";
import QuickMealEditor from "./QuickMealEditor";
import RecipeEditor from "./RecipeEditor";

type Kind = "all" | "foods" | "recipes" | "meals";
type Sort = "recent" | "used" | "az";
type View = { k: "list" } | { k: "food"; food?: FoodResult } | { k: "recipe"; id?: number } | { k: "meal"; id?: number };

const KINDS: { value: Kind; label: string }[] = [
  { value: "all", label: "All" },
  { value: "foods", label: "Foods" },
  { value: "recipes", label: "Recipes" },
  { value: "meals", label: "Meals" },
];
const SORTS: { value: Sort; label: string }[] = [
  { value: "recent", label: "Recent" },
  { value: "used", label: "Most used" },
  { value: "az", label: "A–Z" },
];

// My Foods (#/log/my-foods): the person's own foods, corrections, recipes and quick meals in one list.
// Tap one to edit it; New food / New recipe / New quick meal; Back returns to where it was opened from.
export default function MyFoodsPage() {
  const from = myFoodsFrom(useHash());
  const [view, setView] = useState<View>({ k: "list" });
  const [kind, setKind] = useState<Kind>("all");
  const [sort, setSort] = useState<Sort>("recent");
  const [query, setQuery] = useState("");
  const [foods, setFoods] = useState<FoodResult[] | null>(null);
  const [reload, setReload] = useState(0);
  const [deleting, setDeleting] = useState<FoodResult | null>(null);
  const [msg, setMsg] = useState<Msg>(null);

  useEffect(() => {
    if (view.k !== "list") return;
    const q = query.trim();
    let live = true;
    // typing waits a moment (one request per pause); chips and sort ask straight away
    const t = setTimeout(
      () =>
        api<{ foods: FoodResult[] }>("GET", `/api/my-foods?kind=${kind}&sort=${sort}${q ? `&q=${encodeURIComponent(q)}` : ""}`).then(
          (r) => live && setFoods(r.foods),
          (e) => live && setMsg(errorMsg(e)),
        ),
      q ? 250 : 0,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [view.k, kind, sort, query, reload]);

  const toList = (text?: string) => {
    setView({ k: "list" });
    setMsg(text ? { ok: true, text } : null);
  };
  const saved = () => {
    toList("Saved");
    setReload((n) => n + 1);
  };
  const open = (f: FoodResult) => setView(f.foodKind === "recipe" ? { k: "recipe", id: f.id } : f.foodKind === "quick_meal" ? { k: "meal", id: f.id } : { k: "food", food: f });

  const remove = async (f: FoodResult) => {
    setDeleting(null);
    try {
      // The server deletes a food that was never logged or used ({ archived: false }) and hides one that was
      const { archived } = await api<{ archived: boolean }>("DELETE", `/api/my-foods/${f.id}`);
      setMsg({ ok: true, text: archived ? "Hidden (it's been logged)" : "Removed" });
      setReload((n) => n + 1);
    } catch (e) {
      setMsg(errorMsg(e));
    }
  };

  if (view.k === "recipe") return <RecipeEditor id={view.id} onDone={saved} onBack={() => toList()} />;
  if (view.k === "meal") return <QuickMealEditor id={view.id} onDone={saved} onBack={() => toList()} />;
  if (view.k === "food") {
    return (
      <div className="pt-2">
        <EditorHeader title={view.food ? "Edit food" : "New food"} onBack={() => toList()} />
        <div className="mt-4 rounded-2xl bg-container p-4">
          <FoodForm mode={view.food ? { kind: "edit", id: view.food.id } : { kind: "create" }} draft={view.food ? draftOf(view.food) : emptyDraft()} fillRef={view.food ? { kind: "user_food", id: view.food.id } : undefined} onSaved={saved} />
        </div>
      </div>
    );
  }

  return (
    <div className="pt-2">
      <a href={`#${from}`} className="inline-flex items-center rounded-full py-1 pr-3 text-sm font-semibold text-link hover:bg-pressed">
        ‹ Back
      </a>
      <h1 className="mt-2 px-1 text-2xl font-bold">My Foods</h1>

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => setView({ k: "food" })} className={addButton}>
          <Plus className="size-4" /> New food
        </button>
        <button type="button" onClick={() => setView({ k: "recipe" })} className={addButton}>
          <Plus className="size-4" /> New recipe
        </button>
        <button type="button" onClick={() => setView({ k: "meal" })} className={addButton}>
          <Plus className="size-4" /> New quick meal
        </button>
      </div>

      <div className="mt-3 flex flex-col gap-2">
        <input type="search" aria-label="Search my foods" placeholder="Search my foods" value={query} onChange={(e) => setQuery(e.target.value)} className={`${field} mt-0 rounded-full`} />
        <Choice label="Show" value={kind} options={KINDS} onChange={setKind} />
        <Choice label="Sort" value={sort} options={SORTS} onChange={setSort} />
      </div>

      <Notice msg={msg} />

      {foods && foods.length === 0 && <p className="mt-6 px-2 text-center text-subtle">{query.trim() ? "Nothing here matches." : "Nothing here yet. Foods, recipes and meals you make show up here."}</p>}
      {foods && foods.length > 0 && (
        <ul aria-label="My foods" className="mt-3 flex flex-col gap-2">
          {foods.map((f) => {
            const tag = tagOf(f.foodKind);
            return (
              <li key={f.id} className="flex items-center gap-1 rounded-2xl bg-container p-2">
                <button type="button" onClick={() => open(f)} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-1 py-1 text-left hover:bg-pressed">
                  <FoodPic icon={f.icon} imageUrl={f.imageUrl} />
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate font-semibold">{f.name}</span>
                      {tag && <Tag text={tag} />}
                    </span>
                    <span className="block truncate text-sm text-subtle">
                      {f.servings[0]?.label ?? ""}
                      {f.brand && ` · ${f.brand}`}
                    </span>
                    <span className="mt-1 block">
                      <Pills n={f.nutrients} />
                    </span>
                  </span>
                </button>
                <button type="button" aria-label={`Delete ${f.name}`} onClick={() => setDeleting(f)} className="flex size-10 shrink-0 items-center justify-center rounded-full text-subtle hover:bg-pressed hover:text-error">
                  <Trash2 className="size-5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {deleting && (
        <Confirm
          title={`Delete ${deleting.name}?`}
          text="If it's been logged or is part of a recipe or meal, it's hidden instead, so your log stays as it is."
          confirmLabel="Delete"
          onConfirm={() => remove(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
