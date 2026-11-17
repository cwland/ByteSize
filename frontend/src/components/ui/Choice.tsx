// A small set of choices as one pill switch (units, light/dark). value null: none chosen
export function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T | null; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid w-full grid-flow-col auto-cols-fr rounded-full bg-page p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`whitespace-nowrap rounded-full px-3 py-1.5 text-center text-sm font-semibold ${value === o.value ? "bg-primary text-on-primary" : "text-subtle hover:text-ink"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const UNIT_OPTIONS = [
  { value: "imperial" as const, label: "Pounds (lb)" },
  { value: "metric" as const, label: "Kilograms (kg)" },
];
