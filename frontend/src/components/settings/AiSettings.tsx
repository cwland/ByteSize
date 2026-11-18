import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { api } from "../../api";
import { Card } from "../ui/Card";
import { KeyField } from "../ui/KeyField";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { Toggle } from "../ui/Toggle";
import { field, label, linkButton, primaryButton, secondaryButton } from "../ui/styles";

type Provider = "openai" | "anthropic" | "gemini" | "openrouter" | "local";
// label: shown in the Provider list; name: the service's default name; hint/keyUrl: where its key comes from
const PROVIDERS: { id: Provider; name: string; label: string; hint: string; keyUrl?: string }[] = [
  { id: "openai", name: "OpenAI", label: "OpenAI", hint: "API key from platform.openai.com", keyUrl: "https://platform.openai.com/api-keys" },
  { id: "anthropic", name: "Claude", label: "Anthropic (Claude)", hint: "API key from console.anthropic.com", keyUrl: "https://console.anthropic.com/settings/keys" },
  { id: "gemini", name: "Gemini", label: "Google Gemini", hint: "API key from Google AI Studio", keyUrl: "https://aistudio.google.com/apikey" },
  { id: "openrouter", name: "OpenRouter", label: "OpenRouter", hint: "One key for many models, from openrouter.ai", keyUrl: "https://openrouter.ai/settings/keys" },
  { id: "local", name: "Home AI", label: "Home AI (Ollama, LM Studio…)", hint: "Ollama, LM Studio, LocalAI, vLLM… on your own network. Nothing leaves your network." },
];

// A service as GET /api/settings/ai sends it: the key itself never comes with it, only hasKey (the eye and
// copy buttons fetch it on their own, from /api/settings/ai/:id/key)
interface SavedService {
  id: string;
  name: string;
  provider: Provider;
  model: string;
  baseUrl: string | null;
  quick: boolean;
  photos: boolean;
  hasKey: boolean;
  apiKeyUnreadable: boolean;
}
interface Summary {
  enabled: boolean;
  timeoutSec: number;
  services: SavedService[];
}
// On screen: apiKey "" = keep the saved key (or none); removeKey = delete it
// open: shown in full (saved services start folded to name + model, new ones open)
// checked: Validate (or Test) passed since the service, key or address last changed; saved ones count as checked
type Draft = Omit<SavedService, "id"> & { id?: string; key: number; apiKey: string; removeKey: boolean; open: boolean; checked: boolean };

let nextKey = 1;
const draftOf = (s: SavedService): Draft => ({ ...s, key: nextKey++, apiKey: "", removeKey: false, open: false, checked: true });
const blank = (): Draft => ({ key: nextKey++, name: "", provider: "openai", model: "", baseUrl: null, quick: true, photos: true, hasKey: false, apiKeyUnreadable: false, apiKey: "", removeKey: false, open: true, checked: false });

// The list with one item moved from one place to another
const moved = <T,>(list: T[], from: number, to: number) => {
  const l = [...list];
  const [item] = l.splice(from, 1);
  l.splice(to, 0, item);
  return l;
};

// What the API takes for one service (apiKey left out = keep the saved one)
const wire = (d: Draft) => ({
  id: d.id,
  name: d.name.trim() || undefined,
  provider: d.provider,
  model: d.model.trim(),
  baseUrl: d.baseUrl?.trim() || null,
  quick: d.quick,
  photos: d.photos,
  ...(d.apiKey.trim() ? { apiKey: d.apiKey.trim() } : d.removeKey ? { apiKey: "" } : {}),
});

// Settings › Integrations › AI services (admins): tried in order, the next one is the backup
export default function AiSettings() {
  const [enabled, setEnabled] = useState(true);
  const [services, setServices] = useState<Draft[] | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  const show = (s: Summary | null) => {
    setEnabled(s?.enabled ?? true);
    setServices(s?.services.length ? s.services.map(draftOf) : [blank()]);
  };
  const load = useCallback(async () => {
    try {
      show((await api<{ settings: Summary | null }>("GET", "/api/settings/ai")).settings);
    } catch (e) {
      setMsg(errorMsg(e));
    }
  }, []);
  useEffect(() => void load(), [load]);

  // A new service, key or address has to be validated again before Save
  const change = (key: number, patch: Partial<Draft>) => {
    const recheck = ("provider" in patch || "apiKey" in patch || "baseUrl" in patch) && !("checked" in patch);
    setServices((list) => list!.map((d) => (d.key === key ? { ...d, ...patch, ...(recheck ? { checked: false } : {}) } : d)));
  };

  // Order: drag a service by its ⠿ handle (mouse or touch), or arrow keys on the focused handle.
  // While dragging, the list shows where it would land; letting go keeps that order.
  const listRef = useRef<HTMLOListElement>(null);
  const drag = useRef<{ pointerId: number; from: number; to: number; mids: number[] } | null>(null);
  const [dragTo, setDragTo] = useState<number | null>(null);
  const [focusKey, setFocusKey] = useState<number | null>(null);
  const shown = services && drag.current && dragTo !== null ? moved(services, drag.current.from, dragTo) : services;

  const startDrag = (i: number, e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || !listRef.current) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      // (no capture: moves still arrive while the pointer is over the handle)
    }
    // Where each row's middle is, measured once in the order the drag started from
    const mids = Array.from(listRef.current.children).map((row) => {
      const r = row.getBoundingClientRect();
      return r.top + r.height / 2;
    });
    drag.current = { pointerId: e.pointerId, from: i, to: i, mids };
    setDragTo(i);
  };
  const moveDrag = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    // The new place = how many of the other rows' middles are above the pointer (so always inside the list)
    d.to = d.mids.filter((m, j) => j !== d.from && m < e.clientY).length;
    setDragTo(d.to);
  };
  const endDrag = (e: PointerEvent<HTMLButtonElement>, keep: boolean) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if (keep && d.to !== d.from) setServices((list) => moved(list!, d.from, d.to));
    drag.current = null;
    setDragTo(null);
  };
  const keyMove = (i: number, e: KeyboardEvent<HTMLButtonElement>) => {
    const by = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
    if (!by) return;
    e.preventDefault();
    if (i + by < 0 || i + by >= services!.length) return;
    setFocusKey(services![i].key);
    setServices((list) => moved(list!, i, i + by));
  };
  // Keep the moved service's handle focused so the arrow keys can carry on
  useEffect(() => {
    if (focusKey === null) return;
    listRef.current?.querySelector<HTMLButtonElement>(`[data-handle="${focusKey}"]`)?.focus();
    setFocusKey(null);
  }, [focusKey, services]);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ settings: Summary }>("PUT", "/api/settings/ai", { enabled, services: services!.map(wire) });
      show(r.settings);
      setMsg({ ok: true, text: "Saved" });
    } catch (e) {
      setMsg(errorMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const allChecked = !!services?.every((d) => d.checked);
  if (!services || !shown) return <Card title="AI services">{msg ? <Notice msg={msg} /> : <p className="text-muted">Loading…</p>}</Card>;
  return (
    <Card title="AI services" description="Used to look up foods and read meal photos and nutrition labels. If one service is down, the next one is used.">
      <div className="flex items-center gap-3">
        <Toggle label="Use AI" checked={enabled} onChange={setEnabled} />
        <span>{enabled ? "AI is on" : "AI is off. Your services are kept for when you turn it back on."}</span>
      </div>
      <p className="mt-4 text-sm text-subtle">Tried from the top. If one is down or doesn't answer in time, the next one is asked. Drag ⠿ (or use the arrow keys) to change the order.</p>
      <ol ref={listRef} className="mt-3 flex flex-col gap-3">
        {shown.map((d, i) => (
          <ServiceForm
            key={d.key}
            draft={d}
            index={i}
            count={shown.length}
            dragging={dragTo !== null && drag.current?.from === services.indexOf(d)}
            handle={{
              onPointerDown: (e) => startDrag(services.indexOf(d), e),
              onPointerMove: moveDrag,
              onPointerUp: (e) => endDrag(e, true),
              onPointerCancel: (e) => endDrag(e, false),
              onKeyDown: (e) => keyMove(i, e),
            }}
            onChange={(p) => change(d.key, p)}
            onRemove={() => setServices((l) => l!.filter((x) => x.key !== d.key))}
          />
        ))}
      </ol>
      <button type="button" onClick={() => setServices((l) => [...l!, blank()])} className="mt-3 font-semibold text-link hover:underline">
        + Add a backup AI service
      </button>
      <p className="mt-5 rounded-lg bg-page px-3 py-2 text-sm text-subtle">
        Sent to the AI: only what a task needs, such as a food you described or a photo of a meal or label. Never passwords, keys or anything from your account. For private use, put a home AI (Ollama, LM Studio) first.
      </p>
      <Notice msg={msg} />
      {!allChecked && <p className="mt-4 text-sm text-muted">Validate each new or changed service before saving.</p>}
      <button type="button" onClick={save} disabled={busy || !allChecked} className={`${primaryButton} mt-5 block`}>
        Save
      </button>
    </Card>
  );
}

type HandleEvents = {
  onPointerDown: (e: PointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (e: PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (e: PointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: (e: PointerEvent<HTMLButtonElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
};

function ServiceForm({
  draft: d,
  index,
  count,
  dragging,
  handle,
  onChange,
  onRemove,
}: {
  draft: Draft;
  index: number;
  count: number;
  dragging: boolean;
  handle: HandleEvents;
  onChange: (p: Partial<Draft>) => void;
  onRemove: () => void;
}) {
  const title = d.name || PROVIDERS.find((p) => p.id === d.provider)!.name;
  const place = index === 0 ? "Main" : `Backup ${index}`;
  // From Validate: every model the service offers, and the ones suggested for ByteSize
  const [models, setModels] = useState<{ all: string[]; recommended: string[] } | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  // Another service kind has other models (the model itself is cleared when the kind changes)
  const provider = useRef(d.provider);
  useEffect(() => {
    if (provider.current === d.provider) return;
    provider.current = d.provider;
    setModels(null);
    setMsg(null);
  }, [d.provider]);

  async function validate() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ models: string[]; recommended: string[] }>("POST", "/api/settings/ai/models", wire(d));
      setModels({ all: r.models, recommended: r.recommended ?? [] });
      setMsg({ ok: true, text: `Key works · ${r.models.length} models` });
      onChange({ checked: true, ...(!d.model.trim() && r.recommended?.[0] ? { model: r.recommended[0] } : {}) });
    } catch (e) {
      setMsg(errorMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ message: string }>("POST", "/api/settings/ai/test", wire(d));
      setMsg({ ok: true, text: r.message });
      onChange({ checked: true });
    } catch (e) {
      setMsg(errorMsg(e));
    } finally {
      setBusy(false);
    }
  }

  // The Model dropdown: Recommended on top, then the rest A–Z (a saved model not in the list is kept)
  const recommended = models?.recommended ?? [];
  const rest = [...new Set([...(models?.all ?? []), ...(d.model && !recommended.includes(d.model) ? [d.model] : [])])]
    .filter((m) => !recommended.includes(m))
    .sort((a, b) => a.localeCompare(b));

  const info = PROVIDERS.find((p) => p.id === d.provider)!;
  const keyHint = d.removeKey ? "The saved key will be removed when you save." : d.apiKeyUnreadable ? "The saved key can't be read (the server's secret changed). Paste it again." : d.hasKey ? "A key is saved. Leave this empty to keep it." : "";
  const sub = "text-sm font-medium text-subtle";
  return (
    <li
      aria-label={`${place}: ${title}`}
      className={`relative rounded-xl border bg-container p-4 pl-9 ${dragging ? "z-10 border-action shadow-lg" : "border-line"}`}
    >
      {/* Left edge: drag handle, and under it show / hide */}
      <button
        type="button"
        data-handle={d.key}
        aria-label={`Drag to reorder ${place}: ${title}`}
        title="Drag to change the order (or use the arrow keys)"
        {...handle}
        className="absolute top-4 left-1.5 flex h-8 w-6 cursor-grab touch-none items-center justify-center rounded text-lg leading-none text-muted select-none hover:text-ink active:cursor-grabbing"
      >
        ⠿
      </button>
      <button
        type="button"
        aria-expanded={d.open}
        aria-label={d.open ? `Hide ${title} settings` : `Show ${title} settings`}
        title={d.open ? `Hide ${title} settings` : `Show ${title} settings`}
        onClick={() => onChange({ open: !d.open })}
        className="absolute top-12 left-1.5 flex size-6 items-center justify-center rounded text-subtle hover:bg-page hover:text-ink"
      >
        {d.open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
      </button>

      {/* Number · name (edit in place) · its place in the list */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-on-primary">{index + 1}</span>
        <input
          aria-label="Service name"
          value={d.name}
          placeholder={info.name}
          onChange={(e) => onChange({ name: e.target.value })}
          className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-1 text-lg font-semibold text-ink outline-none placeholder:text-ink hover:border-line focus:border-action"
        />
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${index === 0 ? "bg-pressed text-link" : "bg-page text-subtle"}`}>
          {index === 0 ? "Asked first" : `Backup ${index}`}
        </span>
      </div>

      {!d.open && (
        <p className="mt-1 truncate pl-9 text-sm text-subtle">
          {info.label}
          {d.model ? ` · ${d.model}` : " · no model yet"}
          {d.provider === "local" && d.baseUrl ? ` · ${d.baseUrl}` : ""}
        </p>
      )}

      {d.open && (
        <div className="mt-3 grid gap-3">
          <label className={sub}>
            Provider
            <select aria-label="Service" value={d.provider} onChange={(e) => onChange({ provider: e.target.value as Provider, model: "" })} className={field}>
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <span className="mt-1 block font-normal">
              {info.hint}
              {info.keyUrl && (
                <>
                  {" · "}
                  <a href={info.keyUrl} target="_blank" rel="noreferrer" className="text-link hover:underline">
                    Get a key
                  </a>
                </>
              )}
            </span>
          </label>

          {(d.provider === "local" || d.baseUrl) && (
            <label className={sub}>
              Server address
              <input aria-label="Address" placeholder="http://192.168.1.20:11434/v1" value={d.baseUrl ?? ""} onChange={(e) => onChange({ baseUrl: e.target.value })} className={field} />
            </label>
          )}

          {/* The key, with show / hide, and Validate right beside it */}
          <div role="group" aria-label="API key and Validate">
            <label htmlFor={`ai-key-${d.key}`} className={sub}>
              API key {d.provider === "local" && <span className="font-normal">(optional)</span>}
            </label>
            <div className="mt-1 flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <KeyField
                  id={`ai-key-${d.key}`}
                  label="API key"
                  keyName={`${title} key`}
                  showLabel={false}
                  value={d.apiKey}
                  onChange={(v) => onChange({ apiKey: v, removeKey: false })}
                  saved={!!d.id && d.hasKey && !d.removeKey}
                  fetchSaved={async () => (await api<{ key: string }>("GET", `/api/settings/ai/${encodeURIComponent(d.id!)}/key`)).key}
                  placeholder={d.hasKey && !d.removeKey ? "••••••••" : d.provider === "local" ? "Only if your server needs one" : "Paste your API key"}
                />
              </div>
              <button type="button" onClick={validate} disabled={busy} className={`${secondaryButton} shrink-0 py-2 text-sm`}>
                {busy ? "Checking…" : "Validate"}
              </button>
            </div>
            {keyHint && (
              <p className={`mt-1 text-xs ${d.apiKeyUnreadable ? "text-error" : "text-muted"}`}>
                {keyHint}{" "}
                {d.hasKey && !d.removeKey && (
                  <button type="button" onClick={() => onChange({ removeKey: true, apiKey: "" })} className={linkButton}>
                    Remove key
                  </button>
                )}
              </p>
            )}
          </div>

          {/* No list yet (before Validate, or it failed): type the model's name */}
          {!models?.all.length ? (
            <label className={sub}>
              Model
              <input aria-label="Model" value={d.model} placeholder="Validate to choose from a list, or type a name" onChange={(e) => onChange({ model: e.target.value })} className={`${field} font-mono`} />
            </label>
          ) : (
            <label className={sub}>
              Model
              <select aria-label="Model" value={d.model} onChange={(e) => onChange({ model: e.target.value })} className={`${field} font-mono`}>
                {!d.model && <option value="">Choose a model</option>}
                {recommended.length > 0 && (
                  <optgroup label="Recommended">
                    {recommended.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </optgroup>
                )}
                {rest.length > 0 && (
                  <optgroup label="All models">
                    {rest.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
          )}

          {/* A cheap, fast model for the small jobs; a photo-reading one for meal photos and labels */}
          <fieldset className="flex flex-col gap-2 text-sm">
            <legend className="mb-1 font-medium text-subtle">Use it for</legend>
            <label className="flex items-start gap-2">
              <input type="checkbox" aria-label="Quick jobs" checked={d.quick} onChange={(e) => onChange({ quick: e.target.checked })} className="mt-0.5 size-4 accent-[var(--color-action)]" />
              <span>
                Quick jobs <span className="text-subtle">(describing a food, filling in missing nutrients). Untick on a big, expensive model if a cheaper one is set up.</span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input type="checkbox" aria-label="Reads photos" checked={d.photos} onChange={(e) => onChange({ photos: e.target.checked })} className="mt-0.5 size-4 accent-[var(--color-action)]" />
              <span>
                Can read photos <span className="text-subtle">(meal photos and nutrition labels). Tick only if this model takes pictures — most hosted ones do; for home models, ones like qwen3-vl or gemma3.</span>
              </span>
            </label>
          </fieldset>

          <Notice msg={msg} />
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={test} disabled={busy} className={`${secondaryButton} py-2 text-sm`}>
              Test
            </button>
            {count > 1 && (
              <button type="button" onClick={onRemove} className="ml-auto text-sm text-error hover:underline">
                Remove
              </button>
            )}
          </div>
        </div>
      )}
      {!d.open && msg && (
        <div className="mt-2 pl-9">
          <Notice msg={msg} />
        </div>
      )}
    </li>
  );
}
