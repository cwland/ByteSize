import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
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
type Draft = Omit<SavedService, "id"> & { id?: string; key: number; apiKey: string; removeKey: boolean };

let nextKey = 1;
const draftOf = (s: SavedService): Draft => ({ ...s, key: nextKey++, apiKey: "", removeKey: false });
const blank = (): Draft => ({ key: nextKey++, name: "", provider: "openai", model: "", baseUrl: null, quick: true, photos: true, hasKey: false, apiKeyUnreadable: false, apiKey: "", removeKey: false });

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
  const move = (i: number, by: number) =>
    setServices((list) => {
      const l = [...list!];
      [l[i], l[i + by]] = [l[i + by], l[i]];
      return l;
    });

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

  if (!services) return <Card title="AI services">{msg ? <Notice msg={msg} /> : <p className="text-muted">Loading…</p>}</Card>;
  return (
    <Card title="AI services" description="Used to look up foods and read meal photos and nutrition labels. If one service is down, the next one is used.">
      <div className="flex items-center gap-3">
        <Toggle label="Use AI" checked={enabled} onChange={setEnabled} />
        <span>{enabled ? "AI is on" : "AI is off. Your services are kept for when you turn it back on."}</span>
      </div>
      <ol className="mt-4 flex flex-col gap-4">
        {services.map((d, i) => (
          <ServiceForm
            key={d.key}
            draft={d}
            index={i}
            count={services.length}
            onChange={(p) => change(d.key, p)}
            onMove={(by) => move(i, by)}
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

function ServiceForm({ draft: d, index, count, onChange, onMove, onRemove }: { draft: Draft; index: number; count: number; onChange: (p: Partial<Draft>) => void; onMove: (by: number) => void; onRemove: () => void }) {
  const title = d.name || PROVIDERS.find((p) => p.id === d.provider)!.name;
  const [models, setModels] = useState<string[]>([]);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const listId = `ai-models-${d.key}`;

  async function run(what: "test" | "models") {
    setBusy(true);
    setMsg(null);
    try {
      if (what === "models") {
        const r = await api<{ models: string[] }>("POST", "/api/settings/ai/models", wire(d));
        setModels(r.models);
        setMsg({ ok: true, text: `${r.models.length} models found` });
      } else {
        const r = await api<{ message: string }>("POST", "/api/settings/ai/test", wire(d));
        setMsg({ ok: true, text: r.message });
      }
    } catch (e) {
      setMsg(errorMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const keyHint = d.removeKey ? "The saved key will be removed when you save." : d.apiKeyUnreadable ? "The saved key can't be read (the server's secret changed). Enter it again." : d.hasKey ? "A key is saved. Leave this empty to keep it." : "";
  return (
    <li aria-label={`${index === 0 ? "Main" : "Backup"}: ${title}`} className="rounded-xl bg-page p-4">
      <div className="flex items-center gap-2">
        <h3 className="flex-1 font-semibold">
          {index === 0 ? "Main" : `Backup ${index}`}: {title}
        </h3>
        <button type="button" aria-label="Move up" disabled={index === 0} onClick={() => onMove(-1)} className="rounded p-1 text-subtle hover:bg-page disabled:opacity-30">
          <ArrowUp className="size-4" />
        </button>
        <button type="button" aria-label="Move down" disabled={index === count - 1} onClick={() => onMove(1)} className="rounded p-1 text-subtle hover:bg-page disabled:opacity-30">
          <ArrowDown className="size-4" />
        </button>
        {count > 1 && (
          <button type="button" onClick={onRemove} className={`${linkButton} text-sm`}>
            Remove
          </button>
        )}
      </div>
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
      <Field label="Model" list={listId} value={d.model} onChange={(e) => onChange({ model: e.target.value })} />
      <datalist id={listId}>
        {models.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
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
        <button type="button" onClick={() => run("models")} disabled={busy} className={`${secondaryButton} py-1.5 text-sm`}>
          Find models
        </button>
        <button type="button" onClick={() => run("test")} disabled={busy} className={`${secondaryButton} py-1.5 text-sm`}>
          Test
        </button>
      </div>
    </li>
  );
}
