import { useId, useState, type FormEvent } from "react";
import { api } from "../../api";
import { useSession } from "../../session";
import { todayIn } from "../../selectedDay";
import type { Activity, Body } from "../../types";
import { cmToFtIn, inToCm, kgToLb, lbToKg } from "../../units";
import { Choice } from "../ui/Choice";
import { Field } from "../ui/Field";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { Toggle } from "../ui/Toggle";
import { primaryButton } from "../ui/styles";

export const ACTIVITY_QUESTION = "How active is your day, not counting workouts?";
// Workouts are logged as exercise, so these describe the rest of the day (×1.2, 1.3, 1.4, 1.5)
export const ACTIVITIES: { id: Activity; name: string; hint: string }[] = [
  { id: "sitting", name: "Mostly sitting", hint: "Desk job, little walking" },
  { id: "some", name: "On your feet some of the day", hint: "Some walking, or a daily walk" },
  { id: "most", name: "On your feet most of the day", hint: "Retail, teaching, lots of walking" },
  { id: "physical", name: "Physical job", hint: "Construction, warehouse, farm work" },
];

const str = (n: number | undefined, digits = 1) => (n === undefined ? "" : String(Math.round(n * 10 ** digits) / 10 ** digits));

// Height, weight, goal, birthdate, sex, activity and GLP-1: what the plans are worked out from.
// Imperial shows ft + in and lb; metric shows cm and kg. Sends metric.
export default function BodyForm({ initial, onSaved }: { initial: Body | null; onSaved: (b: Body) => void }) {
  const { user } = useSession();
  const metric = user.units === "metric";
  const ftIn = initial ? cmToFtIn(initial.heightCm) : undefined;
  const w = (kg: number | undefined) => (kg === undefined ? undefined : metric ? kg : kgToLb(kg));
  const [sex, setSex] = useState<Body["sex"] | "">(initial?.sex ?? "");
  const [birthDate, setBirthDate] = useState(initial?.birthDate ?? "");
  const [ft, setFt] = useState(ftIn ? String(ftIn.ft) : "");
  const [inches, setInches] = useState(ftIn ? String(ftIn.in) : "");
  const [cm, setCm] = useState(str(initial?.heightCm));
  const [weight, setWeight] = useState(str(w(initial?.weightKg)));
  const [goal, setGoal] = useState(str(w(initial?.goalWeightKg)));
  // An activity from before the new levels (shouldn't reach here once migrated) is asked again
  const [activity, setActivity] = useState<Activity | "">(ACTIVITIES.some((a) => a.id === initial?.activity) ? initial!.activity : "");
  const [glp1, setGlp1] = useState(initial?.glp1 ?? false);
  const [msg, setMsg] = useState<Msg>(null);
  const questionId = useId();
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const heightCm = metric ? Number(cm) : inToCm(Number(ft) * 12 + Number(inches || 0));
    const toKg = (v: string) => (metric ? Number(v) : lbToKg(Number(v)));
    if (!sex || !activity || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || !heightCm || !weight || !goal) {
      setMsg({ ok: false, text: "Fill in every field to see your plans" });
      return;
    }
    const body: Body = { sex, birthDate, heightCm, weightKg: toKg(weight), goalWeightKg: toKg(goal), activity, glp1 };
    setBusy(true);
    try {
      const out = await api<{ body: Body }>("PUT", "/api/body", body);
      onSaved(out.body);
    } catch (err) {
      setMsg(errorMsg(err));
      setBusy(false);
    }
  };

  const wUnit = metric ? "kg" : "lb";
  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-2xl bg-container p-5">
      <h1 className="text-xl font-bold">Tell us about yourself</h1>
      <p className="-mt-2 text-subtle">ByteSize uses this to work out your daily calories and pick a safe plan.</p>
      <Choice label="Sex" value={sex as Body["sex"]} onChange={setSex} options={[{ value: "male", label: "Male" }, { value: "female", label: "Female" }]} />
      <Field label="Birthdate" type="date" max={todayIn(user.timezone)} value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
      {metric ? (
        <Field label="Height (cm)" type="number" inputMode="decimal" value={cm} onChange={(e) => setCm(e.target.value)} />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Height (ft)" type="number" inputMode="numeric" value={ft} onChange={(e) => setFt(e.target.value)} />
          <Field label="Height (in)" type="number" inputMode="numeric" value={inches} onChange={(e) => setInches(e.target.value)} />
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label={`Current weight (${wUnit})`} type="number" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} />
        <Field label={`Goal weight (${wUnit})`} type="number" inputMode="decimal" value={goal} onChange={(e) => setGoal(e.target.value)} />
      </div>
      <div role="radiogroup" aria-labelledby={questionId} className="flex flex-col gap-2">
        <p id={questionId} className="text-sm font-medium text-subtle">
          {ACTIVITY_QUESTION}
        </p>
        {ACTIVITIES.map((a) => (
          <button
            key={a.id}
            type="button"
            role="radio"
            aria-checked={activity === a.id}
            onClick={() => setActivity(a.id)}
            className={`rounded-xl border px-4 py-2.5 text-left ${activity === a.id ? "border-action bg-active" : "border-line hover:bg-pressed"}`}
          >
            <span className="block font-semibold">{a.name}</span>
            <span className="block text-sm text-subtle">{a.hint}</span>
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">Are you taking a GLP-1 medicine?</span>
        <Toggle label="Are you taking a GLP-1 medicine?" checked={glp1} onChange={setGlp1} />
      </div>
      <Notice msg={msg} />
      <button type="submit" disabled={busy} className={primaryButton}>
        See my plans
      </button>
    </form>
  );
}
