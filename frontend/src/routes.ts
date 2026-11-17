import { useEffect, useState } from "react";

// Hash routes: #/ Dashboard, #/log Log (#/log/my-foods?from=<route> My Foods), #/goals Goals,
// #/settings[/<section>]
export type Page = "dashboard" | "log" | "goals" | "settings";

export const PAGES: { id: Page; label: string; href: string }[] = [
  { id: "dashboard", label: "Dashboard", href: "#/" },
  { id: "log", label: "Log", href: "#/log" },
  { id: "goals", label: "Goals", href: "#/goals" },
  { id: "settings", label: "Settings", href: "#/settings" },
];

export function pageFromHash(hash = window.location.hash): Page {
  const first = hash.replace(/^#\/?/, "").split(/[/?]/)[0];
  if (first === "log" || first === "goals" || first === "settings") return first;
  return "dashboard";
}

// "#/settings/security" -> "security"
export const settingsSectionFromHash = (hash = window.location.hash) => hash.split("?")[0].split("/")[2] ?? "";

// The current hash, re-rendering when it changes
export function useHash() {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash;
}

// My Foods lives under the Log tab and remembers the route it was opened from, for Back
export const isMyFoods = (hash = window.location.hash) => /^#\/log\/my-foods(\?|$)/.test(hash);
export function myFoodsFrom(hash = window.location.hash): string {
  const from = hash.match(/[?&]from=(.*)$/)?.[1] ?? "/log";
  return from.startsWith("/") && !isMyFoods(`#${from}`) ? from : "/log";
}
export const myFoodsHref = (from = window.location.hash.replace(/^#/, "") || "/") => `#/log/my-foods?from=${isMyFoods(`#${from}`) ? myFoodsFrom() : from}`;
