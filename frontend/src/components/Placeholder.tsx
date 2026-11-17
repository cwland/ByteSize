import { Plus } from "lucide-react";

// Visual previews of the screens that arrive in M2 (no data yet): the shapes, empty.

const RINGS = ["Protein", "Fiber", "Water"];

export function DashboardPreview() {
  return (
    <div>
      <h1 className="sr-only">Dashboard</h1>
      <section aria-label="Budget" className="rounded-2xl bg-container p-5">
        <h2 className="text-lg font-bold">Budget</h2>
        <div className="mx-auto mt-3 max-w-72">
          <svg viewBox="0 0 200 110" className="w-full" aria-hidden="true">
            <path d="M 15 100 A 85 85 0 0 1 185 100" fill="none" stroke="var(--color-line)" strokeWidth="14" strokeLinecap="round" />
          </svg>
          <div className="-mt-12 text-center">
            <p className="text-4xl font-bold leading-none text-inactive tabular">—</p>
            <p className="mt-1 text-sm text-muted">calories left</p>
          </div>
        </div>
        <div className="mt-6 grid grid-cols-3 gap-2">
          {RINGS.map((name) => (
            <div key={name} className="flex flex-col items-center">
              <svg viewBox="0 0 64 64" className="size-16" aria-hidden="true">
                <circle cx="32" cy="32" r="26" fill="none" stroke="var(--color-line)" strokeWidth="7" />
              </svg>
              <p className="mt-1.5 text-sm font-semibold">{name}</p>
            </div>
          ))}
        </div>
        <p className="mt-5 text-center text-subtle">Set up your goals to see your budget</p>
      </section>
    </div>
  );
}

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
