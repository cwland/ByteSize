import { KeyRound } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../api";
import { passkeyError, passkeysAvailable, signInWithPasskey, startPasskeyAutofill } from "../passkeys";
import type { User } from "../session";
import AuthFrame from "./AuthFrame";
import { Field } from "./ui/Field";
import { Notice } from "./ui/Notice";
import { primaryButton, secondaryButton } from "./ui/styles";

// Sign in with a password or a passkey. There is no sign-up: the admin adds people in Settings › Users.
export default function AuthScreen({ onDone }: { onDone: (token: string, user: User) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const canPasskey = passkeysAvailable();

  // Passkey autofill: offered as soon as the page opens (password managers show it on the username box)
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (!canPasskey) return;
    return startPasskeyAutofill((r) => done.current(r.token, r.user), setError);
  }, [canPasskey]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const r = await api<{ token: string; user: User }>("POST", "/api/auth/login", { username, password });
      onDone(r.token, r.user);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  async function passkey() {
    setError("");
    setBusy(true);
    try {
      const r = await signInWithPasskey();
      onDone(r.token, r.user);
    } catch (err) {
      const msg = passkeyError(err);
      if (msg) setError(msg);
      setBusy(false);
    }
  }

  return (
    <AuthFrame>
      <h1 className="text-lg font-semibold">Sign in</h1>
      <form onSubmit={submit} className="mt-4">
        <Field label="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username webauthn" autoCapitalize="none" autoFocus required />
        <Field label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        <Notice msg={error ? { ok: false, text: error } : null} />
        <button type="submit" disabled={busy} className={`${primaryButton} mt-5 w-full`}>
          Sign in
        </button>
      </form>
      {canPasskey && (
        <button type="button" onClick={passkey} disabled={busy} className={`${secondaryButton} mt-3 flex w-full items-center justify-center gap-2`}>
          <KeyRound className="size-4" /> Sign in with a passkey
        </button>
      )}
      <p className="mt-5 text-center text-sm text-muted">Need an account? Ask your ByteSize admin.</p>
    </AuthFrame>
  );
}
