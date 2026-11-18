import { useEffect, useState, type FormEvent } from "react";
import { api } from "../../api";
import { notifySettingsChanged } from "../../day";
import { DATE_FORMATS, DEFAULT_DATE_FORMAT, formatDate } from "../../dateFormat";
import { todayIn } from "../../selectedDay";
import type { SettingsMe } from "../../types";
import { useSession, type User } from "../../session";
import { THEMES, applyMode, applyTheme, useTheme, type ColorMode } from "../../themes";
import { Card } from "../ui/Card";
import { Choice, UNIT_OPTIONS } from "../ui/Choice";
import { Field } from "../ui/Field";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { field, label, primaryButton } from "../ui/styles";
import { TimezoneSelect } from "../ui/TimezoneSelect";

export default function ProfileSettings() {
  return (
    <>
      <AboutYou />
      <Appearance />
    </>
  );
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Name, email, units, time zone and the day weeks start on (that one lives in /api/settings/me)
function AboutYou() {
  const { user, setUser } = useSession();
  const [displayName, setDisplayName] = useState(user.displayName ?? "");
  const [email, setEmail] = useState(user.email ?? "");
  const [units, setUnits] = useState<User["units"]>(user.units);
  const [timezone, setTimezone] = useState(user.timezone);
  const today = todayIn(timezone); // the options preview today's date
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  // The saved settings (null until loaded: nothing is sent for them before then)
  const [settings, setSettings] = useState<SettingsMe | null>(null);
  const [weekStart, setWeekStart] = useState(0);
  const [dateFormat, setDateFormat] = useState<string>(DEFAULT_DATE_FORMAT);
  useEffect(() => {
    api<SettingsMe>("GET", "/api/settings/me")
      .then((s) => {
        setSettings(s);
        setWeekStart(s.weekStart);
        setDateFormat(s.dateFormat ?? DEFAULT_DATE_FORMAT);
      })
      .catch(() => {});
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ user: User }>("PATCH", "/api/profile", { displayName: displayName.trim() || null, email: email.trim() || null, units, timezone });
      setUser(r.user);
      if (settings && (weekStart !== settings.weekStart || dateFormat !== (settings.dateFormat ?? DEFAULT_DATE_FORMAT))) {
        const saved = await api<SettingsMe>("PUT", "/api/settings/me", { mealWindows: settings.mealWindows, waterButtonsMl: settings.waterButtonsMl, weekStart, dateFormat });
        setSettings(saved);
        notifySettingsChanged();
      }
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
        <label className={`${label} mt-4`}>
          Date format
          <select aria-label="Date format" value={dateFormat} disabled={!settings} onChange={(e) => setDateFormat(e.target.value)} className={field}>
            {DATE_FORMATS.map((f) => (
              <option key={f.key} value={f.key}>
                {formatDate(today, f.key)}
              </option>
            ))}
          </select>
        </label>
        <TimezoneSelect value={timezone} onChange={setTimezone} />
        <label className={`${label} mt-4`}>
          Week starts on
          <select aria-label="Week starts on" value={weekStart} disabled={!settings} onChange={(e) => setWeekStart(Number(e.target.value))} className={field}>
            {WEEKDAYS.map((name, i) => (
              <option key={name} value={i}>
                {name}
              </option>
            ))}
          </select>
        </label>
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
