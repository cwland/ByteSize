// An on/off switch with its label
export function Toggle({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      title={label}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-50 ${checked ? "bg-action" : "bg-strong"}`}
    >
      <span className={`absolute top-1 size-5 rounded-full bg-container shadow transition-all ${checked ? "left-6" : "left-1"}`} />
    </button>
  );
}
