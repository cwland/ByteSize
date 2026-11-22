import { useState } from "react";
import { ChevronRight, Sparkles, Wrench, RefreshCw } from "lucide-react";
import { CHANGELOG, changeCount, isNewer, type Release } from "../changelog";
import { APP_VERSION } from "../version";
import { Sheet } from "./ui/Sheet";
import { primaryButton } from "./ui/styles";

const longDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
const shortDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

const KINDS = [
  { key: "added", label: "Added", Icon: Sparkles, tone: "text-success" },
  { key: "changed", label: "Changed", Icon: RefreshCw, tone: "text-link" },
  { key: "fixed", label: "Fixed", Icon: Wrench, tone: "text-warning" },
] as const;

// "What's new" (W1, as in RecipeHub; SPEC-19 like YAHD2): the versions you haven't seen (or just the current one) open in
// full, grouped as Added / Changed / Fixed; every earlier version is a folded row under "Earlier updates" that opens
// in place. `all` (from the version number) has nothing new to show beyond the current version.
export default function WhatsNew({ since, onClose }: { since?: string | null; all?: boolean; onClose: () => void }) {
  const released = CHANGELOG.filter((r) => !isNewer(r.version, APP_VERSION));
  const fresh = since ? released.filter((r) => isNewer(r.version, since)) : [];
  const open = fresh.length ? fresh : released.slice(0, 1);
  const folded = released.filter((r) => !open.includes(r));
  const current = released.find((r) => r.version === APP_VERSION);

  return (
    <Sheet label="What's new" onClose={onClose}>
      <div className="flex flex-col gap-5 px-1 pb-4">
        <p className="text-sm text-subtle">{`ByteSize v${APP_VERSION}${current ? ` · ${shortDate(current.date)}` : ""}`}</p>
        {open.map((r) => (
          <section key={r.version} aria-label={`Version ${r.version}`} className="rounded-2xl bg-pressed p-4">
            <Header r={r} current={r.version === APP_VERSION} />
            <Changes r={r} />
          </section>
        ))}
        {folded.length > 0 && (
          <div>
            <h3 className="px-1 text-xs font-semibold tracking-wide text-muted uppercase">Earlier updates</h3>
            <ul className="mt-2 flex flex-col divide-y divide-line overflow-hidden rounded-2xl border border-line">
              {folded.map((r) => (
                <Folded key={r.version} r={r} />
              ))}
            </ul>
          </div>
        )}
        <div className="flex justify-end border-t border-line pt-4">
          <button type="button" onClick={onClose} className={`${primaryButton} px-5 py-2.5`}>
            Got it
          </button>
        </div>
      </div>
    </Sheet>
  );
}

function Header({ r, current }: { r: Release; current: boolean }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-lg font-bold">{`v${r.version}`}</h3>
        {current && <span className="rounded-full bg-brand-subtle px-2 py-0.5 text-xs font-semibold text-success">Current version</span>}
        <span className="ml-auto text-sm text-muted">{longDate(r.date)}</span>
      </div>
      {r.title && <p className="mt-0.5 font-semibold text-subtle">{r.title}</p>}
    </div>
  );
}

function Changes({ r }: { r: Release }) {
  return (
    <div className="mt-3 flex flex-col gap-3">
      {KINDS.filter((k) => r[k.key]?.length).map(({ key, label, Icon, tone }) => (
        <div key={key}>
          <h4 className={`flex items-center gap-1.5 text-sm font-bold ${tone}`}>
            <Icon aria-hidden="true" className="size-4" />
            {label}
          </h4>
          <ul className="mt-1 list-disc space-y-1.5 pl-6 text-sm">
            {r[key]!.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// An earlier version: › version · title, "N changes · date"; opens in place
function Folded({ r }: { r: Release }) {
  const [open, setOpen] = useState(false);
  const n = changeCount(r);
  return (
    <li>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-pressed">
        <ChevronRight aria-hidden="true" className={`size-4 shrink-0 text-muted transition-transform ${open ? "rotate-90" : ""}`} />
        <span className="min-w-0 flex-1">
          <span className="font-semibold">{`Version ${r.version}`}</span>
          {r.title && <span className="text-subtle">{` · ${r.title}`}</span>}
        </span>
        <span className="shrink-0 text-xs text-muted">{`${n} change${n === 1 ? "" : "s"} · ${shortDate(r.date)}`}</span>
      </button>
      {open && (
        <section aria-label={`Version ${r.version}`} className="px-4 pb-4">
          <Changes r={r} />
        </section>
      )}
    </li>
  );
}
