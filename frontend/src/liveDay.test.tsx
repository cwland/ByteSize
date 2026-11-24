import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { fakeServer } from "./test/fakeServer";
import { onDayChanged, useDay, DAY_CHECK_MS } from "./day";

// Something logged on another device (the iPhone) shows on the web without a reload: the day is checked again
// when you come back to the page and every 30 s while it's showing. The screen only changes when the day did.

let calories = 500;
const dayJson = () => ({ day: "2026-11-23", entries: [], totals: { calories } });

function Probe() {
  const { data } = useDay("2026-11-23");
  return <p data-testid="cal">{data ? String((data as unknown as { totals: { calories: number } }).totals.calories) : "…"}</p>;
}

const dayGets = (sent: { method: string; path: string }[]) => sent.filter((s) => s.method === "GET" && s.path === "/api/day/2026-11-23").length;
const setVisible = (v: "visible" | "hidden") => Object.defineProperty(document, "visibilityState", { configurable: true, get: () => v });

describe("the day follows changes made elsewhere", () => {
  beforeEach(() => {
    calories = 500;
    setVisible("visible");
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("checks every 30 seconds while the page shows, and updates when the day changed", async () => {
    const { sent } = fakeServer({ "GET /api/day/:d": () => dayJson() });
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId("cal")).toHaveTextContent("500"));
    expect(DAY_CHECK_MS).toBe(30_000);
    calories = 650; // the phone logged something
    await act(async () => void vi.advanceTimersByTime(DAY_CHECK_MS));
    await waitFor(() => expect(screen.getByTestId("cal")).toHaveTextContent("650"));
    expect(dayGets(sent)).toBeGreaterThanOrEqual(2);
  });

  it("coming back to the page checks straight away", async () => {
    const { sent } = fakeServer({ "GET /api/day/:d": () => dayJson() });
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId("cal")).toHaveTextContent("500"));
    const before = dayGets(sent);
    calories = 720;
    await act(async () => void window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(screen.getByTestId("cal")).toHaveTextContent("720"));
    expect(dayGets(sent)).toBeGreaterThan(before);
  });

  it("nothing changed: the other screens aren't told to reload", async () => {
    fakeServer({ "GET /api/day/:d": () => dayJson() });
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId("cal")).toHaveTextContent("500"));
    const told = vi.fn();
    const stop = onDayChanged(told);
    await act(async () => void vi.advanceTimersByTime(DAY_CHECK_MS));
    await act(async () => void window.dispatchEvent(new Event("focus")));
    await new Promise((r) => setTimeout(r, 20));
    expect(told).not.toHaveBeenCalled();
    calories = 900;
    await act(async () => void vi.advanceTimersByTime(DAY_CHECK_MS));
    await waitFor(() => expect(told).toHaveBeenCalled()); // the week strip, the day picker, … reload too
    stop();
  });

  it("a hidden page doesn't check", async () => {
    const { sent } = fakeServer({ "GET /api/day/:d": () => dayJson() });
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId("cal")).toHaveTextContent("500"));
    setVisible("hidden");
    const before = dayGets(sent);
    await act(async () => void vi.advanceTimersByTime(DAY_CHECK_MS * 3));
    expect(dayGets(sent)).toBe(before);
  });
});
