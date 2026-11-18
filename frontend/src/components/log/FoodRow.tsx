import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Plus } from "lucide-react";
import type { FoodKind, Nutrients } from "../../types";
import Pills from "./Pills";
import FoodPic from "./FoodPic";

// The small tag on a recipe or quick meal row (database and own foods have none)
export const tagOf = (k: FoodKind | undefined) => (k === "recipe" ? "Recipe" : k === "quick_meal" ? "Meal" : null);

export function Tag({ text }: { text: string }) {
  return <span className="shrink-0 rounded-full bg-active px-1.5 py-px text-[10px] font-bold text-action">{text}</span>;
}

export const ADDED_MS = 2000; // how long the ✓ shows before the + comes back

// Quick add: every tap logs (two taps = two entries); each success shows ✓ for a moment, a failure says why
export function useQuickAdd(add: () => Promise<void>) {
  const [checks, setChecks] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(true);
  useEffect(() => {
    live.current = true; // set again on mount: StrictMode (npm run dev) unmounts and remounts once
    return () => void (live.current = false);
  }, []);
  const run = async () => {
    setError(null);
    try {
      await add();
      if (!live.current) return;
      setChecks((c) => c + 1);
      setTimeout(() => live.current && setChecks((c) => c - 1), ADDED_MS);
    } catch (e) {
      if (live.current) setError((e as Error)?.message || "Something went wrong");
    }
  };
  return { added: checks > 0, error, run };
}

export function QuickAddButton({ label, added, onClick }: { label: string; added: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`flex size-10 shrink-0 items-center justify-center rounded-full ${added ? "bg-success text-on-primary" : "bg-primary text-on-primary hover:bg-primary-pressed"}`}
    >
      {added ? (
        <span role="img" aria-label="Added">
          <Check aria-hidden="true" className="size-5" strokeWidth={3} />
        </span>
      ) : <Plus aria-hidden="true" className="size-5" strokeWidth={3} />}
    </button>
  );
}

// A food to add: icon, name, amount, pills; tap to open it, + to log it as shown
export default function FoodRow({
  name,
  icon,
  imageUrl,
  amount,
  brand,
  tag,
  nutrients,
  onOpen,
  onQuickAdd,
  busy = false,
  note,
}: {
  name: string;
  icon: string;
  imageUrl?: string | null;
  amount: string;
  brand?: string | null;
  tag?: string | null;
  nutrients: Nutrients;
  onOpen: () => void;
  onQuickAdd: () => Promise<void>;
  busy?: boolean; // being opened (a Culury recipe loading): disabled, "Opening…" for the amount
  note?: ReactNode; // under the row (a kept copy's "Saved copy from …" with its own button)
}) {
  const quick = useQuickAdd(onQuickAdd);
  return (
    <li className="rounded-2xl bg-pressed">
      <div className="flex items-center gap-2 p-2">
        <button type="button" onClick={onOpen} disabled={busy} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-1 py-1 text-left disabled:opacity-60">
          <FoodPic icon={icon} imageUrl={imageUrl} />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate font-semibold">{name}</span>
              {tag && <Tag text={tag} />}
            </span>
            <span className="block truncate text-sm text-subtle">
              <span>{busy ? "Opening…" : amount}</span>
              {brand && !busy && <span>{` · ${brand}`}</span>}
            </span>
            <span className="mt-1 block">
              <Pills n={nutrients} />
            </span>
          </span>
        </button>
        <QuickAddButton label={`Quick add ${name}`} added={quick.added} onClick={quick.run} />
      </div>
      {note && <div className="-mt-1 px-4 pb-2">{note}</div>}
      {quick.error && (
        <p role="alert" className="mx-3 mb-2 rounded-xl bg-error-subtle px-3 py-1.5 text-sm text-error">
          {quick.error}
        </p>
      )}
    </li>
  );
}
