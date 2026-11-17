import { useEffect, useRef, useState } from "react";
import { Check, Plus } from "lucide-react";
import type { Nutrients } from "../../types";
import Pills from "./Pills";
import FoodPic from "./FoodPic";

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
  nutrients,
  onOpen,
  onQuickAdd,
}: {
  name: string;
  icon: string;
  imageUrl?: string | null;
  amount: string;
  brand?: string | null;
  nutrients: Nutrients;
  onOpen: () => void;
  onQuickAdd: () => Promise<void>;
}) {
  const quick = useQuickAdd(onQuickAdd);
  return (
    <li className="rounded-2xl bg-pressed">
      <div className="flex items-center gap-2 p-2">
        <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-1 py-1 text-left">
          <FoodPic icon={icon} imageUrl={imageUrl} />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">{name}</span>
            <span className="block truncate text-sm text-subtle">
              <span>{amount}</span>
              {brand && <span>{` · ${brand}`}</span>}
            </span>
            <span className="mt-1 block">
              <Pills n={nutrients} />
            </span>
          </span>
        </button>
        <QuickAddButton label={`Quick add ${name}`} added={quick.added} onClick={quick.run} />
      </div>
      {quick.error && (
        <p role="alert" className="mx-3 mb-2 rounded-xl bg-error-subtle px-3 py-1.5 text-sm text-error">
          {quick.error}
        </p>
      )}
    </li>
  );
}
