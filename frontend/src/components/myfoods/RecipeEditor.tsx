import { useEffect, useState, type FormEvent } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { api } from "../../api";
import type { MyFood } from "../../types";
import { Field } from "../ui/Field";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { field, label as labelClass, noAutofill, primaryButton, secondaryButton } from "../ui/styles";
import { EditorHeader, FoodPicker, type EditItem, ItemList, Totals, addButton, divideNutrients, itemBody, itemFromFood, itemFromView, sumNutrients, useItems } from "./items";

// Everything the person can change, to tell whether the form differs from what was loaded
const formKey = (name: string, servings: string, weight: string, notes: string, items: EditItem[]) => JSON.stringify([name, servings, weight, notes, items.map(itemBody)]);

// New or existing recipe: name, ingredients with amounts, number of servings, weight of one serving (optional),
// notes, and live per-serving totals. Save stores the numbers; Recalculate re-reads the ingredients' foods.
export default function RecipeEditor({ id, onDone, onBack }: { id?: number; onDone: (f: MyFood) => void; onBack: () => void }) {
  const [loaded, setLoaded] = useState(id === undefined);
  const [name, setName] = useState("");
  const [servings, setServings] = useState("1");
  const [weight, setWeight] = useState("");
  const [notes, setNotes] = useState("");
  const { items, setItems, add, change, remove } = useItems();
  const [picking, setPicking] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  // The form as loaded (or as last recalculated): Recalculate works on the saved recipe, so it waits
  // until changes are saved rather than silently dropping them
  const [loadedAs, setLoadedAs] = useState<string | null>(null);

  useEffect(() => {
    if (id === undefined) return;
    let live = true;
    api<{ food: MyFood }>("GET", `/api/my-foods/${id}`).then(
      ({ food }) => {
        if (!live) return;
        setName(food.name);
        setServings(String(food.recipeServings ?? 1));
        setWeight(food.servingGrams ? String(food.servingGrams) : "");
        setNotes(food.notes ?? "");
        const loadedItems = (food.items ?? []).map(itemFromView);
        setItems(loadedItems);
        setLoadedAs(formKey(food.name, String(food.recipeServings ?? 1), food.servingGrams ? String(food.servingGrams) : "", food.notes ?? "", loadedItems));
        setLoaded(true);
      },
      (e) => live && setMsg(errorMsg(e)),
    );
    return () => void (live = false);
  }, [id, setItems]);

  const changed = loadedAs !== formKey(name, servings, weight, notes, items);
  const count = Number(servings);
  const perServing = divideNutrients(sumNutrients(items), servings.trim() && count > 0 ? count : 0);

  const recalculate = async () => {
    setMsg(null);
    try {
      const { food } = await api<{ food: MyFood }>("POST", `/api/my-foods/${id}/recalculate`);
      const fresh = (food.items ?? []).map(itemFromView);
      setItems(fresh);
      setLoadedAs(formKey(name, servings, weight, notes, fresh));
      setMsg({ ok: true, text: "Recalculated" });
    } catch (e) {
      setMsg(errorMsg(e));
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const grams = weight.trim() ? Number(weight) : null;
    if (!name.trim()) return setMsg({ ok: false, text: "Give the recipe a name" });
    if (!items.length) return setMsg({ ok: false, text: "Add at least one ingredient" });
    if (!(count > 0)) return setMsg({ ok: false, text: "The number of servings must be more than 0" });
    if (grams !== null && !(grams > 0)) return setMsg({ ok: false, text: "The weight of one serving must be more than 0 g" });
    const body = { name: name.trim(), items: items.map(itemBody), servings: count, servingGrams: grams, notes: notes.trim() || null };
    setBusy(true);
    setMsg(null);
    try {
      const out = id === undefined ? await api<{ food: MyFood }>("POST", "/api/my-foods/recipes", body) : await api<{ food: MyFood }>("PUT", `/api/my-foods/recipes/${id}`, body);
      onDone(out.food);
    } catch (err) {
      setMsg(errorMsg(err));
      setBusy(false);
    }
  };

  return (
    <div className="pt-2">
      <EditorHeader title={id === undefined ? "New recipe" : "Edit recipe"} onBack={onBack} />
      {!loaded ? (
        <Notice msg={msg} />
      ) : (
        <form onSubmit={save} className="mt-4 flex flex-col gap-3">
          <div className="rounded-2xl bg-container p-4">
            <Field label="Name" placeholder="Chili" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <section aria-labelledby="ingredients" className="flex flex-col gap-2 rounded-2xl bg-container p-4">
            <h2 id="ingredients" className="font-bold">
              Ingredients
            </h2>
            {items.length > 0 ? <ItemList label="Ingredients" items={items} onChange={change} onRemove={remove} /> : <p className="text-sm text-subtle">No ingredients yet.</p>}
            <button type="button" onClick={() => setPicking(true)} className={addButton}>
              <Plus className="size-4" /> Add ingredient
            </button>
          </section>

          <div className="grid grid-cols-2 items-end gap-3 rounded-2xl bg-container p-4">
            <label className={labelClass}>
              Number of servings
              <input {...noAutofill} aria-label="Number of servings" type="number" inputMode="decimal" min="0" step="any" value={servings} onChange={(e) => setServings(e.target.value)} className={field} />
            </label>
            <label className={labelClass}>
              Weight of one serving (g)
              <input {...noAutofill} aria-label="Weight of one serving (g)" type="number" inputMode="decimal" min="0" step="any" placeholder="Optional" value={weight} onChange={(e) => setWeight(e.target.value)} className={field} />
            </label>
            <p className="col-span-2 text-xs text-muted">With a weight you can log it in grams or ounces too; without one, by servings.</p>
          </div>

          <Totals label="Per serving" n={perServing} />

          <div className="rounded-2xl bg-container p-4">
            <label className={labelClass}>
              Notes
              <textarea {...noAutofill} aria-label="Notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className={field} />
            </label>
          </div>

          <Notice msg={msg} />
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy} className={primaryButton}>
              Save recipe
            </button>
            {id !== undefined && (
              <button type="button" disabled={changed} onClick={recalculate} className={`${secondaryButton} inline-flex items-center gap-1.5`}>
                <RefreshCw className="size-4" /> Recalculate
              </button>
            )}
          </div>
          {id !== undefined && (
            <p className="text-xs text-muted">{changed ? "Save your changes first" : "Recalculate uses the ingredients' foods as they are now, in case their numbers changed."}</p>
          )}
        </form>
      )}
      {picking && (
        <FoodPicker
          title="Add ingredient"
          // a recipe can't hold a quick meal, or itself
          allowed={(f) => f.foodKind !== "quick_meal" && !(f.kind === "user_food" && f.id === id)}
          onAdd={(f, p) => add(itemFromFood(f, p))}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}
