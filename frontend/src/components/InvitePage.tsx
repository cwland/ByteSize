import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import type { User } from "../session";
import AuthFrame from "./AuthFrame";
import { Field } from "./ui/Field";
import { Notice } from "./ui/Notice";
import { linkButton, primaryButton } from "./ui/styles";

// "#/invite/<token>" -> the token (the part after # never reaches the server's logs)
export const inviteTokenFromHash = (hash = window.location.hash) => /^#\/invite\/([A-Za-z0-9_-]+)$/.exec(hash.split("?")[0])?.[1] ?? null;

// The page an invite email links to: welcome, the username (fixed), and a password the person chooses.
// Accepting signs them in; first-run setup follows, like anyone the admin added.
export default function InvitePage({ token, onDone }: { token: string; onDone: (token: string, user: User) => void }) {
  const [invite, setInvite] = useState<{ name: string; username: string } | null>(null);
  const [gone, setGone] = useState<string | null>(null); // expired, used, cancelled or replaced
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ name: string; username: string }>("POST", "/api/invites/check", { token }).then(setInvite, (e) => setGone((e as Error).message));
  }, [token]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) return setError("The passwords don't match");
    setBusy(true);
    try {
      const r = await api<{ token: string; user: User }>("POST", "/api/invites/accept", { token, password });
      onDone(r.token, r.user);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 410) setGone((err as Error).message);
      else setError((err as Error).message);
      setBusy(false);
    }
  }

  if (gone) {
    return (
      <AuthFrame>
        <h1 className="text-xl font-bold">Invite link</h1>
        <p className="mt-3 text-subtle">{gone}</p>
        <a href="#/" className={`${linkButton} mt-5 inline-block`}>
          Go to sign in
        </a>
      </AuthFrame>
    );
  }
  if (!invite) {
    return (
      <AuthFrame>
        <p className="text-muted">Loading…</p>
      </AuthFrame>
    );
  }
  return (
    <AuthFrame>
      <h1 className="text-xl font-bold">Welcome to ByteSize, {invite.name}</h1>
      <p className="mt-1 text-subtle">Choose a password to finish setting up your account.</p>
      <form onSubmit={submit} className="mt-4">
        <Field signIn label="Username" value={invite.username} readOnly autoComplete="username" />
        <Field label="New password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={8} autoFocus required />
        <Field label="Confirm new password" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" minLength={8} required />
        <p className="mt-2 text-sm text-muted">At least 8 characters.</p>
        <Notice msg={error ? { ok: false, text: error } : null} />
        <button type="submit" disabled={busy} className={`${primaryButton} mt-5 w-full`}>
          Set password and sign in
        </button>
      </form>
    </AuthFrame>
  );
}
