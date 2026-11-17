import { primaryButton, secondaryButton } from "./styles";

// An in-app "are you sure?" (instead of window.confirm)
export function Confirm({ title, text, confirmLabel, onConfirm, onCancel }: { title: string; text?: string; confirmLabel: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={onCancel}>
      <div role="alertdialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-3xl bg-container p-5">
        <h2 className="text-lg font-bold">{title}</h2>
        {text && <p className="mt-1 text-subtle">{text}</p>}
        <div className="mt-5 flex justify-end gap-3">
          <button type="button" onClick={onCancel} className={secondaryButton}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm} className={`${primaryButton} bg-error text-white hover:bg-error`}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
