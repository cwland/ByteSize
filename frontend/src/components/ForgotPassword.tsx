import { useState, type FormEvent } from "react";
import { api } from "../api";
import type { User } from "../session";
import { Field } from "./ui/Field";
import { Notice, errorMsg, type Msg } from "./ui/Notice";
import { linkButton, primaryButton } from "./ui/styles";

// Forgot password (sign-in screen, only when email is set up): your email, then the 6-digit code from the
// email and a new password. The server answers the same whether or not an account uses that email.
export default function ForgotPassword({ onDone, onBack }: { onDone: (token: string, user: User) => void; onBack: () => void }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<string | null>(null); // the server's answer once a code was asked for
  const [code, setCode] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  async function work(fn: () => Promise<void>) {
    setMsg(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setMsg(errorMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const askForCode = (e: FormEvent) => {
    e.preventDefault();
    void work(async () => {
      const r = await api<{ message: string }>("POST", "/api/auth/forgot", { email: email.trim() });
      setSent(r.message);
    });
  };

  const setPassword = (e: FormEvent) => {
    e.preventDefault();
    if (next !== confirm) return setMsg({ ok: false, text: "The new passwords don't match" });
    void work(async () => {
      const r = await api<{ token: string; user: User }>("POST", "/api/auth/reset", { email: email.trim(), code: code.trim(), newPassword: next });
      onDone(r.token, r.user);
    });
  };

  return (
    <>
      <h1 className="text-xl font-bold">Forgot password</h1>
      {sent === null ? (
        <form onSubmit={askForCode} className="mt-4">
          <p className="text-sm text-subtle">Enter the email on your ByteSize account. We'll email you a 6-digit code.</p>
          <div className="mt-3">
            <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoCapitalize="none" autoFocus required />
          </div>
          <Notice msg={msg} />
          <button type="submit" disabled={busy} className={`${primaryButton} mt-5 w-full`}>
            Send code
          </button>
        </form>
      ) : (
        <form onSubmit={setPassword} className="mt-4">
          <p role="status" className="rounded-xl bg-success-subtle px-3 py-2 text-sm text-success">
            {sent}
          </p>
          <p className="mt-3 text-sm text-subtle">The code works once, for 15 minutes.</p>
          <div className="mt-3">
            <Field label="6-digit code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} autoComplete="one-time-code" autoFocus required />
            <Field label="New password" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={8} required />
            <Field label="Confirm new password" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
          </div>
          <Notice msg={msg} />
          <button type="submit" disabled={busy} className={`${primaryButton} mt-5 w-full`}>
            Set new password
          </button>
          <button type="button" disabled={busy} onClick={() => setSent(null)} className={`${linkButton} mt-3 block w-full text-center text-sm`}>
            Send a new code
          </button>
        </form>
      )}
      <button type="button" onClick={onBack} className={`${linkButton} mt-4 block w-full text-center text-sm`}>
        Back to sign in
      </button>
    </>
  );
}
