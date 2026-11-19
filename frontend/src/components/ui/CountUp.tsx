import { useEffect, useState } from "react";

// A number that counts up from 0 over about a second and a half, easing out, when it first shows. Screen readers
// get the final value in a visually hidden span; the moving digits are aria-hidden. With "reduce motion" on, the
// number is there at once. delayMs staggers a row of them.
export const COUNT_MS = 1500;
const REDUCE_MOTION = "(prefers-reduced-motion: reduce)";
const easeOut = (p: number) => 1 - (1 - p) ** 3;

const reducedMotion = () => typeof window.matchMedia === "function" && window.matchMedia(REDUCE_MOTION).matches;

export function CountUp({ value, decimals = 0, delayMs = 0 }: { value: number; decimals?: number; delayMs?: number }) {
  const text = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const [still] = useState(reducedMotion);
  const [now, setNow] = useState(still ? value : 0);

  useEffect(() => {
    if (still) return setNow(value);
    setNow(0);
    if (value === 0) return;
    const began = performance.now() + delayMs;
    let frame = requestAnimationFrame(function step(t) {
      const p = Math.min(1, Math.max(0, (t - began) / COUNT_MS));
      setNow(p >= 1 ? value : value * easeOut(p));
      if (p < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [value, delayMs, still]);

  return (
    <>
      <span aria-hidden="true">{text(now)}</span>
      <span className="sr-only">{text(value)}</span>
    </>
  );
}
