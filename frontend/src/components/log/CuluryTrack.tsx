import { useState } from "react";
import { Sparkles } from "lucide-react";
import { api } from "../../api";
import { scaleNutrients } from "../../nutrition";
import type { CuluryRecipe, FoodResult, Nutrients, Portion } from "../../types";
import FoodDetail from "./FoodDetail";
import { Tag } from "./FoodRow";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { primaryButton } from "../ui/styles";

const ONE_SERVING: Portion = { servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 };

// The AI's estimate for one serving of the recipe: its own first serving, scaled to the recipe's serving
// weight when both are weighed
async function estimateServing(food: FoodResult): Promise<Nutrients> {
  const grams = food.servings[0]?.grams;
  const out = await api<{ food: { servings: { grams?: number }[]; nutrients: Nutrients } }>("POST", "/api/ai/estimate", { text: `1 serving of ${food.name}${grams ? ` (${grams} g)` : ""}` });
  const theirs = out.food.servings[0]?.grams;
  return grams && theirs ? scaleNutrients(out.food.nutrients, grams / theirs) : out.food.nutrients;
}

// Track food for a Culury recipe (read live from Culury, starts at 1 serving). Culury's nutrition may be
// marked out of date; with none at all, "Estimate with AI" fills it in for this entry only (logged as AI-estimated).
// initial: where the amount starts (1 serving, or the last portion from Recently tracked).
// stale: Culury couldn't answer, so this is the last logged copy (the server logs from it too).
export default function CuluryTrack({
  recipe,
  initial = ONE_SERVING,
  stale = false,
  onTrack,
}: {
  recipe: CuluryRecipe;
  initial?: Portion;
  stale?: boolean;
  onTrack: (p: Portion, estimate?: Nutrients) => Promise<void>;
}) {
  const [estimate, setEstimate] = useState<Nutrients | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const { food } = recipe;

  const runEstimate = async () => {
    setBusy(true);
    setMsg(null);
    try {
      setEstimate(await estimateServing(food));
    } catch (e) {
      setMsg(errorMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {stale && <p className="rounded-xl bg-pressed px-3 py-2 text-sm text-subtle">Culury is unavailable — using the last logged version</p>}
      {recipe.outdated && <p className="px-1 text-xs text-muted">Culury's nutrition for this recipe may be out of date.</p>}
      {!recipe.hasNutrition &&
        (estimate ? (
          <p className="flex flex-wrap items-center gap-1.5 px-1 text-sm text-subtle">
            <Tag text="AI estimate" /> The nutrition is a guess for one serving; it's logged marked as AI-estimated.
          </p>
        ) : (
          <div className="rounded-2xl bg-pressed px-3 py-2.5 text-sm">
            <p className="text-subtle">Culury has no nutrition for this recipe. Estimate it before tracking, or track it as unknown.</p>
            <button type="button" disabled={busy} onClick={() => void runEstimate()} className={`${primaryButton} mt-2 inline-flex items-center gap-1.5 text-sm`}>
              <Sparkles className="size-4" /> {busy ? "Estimating…" : "Estimate with AI"}
            </button>
            <Notice msg={msg} />
          </div>
        ))}
      <FoodDetail key={estimate ? "estimate" : "culury"} food={{ ...food, nutrients: estimate ?? food.nutrients }} initial={initial} submitLabel="Track" onSubmit={(p) => onTrack(p, estimate ?? undefined)} />
    </div>
  );
}
