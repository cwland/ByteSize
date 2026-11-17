import { useEffect, useState } from "react";
import { api } from "./api";
import type { Weight } from "./types";

// A weigh-in was saved or deleted: the Dashboard card and the Goals chart reload
const EVENT = "bytesize:weight-changed";
export const notifyWeightChanged = () => window.dispatchEvent(new Event(EVENT));
export const onWeightChanged = (on: () => void) => {
  window.addEventListener(EVENT, on);
  return () => window.removeEventListener(EVENT, on);
};

// GET /api/weight (optionally windowed; from/to inclusive), reloaded when a weigh-in changes
export function useWeight(from?: string, to?: string) {
  const [data, setData] = useState<Weight | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const qs = [from && `from=${from}`, to && `to=${to}`].filter(Boolean).join("&");
    const load = () =>
      api<Weight>("GET", `/api/weight${qs ? `?${qs}` : ""}`)
        .then((w) => {
          if (!live) return;
          setData(w);
          setError(null);
        })
        .catch((e) => live && setError((e as Error).message));
    load();
    const off = onWeightChanged(load);
    return () => {
      live = false;
      off();
    };
  }, [from, to]);
  return { data, error };
}

// "2026-10-20" -> "Oct 20"; longDay -> "Oct 20, 2026"
export const shortDay = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
export const longDay = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
// Whole days from a to b (b later = positive)
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
