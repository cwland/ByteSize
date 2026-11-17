import { useEffect, useRef, useState } from "react";
import { addDays } from "../../selectedDay";
import type { Units, WeighIn } from "../../types";
import { formatWeight, weightValue } from "../../units";
import { daysBetween, shortDay } from "../../weight";

export type ChartMarker = { day: string; label: string };

const HEIGHT = 220;
const PAD = { left: 40, right: 14, top: 26, bottom: 26 };
const STEPS = [0.5, 1, 2, 5, 10, 20, 25, 50, 100];
const n1 = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 1 });
const c = (n: number) => n.toFixed(1);

// What the chart shows, in words (the SVG's accessible name)
function summary(points: WeighIn[], goalKg: number | null, units: Units, from: string, to: string) {
  const w = (kg: number) => formatWeight(kg, units);
  const goal = goalKg !== null ? `, goal ${w(goalKg)}` : "";
  const first = points[0];
  const last = points[points.length - 1];
  if (points.length === 1) return `Weight on ${shortDay(first.day)}: ${w(first.weightKg)}, trend ${w(first.trendKg)}${goal}`;
  return `Weight from ${shortDay(first.day)} to ${shortDay(last.day)}: ${w(first.weightKg)} to ${w(last.weightKg)}, trend ${w(last.trendKg)}${goal}`;
}

// Weight over time, hand-drawn: weigh-in dots, the smoothed trend, optional labelled markers (dose changes)
// along the top. Zoomed to the weights so day-to-day swings show; the goal is a dashed line when it falls
// inside, otherwise a label at the edge it lies beyond. Values in the person's units. Tapping a dot selects it.
export default function WeightChart({
  weighIns,
  goalKg,
  units,
  from,
  to,
  markers = [],
  onSelect,
}: {
  weighIns: WeighIn[];
  goalKg: number | null;
  units: Units;
  from: string;
  to: string;
  markers?: ChartMarker[];
  onSelect?: (w: WeighIn) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const points = weighIns.filter((p) => p.day >= from && p.day <= to);
  const drawn = points.length > 0;
  // (re)attach when the chart appears: the empty state has no box to measure
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => e.contentRect.width > 0 && setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [drawn]);

  const v = (kg: number) => weightValue(kg, units);

  if (!drawn) return <p className="rounded-xl bg-pressed px-3 py-6 text-center text-sm text-subtle">No weigh-ins in this range</p>;

  // y: the weights and the trend, padded to round steps (the goal can lie outside)
  const values = points.flatMap((p) => [v(p.weightKg), v(p.trendKg)]);
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (hi - lo < 2) {
    const mid = (hi + lo) / 2;
    lo = mid - 1;
    hi = mid + 1;
  }
  const step = STEPS.find((s) => (hi - lo) / s <= 5) ?? 200;
  const yMin = Math.floor(lo / step) * step;
  const yMax = Math.max(Math.ceil(hi / step) * step, yMin + step);
  const ticks: number[] = [];
  for (let t = yMin; t <= yMax + step / 2; t += step) ticks.push(Math.round(t * 10) / 10);

  const plotW = Math.max(1, width - PAD.left - PAD.right);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const span = Math.max(0, daysBetween(from, to));
  const x = (day: string) => PAD.left + (span === 0 ? plotW / 2 : (daysBetween(from, day) / span) * plotW);
  const y = (value: number) => PAD.top + (1 - (value - yMin) / (yMax - yMin)) * plotH;

  // a few dates along the bottom (fewer on a phone)
  const k = Math.min(span, width < 480 ? 3 : 4);
  const xDays = k === 0 ? [from] : Array.from({ length: k + 1 }, (_, i) => addDays(from, Math.round((span * i) / k)));
  const anchor = (i: number) => (k === 0 ? "middle" : i === 0 ? "start" : i === k ? "end" : "middle");

  const trend = points.map((p, i) => `${i ? "L" : "M"}${c(x(p.day))} ${c(y(v(p.trendKg)))}`).join(" ");
  const goalV = goalKg !== null ? v(goalKg) : null;
  const goalEdge = goalV === null || (goalV >= yMin && goalV <= yMax) ? null : goalV < yMin ? "below" : "above";
  const shownMarkers = markers.filter((m) => m.day >= from && m.day <= to);

  return (
    <div ref={box} className="w-full">
      <svg width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} role="img" aria-label={summary(points, goalKg, units, from, to)} className="block max-w-full select-none">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={c(y(t))} y2={c(y(t))} stroke="var(--color-line)" strokeWidth="1" />
            <text data-testid="y-label" x={PAD.left - 6} y={c(y(t))} dy="0.35em" textAnchor="end" fontSize="11" fill="var(--color-muted)">
              {n1(t)}
            </text>
          </g>
        ))}
        {xDays.map((d, i) => (
          <text key={d} data-testid="x-label" x={c(x(d))} y={HEIGHT - 6} textAnchor={anchor(i)} fontSize="11" fill="var(--color-muted)">
            {shortDay(d)}
          </text>
        ))}
        {goalV !== null && !goalEdge && (
          <g>
            <line data-testid="goal-line" x1={PAD.left} x2={width - PAD.right} y1={c(y(goalV))} y2={c(y(goalV))} stroke="var(--color-success)" strokeWidth="1.5" strokeDasharray="6 4" />
            <text x={width - PAD.right} y={c(y(goalV) - 5)} textAnchor="end" fontSize="11" fontWeight="600" fill="var(--color-success)">
              {`Goal ${n1(goalV)}`}
            </text>
          </g>
        )}
        {/* On the left: a losing (or gaining) line has its latest dots at the right edge it would point to */}
        {goalKg !== null && goalEdge && (
          <text
            data-testid="goal-edge"
            x={PAD.left + 6}
            y={goalEdge === "below" ? PAD.top + plotH - 6 : PAD.top + 12}
            textAnchor="start"
            fontSize="11"
            fontWeight="600"
            fill="var(--color-success)"
          >
            {`Goal ${formatWeight(goalKg, units)} ${goalEdge === "below" ? "↓" : "↑"}`}
          </text>
        )}
        {shownMarkers.map((m) => (
          <g key={`${m.day}-${m.label}`} data-testid="marker">
            <line x1={c(x(m.day))} x2={c(x(m.day))} y1={PAD.top - 6} y2={PAD.top + plotH} stroke="var(--color-protein)" strokeWidth="1" strokeDasharray="2 3" opacity="0.7" />
            <text x={c(Math.min(Math.max(x(m.day), PAD.left + 16), width - PAD.right - 16))} y={PAD.top - 10} textAnchor="middle" fontSize="10" fontWeight="600" fill="var(--color-protein)">
              {m.label}
            </text>
          </g>
        ))}
        {points.length > 1 && <path data-testid="trend-path" d={trend} fill="none" stroke="var(--color-action)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />}
        {points.map((p) => (
          <g key={p.day} data-testid="weigh-in-dot" onClick={onSelect ? () => onSelect(p) : undefined} className={onSelect ? "cursor-pointer" : undefined}>
            <circle cx={c(x(p.day))} cy={c(y(v(p.weightKg)))} r="12" fill="transparent" />
            <circle cx={c(x(p.day))} cy={c(y(v(p.weightKg)))} r="3.5" fill="var(--color-container)" stroke="var(--color-ink)" strokeWidth="1.5" />
          </g>
        ))}
      </svg>
    </div>
  );
}
