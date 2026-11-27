import { useEffect, useState, type FormEvent } from "react";
import { api } from "../../api";
import { DEFAULT_SETTINGS, notifySettingsChanged, useSettingsMe } from "../../day";
import { DATE_FORMATS, DEFAULT_DATE_FORMAT, formatDate } from "../../dateFormat";
import { todayIn } from "../../selectedDay";
import { GOAL_ESTIMATE_WEEKS, type GoalEstimateBasis, type GoalEstimateWeeks, type MealWindows, type SettingsMe } from "../../types";

// The goal estimate before anyone chooses (the server's defaults)
const DEFAULT_ESTIMATE_BASIS: GoalEstimateBasis = "scale";
const DEFAULT_ESTIMATE_WEEKS: GoalEstimateWeeks = 12;
import { useSession, type User } from "../../session";
import { THEMES, applyMode, applyTheme, useTheme, type ColorMode } from "../../themes";
import { Card } from "../ui/Card";
import { Choice, UNIT_OPTIONS } from "../ui/Choice";
import { Field } from "../ui/Field";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { field, label, noAutofill, primaryButton } from "../ui/styles";
import { TimezoneSelect } from "../ui/TimezoneSelect";
import VacationMode from "./VacationMode";
import { ChevronRight, Syringe } from "lucide-react";

export default function ProfileSettings() {
  return (
    <>
      <AboutYou />
      <Glp1Shots />
      <VacationMode />
      <Appearance />
    </>
  );
}

// With GLP-1 tracking on: a row to the GLP-1 page (shots, doses, how you feel), which comes back here (§40a: the
// phones' way in, now the Goals button has gone; turned on or off in Goals › Edit my details or by setting GLP-1 up)
function Glp1Shots() {
  if (!useSettingsMe().glp1On) return null; // from the settings, like the rail (§46)
  return (
    <Card title="GLP-1">
      <a href="#/glp1?from=/settings/profile" className="-mx-2 flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-pressed">
        <Syringe aria-hidden="true" className="size-5 text-action" />
        <span className="flex-1">
          <span className="block font-semibold">GLP-1 shots</span>
          <span className="block text-sm text-subtle">Your shots, doses and how you're feeling</span>
        </span>
        <ChevronRight aria-hidden="true" className="size-5 text-subtle" />
      </a>
    </Card>
  );
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Each meal's end time: the default meal for new food comes from the clock (after dinner is snacks)
const MEAL_TIMES: { key: keyof MealWindows; label: string }[] = [
  { key: "breakfast", label: "Breakfast until" },
  { key: "lunch", label: "Lunch until" },
  { key: "snacks", label: "Snacks until" },
  { key: "dinner", label: "Dinner until" },
];
const sameWindows = (a: MealWindows, b: MealWindows) => MEAL_TIMES.every(({ key }) => a[key] === b[key]);

// Name, email, units, time zone, plus the date format, week start and meal times (those live in /api/settings/me)
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
  const [mealWindows, setMealWindows] = useState<MealWindows>(DEFAULT_SETTINGS.mealWindows);
  const [estimateBasis, setEstimateBasis] = useState<GoalEstimateBasis>(DEFAULT_ESTIMATE_BASIS);
  const [estimateWeeks, setEstimateWeeks] = useState<GoalEstimateWeeks>(DEFAULT_ESTIMATE_WEEKS);
  useEffect(() => {
    api<SettingsMe>("GET", "/api/settings/me")
      .then((s) => {
        setSettings(s);
        setWeekStart(s.weekStart);
        setDateFormat(s.dateFormat ?? DEFAULT_DATE_FORMAT);
        setMealWindows(s.mealWindows);
        setEstimateBasis(s.goalEstimateBasis ?? DEFAULT_ESTIMATE_BASIS);
        setEstimateWeeks(s.goalEstimateWeeks ?? DEFAULT_ESTIMATE_WEEKS);
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
      const changed =
        settings &&
        (weekStart !== settings.weekStart ||
          dateFormat !== (settings.dateFormat ?? DEFAULT_DATE_FORMAT) ||
          !sameWindows(mealWindows, settings.mealWindows) ||
          estimateBasis !== (settings.goalEstimateBasis ?? DEFAULT_ESTIMATE_BASIS) ||
          estimateWeeks !== (settings.goalEstimateWeeks ?? DEFAULT_ESTIMATE_WEEKS));
      if (settings && changed) {
        const saved = await api<SettingsMe>("PUT", "/api/settings/me", {
          mealWindows,
          waterButtonsMl: settings.waterButtonsMl,
          weekStart,
          dateFormat,
          goalEstimateBasis: estimateBasis,
          goalEstimateWeeks: estimateWeeks,
        });
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
        <fieldset className="mt-4">
          <legend className={label}>Meal times</legend>
          <div className="mt-1 grid grid-cols-2 gap-3">
            {MEAL_TIMES.map(({ key, label: name }) => (
              <label key={key} className="block text-sm text-subtle">
                {name}
                <input
                  type="time"
                  {...noAutofill}
                  aria-label={name}
                  value={mealWindows[key]}
                  disabled={!settings}
                  onChange={(e) => setMealWindows((w) => ({ ...w, [key]: e.target.value }))}
                  className={field}
                />
              </label>
            ))}
          </div>
          <p className="mt-1 flex items-center justify-between gap-2 text-sm text-subtle">
            <span>After dinner counts as snacks.</span>
            <button type="button" disabled={!settings} onClick={() => setMealWindows(DEFAULT_SETTINGS.mealWindows)} className="text-link hover:underline disabled:opacity-60">
              Reset to defaults
            </button>
          </p>
        </fieldset>
        <fieldset className="mt-4">
          <legend className={label}>Goal estimate</legend>
          <div className="mt-1 grid grid-cols-2 gap-3">
            <label className="block text-sm text-subtle">
              Goes by
              <select aria-label="Goal estimate goes by" value={estimateBasis} disabled={!settings} onChange={(e) => setEstimateBasis(e.target.value as GoalEstimateBasis)} className={field}>
                <option value="scale">Scale weigh-ins</option>
                <option value="trend">Trend</option>
              </select>
            </label>
            <label className="block text-sm text-subtle">
              Looks back
              <select aria-label="Goal estimate looks back" value={estimateWeeks} disabled={!settings} onChange={(e) => setEstimateWeeks(Number(e.target.value) as GoalEstimateWeeks)} className={field}>
                {GOAL_ESTIMATE_WEEKS.map((n) => (
                  <option key={n} value={n}>
                    {`${n} weeks`}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="mt-1 text-sm text-subtle">Scale follows your weigh-ins; trend smooths day-to-day swings. A longer look-back is steadier.</p>
        </fieldset>
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
