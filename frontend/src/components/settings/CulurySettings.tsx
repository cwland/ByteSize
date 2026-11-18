import { useEffect, useId, useState } from "react";
import { api } from "../../api";
import type { CuluryLink } from "../../types";
import { IntegrationCard } from "./IntegrationCard";
import { Field } from "../ui/Field";
import { KeyField } from "../ui/KeyField";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { primaryButton, secondaryButton } from "../ui/styles";

// Settings › Integrations › Culury (per person): the link to Culury, the recipe and meal-planning app.
// The summary only says whether a key is saved; the eye and copy buttons fetch the person's own key when
// pressed. A new address needs the key again (the server keeps a saved key with its own address).
// The card's switch is the person's own: off, ByteSize never asks their Culury (the link is kept).
export default function CulurySettings() {
  const [link, setLink] = useState<CuluryLink | null>(null);
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [loadMsg, setLoadMsg] = useState<Msg>(null);
  const addressId = useId();
  const [focus, setFocus] = useState(false); // switched on with nothing linked: the address box takes the focus
  useEffect(() => {
    if (focus && link?.enabled) document.getElementById(addressId)?.focus();
  }, [focus, link?.enabled, addressId]);

  const show = (l: CuluryLink) => {
    setLink(l);
    setUrl(l.url ?? "");
    setKey("");
  };
  useEffect(() => {
    api<CuluryLink>("GET", "/api/settings/culury").then(show, (e) => setLoadMsg(errorMsg(e)));
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

  // The switch alone: the address and key stay as they are
  const onSwitch = async (enabled: boolean) => {
    const l = await api<CuluryLink>("PUT", "/api/settings/culury/enabled", { enabled });
    setLink(l);
    setFocus(enabled && !(l.url && l.hasKey));
  };

  const linked = !!link?.url && link.hasKey;
  return (
    <IntegrationCard
      title="Culury"
      on={link ? link.enabled : null}
      onSwitch={onSwitch}
      loading={loadMsg ? <Notice msg={loadMsg} /> : <p className="text-muted">Loading…</p>}
      description="Log meals you planned in Culury, your recipe app. ByteSize reads your meal plan and recipes; nothing changes in Culury."
    >
      <p className="text-sm text-subtle">{linked ? "Linked. A key is saved — leave the key empty to keep it." : "Not linked yet."}</p>
      <form
        className="mt-3 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field id={addressId} label="Culury address" type="url" autoComplete="off" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://192.168.1.20:4000" />
        <KeyField
          label="API key"
          keyName="Culury key"
          autoComplete="new-password"
          value={key}
          onChange={setKey}
          saved={!!link?.hasKey}
          fetchSaved={async () => (await api<{ key: string }>("GET", "/api/settings/culury/key")).key}
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
    </IntegrationCard>
  );
}
