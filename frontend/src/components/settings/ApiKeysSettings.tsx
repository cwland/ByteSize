import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Copy } from "lucide-react";
import { api } from "../../api";
import { when } from "../../format";
import { todayIn } from "../../selectedDay";
import { useSession } from "../../session";
import { Card } from "../ui/Card";
import { Choice } from "../ui/Choice";
import { Confirm } from "../ui/Confirm";
import { Field } from "../ui/Field";
import { KeyField, copyText } from "../ui/KeyField";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { linkButton, primaryButton, secondaryButton } from "../ui/styles";

// Settings › API keys (everyone): the person's own keys for their tools (Home Assistant, n8n, Shortcuts,
// scripts). A key is sent by the server only when it's made and when its owner presses the eye or copy.

type Access = "read" | "log";
export interface ApiKey {
  id: number;
  name: string;
  prefix: string; // the first characters ("bs_3f9aK2xQ")
  access: Access;
  createdAt: string;
  lastUsedAt: string | null;
}

const ACCESS: { value: Access; label: string }[] = [
  { value: "read", label: "Read only" },
  { value: "log", label: "Read and log" },
];
const accessLabel = (a: Access) => ACCESS.find((o) => o.value === a)?.label ?? a;
const ACCESS_HINT: Record<Access, string> = {
  read: "Can look at your day, foods, weight, GLP-1, goals and trends. Can't change anything.",
  log: "Can also add, edit and delete log entries, weigh-ins, water and shots.",
};
const made = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
const fetchKey = (k: ApiKey) => api<{ key: string }>("GET", `/api/keys/${k.id}/key`).then((r) => r.key);

export default function ApiKeysSettings() {
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [making, setMaking] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null); // a key just made, shown until Done
  const [msg, setMsg] = useState<Msg>(null);

  const load = useCallback(async () => {
    try {
      setKeys((await api<{ keys: ApiKey[] }>("GET", "/api/keys")).keys);
    } catch (e) {
      setMsg(errorMsg(e));
    }
  }, []);
  useEffect(() => void load(), [load]);

  const replace = (k: ApiKey) => setKeys((list) => (list ?? []).map((x) => (x.id === k.id ? k : x)));

  return (
    <>
      <Card title="API keys" description="Let your own tools, like Home Assistant, n8n, Shortcuts or a script, read your ByteSize data or log for you. A key works as you, and only you.">
        {fresh ? (
          <div className="rounded-xl bg-page p-4">
            <KeyField label="Your new key" keyName="new key" value={fresh} onChange={() => {}} saved={false} fetchSaved={async () => fresh} readOnly defaultShown />
            <p className="mt-2 text-sm text-subtle">Copy it into your tool now. You can show it again later with the eye.</p>
            <button type="button" onClick={() => setFresh(null)} className={`${secondaryButton} mt-3`}>
              Done
            </button>
          </div>
        ) : making ? (
          <NewKey
            onCancel={() => setMaking(false)}
            onMade={(k, key) => {
              setKeys((list) => [...(list ?? []), k]);
              setMaking(false);
              setFresh(key);
            }}
          />
        ) : (
          <div className="flex justify-end">
            <button type="button" onClick={() => setMaking(true)} className={secondaryButton}>
              New key
            </button>
          </div>
        )}
        <Notice msg={msg} />
        {keys === null ? (
          <p className="mt-4 text-muted">Loading…</p>
        ) : keys.length === 0 ? (
          <p className="mt-4 text-muted">No keys yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-line">
            {keys.map((k) => (
              <KeyRow key={k.id} k={k} onChanged={replace} onDeleted={() => setKeys((list) => (list ?? []).filter((x) => x.id !== k.id))} />
            ))}
          </ul>
        )}
      </Card>
      <HowToUse />
    </>
  );
}

function NewKey({ onMade, onCancel }: { onMade: (k: ApiKey, key: string) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [access, setAccess] = useState<Access>("read");
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const { key, ...row } = await api<ApiKey & { key: string }>("POST", "/api/keys", { name: name.trim(), access });
      onMade(row, key);
    } catch (err) {
      setMsg(errorMsg(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} aria-label="New key" className="rounded-xl bg-page p-4">
      <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Home Assistant" maxLength={60} required />
      <p className="mt-3 text-sm font-medium text-subtle">What it can do</p>
      <div className="mt-1">
        <Choice label="What it can do" value={access} options={ACCESS} onChange={setAccess} />
      </div>
      <p className="mt-2 text-sm text-subtle">{ACCESS_HINT[access]}</p>
      <Notice msg={msg} />
      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={busy || !name.trim()} className={primaryButton}>
          Make key
        </button>
        <button type="button" onClick={onCancel} className={secondaryButton}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function KeyRow({ k, onChanged, onDeleted }: { k: ApiKey; onChanged: (k: ApiKey) => void; onDeleted: () => void }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(k.name);
  const [changing, setChanging] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  async function patch(change: { name?: string; access?: Access }) {
    setMsg(null);
    try {
      onChanged((await api<{ key: ApiKey }>("PATCH", `/api/keys/${k.id}`, change)).key);
      return true;
    } catch (e) {
      setMsg(errorMsg(e));
      return false;
    }
  }

  async function rename(e: FormEvent) {
    e.preventDefault();
    if (await patch({ name: name.trim() })) setRenaming(false);
  }

  async function remove() {
    setDeleting(false);
    setMsg(null);
    try {
      await api("DELETE", `/api/keys/${k.id}`);
      onDeleted();
    } catch (e) {
      setMsg(errorMsg(e));
    }
  }

  return (
    <li aria-label={k.name} className="py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="min-w-0 flex-1 truncate font-semibold">{k.name}</p>
        <span className="rounded-full bg-pressed px-2.5 py-0.5 text-xs font-semibold text-subtle">{accessLabel(k.access)}</span>
      </div>
      <p className="mt-0.5 text-sm text-muted">
        <span className="font-mono">{k.prefix}…</span> · Made {made(k.createdAt)} · Last used {when(k.lastUsedAt)}
      </p>
      <div className="mt-2">
        <KeyField label={`${k.name} key`} keyName={`${k.name} key`} showLabel={false} value="" onChange={() => {}} saved fetchSaved={() => fetchKey(k)} placeholder="Press the eye to show the key" readOnly />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        <button type="button" onClick={() => setRenaming((r) => !r)} className={`${linkButton} text-sm`}>
          Rename
        </button>
        <button type="button" onClick={() => setChanging((c) => !c)} className={`${linkButton} text-sm`}>
          Change access
        </button>
        <button type="button" onClick={() => setDeleting(true)} className={`${linkButton} text-sm text-error`}>
          Delete
        </button>
      </div>
      {renaming && (
        <form onSubmit={rename} aria-label={`Rename ${k.name}`} className="mt-2 flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1">
            <Field label="New name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />
          </div>
          <button type="submit" disabled={!name.trim()} className={primaryButton}>
            Save
          </button>
        </form>
      )}
      {changing && (
        <div className="mt-2">
          <Choice
            label={`What ${k.name} can do`}
            value={k.access}
            options={ACCESS}
            onChange={(access) => {
              if (access === k.access) return setChanging(false);
              void patch({ access }).then((ok) => ok && setChanging(false));
            }}
          />
          <p className="mt-1 text-sm text-subtle">{ACCESS_HINT[k.access]}</p>
        </div>
      )}
      <Notice msg={msg} />
      {deleting && (
        <Confirm
          title={`Delete ${k.name}?`}
          text="Anything using this key stops working at once. This can't be undone."
          confirmLabel="Delete key"
          onConfirm={() => void remove()}
          onCancel={() => setDeleting(false)}
        />
      )}
    </li>
  );
}

// The header line and two curl examples with this server's address, each with a copy button
function HowToUse() {
  const { user } = useSession();
  const origin = window.location.origin;
  const auth = `-H "Authorization: Bearer <your key>"`;
  const examples = [
    { what: "today's day", text: `curl ${auth} ${origin}/api/day/${todayIn(user.timezone)}` },
    { what: "logging water", text: `curl -X POST ${auth} -H "Content-Type: application/json" -d '{"water_ml": 250}' ${origin}/api/log` },
  ];
  return (
    <Card title="How to use a key" description="Send the key with every request, in this header:">
      <code className="block rounded-xl bg-page px-3 py-2 font-mono text-sm break-all">Authorization: Bearer &lt;your key&gt;</code>
      <p className="mt-4 text-sm text-subtle">For example, to read today, then to log 250 ml of water:</p>
      {examples.map((ex) => (
        <Example key={ex.what} what={ex.what} text={ex.text} />
      ))}
      <p className="mt-3 text-sm text-subtle">Replace &lt;your key&gt; with the key. A key gets 120 requests a minute.</p>
    </Card>
  );
}

function Example({ what, text }: { what: string; text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state !== "copied") return;
    const t = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(t);
  }, [state]);
  return (
    <div className="mt-2">
      <div className="flex items-start gap-2 rounded-xl bg-page px-3 py-2">
        <code className="min-w-0 flex-1 font-mono text-sm break-all">{text}</code>
        <button type="button" aria-label={`Copy the example for ${what}`} title="Copy" onClick={() => void copyText(text).then((ok) => setState(ok ? "copied" : "failed"))} className="shrink-0 text-subtle hover:text-ink">
          {state === "copied" ? <span className="text-xs font-semibold text-success">Copied</span> : <Copy className="size-4" />}
        </button>
      </div>
      {state === "failed" && (
        <p role="alert" className="mt-1 text-xs text-error">
          Couldn't copy. Select the line and copy it by hand.
        </p>
      )}
    </div>
  );
}
