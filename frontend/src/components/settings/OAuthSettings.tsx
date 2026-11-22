import { useEffect, useState, type FormEvent } from "react";
import { Copy } from "lucide-react";
import { api } from "../../api";
import { clearOAuthReturn, goToProvider, oauthReturn } from "../../oauth";
import { Card } from "../ui/Card";
import { Field } from "../ui/Field";
import { KeyField, copyText } from "../ui/KeyField";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { Toggle } from "../ui/Toggle";
import { label as labelClass, linkButton, primaryButton, secondaryButton } from "../ui/styles";
import { IconButton } from "../ui/IconButton";

// Settings › Security: sign in with OAuth / OpenID Connect (Authentik, Keycloak, Google...), copied from
// RecipeHub's SignInSettings. The admin sets up the provider; everyone can link their own account once it's on.

interface OAuthView {
  enabled: boolean;
  providerName: string;
  issuerUrl: string | null;
  clientId: string;
  clientSecretSet: boolean;
  clientSecretUnreadable: boolean;
  oauthOnly: boolean;
  ready: boolean;
}

// The server's, when ByteSize's address is set (Settings › Email, APP_URL); otherwise this browser's address
const ownRedirectUri = () => `${window.location.origin}/api/auth/oauth/callback`;

/** The provider's details (admin only). */
export function OAuthSettings() {
  const [saved, setSaved] = useState<OAuthView | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [name, setName] = useState("");
  const [issuer, setIssuer] = useState("");
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [oauthOnly, setOauthOnly] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [redirectUri, setRedirectUri] = useState<string | null>(null);

  const show = (s: OAuthView) => {
    setSaved(s);
    setEnabled(s.enabled);
    setName(s.providerName);
    setIssuer(s.issuerUrl ?? "");
    setClientId(s.clientId);
    setSecret("");
    setOauthOnly(s.oauthOnly);
  };
  useEffect(() => {
    api<{ settings: OAuthView; redirectUri?: string | null }>("GET", "/api/settings/oauth").then(
      (r) => {
        setRedirectUri(r.redirectUri ?? null);
        show(r.settings);
      },
      (e) => setMsg(errorMsg(e))
    );
  }, []);

  async function run(work: () => Promise<Msg>) {
    setBusy(true);
    setMsg(null);
    try {
      setMsg(await work());
    } catch (e) {
      setMsg(errorMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const save = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const body = { enabled, providerName: name.trim(), issuerUrl: issuer.trim() || null, clientId: clientId.trim(), ...(secret ? { clientSecret: secret } : {}), oauthOnly };
      const r = await api<{ settings: OAuthView; message?: string }>("PUT", "/api/settings/oauth", body);
      show(r.settings);
      return { ok: true, text: r.message ?? "Saved" };
    });
  };
  const test = () => run(async () => ({ ok: true, text: (await api<{ message: string }>("POST", "/api/settings/oauth/test")).message }));
  const copyUri = async () => {
    if (await copyText(redirectUri ?? ownRedirectUri())) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <Card title="OAuth sign-in" description="Let people sign in with your identity provider (Authentik, Keycloak, Google…). OAuth never makes accounts: add people in Settings › Users.">
      {!saved ? (
        msg ? <Notice msg={msg} /> : <p className="text-muted">Loading…</p>
      ) : (
        <form onSubmit={save} aria-label="OAuth settings" className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4">
            <p className="font-semibold">Sign in with OAuth</p>
            <Toggle label="OAuth sign-in" checked={enabled} disabled={busy} onChange={setEnabled} />
          </div>
          <Field label="Button name" placeholder="Authentik" value={name} onChange={(e) => setName(e.target.value)} />
          <Field label="Issuer URL" type="url" placeholder="https://auth.example.com/application/o/bytesize/" value={issuer} onChange={(e) => setIssuer(e.target.value)} />
          <Field label="Client ID" autoComplete="off" value={clientId} onChange={(e) => setClientId(e.target.value)} />
          <KeyField
            label="Client secret"
            keyName="client secret"
            autoComplete="new-password"
            value={secret}
            onChange={setSecret}
            saved={saved.clientSecretSet && !saved.clientSecretUnreadable}
            fetchSaved={async () => (await api<{ key: string }>("GET", "/api/settings/oauth/secret")).key}
            placeholder={saved.clientSecretSet ? "Saved. Leave blank to keep it." : "From your provider"}
          />
          {saved.clientSecretUnreadable && <p className="text-xs text-error">The saved secret can't be read (the server's secret changed). Enter it again.</p>}
          <div>
            <p className={labelClass}>Redirect URI (add it at your provider)</p>
            <div className="mt-1 flex items-center gap-2 rounded-xl bg-page px-3 py-2">
              <code className="min-w-0 flex-1 truncate font-mono text-sm">{redirectUri ?? ownRedirectUri()}</code>
              <IconButton label="Copy redirect URI" onClick={() => void copyUri()} className="text-subtle hover:text-ink">
                {copied ? <span className="text-xs font-semibold text-success">Copied</span> : <Copy className="size-4" />}
              </IconButton>
            </div>
          </div>
          <div className="flex items-start justify-between gap-4 rounded-xl border border-line p-3">
            <div>
              <p className="font-semibold">OAuth only</p>
              <p className="text-sm text-subtle">Hides the password form. Link your own account first. Locked out? npm run auth:reset on the server.</p>
            </div>
            <Toggle label="OAuth only" checked={oauthOnly} disabled={busy} onChange={setOauthOnly} />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy} className={primaryButton}>
              Save
            </button>
            <button type="button" disabled={busy || !saved.clientId} onClick={() => void test()} className={secondaryButton}>
              Test connection
            </button>
          </div>
          <Notice msg={msg} />
        </form>
      )}
    </Card>
  );
}

/** Link my account (everyone, when OAuth sign-in is on). */
export function LinkMyAccount() {
  const [info, setInfo] = useState<{ available: boolean; providerName: string; linked: { email: string | null } | null } | null>(null);
  const [msg, setMsg] = useState<Msg>(() => {
    const back = oauthReturn();
    if (back.error) return { ok: false, text: back.error };
    return back.linked ? { ok: true, text: "Your account is linked. You can sign in with it now." } : null;
  });
  const [busy, setBusy] = useState(false);

  const load = () => api<NonNullable<typeof info>>("GET", "/api/auth/oauth").then(setInfo, (e) => setMsg(errorMsg(e)));
  useEffect(() => {
    const back = oauthReturn();
    if (back.error || back.linked) clearOAuthReturn("/settings/security");
    void load();
  }, []);

  async function link() {
    setBusy(true);
    setMsg(null);
    try {
      await goToProvider("/api/auth/oauth/link/start");
    } catch (e) {
      setMsg(errorMsg(e));
      setBusy(false);
    }
  }
  async function unlink() {
    setBusy(true);
    setMsg(null);
    try {
      await api("POST", "/api/auth/oauth/unlink");
      await load();
    } catch (e) {
      setMsg(errorMsg(e));
    } finally {
      setBusy(false);
    }
  }

  if (!info?.available) return null;
  return (
    <Card title="Link my account" description={`Sign in with ${info.providerName} instead of your password.`}>
      {info.linked ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1">
            Linked to {info.providerName}
            {info.linked.email ? ` as ${info.linked.email}` : ""}.
          </p>
          <button type="button" disabled={busy} onClick={() => void unlink()} className={`${linkButton} text-sm`}>
            Unlink
          </button>
        </div>
      ) : (
        <>
          <p className="text-subtle">Not linked yet.</p>
          <button type="button" disabled={busy} onClick={() => void link()} className={`${secondaryButton} mt-3`}>
            Link my account
          </button>
        </>
      )}
      <Notice msg={msg} />
    </Card>
  );
}
