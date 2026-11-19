import { useEffect, useState } from "react";
import { Syringe } from "lucide-react";
import { api } from "../../api";
import type { Glp1View, SavedBody } from "../../types";
import { primaryButton } from "../ui/styles";
import ShotSheet from "./ShotSheet";
import { statusText } from "./glp1";

// Dashboard GLP-1 card: "Next shot Fri, Nov 20" / "Injection day" / "Injection overdue by N days", with Log shot.
// Shown when GLP-1 is set up, or when the body profile says GLP-1 (then it invites setup). Hidden otherwise,
// and hidden if either request fails (the rest of the Dashboard doesn't depend on it).
export default function Glp1Card() {
  const [view, setView] = useState<Glp1View | null>(null);
  const [usesGlp1, setUsesGlp1] = useState(false);
  const [logging, setLogging] = useState(false);
  useEffect(() => {
    let live = true;
    api<Glp1View>("GET", "/api/glp1")
      .then((v) => live && setView(v))
      .catch(() => {});
    api<{ body: SavedBody | null }>("GET", "/api/body")
      .then((r) => live && setUsesGlp1(!!r.body?.glp1))
      .catch(() => {});
    return () => void (live = false);
  }, []);

  if (!view || (!view.settings && !usesGlp1)) return null;
  const open = () => (window.location.hash = "#/glp1");
  const text = statusText(view);
  const late = view.status === "due" || view.status === "overdue";

  return (
    <section aria-label="GLP-1" className="flex items-center gap-3 rounded-2xl bg-container px-4 py-3">
      <Syringe className={`size-5 shrink-0 ${late ? "text-action" : "text-subtle"}`} aria-hidden="true" />
      {view.settings && text ? (
        <>
          <button type="button" onClick={open} className="min-w-0 flex-1 text-left">
            <span className={`block font-semibold ${view.status === "overdue" ? "text-action" : ""}`}>{text}</span>
            <span className="block truncate text-xs text-muted">{view.settings.medication}</span>
          </button>
          <button type="button" onClick={() => setLogging(true)} className={`${primaryButton} shrink-0 px-4 py-1.5 text-sm`}>
            Log shot
          </button>
        </>
      ) : (
        <button type="button" onClick={open} className="flex-1 text-left font-semibold text-link">
          Set up your GLP-1
        </button>
      )}
      {logging && (
        <ShotSheet
          view={view}
          onClose={() => setLogging(false)}
          onSaved={(v) => {
            setView(v);
            setLogging(false);
          }}
        />
      )}
    </section>
  );
}
