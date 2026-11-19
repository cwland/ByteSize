import { useEffect, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { api } from "../../api";
import type { Item, MyFood } from "../../types";
import { Field } from "../ui/Field";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { primaryButton } from "../ui/styles";
import { EditorHeader, FoodPicker, ItemList, Totals, addButton, itemBody, itemFromFood, itemFromView, sumNutrients, useItems } from "./items";

// A quick meal can hold recipes and foods, but not another quick meal
const allowed = (f: { foodKind: string }) => f.foodKind !== "quick_meal";

// New or existing quick meal: a name and foods with amounts, with the live total. Save stores it.
export default function QuickMealEditor({ id, onDone, onBack }: { id?: number; onDone: (f: MyFood) => void; onBack: () => void }) {
  const [loaded, setLoaded] = useState(id === undefined);
  const [name, setName] = useState("");
  const { items, setItems, add, change, remove } = useItems();
  const [picking, setPicking] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (id === undefined) return;
    let live = true;
    api<{ food: MyFood }>("GET", `/api/my-foods/${id}`).then(
      ({ food }) => {
        if (!live) return;
        setName(food.name);
        setItems((food.items ?? []).map(itemFromView));
        setLoaded(true);
      },
      (e) => live && setMsg(errorMsg(e)),
    );
    return () => void (live = false);
  }, [id, setItems]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setMsg({ ok: false, text: "Give the meal a name" });
    if (!items.length) return setMsg({ ok: false, text: "Add at least one food" });
    const body = { name: name.trim(), items: items.map(itemBody) };
    setBusy(true);
    setMsg(null);
    try {
      const out = id === undefined ? await api<{ food: MyFood }>("POST", "/api/my-foods/meals", body) : await api<{ food: MyFood }>("PUT", `/api/my-foods/meals/${id}`, body);
      onDone(out.food);
    } catch (err) {
      setMsg(errorMsg(err));
      setBusy(false);
    }
  };

  return (
    <div className="pt-2">
      <EditorHeader title={id === undefined ? "New quick meal" : "Edit quick meal"} onBack={onBack} />
      {!loaded ? (
        <Notice msg={msg} />
      ) : (
        <form onSubmit={save} className="mt-4 flex flex-col gap-3">
          <div className="rounded-2xl bg-container p-4">
            <Field label="Name" placeholder="Usual breakfast" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <section aria-labelledby="meal-foods" className="flex flex-col gap-2 rounded-2xl bg-container p-4">
            <h2 id="meal-foods" className="font-bold">
              Foods
            </h2>
            {items.length > 0 ? <ItemList label="Foods in this meal" items={items} onChange={change} onRemove={remove} /> : <p className="text-sm text-subtle">No foods yet.</p>}
            <button type="button" onClick={() => setPicking(true)} className={addButton}>
              <Plus className="size-4" /> Add food
            </button>
          </section>
          <Totals label="Total" n={sumNutrients(items)} />
          <Notice msg={msg} />
          <button type="submit" disabled={busy} className={`${primaryButton} self-start`}>
            Save meal
          </button>
        </form>
      )}
      {picking && <FoodPicker title="Add food" allowed={allowed} onAdd={(f, p) => add(itemFromFood(f, p))} onClose={() => setPicking(false)} />}
    </div>
  );
}

// Add Food › a quick meal: its foods to adjust (or leave out) before Track; only this log changes
export function TrackMeal({ id, onTrack }: { id: number; onTrack: (items: Item[]) => Promise<void> }) {
  const { items, setItems, change, remove } = useItems();
  const [name, setName] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    api<{ food: MyFood }>("GET", `/api/my-foods/${id}`).then(
      ({ food }) => {
        if (!live) return;
        setName(food.name);
        setItems((food.items ?? []).map(itemFromView));
      },
      (e) => live && setMsg(errorMsg(e)),
    );
    return () => void (live = false);
  }, [id, setItems]);

  const track = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await onTrack(items.map(itemBody));
    } catch (e) {
      setMsg(errorMsg(e));
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {name !== null && (
        <>
          <h3 className="text-xl font-bold">{name}</h3>
          <ItemList label="Foods in this meal" items={items} onChange={change} onRemove={items.length > 1 ? remove : undefined} />
          <Totals label="Total" n={sumNutrients(items)} />
        </>
      )}
      <Notice msg={msg} />
      {name !== null && (
        <button type="button" disabled={busy || !items.length} onClick={track} className={`${primaryButton} w-full py-3.5 text-lg`}>
          Track
        </button>
      )}
    </div>
  );
}
