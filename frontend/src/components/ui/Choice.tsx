// A small set of choices as one pill switch (units, light/dark)
export function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg bg-page p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-4 py-1.5 text-sm font-semibold ${value === o.value ? "bg-container text-ink shadow-sm" : "text-subtle hover:text-ink"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const UNIT_OPTIONS = [
  { value: "imperial" as const, label: "Pounds and ounces" },
  { value: "metric" as const, label: "Kilograms and grams" },
];
