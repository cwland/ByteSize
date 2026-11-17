import { useState, type FormEvent } from "react";
import { api } from "../../api";
import { useSession, type User } from "../../session";
import { THEMES, applyMode, applyTheme, useTheme, type ColorMode } from "../../themes";
import { Card } from "../ui/Card";
import { Choice, UNIT_OPTIONS } from "../ui/Choice";
import { Field } from "../ui/Field";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { label, primaryButton } from "../ui/styles";
import { TimezoneSelect } from "../ui/TimezoneSelect";

export default function ProfileSettings() {
  return (
    <>
      <AboutYou />
      <Appearance />
    </>
  );
}

// Name, email, units and time zone
function AboutYou() {
  const { user, setUser } = useSession();
  const [displayName, setDisplayName] = useState(user.displayName ?? "");
  const [email, setEmail] = useState(user.email ?? "");
  const [units, setUnits] = useState<User["units"]>(user.units);
  const [timezone, setTimezone] = useState(user.timezone);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ user: User }>("PATCH", "/api/profile", { displayName: displayName.trim() || null, email: email.trim() || null, units, timezone });
      setUser(r.user);
      setMsg({ ok: true, text: "Saved" });
    } catch (err) {
      setMsg(errorMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Profile" description={`Signed in as ${user.username}${user.isAdmin ? " (admin)" : ""}`}>
      <form onSubmit={save} aria-label="Profile">
        <Field label="Name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="name" />
        <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        <div className={`${label} mt-4`}>
          Units
          <div className="mt-1">
            <Choice label="Units" value={units} options={UNIT_OPTIONS} onChange={setUnits} />
          </div>
        </div>
        <TimezoneSelect value={timezone} onChange={setTimezone} />
        <Notice msg={msg} />
        <button type="submit" disabled={busy} className={`${primaryButton} mt-5`}>
          Save
        </button>
      </form>
    </Card>
  );
}

const MODES: { value: ColorMode; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

// Theme and light/dark: used at once, then saved with the account
function Appearance() {
  const { user, setUser } = useSession();
  const { theme, mode } = useTheme();
  const [msg, setMsg] = useState<Msg>(null);

  async function save(change: { theme?: string; colorMode?: ColorMode }) {
    if (change.theme) applyTheme(change.theme);
    if (change.colorMode) applyMode(change.colorMode);
    setMsg(null);
    try {
      const r = await api<{ user: User }>("PATCH", "/api/profile", change);
      setUser(r.user);
    } catch (err) {
      setMsg(errorMsg(err));
      applyTheme(user.theme);
      applyMode(user.colorMode);
    }
  }

  return (
    <Card title="Appearance">
      <div role="radiogroup" aria-label="Theme" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={theme.id === t.id}
            onClick={() => save({ theme: t.id })}
            className={`flex items-center gap-2 rounded-xl border-2 p-2 text-left text-sm ${theme.id === t.id ? "border-action bg-pressed" : "border-transparent bg-page hover:bg-pressed"}`}
          >
            <span className="size-6 shrink-0 rounded-full border border-line" style={{ background: t.colors.brand }} aria-hidden="true" />
            <span className="font-semibold">{t.name}</span>
          </button>
        ))}
      </div>
      <div className="mt-4">
        <Choice label="Color mode" value={mode} options={MODES} onChange={(m) => save({ colorMode: m })} />
      </div>
      <Notice msg={msg} />
    </Card>
  );
}
