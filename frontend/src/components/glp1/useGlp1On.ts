import { useEffect, useState } from "react";
import { api } from "../../api";
import type { Glp1View, SavedBody } from "../../types";

// GLP-1 tracking is on when GLP-1 is set up (GET /api/glp1 has settings) or the body profile says the person takes
// a GLP-1 (Goals › Edit my details) — the rule the Next shot widget uses. A failing request counts as off.
export function useGlp1On() {
  const [setUp, setSetUp] = useState(false);
  const [says, setSays] = useState(false);
  useEffect(() => {
    let live = true;
    api<Glp1View>("GET", "/api/glp1")
      .then((v) => live && setSetUp(!!v.settings))
      .catch(() => {});
    api<{ body: SavedBody | null }>("GET", "/api/body")
      .then((r) => live && setSays(!!r.body?.glp1))
      .catch(() => {});
    return () => void (live = false);
  }, []);
  return setUp || says;
}
