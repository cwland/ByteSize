import { useEffect, useState } from "react";
import { api } from "../../api";
import type { CuluryLink } from "../../types";
import { Card } from "../ui/Card";
import { Field } from "../ui/Field";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { primaryButton, secondaryButton } from "../ui/styles";

// Settings › Integrations (per person): the link to Culury, the recipe and meal-planning app.
// The key is never sent back — the server only says whether one is saved. A new address needs the key
// again (the server keeps a saved key with its own address).
export default function IntegrationsSettings() {
  const [link, setLink] = useState<CuluryLink | null>(null);
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  const show = (l: CuluryLink) => {
    setLink(l);
    setUrl(l.url ?? "");
    setKey("");
  };
  useEffect(() => {
    api<CuluryLink>("GET", "/api/settings/culury").then(show, (e) => setMsg(errorMsg(e)));
  }, []);

  const run = async (work: () => Promise<Msg>) => {
    setBusy(true);
    setMsg(null);
    try {
      setMsg(await work());
    } catch (e) {
      setMsg(errorMsg(e));
    } finally {
      setBusy(false);
    }
  };
  const typed = () => ({ url: url.trim(), ...(key.trim() ? { apiKey: key.trim() } : {}) });
  const save = () =>
    run(async () => {
      show(await api<CuluryLink>("PUT", "/api/settings/culury", typed()));
      return { ok: true, text: "Culury linked" };
    });
  // Nothing changed: test the saved link; otherwise what's typed, before saving it
  const test = () =>
    run(async () => {
      const changed = !!key.trim() || url.trim() !== (link?.url ?? "");
      const r = await api<{ message: string }>("POST", "/api/settings/culury/test", changed ? typed() : undefined);
      return { ok: true, text: r.message };
    });
  const remove = () =>
    run(async () => {
      show(await api<CuluryLink>("DELETE", "/api/settings/culury"));
      return { ok: true, text: "Culury unlinked" };
    });

  const linked = !!link?.url && link.hasKey;
  return (
    <Card title="Culury" description="Log meals you planned in Culury, your recipe app. ByteSize reads your meal plan and recipes; nothing changes in Culury.">
      {link && <p className="text-sm text-subtle">{linked ? "Linked. A key is saved — leave the key empty to keep it." : "Not linked yet."}</p>}
      <form
        className="mt-3 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Culury address" type="url" autoComplete="off" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://192.168.1.20:4000" />
        <Field
          label="API key"
          type="password"
          autoComplete="off"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={link?.hasKey ? "Enter a new key to replace it" : "Paste a Read only key"}
        />
        <p className="text-xs text-muted">Make one in Culury › Settings › API keys, with Read only access.</p>
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={primaryButton} disabled={busy || !url.trim()}>
            Save
          </button>
          <button type="button" className={secondaryButton} disabled={busy || !url.trim()} onClick={() => void test()}>
            Test connection
          </button>
          {linked && (
            <button type="button" className="ml-auto text-sm text-error hover:underline" disabled={busy} onClick={() => void remove()}>
              Remove
            </button>
          )}
        </div>
      </form>
      <Notice msg={msg} />
    </Card>
  );
}
