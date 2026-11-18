import { useState } from "react";
import type { SearchResult } from "../../types";

// Add food's source pills (§22): one toggle per source a typed search asked. A pill that is on shows its group.
export const PILLS = [
  { id: "fatsecret", label: "FatSecret" },
  { id: "basic", label: "Basic" },
  { id: "usda", label: "USDA" },
  { id: "off", label: "Open Food Facts" },
  { id: "culury", label: "Culury" },
] as const;
export type PillId = (typeof PILLS)[number]["id"];
export type Choice = Record<PillId, boolean>;
const DEFAULTS: Choice = { fatsecret: true, basic: false, usda: true, off: true, culury: false };

// Remembered per person on this device. A browser without storage (or with junk in it) just uses the defaults.
const keyFor = (userId: number) => `bytesize.searchSources.${userId}`;
function load(userId: number): Choice {
  try {
    const saved = JSON.parse(localStorage.getItem(keyFor(userId)) ?? "null");
    if (saved && typeof saved === "object") return Object.fromEntries(PILLS.map((p) => [p.id, typeof saved[p.id] === "boolean" ? saved[p.id] : DEFAULTS[p.id]])) as Choice;
  } catch {
    // storage blocked or unreadable
  }
  return { ...DEFAULTS };
}
function save(userId: number, choice: Choice) {
  try {
    localStorage.setItem(keyFor(userId), JSON.stringify(choice));
  } catch {
    // storage blocked or full: the choice lasts until the sheet closes
  }
}

export function useSourceChoice(userId: number) {
  const [choice, setChoice] = useState(() => load(userId));
  const toggle = (id: PillId) =>
    setChoice((c) => {
      const next = { ...c, [id]: !c[id] };
      save(userId, next);
      return next;
    });
  return { choice, toggle };
}

// What a search answer looks like through the pills. USDA's failure marks Basic too (one call feeds both).
export function viewOf(found: SearchResult, choice: Choice) {
  const asked = PILLS.filter((p) => found.searched?.includes(p.id));
  const count = (id: PillId) => found.groups.find((g) => g.source === id)?.foods.length ?? 0;
  const failedIds = new Set<string>(found.errors.map((e) => e.source));
  if (failedIds.has("usda")) failedIds.add("basic");
  const pills = asked.map((p) => ({ ...p, on: choice[p.id], count: count(p.id), failed: failedIds.has(p.id) }));
  const asking = new Set<string>(pills.map((p) => p.id));
  // Groups with a pill follow it; My foods and Saved foods have none and always show
  const groups = found.groups.filter((g) => !asking.has(g.source) || choice[g.source as PillId]);
  const errors = found.errors.filter((e) => !asking.has(e.source) || choice[e.source as PillId] || (e.source === "usda" && choice.basic));
  const on = pills.filter((p) => p.on);
  const more = pills.find((p) => !p.on && p.count > 0);
  const nothing = pills.length && more && on.every((p) => p.count === 0) ? { names: on.map((p) => p.label), more } : null;
  return { pills, groups, errors, nothing };
}

const list = (names: string[]) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

export function SourcePills({ pills, onToggle }: { pills: ReturnType<typeof viewOf>["pills"]; onToggle: (id: PillId) => void }) {
  if (!pills.length) return null;
  return (
    <div role="group" aria-label="Sources" className="mt-3 flex flex-wrap gap-2">
      {pills.map((p) => (
        <button
          key={p.id}
          type="button"
          aria-pressed={p.on}
          onClick={() => onToggle(p.id)}
          className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold ${p.on ? "bg-primary text-on-primary hover:bg-primary-pressed" : "bg-pressed text-subtle hover:bg-strong"}`}
        >
          {p.failed ? (p.count ? `${p.label} (${p.count}) !` : `${p.label} !`) : `${p.label} (${p.count})`}
        </button>
      ))}
    </div>
  );
}

export function NothingFrom({ nothing }: { nothing: NonNullable<ReturnType<typeof viewOf>["nothing"]> }) {
  const { names, more } = nothing;
  return (
    <p className="mt-3 px-2 text-subtle">
      {names.length ? `Nothing from ${list(names)}.` : "No sources are on."} Tap {more.label} ({more.count}) to see those.
    </p>
  );
}
