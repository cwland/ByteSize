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

// Left open overnight (2026-11-24): the date moved to Tuesday but Monday's food stayed — the first load after the
// computer woke failed, and a failed load kept the old day on screen with nothing trying again.
function DayProbe({ day }: { day: string }) {
  const { data, error } = useDay(day);
  const d = data as unknown as { day: string } | null;
  return (
    <>
      <p data-testid="shown">{d ? d.day : "…"}</p>
      <p data-testid="err">{error ?? ""}</p>
    </>
  );
}

describe("a new day never shows the old one", () => {
  beforeEach(() => {
    setVisible("visible");
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("moving to another day clears the old day's food straight away", async () => {
    let release: (() => void) | null = null;
    fakeServer({
      "GET /api/day/:d": (_b: unknown, path: string) => {
        const d = path.split("/").pop()!;
        if (d === "2026-11-24") return new Promise((r) => (release = () => r({ day: d, entries: [], totals: { calories: 0 } })));
        return { day: d, entries: [], totals: { calories: 1800 } };
      },
    });
    const { rerender } = render(<DayProbe day="2026-11-23" />);
    await waitFor(() => expect(screen.getByTestId("shown")).toHaveTextContent("2026-11-23"));
    rerender(<DayProbe day="2026-11-24" />);
    expect(screen.getByTestId("shown")).toHaveTextContent("…"); // not Monday's food under Tuesday
    await act(async () => release!());
    await waitFor(() => expect(screen.getByTestId("shown")).toHaveTextContent("2026-11-24"));
  });

  it("a day that failed to load is tried again on the next check", async () => {
    let up = false; // the network after the computer wakes
    fakeServer({
      "GET /api/day/:d": (_b: unknown, path: string) => {
        const d = path.split("/").pop()!;
        if (d === "2026-11-24" && !up) return { status: 503, json: { error: "Couldn't reach the server" } };
        return { day: d, entries: [], totals: { calories: 0 } };
      },
    });
    const { rerender } = render(<DayProbe day="2026-11-23" />);
    await waitFor(() => expect(screen.getByTestId("shown")).toHaveTextContent("2026-11-23"));
    rerender(<DayProbe day="2026-11-24" />);
    await waitFor(() => expect(screen.getByTestId("err")).not.toHaveTextContent(/^$/));
    expect(screen.getByTestId("shown")).toHaveTextContent("…");
    up = true;
    await act(async () => void vi.advanceTimersByTime(DAY_CHECK_MS));
    await waitFor(() => expect(screen.getByTestId("shown")).toHaveTextContent("2026-11-24"));
    expect(screen.getByTestId("err")).toHaveTextContent(/^$/);
  });
});
