import { useEffect, useRef } from "react";
import { primaryButton, secondaryButton } from "./styles";

// An in-app "are you sure?" (instead of window.confirm). A click on the backdrop doesn't dismiss it:
// Cancel or Escape does.
export function Confirm({ title, text, confirmLabel, cancelLabel = "Cancel", onConfirm, onCancel }: { title: string; text?: string; confirmLabel: string; cancelLabel?: string; onConfirm: () => void; onCancel: () => void }) {
  // Focus moves into the dialog (Cancel: the safe choice), so the keyboard is never left behind it
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => cancel.current?.focus(), []);
  useEffect(() => {
    // Caught on the way down and stopped there, so a window underneath (a Sheet) doesn't close too.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onCancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div role="alertdialog" aria-modal="true" aria-label={title} className="w-full max-w-sm rounded-3xl bg-container p-5">
        <h2 className="text-lg font-bold">{title}</h2>
        {text && <p className="mt-1 text-subtle">{text}</p>}
        <div className="mt-5 flex justify-end gap-3">
          <button ref={cancel} type="button" onClick={onCancel} className={secondaryButton}>
            {cancelLabel}
          </button>
          <button type="button" onClick={onConfirm} className={`${primaryButton} bg-error text-white hover:bg-error`}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
