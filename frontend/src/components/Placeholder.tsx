import { Plus } from "lucide-react";

// Visual previews of the screens that arrive in M2 (no data yet): the shapes, empty.

const MEALS = ["Breakfast", "Lunch", "Dinner", "Snacks"];

export function LogPreview() {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="sr-only">Log</h1>
      {MEALS.map((meal) => (
        <section key={meal} aria-label={meal} className="rounded-2xl bg-container p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold">{meal}</h2>
            <span className="text-sm text-inactive tabular">0 cal</span>
          </div>
          <button
            type="button"
            disabled
            className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-bold text-on-primary opacity-50"
          >
            <Plus className="size-4" strokeWidth={3} /> Add Food
          </button>
        </section>
      ))}
      <p className="px-1 text-center text-sm text-muted">Logging arrives in the next update</p>
    </div>
  );
}
