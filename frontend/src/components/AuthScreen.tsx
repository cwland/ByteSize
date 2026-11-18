import { KeyRound, LogIn } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../api";
import { clearOAuthReturn, goToProvider, oauthReturn } from "../oauth";
import { passkeyError, passkeysAvailable, signInWithPasskey, startPasskeyAutofill } from "../passkeys";
import type { User } from "../session";
import AuthFrame from "./AuthFrame";
import ForgotPassword from "./ForgotPassword";
import { Field } from "./ui/Field";
import { Notice } from "./ui/Notice";
import { linkButton, primaryButton, secondaryButton } from "./ui/styles";

// What the server offers on this screen (GET /api/auth/status)
interface SignInOptions {
  passwords: boolean; // false: OAuth only
  forgotPassword: boolean; // email is set up
  oauth: { label: string } | null;
}

// Sign in with a password, a passkey or OAuth. There is no sign-up: the admin adds people in Settings › Users.
// Coming back from the OAuth provider, the address holds a one-time ticket (swapped for a sign-in) or a problem.
export default function AuthScreen({ onDone }: { onDone: (token: string, user: User) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(() => oauthReturn().error ?? "");
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [options, setOptions] = useState<SignInOptions>({ passwords: true, forgotPassword: false, oauth: null });
  const canPasskey = passkeysAvailable();

  useEffect(() => {
    api<SignInOptions>("GET", "/api/auth/status").then(
      (s) => setOptions({ passwords: s.passwords !== false, forgotPassword: !!s.forgotPassword, oauth: s.oauth ?? null }),
      () => {} // the password form still works
    );
  }, []);

  // Passkey autofill: offered as soon as the page opens (password managers show it on the username box)
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (!canPasskey) return;
    return startPasskeyAutofill((r) => done.current(r.token, r.user), setError);
  }, [canPasskey]);

  // Back from the OAuth provider
  useEffect(() => {
    const back = oauthReturn();
    if (back.error) clearOAuthReturn("/");
    if (!back.ticket) return;
    clearOAuthReturn("/");
    setBusy(true);
    api<{ token: string; user: User }>("POST", "/api/auth/oauth/finish", { ticket: back.ticket }).then(
      (r) => done.current(r.token, r.user),
      (e) => {
        setError((e as Error).message);
        setBusy(false);
      }
    );
  }, []);

  async function oauth() {
    setError("");
    setBusy(true);
    try {
      await goToProvider("/api/auth/oauth/start");
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

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

  if (forgot && options.forgotPassword && options.passwords) {
    return (
      <AuthFrame>
        <ForgotPassword onDone={onDone} onBack={() => setForgot(false)} />
      </AuthFrame>
    );
  }

  return (
    <AuthFrame>
      <h1 className="text-xl font-bold">Sign in</h1>
      {options.passwords ? (
        <form onSubmit={submit} className="mt-4">
          <Field label="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username webauthn" autoCapitalize="none" autoFocus required />
          <Field label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          {options.forgotPassword && (
            <div className="mt-2 text-right">
              <button type="button" onClick={() => setForgot(true)} className={`${linkButton} text-sm`}>
                Forgot password?
              </button>
            </div>
          )}
          <Notice msg={error ? { ok: false, text: error } : null} />
          <button type="submit" disabled={busy} className={`${primaryButton} mt-5 w-full`}>
            Sign in
          </button>
        </form>
      ) : (
        <Notice msg={error ? { ok: false, text: error } : null} />
      )}
      {options.oauth && (
        <button type="button" onClick={oauth} disabled={busy} className={`${options.passwords ? secondaryButton : primaryButton} mt-3 flex w-full items-center justify-center gap-2`}>
          <LogIn className="size-4" /> Sign in with {options.oauth.label}
        </button>
      )}
      {canPasskey && (
        <button type="button" onClick={passkey} disabled={busy} className={`${secondaryButton} mt-3 flex w-full items-center justify-center gap-2`}>
          <KeyRound className="size-4" /> Sign in with a passkey
        </button>
      )}
      <p className="mt-5 text-center text-sm text-muted">Need an account? Ask your ByteSize admin.</p>
    </AuthFrame>
  );
}
