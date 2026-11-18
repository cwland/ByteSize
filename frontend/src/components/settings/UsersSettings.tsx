import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "../../api";
import { when } from "../../format";
import { useSession, type User } from "../../session";
import { Card } from "../ui/Card";
import { Confirm } from "../ui/Confirm";
import { Field } from "../ui/Field";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { Toggle } from "../ui/Toggle";
import { linkButton, primaryButton, secondaryButton } from "../ui/styles";

// A person as GET /api/admin/users sends them. invited: added by Invite by email and hasn't chosen a password yet.
export type AdminUser = User & { disabled: boolean; createdAt: string; lastSeenAt: string | null; invited: boolean; inviteSentAt: string | null };
type InviteAnswer = { user: AdminUser; emailError?: string };
export const NO_EMAIL = "Set up email in Settings › Email to invite people";
const sentOn = (iso: string | null) => (iso ? `Sent ${new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" })}` : "Not sent yet");

// Settings › Users (admins): there is no sign-up page, so the admin adds everyone here
export default function UsersSettings() {
  const { user: me, refresh } = useSession();
  const [people, setPeople] = useState<AdminUser[] | null>(null);
  const [adding, setAdding] = useState<false | "person" | "invite">(false);
  const [canInvite, setCanInvite] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ users: AdminUser[]; canInvite?: boolean }>("GET", "/api/admin/users");
      setPeople(r.users);
      setCanInvite(!!r.canInvite);
    } catch (e) {
      setMsg(errorMsg(e));
    }
  }, []);
  useEffect(() => void load(), [load]);

  const replace = (u: AdminUser) => setPeople((list) => (list ?? []).map((p) => (p.id === u.id ? u : p)));
  const sent = (r: InviteAnswer, ok: string) => setMsg(r.emailError ? { ok: false, text: r.emailError } : { ok: true, text: ok });

  async function resend(p: AdminUser) {
    setMsg(null);
    try {
      const r = await api<InviteAnswer>("POST", `/api/admin/invites/${p.id}/resend`);
      replace(r.user);
      sent(r, `A new invite link went to ${r.user.email}. The old one no longer works.`);
    } catch (e) {
      setMsg(errorMsg(e));
    }
  }

  async function cancelInvite(p: AdminUser) {
    setMsg(null);
    try {
      await api("DELETE", `/api/admin/invites/${p.id}`);
      setPeople((list) => (list ?? []).filter((x) => x.id !== p.id));
      setMsg({ ok: true, text: `${p.username}'s invite is cancelled` });
    } catch (e) {
      setMsg(errorMsg(e));
    }
  }

  async function update(p: AdminUser, change: Partial<Pick<AdminUser, "isAdmin" | "disabled">> | { password: string }) {
    setMsg(null);
    try {
      const r = await api<{ user: AdminUser }>("PATCH", `/api/admin/users/${p.id}`, change);
      replace(r.user);
      if (p.id === me.id) await refresh(); // e.g. you made yourself a member
      return true;
    } catch (e) {
      setMsg(errorMsg(e));
      return false;
    }
  }

  return (
    <Card title="Users" description="Everyone who can sign in to ByteSize. Each person's food log is their own.">
      {!adding && (
        <div className="flex flex-col items-end gap-1">
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => setAdding("invite")} disabled={!canInvite} className={secondaryButton}>
              Invite by email
            </button>
            <button type="button" onClick={() => setAdding("person")} className={secondaryButton}>
              Add person
            </button>
          </div>
          {!canInvite && people !== null && <p className="text-right text-sm text-muted">{NO_EMAIL}</p>}
        </div>
      )}
      {adding === "person" && (
        <AddPerson
          onCancel={() => setAdding(false)}
          onAdded={(u) => {
            setPeople((list) => [...(list ?? []), u]);
            setAdding(false);
            setMsg({ ok: true, text: `${u.username} can sign in now` });
          }}
        />
      )}
      {adding === "invite" && (
        <InvitePerson
          onCancel={() => setAdding(false)}
          onInvited={(r) => {
            setPeople((list) => [...(list ?? []), r.user]);
            setAdding(false);
            sent(r, `Invite sent to ${r.user.email}`);
          }}
        />
      )}
      <Notice msg={msg} />
      {people === null ? (
        <p className="mt-4 text-muted">Loading…</p>
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {people.map((p) =>
            p.invited ? (
              <InvitedRow key={p.id} person={p} onResend={() => resend(p)} onCancel={() => cancelInvite(p)} />
            ) : (
              <PersonRow key={p.id} person={p} isMe={p.id === me.id} onChange={(c) => update(p, c)} />
            )
          )}
        </ul>
      )}
    </Card>
  );
}

function PersonRow({ person: p, isMe, onChange }: { person: AdminUser; isMe: boolean; onChange: (c: { isAdmin?: boolean; disabled?: boolean } | { password: string }) => Promise<boolean> }) {
  const [resetting, setResetting] = useState(false);
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);

  async function reset(e: FormEvent) {
    e.preventDefault();
    if (await onChange({ password })) {
      setResetting(false);
      setPassword("");
      setDone(true);
    }
  }

  return (
    <li aria-label={p.username} className="py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className={`font-semibold ${p.disabled ? "text-inactive line-through" : ""}`}>
            {p.username}
            {isMe && <span className="ml-2 text-sm font-normal text-muted">(you)</span>}
          </p>
          <p className="text-sm text-muted">
            {[p.displayName, p.email].filter(Boolean).join(" · ")}
            {p.disabled ? " Turned off" : ` Last seen ${when(p.lastSeenAt)}`}
          </p>
        </div>
        <span className="flex items-center gap-2 text-sm text-subtle">
          Admin
          <Toggle label={`${p.username} is an admin`} checked={p.isAdmin} onChange={(v) => void onChange({ isAdmin: v })} />
        </span>
        <button type="button" onClick={() => setResetting((r) => !r)} className={`${linkButton} text-sm`}>
          Reset password
        </button>
        <button type="button" onClick={() => void onChange({ disabled: !p.disabled })} className={`${linkButton} text-sm`}>
          {p.disabled ? "Turn on" : "Turn off"}
        </button>
      </div>
      {resetting && (
        <form onSubmit={reset} aria-label={`New password for ${p.username}`} className="mt-2 flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1">
            <Field label="New password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={8} required />
          </div>
          <button type="submit" className={primaryButton}>
            Set password
          </button>
        </form>
      )}
      {done && <p role="status" className="mt-1 text-sm text-success">Password changed. {p.username} is signed out everywhere.</p>}
    </li>
  );
}

function AddPerson({ onAdded, onCancel }: { onAdded: (u: AdminUser) => void; onCancel: () => void }) {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const body = { username, password, isAdmin, ...(displayName.trim() ? { displayName: displayName.trim() } : {}), ...(email.trim() ? { email: email.trim() } : {}) };
      onAdded((await api<{ user: AdminUser }>("POST", "/api/admin/users", body)).user);
    } catch (err) {
      setMsg(errorMsg(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} aria-label="Add person" className="mt-3 rounded-xl bg-page p-4">
      <Field label="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" autoComplete="off" required />
      <Field label="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="off" />
      <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
      <Field label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={8} required />
      <div className="mt-4 flex items-center gap-3 text-sm text-subtle">
        <Toggle label="Admin" checked={isAdmin} onChange={setIsAdmin} />
        Admin (can add people and change AI services)
      </div>
      <Notice msg={msg} />
      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={busy} className={primaryButton}>
          Add
        </button>
        <button type="button" onClick={onCancel} className={secondaryButton}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// Someone invited by email who hasn't chosen a password yet
function InvitedRow({ person: p, onResend, onCancel }: { person: AdminUser; onResend: () => Promise<void>; onCancel: () => Promise<void> }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    await work();
    setBusy(false);
  };
  return (
    <li aria-label={p.username} className="py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            {p.username}
            <span className="ml-2 rounded-full bg-pressed px-2.5 py-0.5 text-xs font-semibold text-subtle">Invited</span>
          </p>
          <p className="text-sm text-muted">{[p.displayName, p.email, sentOn(p.inviteSentAt)].filter(Boolean).join(" · ")}</p>
        </div>
        <button type="button" disabled={busy} onClick={() => void run(onResend)} className={`${linkButton} text-sm`}>
          Resend
        </button>
        <button type="button" disabled={busy} onClick={() => setAsking(true)} className={`${linkButton} text-sm`}>
          Cancel invite
        </button>
      </div>
      {asking && (
        <Confirm
          title={`Cancel ${p.username}'s invite?`}
          text={`${p.username} is removed and the link in their email stops working.`}
          confirmLabel="Cancel invite"
          cancelLabel="Keep it"
          onConfirm={() => {
            setAsking(false);
            void run(onCancel);
          }}
          onCancel={() => setAsking(false)}
        />
      )}
    </li>
  );
}

// The username offered for an email: its part before the @ (the admin can change it)
export const usernameFromEmail = (email: string) => email.split("@")[0].trim().toLowerCase();

function InvitePerson({ onInvited, onCancel }: { onInvited: (r: InviteAnswer) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [edited, setEdited] = useState(false); // the admin typed their own username: stop suggesting
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      onInvited(await api<InviteAnswer>("POST", "/api/admin/invites", { name: name.trim(), username: username.trim(), email: email.trim() }));
    } catch (err) {
      setMsg(errorMsg(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} aria-label="Invite by email" className="mt-3 rounded-xl bg-page p-4">
      <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" maxLength={100} required />
      <Field
        label="Email"
        type="email"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          if (!edited) setUsername(usernameFromEmail(e.target.value));
        }}
        autoComplete="off"
        required
      />
      <Field
        label="Username"
        value={username}
        onChange={(e) => {
          setEdited(true);
          setUsername(e.target.value);
        }}
        autoCapitalize="none"
        autoComplete="off"
        maxLength={100}
        required
      />
      <p className="mt-3 text-sm text-subtle">They get an email with a link to choose their own password. The link works once, for 7 days.</p>
      <Notice msg={msg} />
      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={busy} className={primaryButton}>
          Send invite
        </button>
        <button type="button" onClick={onCancel} className={secondaryButton}>
          Cancel
        </button>
      </div>
    </form>
  );
}
