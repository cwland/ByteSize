import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { api } from "../../api";
import { Card } from "../ui/Card";
import { Field } from "../ui/Field";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { Toggle } from "../ui/Toggle";
import { field, label, linkButton, primaryButton, secondaryButton } from "../ui/styles";

type Provider = "openai" | "anthropic" | "gemini" | "openrouter" | "local";
const PROVIDERS: { id: Provider; name: string }[] = [
  { id: "openai", name: "OpenAI" },
  { id: "anthropic", name: "Claude" },
  { id: "gemini", name: "Gemini" },
  { id: "openrouter", name: "OpenRouter" },
  { id: "local", name: "Home AI (Ollama, LM Studio…)" },
];

// A service as GET /api/settings/ai sends it: the key itself never comes back, only hasKey
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
type Draft = Omit<SavedService, "id"> & { id?: string; key: number; apiKey: string; removeKey: boolean; open: boolean };

let nextKey = 1;
const draftOf = (s: SavedService): Draft => ({ ...s, key: nextKey++, apiKey: "", removeKey: false, open: false });
const blank = (): Draft => ({ key: nextKey++, name: "", provider: "openai", model: "", baseUrl: null, quick: true, photos: true, hasKey: false, apiKeyUnreadable: false, apiKey: "", removeKey: false, open: true });

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

// Settings › AI services (admins): tried in order, the next one is the backup
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

  const change = (key: number, patch: Partial<Draft>) => setServices((list) => list!.map((d) => (d.key === key ? { ...d, ...patch } : d)));

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

  if (!services || !shown) return <Card title="AI services">{msg ? <Notice msg={msg} /> : <p className="text-muted">Loading…</p>}</Card>;
  return (
    <Card title="AI services" description="Used to look up foods and read meal photos and nutrition labels. If one service is down, the next one is used.">
      <div className="flex items-center gap-3">
        <Toggle label="Use AI" checked={enabled} onChange={setEnabled} />
        <span>{enabled ? "AI is on" : "AI is off. Your services are kept for when you turn it back on."}</span>
      </div>
      <ol ref={listRef} className="mt-4 flex flex-col gap-4">
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
      <button type="button" onClick={() => setServices((l) => [...l!, blank()])} className={`${linkButton} mt-3`}>
        Add a backup service
      </button>
      <Notice msg={msg} />
      <button type="button" onClick={save} disabled={busy} className={`${primaryButton} mt-5 block`}>
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

  // Another service kind has other models
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
      if (!d.model.trim() && r.recommended?.[0]) onChange({ model: r.recommended[0] });
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

  const keyHint = d.removeKey ? "The saved key will be removed when you save." : d.apiKeyUnreadable ? "The saved key can't be read (the server's secret changed). Enter it again." : d.hasKey ? "A key is saved. Leave this empty to keep it." : "";
  return (
    <li aria-label={`${place}: ${title}`} className={`rounded-xl bg-page p-4 ${dragging ? "opacity-70 shadow-lg ring-2 ring-primary" : ""}`}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-handle={d.key}
          aria-label={`Drag to reorder ${place}: ${title}`}
          title="Drag to change the order (or use the arrow keys)"
          {...handle}
          className="cursor-grab touch-none select-none rounded px-1 text-lg leading-none text-subtle hover:bg-pressed active:cursor-grabbing"
        >
          ⠿
        </button>
        <button type="button" aria-expanded={d.open} onClick={() => onChange({ open: !d.open })} className="flex min-w-0 flex-1 items-baseline gap-2 text-left">
          <span aria-hidden="true" className="text-subtle">
            {d.open ? "▾" : "▸"}
          </span>
          <span className="font-semibold">
            {place}: {title}
          </span>
          {!d.open && <span className="truncate text-sm text-muted">· {d.model || "No model yet"}</span>}
        </button>
        {count > 1 && (
          <button type="button" onClick={onRemove} className={`${linkButton} text-sm`}>
            Remove
          </button>
        )}
      </div>
      {d.open && (
        <>
          <label className={`${label} mt-3`}>
            Service
            <select aria-label="Service" value={d.provider} onChange={(e) => onChange({ provider: e.target.value as Provider })} className={field}>
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <Field label="Name" value={d.name} placeholder={PROVIDERS.find((p) => p.id === d.provider)!.name} onChange={(e) => onChange({ name: e.target.value })} />
          {(d.provider === "local" || d.baseUrl) && (
            <Field label="Address" value={d.baseUrl ?? ""} placeholder="http://192.168.1.20:11434/v1" onChange={(e) => onChange({ baseUrl: e.target.value })} />
          )}
          <Field label="API key" type="password" autoComplete="off" value={d.apiKey} placeholder={d.hasKey && !d.removeKey ? "••••••••" : ""} onChange={(e) => onChange({ apiKey: e.target.value, removeKey: false })} />
          {keyHint && (
            <p className="mt-1 text-xs text-muted">
              {keyHint}{" "}
              {d.hasKey && !d.removeKey && (
                <button type="button" onClick={() => onChange({ removeKey: true, apiKey: "" })} className={linkButton}>
                  Remove key
                </button>
              )}
            </p>
          )}
          <label className={`${label} mt-3`}>
            Model
            <select aria-label="Model" value={d.model} onChange={(e) => onChange({ model: e.target.value })} className={field}>
              {!d.model && <option value="">{models ? "Choose a model" : "Validate to load the models"}</option>}
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
          <div className="mt-3 flex flex-wrap gap-4 text-sm text-subtle">
            <span className="flex items-center gap-2">
              <Toggle label="Reads photos" checked={d.photos} onChange={(v) => onChange({ photos: v })} /> Reads photos
            </span>
            <span className="flex items-center gap-2">
              <Toggle label="Quick jobs" checked={d.quick} onChange={(v) => onChange({ quick: v })} /> Quick jobs
            </span>
          </div>
          <Notice msg={msg} />
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={validate} disabled={busy} className={`${secondaryButton} py-1.5 text-sm`}>
              Validate
            </button>
            <button type="button" onClick={test} disabled={busy} className={`${secondaryButton} py-1.5 text-sm`}>
              Test
            </button>
          </div>
        </>
      )}
    </li>
  );
}
