import { useState } from "react";
import { Sparkles } from "lucide-react";
import { scaleNutrients } from "../../nutrition";
import type { CuluryRecipe, FoodResult, Nutrients, Portion } from "../../types";
import FoodDetail from "./FoodDetail";
import { Tag } from "./FoodRow";
import { AiWorking, useEstimate, type Estimate } from "./useEstimate";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { primaryButton } from "../ui/styles";

const ONE_SERVING: Portion = { servingIndex: 0, unit: "serving", quantity: 1, fraction: 1 };

// What to ask the AI for: one serving of the recipe (with its weight when it's weighed)
const askFor = (food: FoodResult) => `1 serving of ${food.name}${food.servings[0]?.grams ? ` (${food.servings[0].grams} g)` : ""}`;

// The AI's estimate for one serving of the recipe: its own first serving, scaled to the recipe's serving
// weight when both are weighed
function servingOf(food: FoodResult, out: Estimate): Nutrients {
  const grams = food.servings[0]?.grams;
  const theirs = out.food.servings[0]?.grams;
  return grams && theirs ? scaleNutrients(out.food.nutrients, grams / theirs) : out.food.nutrients;
}

// Track food for a RecipeHub recipe (read live from RecipeHub, starts at 1 serving). RecipeHub's nutrition may be
// marked out of date; with none at all, "Estimate with AI" fills it in for this entry only (logged as AI-estimated).
// initial: where the amount starts (1 serving, or the last portion from Recently tracked).
// stale: RecipeHub couldn't answer, so this is the last logged copy (the server logs from it too).
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
  const estimating = useEstimate();
  const [msg, setMsg] = useState<Msg>(null);
  const { food } = recipe;

  const runEstimate = async () => {
    setMsg(null);
    try {
      const out = await estimating.run(askFor(food));
      if (out) setEstimate(servingOf(food, out));
    } catch (e) {
      setMsg(errorMsg(e));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {stale && <p className="rounded-xl bg-pressed px-3 py-2 text-sm text-subtle">RecipeHub is unavailable — using the last logged version</p>}
      {recipe.outdated && <p className="px-1 text-xs text-muted">RecipeHub's nutrition for this recipe may be out of date.</p>}
      {!recipe.hasNutrition &&
        (estimate ? (
          <p className="flex flex-wrap items-center gap-1.5 px-1 text-sm text-subtle">
            <Tag text="AI estimate" /> The nutrition is a guess for one serving; it's logged marked as AI-estimated.
          </p>
        ) : (
          <div className="rounded-2xl bg-pressed px-3 py-2.5 text-sm">
            <p className="text-subtle">RecipeHub has no nutrition for this recipe. Estimate it before tracking, or track it as unknown.</p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <button type="button" disabled={!!estimating.step} onClick={() => void runEstimate()} className={`${primaryButton} inline-flex items-center gap-1.5 text-sm`}>
                <Sparkles className="size-4" /> Estimate with AI
              </button>
              <AiWorking step={estimating.step} onCancel={estimating.cancel} />
            </div>
            <Notice msg={msg} />
          </div>
        ))}
      <FoodDetail key={estimate ? "estimate" : "culury"} food={{ ...food, nutrients: estimate ?? food.nutrients }} initial={initial} submitLabel="Track" onSubmit={(p) => onTrack(p, estimate ?? undefined)} />
    </div>
  );
}
