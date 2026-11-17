import { fmt } from "../../units";

// Semicircle calorie gauge (design §9 option B). Fills with food ÷ range top. The centre counts down
// to the range top ("left", green) or shows how far above it you are ("over", amber).
export default function Gauge({ food, min, max }: { food: number; min: number; max: number }) {
  const over = food > max;
  const fill = Math.min(1, max > 0 ? food / max : 0);
  const color = over ? "var(--color-warning)" : "var(--color-success)";
  const arc = "M 15 100 A 85 85 0 0 1 185 100";
  return (
    <div className="relative mx-auto w-full max-w-64">
      <svg viewBox="0 0 200 110" className="w-full" aria-hidden="true">
        <path d={arc} fill="none" stroke="var(--color-line)" strokeWidth="14" strokeLinecap="round" />
        {fill > 0 && <path d={arc} fill="none" stroke={color} strokeWidth="14" strokeLinecap="round" pathLength={100} strokeDasharray={`${fill * 100} 100`} />}
      </svg>
      <div data-testid="gauge-centre" data-state={over ? "over" : "left"} className="absolute inset-x-0 bottom-1 text-center">
        <p className={`text-4xl font-bold leading-none tabular ${over ? "text-warning" : "text-success"}`}>{fmt(over ? food - max : max - food)}</p>
        <p className="mt-1 text-sm font-semibold text-subtle">{over ? "over" : "left"}</p>
      </div>
      {food < min && <p className="mt-2 text-center text-sm text-muted">{fmt(min - food)} to reach your range</p>}
    </div>
  );
}
