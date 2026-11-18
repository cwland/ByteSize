import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "../../api";
import { when } from "../../format";
import { addPasskey, passkeyError, passkeysAvailable } from "../../passkeys";
import { useSession } from "../../session";
import { Card } from "../ui/Card";
import { Field } from "../ui/Field";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { linkButton, primaryButton, secondaryButton } from "../ui/styles";
import { LinkMyAccount, OAuthSettings } from "./OAuthSettings";

export default function SecuritySettings() {
  const { user } = useSession();
  return (
    <>
      <ChangePassword />
      <Passkeys />
      <LinkMyAccount />
      {user.isAdmin && <OAuthSettings />}
      <Devices />
      <SignInHistory />
    </>
  );
}

// Signs out every other device; this one gets a fresh token
export function ChangePassword() {
  const { replaceToken } = useSession();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next !== confirm) return setMsg({ ok: false, text: "The new passwords don't match" });
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ token: string }>("POST", "/api/auth/password", { currentPassword: current, newPassword: next });
      replaceToken(r.token);
      setCurrent("");
      setNext("");
      setConfirm("");
      setMsg({ ok: true, text: "Password changed. Your other devices are signed out." });
    } catch (err) {
      setMsg(errorMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Password">
      <form onSubmit={submit} aria-label="Change password">
        <Field label="Current password" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
        <Field label="New password" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={8} required />
        <Field label="Confirm new password" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
        <Notice msg={msg} />
        <button type="submit" disabled={busy} className={`${primaryButton} mt-5`}>
          Change password
        </button>
      </form>
    </Card>
  );
}

interface PasskeyRow {
  id: number;
  name: string;
  rpId: string;
  synced: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

export function Passkeys() {
  const [rows, setRows] = useState<PasskeyRow[] | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      setRows(await api<PasskeyRow[]>("GET", "/api/passkeys"));
    } catch (e) {
      setMsg(errorMsg(e));
    }
  }, []);
  useEffect(() => void load(), [load]);

  async function add() {
    setBusy(true);
    setMsg(null);
    try {
      await addPasskey();
      await load();
      setMsg({ ok: true, text: "Passkey added" });
    } catch (e) {
      const text = passkeyError(e);
      if (text) setMsg({ ok: false, text });
    } finally {
      setBusy(false);
    }
  }

  async function rename(p: PasskeyRow) {
    const name = window.prompt("Passkey name", p.name)?.trim();
    if (!name || name === p.name) return;
    try {
      await api("PATCH", `/api/passkeys/${p.id}`, { name });
      await load();
    } catch (e) {
      setMsg(errorMsg(e));
    }
  }

  async function remove(p: PasskeyRow) {
    if (!window.confirm(`Remove "${p.name}"? You can still sign in with your password.`)) return;
    try {
      await api("DELETE", `/api/passkeys/${p.id}`);
      await load();
    } catch (e) {
      setMsg(errorMsg(e));
    }
  }

  const here = window.location.hostname;
  return (
    <Card title="Passkeys" description="Sign in with Face ID, Touch ID, Windows Hello or your phone instead of your password.">
      {rows && rows.length > 0 && (
        <ul className="divide-y divide-line">
          {rows.map((p) => (
            <li key={p.id} aria-label={p.name} className="flex flex-wrap items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{p.name}</p>
                <p className="text-sm text-muted">
                  Last used {when(p.lastUsedAt)}
                  {p.rpId !== here && ` · Works at ${p.rpId}`}
                </p>
              </div>
              <button type="button" onClick={() => rename(p)} className={`${linkButton} text-sm`}>
                Rename
              </button>
              <button type="button" onClick={() => remove(p)} className={`${linkButton} text-sm`}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {rows?.length === 0 && <p className="text-muted">No passkeys yet.</p>}
      <Notice msg={msg} />
      {passkeysAvailable() ? (
        <button type="button" onClick={add} disabled={busy} className={`${secondaryButton} mt-4`}>
          Add a passkey
        </button>
      ) : (
        <p className="mt-4 text-sm text-muted">Passkeys need a browser that supports them and a secure address (https://).</p>
      )}
    </Card>
  );
}

interface DeviceSession {
  id: number;
  current: boolean;
  status: "active" | "expired" | "signed out";
  device: { label: string };
  how: string | null;
  lastIp: string | null;
  lastSeenAt: string;
}

export function Devices() {
  const { replaceToken } = useSession();
  const [list, setList] = useState<DeviceSession[] | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const load = useCallback(async () => {
    try {
      setList(await api<DeviceSession[]>("GET", "/api/auth/sessions"));
    } catch (e) {
      setMsg(errorMsg(e));
    }
  }, []);
  useEffect(() => void load(), [load]);

  async function signOut(d: DeviceSession) {
    try {
      await api("DELETE", `/api/auth/sessions/${d.id}`);
      await load();
    } catch (e) {
      setMsg(errorMsg(e));
    }
  }

  async function signOutOthers() {
    try {
      const r = await api<{ token?: string }>("POST", "/api/auth/logout-all", { keepThisDevice: true });
      if (r.token) replaceToken(r.token);
      await load();
      setMsg({ ok: true, text: "Every other device is signed out" });
    } catch (e) {
      setMsg(errorMsg(e));
    }
  }

  const active = (list ?? []).filter((d) => d.status === "active");
  return (
    <Card title="Signed-in devices">
      <ul className="divide-y divide-line">
        {active.map((d) => (
          <li key={d.id} aria-label={d.device.label} className="flex flex-wrap items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {d.device.label}
                {d.current && <span className="ml-2 text-sm font-normal text-success">This device</span>}
              </p>
              <p className="text-sm text-muted">
                Last seen {when(d.lastSeenAt)}
                {d.lastIp && ` · ${d.lastIp}`}
              </p>
            </div>
            {!d.current && (
              <button type="button" onClick={() => signOut(d)} className={`${linkButton} text-sm`}>
                Sign out
              </button>
            )}
          </li>
        ))}
      </ul>
      <Notice msg={msg} />
      {active.length > 1 && (
        <button type="button" onClick={signOutOthers} className={`${secondaryButton} mt-4`}>
          Sign out everywhere else
        </button>
      )}
    </Card>
  );
}

interface SignIn {
  id: number;
  at: string;
  username: string | null;
  success: boolean;
  reason: string | null;
  ip: string | null;
  device: { label: string };
}

export function SignInHistory() {
  const [events, setEvents] = useState<SignIn[] | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  useEffect(() => {
    api<SignIn[]>("GET", "/api/auth/logins")
      .then(setEvents)
      .catch((e) => setMsg(errorMsg(e)));
  }, []);

  return (
    <Card title="Sign-in history" description="The last 60 days.">
      <Notice msg={msg} />
      {events?.length === 0 && <p className="text-muted">Nothing yet.</p>}
      {events && events.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-muted">
              <tr>
                <th className="py-1 pr-3 font-medium">When</th>
                <th className="py-1 pr-3 font-medium">Who</th>
                <th className="py-1 pr-3 font-medium">Result</th>
                <th className="py-1 pr-3 font-medium">Device</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {events.slice(0, 200).map((e) => (
                <tr key={e.id}>
                  <td className="py-1.5 pr-3 whitespace-nowrap">{when(e.at)}</td>
                  <td className="py-1.5 pr-3">{e.username ?? "—"}</td>
                  <td className={`py-1.5 pr-3 ${e.success ? "text-success" : "text-error"}`}>{e.reason ?? (e.success ? "Signed in" : "Failed")}</td>
                  <td className="py-1.5 pr-3 text-subtle">
                    {e.device.label}
                    {e.ip && ` · ${e.ip}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
