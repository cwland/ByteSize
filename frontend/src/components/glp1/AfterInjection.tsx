import type { AfterInjection as Data } from "../../types";
import { fmt } from "../../units";

// After your injection: average calories and protein by days since the shot (day 0–6), hand-drawn bars.
// A day with no food logged has no bar (unknown, not zero). Until there are two shots, a hint instead.
export default function AfterInjection({ data }: { data: Data }) {
  if (!data.enough) return <p className="text-subtle">Log at least two shots to see how your eating changes after an injection</p>;
  return (
    <div className="flex flex-col gap-4">
      <Bars title="Calories" name="Average calories by day since your shot" unit="" values={data.days.map((d) => d.avgCalories)} className="fill-primary" />
      <Bars title="Protein" name="Average protein by day since your shot" unit=" g" values={data.days.map((d) => d.avgProtein)} className="fill-protein" />
      <p className="text-xs text-muted">Last 12 weeks, days with food logged</p>
    </div>
  );
}

const W = 320;
const H = 120;
const TOP = 16; // room for the value over the tallest bar
const BOTTOM = 18; // room for the day labels

function Bars({ title, name, unit, values, className }: { title: string; name: string; unit: string; values: (number | null)[]; className: string }) {
  const max = Math.max(1, ...values.map((v) => v ?? 0));
  const slot = W / values.length;
  const barW = slot * 0.6;
  const plot = H - TOP - BOTTOM;
  const words = values.map((v, i) => `day ${i} ${v === null ? "no food logged" : `${fmt(v)}${unit}`}`).join(", ");
  return (
    <figure>
      <figcaption className="mb-1 text-sm font-semibold">{title}</figcaption>
      <svg role="img" aria-label={`${name}: ${words}`} viewBox={`0 0 ${W} ${H}`} className="w-full">
        <line x1="0" x2={W} y1={H - BOTTOM} y2={H - BOTTOM} className="stroke-line" strokeWidth="1" />
        {values.map((v, i) => {
          const x = i * slot + (slot - barW) / 2;
          const h = v === null ? 0 : Math.max(2, (v / max) * plot);
          return (
            <g key={i}>
              {v !== null && (
                <>
                  <rect data-bar="" x={x} y={H - BOTTOM - h} width={barW} height={h} rx="4" className={className} />
                  <text x={x + barW / 2} y={H - BOTTOM - h - 4} textAnchor="middle" className="fill-subtle text-[10px]">
                    {fmt(v)}
                  </text>
                </>
              )}
              {v === null && (
                <text x={x + barW / 2} y={H - BOTTOM - 4} textAnchor="middle" className="fill-inactive text-[10px]">
                  –
                </text>
              )}
              <text x={x + barW / 2} y={H - 4} textAnchor="middle" className="fill-muted text-[10px]">
                {`Day ${i}`}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
