import { useEffect, useState, type FormEvent } from "react";
import { ApiError, api } from "../../api";
import { Card } from "../ui/Card";
import { Field } from "../ui/Field";
import { KeyField } from "../ui/KeyField";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { Toggle } from "../ui/Toggle";
import { field, label as labelClass, linkButton, primaryButton, secondaryButton } from "../ui/styles";

// Settings › Email (admin): the account ByteSize sends email from (forgot-password codes). Copied from
// Culury's EmailSettings. The password is never sent with the settings: the eye and copy buttons fetch it.
// Save needs a test email that went through with the same connection first (the server checks too).

type Security = "starttls" | "ssl" | "auto" | "none";

interface EmailSettingsResponse {
  source: "app" | "env" | "none";
  active: boolean;
  settings: null | {
    enabled: boolean;
    host: string;
    port: number;
    security: Security;
    username: string | null;
    passwordSet: boolean;
    passwordUnreadable: boolean;
    fromName: string | null;
    fromAddress: string;
    appUrl: string | null;
  };
  env: { available: boolean; host: string | null };
  accountEmail: string | null;
}

export const PRESETS: { id: string; label: string; host: string; port: number; security: Security; hint: string }[] = [
  { id: "gmail", label: "Gmail", host: "smtp.gmail.com", port: 587, security: "starttls", hint: "Username is your Gmail address. Use an app password (Google Account › Security › App passwords), not your normal password." },
  { id: "outlook", label: "Outlook / Microsoft 365", host: "smtp.office365.com", port: 587, security: "starttls", hint: "Username is your full Outlook address." },
  { id: "icloud", label: "iCloud Mail", host: "smtp.mail.me.com", port: 587, security: "starttls", hint: "Use an app-specific password from appleid.apple.com." },
  { id: "fastmail", label: "Fastmail", host: "smtp.fastmail.com", port: 465, security: "ssl", hint: "Use an app password from Fastmail's settings." },
];

const SECURITY_LABELS: Record<Security, string> = {
  starttls: "STARTTLS (port 587)",
  ssl: "SSL/TLS (port 465)",
  auto: "Auto (TLS if offered)",
  none: "None (local relay only)",
};

interface Form {
  enabled: boolean;
  host: string;
  port: string;
  security: Security;
  username: string;
  password: string; // blank = keep the saved one
  fromName: string;
  fromAddress: string;
  appUrl: string;
}

const emptyForm = (): Form => ({ enabled: false, host: "", port: "587", security: "starttls", username: "", password: "", fromName: "ByteSize", fromAddress: "", appUrl: window.location.origin });

// What a test email proves: a change to any of these needs a new test before Save
const connectionOf = (f: Form) => JSON.stringify([f.host.trim(), Number(f.port) || 587, f.security, f.username.trim(), f.password, f.fromAddress.trim()]);

export default function EmailSettings() {
  const [data, setData] = useState<EmailSettingsResponse | null>(null);
  const [form, setForm] = useState<Form>(emptyForm);
  const [provider, setProvider] = useState<string | null>(null); // what was picked ("custom" stays custom)
  const [more, setMore] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [working, setWorking] = useState<string | null>(null); // a connection known to work (saved and on, or tested)
  const [msg, setMsg] = useState<Msg>(null);
  const [testMsg, setTestMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const d = await api<EmailSettingsResponse>("GET", "/api/settings/email");
    setData(d);
    setTestTo((t) => t || d.accountEmail || "");
    const s = d.settings;
    const f: Form = s
      ? { enabled: s.enabled, host: s.host, port: String(s.port), security: s.security, username: s.username ?? "", password: "", fromName: s.fromName ?? "", fromAddress: s.fromAddress, appUrl: s.appUrl ?? window.location.origin }
      : { ...emptyForm(), enabled: d.source === "env" }; // nothing saved here: on only when .env provides email
    setForm(f);
    setWorking(s?.enabled && d.active ? connectionOf(f) : null);
  }
  useEffect(() => {
    load().catch((e) => setMsg(errorMsg(e)));
  }, []);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const matched = PRESETS.find((p) => p.host === form.host);
  const providerId = provider ?? matched?.id ?? "custom";
  const preset = PRESETS.find((p) => p.id === providerId);
  const showMore = more || providerId === "custom";

  const body = (enabled = form.enabled) => ({
    enabled,
    host: form.host.trim(),
    port: Number(form.port) || 587,
    security: form.security,
    username: form.username.trim() || null,
    ...(form.password ? { password: form.password } : {}), // blank: keep the saved one
    fromName: form.fromName.trim() || null,
    fromAddress: form.fromAddress.trim(),
    appUrl: form.appUrl.trim() || null,
  });

  const fail = (e: unknown, to: (m: Msg) => void) => {
    if (e instanceof ApiError && e.details?.length) to({ ok: false, text: e.details.map((d) => d.message).join(". ") });
    else to(errorMsg(e));
  };

  async function save(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api("PUT", "/api/settings/email", body());
      await load();
      setMsg({ ok: true, text: form.enabled ? "Saved. Email is on." : "Saved. Email is off." });
    } catch (err) {
      fail(err, setMsg);
    } finally {
      setBusy(false);
    }
  }

  // Off saves at once (when something is saved); on opens the form, and Save (after a test) turns email on
  async function toggle(on: boolean) {
    setMsg(null);
    setTestMsg(null);
    set("enabled", on);
    if (on || !data?.settings) return;
    setBusy(true);
    try {
      await api("PUT", "/api/settings/email", body(false));
      await load();
      setMsg({ ok: true, text: "Email is off." });
    } catch (err) {
      fail(err, setMsg);
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setTestMsg(null);
    const tried = connectionOf(form);
    try {
      const r = await api<{ to: string }>("POST", "/api/settings/email/test", { settings: body(true), to: testTo.trim() || undefined });
      setWorking(tried);
      setTestMsg({ ok: true, text: `Test email sent to ${r.to}. Check your inbox (and spam folder), then Save.` });
    } catch (err) {
      fail(err, setTestMsg);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm("Remove the email settings? Forgot password goes away from the sign-in screen.")) return;
    setBusy(true);
    try {
      await api("DELETE", "/api/settings/email");
      setProvider(null);
      await load();
      setMsg({ ok: true, text: "Email settings removed" });
    } catch (err) {
      fail(err, setMsg);
    } finally {
      setBusy(false);
    }
  }

  const s = data?.settings;
  const canSave = !form.enabled || working === connectionOf(form);
  return (
    <Card title="Email" description="ByteSize emails a 6-digit code when someone uses Forgot password on the sign-in screen.">
      {data && (
        <p role="status" aria-label="Email status" className="mb-4 flex flex-wrap items-center gap-2 rounded-xl bg-page px-3 py-2 text-sm">
          <span className={`rounded-full px-2.5 py-0.5 font-semibold ${data.active ? "bg-success-subtle text-success" : "bg-pressed text-subtle"}`}>{data.active ? "On" : "Off"}</span>
          <span className="text-subtle">
            {data.source === "app" && (data.active ? "Using the settings below. Forgot password is on the sign-in screen." : "Email is turned off. Nothing is sent.")}
            {data.source === "env" && <>Using the server's settings from .env ({data.env.host}). Saving here takes over from them.</>}
            {data.source === "none" && "Not set up yet. Turn it on to add your email provider's details."}
          </span>
        </p>
      )}
      <div className="flex items-center justify-between gap-4">
        <p className="font-semibold">Send email from ByteSize</p>
        <Toggle label="Send email from ByteSize" checked={form.enabled} disabled={busy || !data} onChange={(v) => void toggle(v)} />
      </div>

      {form.enabled && (
        <form onSubmit={save} aria-label="Email settings" className="mt-4 flex flex-col gap-3 border-t border-line pt-4">
          <label className={labelClass}>
            Provider
            <select
              aria-label="Provider"
              value={providerId}
              onChange={(e) => {
                const id = e.target.value;
                setProvider(id);
                const p = PRESETS.find((x) => x.id === id);
                if (p) setForm((f) => ({ ...f, host: p.host, port: String(p.port), security: p.security }));
                else if (matched) setForm((f) => ({ ...f, host: "", port: "587", security: "starttls" })); // custom: type your own server
              }}
              className={field}
            >
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
              <option value="custom">Other / custom server</option>
            </select>
            {preset && <span className="mt-1 block text-xs font-normal text-muted">{preset.hint}</span>}
          </label>
          <Field label="From address" type="email" placeholder="you@example.com" value={form.fromAddress} onChange={(e) => set("fromAddress", e.target.value)} />
          <Field label="Username" autoComplete="off" placeholder="Usually your email address" value={form.username} onChange={(e) => set("username", e.target.value)} />
          <KeyField
            label="Password"
            keyName="email password"
            autoComplete="new-password"
            value={form.password}
            onChange={(v) => set("password", v)}
            saved={!!s?.passwordSet && !s.passwordUnreadable}
            fetchSaved={async () => (await api<{ key: string }>("GET", "/api/settings/email/password")).key}
            placeholder={s?.passwordSet ? "Saved. Leave blank to keep it." : "App password"}
          />
          {s?.passwordUnreadable && <p className="text-xs text-error">The saved password can't be read (the server's secret changed). Enter it again.</p>}

          {providerId !== "custom" && (
            <button type="button" aria-expanded={showMore} onClick={() => setMore((m) => !m)} className={`${linkButton} self-start text-sm`}>
              More options
            </button>
          )}
          {showMore && (
            <div className="flex flex-col gap-3 rounded-xl border border-line p-3">
              <Field label="Email server" placeholder="smtp.example.com" value={form.host} onChange={(e) => set("host", e.target.value)} />
              <div className="grid grid-cols-[6rem_1fr] gap-3">
                <Field label="Port" inputMode="numeric" value={form.port} onChange={(e) => set("port", e.target.value.replace(/\D/g, ""))} />
                <label className={`${labelClass} mt-3 first:mt-0`}>
                  Security
                  <select
                    aria-label="Security"
                    value={form.security}
                    onChange={(e) => {
                      const sec = e.target.value as Security;
                      setForm((f) => ({ ...f, security: sec, port: sec === "ssl" && f.port === "587" ? "465" : sec === "starttls" && f.port === "465" ? "587" : f.port }));
                    }}
                    className={field}
                  >
                    {(Object.keys(SECURITY_LABELS) as Security[]).map((k) => (
                      <option key={k} value={k}>
                        {SECURITY_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <Field label="From name" value={form.fromName} onChange={(e) => set("fromName", e.target.value)} />
            </div>
          )}

          <div>
            <Field label="ByteSize's address" type="url" placeholder="https://bytesize.example.com" value={form.appUrl} onChange={(e) => set("appUrl", e.target.value)} />
            <p className="mt-1 text-xs text-muted">Used in emails, so people can find their way back.</p>
          </div>

          <div className="rounded-xl bg-page p-3">
            <Field label="Send test to" type="email" placeholder="you@example.com" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
            <button type="button" onClick={() => void test()} disabled={busy} className={`${secondaryButton} mt-3`}>
              Send test email
            </button>
            <Notice msg={testMsg} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={busy || !canSave} className={primaryButton}>
              Save
            </button>
            {s && (
              <button type="button" onClick={() => void remove()} disabled={busy} className="ml-auto text-sm text-error hover:underline">
                Remove settings
              </button>
            )}
          </div>
          {!canSave && <p className="text-xs text-muted">Send a test email first. Save works once it goes through.</p>}
        </form>
      )}
      <Notice msg={msg} />
    </Card>
  );
}
