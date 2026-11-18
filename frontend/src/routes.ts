import { useEffect, useState } from "react";

// Hash routes: #/ Dashboard, #/log/my-foods?from=<route> My Foods, #/goals Goals, #/settings[/<section>].
// There is no Log page (§28): #/log (and old links to it) open the Dashboard.
export type Page = "dashboard" | "myfoods" | "goals" | "settings";

export const PAGES: { id: Page; label: string; href: string }[] = [
  { id: "dashboard", label: "Dashboard", href: "#/" },
  { id: "goals", label: "Goals", href: "#/goals" },
  { id: "myfoods", label: "My foods", href: "#/log/my-foods?from=/" },
  { id: "settings", label: "Settings", href: "#/settings" },
];

export function pageFromHash(hash = window.location.hash): Page {
  const first = hash.replace(/^#\/?/, "").split(/[/?]/)[0];
  if (first === "goals" || first === "settings") return first;
  if (isMyFoods(hash)) return "myfoods";
  return "dashboard";
}

// The old Log page's address (#/log, #/log/, #/log?…): the Dashboard now
export const isOldLog = (hash = window.location.hash) => /^#\/log\/?(\?|$)/.test(hash);

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

// My Foods remembers the route it was opened from, for Back (its address keeps the old /log prefix, so saved links work)
// The GLP-1 page (#/glp1[?from=<route>]) sits under the Dashboard tab
export const isGlp1 = (hash = window.location.hash) => /^#\/glp1(\?|$)/.test(hash);
export const isMyFoods = (hash = window.location.hash) => /^#\/log\/my-foods(\?|$)/.test(hash);
export function myFoodsFrom(hash = window.location.hash): string {
  const from = hash.match(/[?&]from=(.*)$/)?.[1] ?? "/";
  return from.startsWith("/") && !isMyFoods(`#${from}`) && !isOldLog(`#${from}`) ? from : "/";
}
export const myFoodsHref = (from = window.location.hash.replace(/^#/, "") || "/") => `#/log/my-foods?from=${isMyFoods(`#${from}`) ? myFoodsFrom() : from}`;
