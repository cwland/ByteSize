import { fmt } from "../../units";

// Semicircle calorie gauge (design §9 option B). Fills with food ÷ range top. The centre counts down
// to the range top ("left", green) or shows how far above it you are ("over", amber).
// bankPaid (§40b): what the weekly workout bank paid today (treats and covered overage) doesn't count against the
// range; a day over its range that the bank fully covered shows as "covered" (green), not over.
export default function Gauge({ food: eaten, min, max, bankPaid = 0 }: { food: number; min: number; max: number; bankPaid?: number }) {
  const food = eaten - bankPaid;
  const over = food > max;
  const covered = !over && bankPaid > 0 && eaten > max;
  const fill = Math.min(1, max > 0 ? food / max : 0);
  const color = over ? "var(--color-warning)" : "var(--color-success)";
  const arc = "M 15 100 A 85 85 0 0 1 185 100";
  return (
    <div className="mx-auto w-full max-w-64">
      {/* the number sits inside the arc; this box holds only the arc so nothing else can push it */}
      <div className="relative">
        <svg viewBox="0 0 200 110" className="w-full" aria-hidden="true">
          <path d={arc} fill="none" stroke="var(--color-line)" strokeWidth="14" strokeLinecap="round" />
          {fill > 0 && <path d={arc} fill="none" stroke={color} strokeWidth="14" strokeLinecap="round" pathLength={100} strokeDasharray={`${fill * 100} 100`} />}
        </svg>
        <div data-testid="gauge-centre" data-state={over ? "over" : covered ? "covered" : "left"} className="absolute inset-x-0 bottom-0 text-center">
          <p className={`text-3xl font-bold leading-none tabular ${over ? "text-warning" : "text-success"}`}>{fmt(over ? food - max : covered ? eaten - max : max - food)}</p>
          <p className="mt-0.5 text-xs font-semibold text-subtle">{over ? "over" : covered ? "covered by bank" : "left"}</p>
        </div>
      </div>
      {food < min && <p className="mt-2 text-center text-xs text-muted">{fmt(min - food)} to reach your range</p>}
    </div>
  );
}
