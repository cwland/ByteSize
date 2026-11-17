import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

// A bottom sheet on phones, a centered panel on desktop. Escape or the backdrop closes it.
// heading: a title (default: the label) or your own header content (e.g. a dropdown)
export function Sheet({ label, heading = label, onClose, onBack, children }: { label: string; heading?: ReactNode; onClose: () => void; onBack?: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
        className="pb-safe max-h-[92vh] w-full max-w-[560px] overflow-y-auto rounded-t-3xl bg-container p-5 sm:rounded-3xl"
      >
        <div className="mb-4 flex items-center gap-2">
          {onBack && (
            <button type="button" onClick={onBack} className="rounded-full px-2 py-1 text-sm font-semibold text-link hover:bg-pressed">
              ‹ Back
            </button>
          )}
          {typeof heading === "string" ? <h2 className="flex-1 truncate text-lg font-bold">{heading}</h2> : <div className="min-w-0 flex-1">{heading}</div>}
          <button type="button" aria-label="Close" onClick={onClose} className="flex size-9 items-center justify-center rounded-full text-subtle hover:bg-pressed hover:text-ink">
            <X className="size-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
