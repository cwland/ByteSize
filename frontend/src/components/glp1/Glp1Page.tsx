import { useEffect, useState } from "react";
import { api } from "../../api";
import { useHash } from "../../routes";
import { useSession } from "../../session";
import { dayLabel, todayIn, useSelectedDay } from "../../selectedDay";
import { SIDE_EFFECTS, type AfterInjection as AfterData, type Glp1Settings, type Glp1View, type Shot, type SideEffectDay } from "../../types";
import { Card } from "../ui/Card";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { field, label, linkButton, primaryButton, secondaryButton } from "../ui/styles";
import AfterInjection from "./AfterInjection";
import ShotSheet from "./ShotSheet";
import SideEffectsSheet from "./SideEffectsSheet";
import { EFFECT_LABELS, LEVEL_LABELS, SITE_LABELS, WEEKDAYS, mg, statusText } from "./glp1";

// "#/glp1?from=/goals" -> "#/goals" (default: the Dashboard)
const backHref = (hash: string) => {
  const from = hash.match(/[?&]from=([^&]*)/)?.[1] ?? "/";
  return from.startsWith("/") && !from.startsWith("/glp1") ? `#${from}` : "#/";
};

// The GLP-1 page (#/glp1): setup, Log shot, "How are you feeling?", history and the after-injection view
export default function Glp1Page() {
  const { user } = useSession();
  const hash = useHash();
  const { day: selected } = useSelectedDay();
  const today = todayIn(user.timezone);
  const day = selected > today ? today : selected; // check-ins are for the day shown, never a future one
  const [view, setView] = useState<Glp1View | null>(null);
  const [after, setAfter] = useState<AfterData | null>(null);
  const [feeling, setFeeling] = useState<SideEffectDay | null | undefined>(undefined);
  const [sheet, setSheet] = useState<"shot" | "feel" | null>(null);
  const [msg, setMsg] = useState<Msg>(null);

  useEffect(() => {
    api<Glp1View>("GET", "/api/glp1")
      .then(setView)
      .catch((e) => setMsg(errorMsg(e)));
  }, []);
  // The after-injection averages depend on the shots: reload when they change
  const shotKey = view?.shots.map((s) => s.day).join(",");
  useEffect(() => {
    if (shotKey === undefined) return;
    api<AfterData>("GET", "/api/glp1/after-injection")
      .then(setAfter)
      .catch(() => {});
  }, [shotKey]);
  useEffect(() => {
    setFeeling(undefined);
    api<{ days: SideEffectDay[] }>("GET", `/api/side-effects?from=${day}&to=${day}`)
      .then((r) => setFeeling(r.days.find((d) => d.day === day) ?? null))
      .catch(() => setFeeling(null));
  }, [day]);

  const status = view ? statusText(view) : null;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <button type="button" aria-label="Back" onClick={() => (window.location.hash = backHref(hash))} className="rounded-full px-2 py-1 text-sm font-semibold text-link hover:bg-pressed">
          ‹ Back
        </button>
        <h1 className="flex-1 text-xl font-bold">GLP-1</h1>
      </div>
      <Notice msg={msg} />
      {view && (
        <>
          <Setup settings={view.settings} today={today} onSaved={setView} />
          {view.settings && (
            <section aria-label="Next shot" className="flex items-center gap-3 rounded-2xl bg-container p-5">
              <p className={`flex-1 text-lg font-bold ${view.status === "overdue" ? "text-action" : ""}`}>{status}</p>
              <button type="button" onClick={() => setSheet("shot")} className={primaryButton}>
                Log shot
              </button>
            </section>
          )}
          <Card title="How are you feeling?" description={dayLabel(day)}>
            {feeling !== undefined && (
              <>
                {feeling ? <p className="font-semibold">{summary(feeling)}</p> : <p className="text-subtle">No side effects noted</p>}
                {feeling?.note && <p className="mt-1 text-subtle">{feeling.note}</p>}
                <button type="button" onClick={() => setSheet("feel")} className={`${secondaryButton} mt-3`}>
                  {feeling ? "Edit check-in" : "Check in"}
                </button>
              </>
            )}
          </Card>
          <Card title="History">
            <History shots={view.shots} doses={view.doseHistory} />
          </Card>
          <Card title="After your injection">{after ? <AfterInjection data={after} /> : <p className="text-subtle">Loading…</p>}</Card>
        </>
      )}
      {view && sheet === "shot" && (
        <ShotSheet
          view={view}
          onClose={() => setSheet(null)}
          onSaved={(v) => {
            setView(v);
            setSheet(null);
          }}
        />
      )}
      {sheet === "feel" && feeling !== undefined && (
        <SideEffectsSheet
          day={day}
          initial={feeling}
          onClose={() => setSheet(null)}
          onSaved={(d) => {
            setFeeling(d);
            setSheet(null);
          }}
        />
      )}
    </div>
  );
}

// "Nausea: medium, Low appetite: strong"; a note alone reads as nothing felt
function summary(d: SideEffectDay) {
  const felt = SIDE_EFFECTS.filter((e) => d.effects[e]).map((e) => `${EFFECT_LABELS[e]}: ${LEVEL_LABELS[d.effects[e]!].toLowerCase()}`);
  return felt.length ? felt.join(", ") : "No side effects noted";
}

// Setup: medication, dose and injection weekday. A form when there's nothing yet (or on Edit), else one line.
function Setup({ settings, today, onSaved }: { settings: Glp1Settings | null; today: string; onSaved: (v: Glp1View) => void }) {
  const [editing, setEditing] = useState(false);
  const [medication, setMedication] = useState(settings?.medication ?? "");
  const [dose, setDose] = useState(settings ? String(settings.doseMg) : "");
  const [weekday, setWeekday] = useState(String(settings?.injectionWeekday ?? new Date(`${today}T00:00:00Z`).getUTCDay()));
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  const edit = () => {
    setMedication(settings?.medication ?? "");
    setDose(settings ? String(settings.doseMg) : "");
    setWeekday(String(settings?.injectionWeekday ?? new Date(`${today}T00:00:00Z`).getUTCDay()));
    setMsg(null);
    setEditing(true);
  };
  const save = async () => {
    const doseMg = Number(dose);
    if (!medication.trim()) return setMsg({ ok: false, text: "Enter your medication" });
    if (!(doseMg > 0)) return setMsg({ ok: false, text: "Enter the dose in mg" });
    setBusy(true);
    try {
      onSaved(await api<Glp1View>("PUT", "/api/glp1/settings", { medication: medication.trim(), doseMg, injectionWeekday: Number(weekday) }));
      setEditing(false);
    } catch (e) {
      setMsg(errorMsg(e));
    } finally {
      setBusy(false);
    }
  };

  if (settings && !editing) {
    return (
      <section aria-label="Setup" className="flex items-center gap-3 rounded-2xl bg-container px-5 py-4">
        <p className="flex-1 font-semibold">{`${settings.medication} ${mg(settings.doseMg)}, ${WEEKDAYS[settings.injectionWeekday]}s`}</p>
        <button type="button" onClick={edit} className={linkButton}>
          Edit
        </button>
      </section>
    );
  }
  return (
    <Card title="Setup" description={settings ? undefined : "Set up your GLP-1 to track shots, rotate sites and see how your eating changes."}>
      <div className="flex flex-col gap-3">
        <label className={label}>
          Medication
          <input aria-label="Medication" value={medication} maxLength={60} onChange={(e) => setMedication(e.target.value)} placeholder="e.g. Ozempic" className={field} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className={label}>
            Dose (mg)
            <input aria-label="Dose (mg)" type="number" inputMode="decimal" min="0" step="any" value={dose} onChange={(e) => setDose(e.target.value)} className={field} />
          </label>
          <label className={label}>
            Injection day
            <select aria-label="Injection day" value={weekday} onChange={(e) => setWeekday(e.target.value)} className={field}>
              {WEEKDAYS.map((w, i) => (
                <option key={w} value={String(i)}>
                  {w}
                </option>
              ))}
            </select>
          </label>
        </div>
        <Notice msg={msg} />
        <div className="flex gap-3">
          <button type="button" onClick={save} disabled={busy} className={primaryButton}>
            Save
          </button>
          {settings && (
            <button type="button" onClick={() => setEditing(false)} className={secondaryButton}>
              Cancel
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

// Shots newest first: date, dose, site, note; the first shot and each dose or medication change called out
function History({ shots, doses }: { shots: Shot[]; doses: Glp1View["doseHistory"] }) {
  if (shots.length === 0) return <p className="text-subtle">No shots logged yet</p>;
  const change = (s: Shot) => {
    const i = doses.findIndex((d) => d.day === s.day);
    if (i < 0) return null;
    if (i === 0) return `Started ${s.medication} ${mg(s.doseMg)}`;
    const was = doses[i - 1];
    if (was.medication !== s.medication) return `Switched to ${s.medication} ${mg(s.doseMg)}`;
    return `Dose changed from ${mg(was.doseMg)} to ${mg(s.doseMg)}`;
  };
  return (
    <ul className="flex flex-col divide-y divide-line">
      {shots.map((s) => {
        const c = change(s);
        return (
          <li key={s.day} className="py-2.5 first:pt-0 last:pb-0">
            <div className="flex items-baseline gap-2">
              <span className="flex-1 font-semibold">{dayLabel(s.day)}</span>
              <span className="tabular">{mg(s.doseMg)}</span>
            </div>
            <p className="text-sm text-subtle">{SITE_LABELS[s.site]}</p>
            {c && <p className="mt-0.5 text-sm font-semibold text-action">{c}</p>}
            {s.note && <p className="mt-0.5 text-sm text-muted">{s.note}</p>}
          </li>
        );
      })}
    </ul>
  );
}
