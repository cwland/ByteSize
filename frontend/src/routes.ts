import { useEffect, useState } from "react";

// Hash routes: #/ Today, #/log Food log, #/foods My foods, #/settings/<section>
export type Page = "today" | "log" | "foods" | "settings";

export const PAGES: { id: Page; label: string; href: string }[] = [
  { id: "today", label: "Today", href: "#/" },
  { id: "log", label: "Food log", href: "#/log" },
  { id: "foods", label: "My foods", href: "#/foods" },
  { id: "settings", label: "Settings", href: "#/settings/profile" },
];

export function pageFromHash(hash = window.location.hash): Page {
  const first = hash.replace(/^#\/?/, "").split(/[/?]/)[0];
  if (first === "log" || first === "foods" || first === "settings") return first;
  return "today";
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
