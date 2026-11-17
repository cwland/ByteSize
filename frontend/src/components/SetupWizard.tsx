import { useState, type FormEvent } from "react";
import { api } from "../api";
import type { User } from "../session";
import { browserTimezone } from "../timezones";
import AuthFrame from "./AuthFrame";
import { Choice, UNIT_OPTIONS } from "./ui/Choice";
import { Field } from "./ui/Field";
import { Notice, errorMsg, type Msg } from "./ui/Notice";
import { label, primaryButton } from "./ui/styles";
import { TimezoneSelect } from "./ui/TimezoneSelect";

// First run: create the admin's account → profile (units, time zone) → done.
// Someone the admin added starts at the profile step on their first sign-in.
interface Props {
  user?: User; // signed in: skip the account step
  onAccount: (token: string, user: User) => void;
  onDone: (user: User) => void;
}

export default function SetupWizard({ user, onAccount, onDone }: Props) {
  const step = !user ? "account" : "profile";
  return (
    <AuthFrame>
      <h1 className="text-xl font-bold">Set up ByteSize</h1>
      {step === "account" ? <AccountStep onAccount={onAccount} /> : <ProfileStep user={user!} onDone={onDone} />}
    </AuthFrame>
  );
}

function AccountStep({ onAccount }: { onAccount: Props["onAccount"] }) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setMsg({ ok: false, text: "The passwords don't match" });
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ token: string; user: User }>("POST", "/api/auth/setup", { username, password, email: email.trim() || undefined });
      onAccount(r.token, r.user);
    } catch (err) {
      setMsg(errorMsg(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-2">
      <p className="mb-4 text-subtle">Step 1 of 2: your admin account. You add everyone else later in Settings › Users.</p>
      <Field label="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" autoFocus required />
      <Field label="Email (optional)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
      <Field label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={8} required />
      <Field label="Confirm password" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
      <Notice msg={msg} />
      <button type="submit" disabled={busy} className={`${primaryButton} mt-5 w-full`}>
        Continue
      </button>
    </form>
  );
}

function ProfileStep({ user, onDone }: { user: User; onDone: Props["onDone"] }) {
  const [displayName, setDisplayName] = useState(user.displayName ?? "");
  const [units, setUnits] = useState<User["units"]>(user.units ?? "imperial");
  const [timezone, setTimezone] = useState(browserTimezone);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api("PATCH", "/api/profile", { displayName: displayName.trim() || null, units, timezone });
      const r = await api<{ user: User }>("POST", "/api/profile/setup-done");
      onDone(r.user);
    } catch (err) {
      setMsg(errorMsg(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-2">
      <p className="mb-4 text-subtle">Step 2 of 2: how ByteSize shows things to you.</p>
      <Field label="Your name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="name" />
      <div className={`${label} mt-4`}>
        Units
        <div className="mt-1">
          <Choice label="Units" value={units} options={UNIT_OPTIONS} onChange={setUnits} />
        </div>
      </div>
      <TimezoneSelect value={timezone} onChange={setTimezone} />
      <Notice msg={msg} />
      <button type="submit" disabled={busy} className={`${primaryButton} mt-5 w-full`}>
        Start using ByteSize
      </button>
    </form>
  );
}
