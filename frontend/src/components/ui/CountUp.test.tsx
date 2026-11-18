import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { CountUp, COUNT_MS } from "./CountUp";

// Fake timers also fake requestAnimationFrame and performance.now, so a test moves the animation by hand
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const parts = (c: HTMLElement) => ({ shown: c.querySelector('[aria-hidden="true"]')!.textContent, sr: c.querySelector(".sr-only")!.textContent });
const run = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const num = (s: string | null) => Number((s ?? "").replace(/,/g, ""));

describe("CountUp", () => {
  it("counts up from 0 to the value in about 1.5 seconds, with thousands separators", () => {
    const { container } = render(<CountUp value={12345} />);
    expect(parts(container).shown).toBe("0");
    run(COUNT_MS / 2);
    const mid = num(parts(container).shown);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(12345);
    run(COUNT_MS);
    expect(parts(container).shown).toBe("12,345");
    expect(COUNT_MS).toBe(1500);
  });

  it("eases out: more than half of the way by half of the time, and never goes backwards", () => {
    const { container } = render(<CountUp value={1000} />);
    let last = 0;
    for (let i = 0; i < 10; i++) {
      run(COUNT_MS / 10);
      const now = num(parts(container).shown);
      expect(now).toBeGreaterThanOrEqual(last);
      last = now;
      if (i === 4) expect(now).toBeGreaterThan(500);
    }
    expect(last).toBe(1000);
  });

  it("screen readers get the final value from the start; the moving text is hidden from them", () => {
    const { container } = render(<CountUp value={12345} />);
    expect(parts(container).sr).toBe("12,345");
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(container.querySelector(".sr-only")!.getAttribute("aria-hidden")).toBeNull();
    run(COUNT_MS * 2);
    expect(parts(container).sr).toBe("12,345");
  });

  it("a delay staggers it: still 0 before it, finished one count after it", () => {
    const { container } = render(<CountUp value={500} delayMs={300} />);
    run(250);
    expect(parts(container).shown).toBe("0");
    run(COUNT_MS + 100);
    expect(parts(container).shown).toBe("500");
  });

  it("with reduce motion on, the number is there at once and nothing is animated", () => {
    window.matchMedia = ((q: string) => ({ matches: q === "(prefers-reduced-motion: reduce)", media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    const raf = vi.spyOn(window, "requestAnimationFrame");
    const { container } = render(<CountUp value={12345} delayMs={400} />);
    expect(parts(container)).toEqual({ shown: "12,345", sr: "12,345" });
    expect(raf).not.toHaveBeenCalled();
  });

  it("0 just shows 0, and a decimal count keeps its decimals all the way", () => {
    const zero = render(<CountUp value={0} />);
    expect(parts(zero.container)).toEqual({ shown: "0", sr: "0" });
    const lost = render(<CountUp value={4.4} decimals={1} />);
    run(COUNT_MS / 3);
    expect(parts(lost.container).shown).toMatch(/^\d\.\d$/);
    run(COUNT_MS);
    expect(parts(lost.container)).toEqual({ shown: "4.4", sr: "4.4" });
  });

  it("stops its frames when it goes away", () => {
    const cancel = vi.spyOn(window, "cancelAnimationFrame");
    const { unmount } = render(<CountUp value={10} />);
    unmount();
    expect(cancel).toHaveBeenCalled();
  });
});
