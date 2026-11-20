import { useEffect, useState } from "react";
import { api } from "../../api";
import { notifySettingsChanged } from "../../day";
import { useHash } from "../../routes";
import { useSession } from "../../session";
import { dayLabel, todayIn, useSelectedDay } from "../../selectedDay";
import { SIDE_EFFECTS, type AfterInjection as AfterData, type DoseUnit, type Glp1Settings, type Glp1View, type Medication, type Shot, type SideEffectDay } from "../../types";
import { Card } from "../ui/Card";
import { Confirm } from "../ui/Confirm";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { field, label, linkButton, noAutofill, primaryButton, secondaryButton } from "../ui/styles";
import AfterInjection from "./AfterInjection";
import ShotSheet from "./ShotSheet";
import SideEffectsSheet from "./SideEffectsSheet";
import { DOSE_UNITS, EFFECT_LABELS, LEVEL_LABELS, SITE_LABELS, WEEKDAYS, doseText, statusText } from "./glp1";
import { IconButton } from "../ui/IconButton";

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
  const [after, setAfter] = useState<AfterData | null | "error">(null);
  const [feeling, setFeeling] = useState<SideEffectDay | null | undefined>(undefined);
  const [sheet, setSheet] = useState<"shot" | "feel" | null>(null);
  const [editDay, setEditDay] = useState<string | undefined>(undefined); // the history row whose shot is being edited
  const [deleting, setDeleting] = useState<string | null>(null);
  const logShot = (d?: string) => {
    setEditDay(d);
    setSheet("shot");
  };
  // Deleting the latest shot can change the current dose: show what the server has now
  const remove = async (d: string) => {
    setDeleting(null);
    try {
      await api("DELETE", `/api/glp1/shots/${d}`);
      setView(await api<Glp1View>("GET", "/api/glp1"));
    } catch (e) {
      setMsg(errorMsg(e));
    }
  };
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
      .catch(() => setAfter("error"));
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
          <Setup settings={view.settings} medications={view.medications ?? []} today={today} onSaved={setView} />
          {view.settings && (
            <section aria-label="Next shot" className="flex items-center gap-3 rounded-2xl bg-container p-5">
              <p className={`flex-1 text-lg font-bold ${view.status === "overdue" ? "text-action" : ""}`}>{status}</p>
              <button type="button" onClick={() => logShot()} className={primaryButton}>
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
            <History shots={view.shots} doses={view.doseHistory} onEdit={logShot} onDelete={setDeleting} />
          </Card>
          <Card title="After your injection">{after === "error" ? <p className="text-subtle">Couldn't load this right now</p> : after ? <AfterInjection data={after} /> : <p className="text-subtle">Loading…</p>}</Card>
        </>
      )}
      {view && sheet === "shot" && (
        <ShotSheet
          view={view}
          day={editDay}
          onClose={() => setSheet(null)}
          onSaved={(v) => {
            setView(v);
            setSheet(null);
          }}
        />
      )}
      {deleting && (
        <Confirm title={`Delete the shot on ${dayLabel(deleting)}?`} confirmLabel="Delete" onConfirm={() => remove(deleting)} onCancel={() => setDeleting(null)} />
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
// W1 (SPEC-14): a brand offers its standard dose steps; Compounded takes its own name, dose and unit.
const COMPOUNDED = "compounded";
function Setup({ settings, medications, today, onSaved }: { settings: Glp1Settings | null; medications: Medication[]; today: string; onSaved: (v: Glp1View) => void }) {
  const brandOf = (name: string | undefined) => medications.find((m) => m.name === name);
  const start = () => {
    const brand = brandOf(settings?.medication);
    return {
      choice: settings ? (brand ? brand.name : COMPOUNDED) : "",
      name: settings && !brand ? settings.medication : "",
      dose: settings ? String(settings.doseMg) : "",
      unit: (settings?.doseUnit ?? "mg") as DoseUnit,
      weekday: String(settings?.injectionWeekday ?? new Date(`${today}T00:00:00Z`).getUTCDay()),
    };
  };
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(start);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<ReturnType<typeof start>>) => setForm((f) => ({ ...f, ...patch }));
  const brand = brandOf(form.choice);

  // A brand: its doses (the saved one if it's a step, else the first); Compounded: whatever was typed
  const pick = (choice: string) => {
    const b = brandOf(choice);
    if (b) set({ choice, unit: "mg", dose: b.doses.includes(Number(form.dose)) ? form.dose : String(b.doses[0]) });
    else set({ choice });
  };

  const edit = () => {
    setForm(start());
    setMsg(null);
    setEditing(true);
  };
  const save = async () => {
    const doseMg = Number(form.dose);
    const medication = brand ? brand.name : form.name.trim();
    if (!form.choice) return setMsg({ ok: false, text: "Choose your medication" });
    if (!medication) return setMsg({ ok: false, text: "Enter the medication or compound name" });
    if (!(doseMg > 0)) return setMsg({ ok: false, text: "Enter the dose" });
    setBusy(true);
    try {
      onSaved(await api<Glp1View>("PUT", "/api/glp1/settings", { medication, doseMg, doseUnit: brand ? "mg" : form.unit, injectionWeekday: Number(form.weekday) }));
      notifySettingsChanged(); // GLP-1 is on now: the rail's GLP-1 item reads it from the settings (§46)
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
        <p className="flex-1 font-semibold">{`${settings.medication} ${doseText(settings.doseMg, settings.doseUnit)}, ${WEEKDAYS[settings.injectionWeekday]}s`}</p>
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
          <select aria-label="Medication" value={form.choice} onChange={(e) => pick(e.target.value)} className={field}>
            <option value="" disabled>
              Choose…
            </option>
            {medications.map((m) => (
              <option key={m.name} value={m.name}>{`${m.name} (${m.ingredient})`}</option>
            ))}
            <option value={COMPOUNDED}>Compounded</option>
          </select>
        </label>
        {form.choice === COMPOUNDED && (
          <label className={label}>
            Medication / compound name
            <input {...noAutofill} aria-label="Medication / compound name" value={form.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Compounded Tirzepatide + B12" className={field} />
          </label>
        )}
        <div className="grid grid-cols-2 gap-3">
          {brand ? (
            <label className={label}>
              Dose
              <select aria-label="Dose" value={form.dose} onChange={(e) => set({ dose: e.target.value })} className={field}>
                {brand.doses.map((d) => (
                  <option key={d} value={String(d)}>
                    {doseText(d)}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            form.choice === COMPOUNDED && (
              <div className="grid grid-cols-2 gap-2">
                <label className={label}>
                  Dose
                  <input {...noAutofill} aria-label="Dose" type="number" inputMode="decimal" min="0" step="any" value={form.dose} onChange={(e) => set({ dose: e.target.value })} className={field} />
                </label>
                <label className={label}>
                  Unit
                  <select aria-label="Unit" value={form.unit} onChange={(e) => set({ unit: e.target.value as DoseUnit })} className={field}>
                    {DOSE_UNITS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )
          )}
          <label className={label}>
            Injection day
            <select aria-label="Injection day" value={form.weekday} onChange={(e) => set({ weekday: e.target.value })} className={field}>
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

// Shots newest first: date, dose, site, note, Edit and Delete; the first shot and each dose or medication change called out
function History({ shots, doses, onEdit, onDelete }: { shots: Shot[]; doses: Glp1View["doseHistory"]; onEdit: (day: string) => void; onDelete: (day: string) => void }) {
  if (shots.length === 0) return <p className="text-subtle">No shots logged yet</p>;
  const change = (s: Shot) => {
    const i = doses.findIndex((d) => d.day === s.day);
    if (i < 0) return null;
    if (i === 0) return `Started ${s.medication} ${doseText(s.doseMg, s.doseUnit)}`;
    const was = doses[i - 1];
    if (was.medication !== s.medication) return `Switched to ${s.medication} ${doseText(s.doseMg, s.doseUnit)}`;
    return `Dose changed from ${doseText(was.doseMg, s.doseUnit)} to ${doseText(s.doseMg, s.doseUnit)}`;
  };
  return (
    <ul className="flex flex-col divide-y divide-line">
      {shots.map((s) => {
        const c = change(s);
        return (
          <li key={s.day} className="py-2.5 first:pt-0 last:pb-0">
            <div className="flex items-baseline gap-2">
              <span className="flex-1 font-semibold">{dayLabel(s.day)}</span>
              <span className="tabular">{doseText(s.doseMg, s.doseUnit)}</span>
            </div>
            <p className="text-sm text-subtle">{SITE_LABELS[s.site]}</p>
            {c && <p className="mt-0.5 text-sm font-semibold text-action">{c}</p>}
            {s.note && <p className="mt-0.5 text-sm text-muted">{s.note}</p>}
            <div className="mt-1 flex gap-4">
              <IconButton label={`Edit shot on ${dayLabel(s.day)}`} onClick={() => onEdit(s.day)} className={`${linkButton} text-sm`}>
                Edit
              </IconButton>
              <IconButton label={`Delete shot on ${dayLabel(s.day)}`} onClick={() => onDelete(s.day)} className="text-sm font-semibold text-error hover:underline">
                Delete
              </IconButton>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
