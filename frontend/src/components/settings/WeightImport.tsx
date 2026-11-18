import { useRef, useState } from "react";
import { api } from "../../api";
import { useSession } from "../../session";
import type { WeightImportOptions, WeightImportPreview, WeightImportResult } from "../../types";
import { formatWeight } from "../../units";
import { longDay, notifyWeightChanged } from "../../weight";
import { Card } from "../ui/Card";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { field, label as labelClass, primaryButton, secondaryButton } from "../ui/styles";

// Settings › Data › Import weight history (design §19): choose a CSV, see what the server read from it (and
// correct its guesses), then import. Nothing is saved until Import.
const MAX_BYTES = 5 * 1024 * 1024;
type Existing = "keep" | "replace";

function importForm(file: File, options: Partial<WeightImportOptions>, existing?: Existing) {
  const form = new FormData();
  for (const [k, v] of Object.entries(options)) if (v !== undefined) form.append(k, String(v));
  if (existing) form.append("existing", existing);
  form.append("file", file);
  return form;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

function resultText(r: WeightImportResult) {
  let text = `Imported ${plural(r.imported, "weigh-in")}.`;
  if (r.kept) text += ` Kept the ${plural(r.kept, "day")} already in ByteSize.`;
  if (r.replaced) text += ` Replaced ${plural(r.replaced, "day")} that ${r.replaced === 1 ? "was" : "were"} already in ByteSize.`;
  return text;
}

export default function WeightImport() {
  const { user } = useSession();
  const [file, setFile] = useState<File | null>(null);
  // What the person changed from the server's guesses; the rest the server guesses again on each preview
  const [choices, setChoices] = useState<Partial<WeightImportOptions>>({});
  const [preview, setPreview] = useState<WeightImportPreview | null>(null);
  const [existing, setExisting] = useState<Existing>("keep");
  const [busy, setBusy] = useState<"reading" | "importing" | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const reads = useRef(0); // only the latest preview counts
  const inputKey = useRef(0);

  // A refused choice leaves the last good preview (and its choices) in place
  async function read(f: File, next: Partial<WeightImportOptions>) {
    const n = ++reads.current;
    setBusy("reading");
    setMsg(null);
    try {
      const p = await api<WeightImportPreview>("POST", "/api/weight/import/preview", importForm(f, next));
      if (n !== reads.current) return;
      setPreview(p);
      setChoices(next);
      if (!p.existingDays) setExisting("keep"); // the choice is hidden: back to the default
    } catch (e) {
      if (n === reads.current) setMsg(errorMsg(e));
    } finally {
      if (n === reads.current) setBusy(null);
    }
  }

  function reset() {
    reads.current++;
    inputKey.current++;
    setFile(null);
    setChoices({});
    setPreview(null);
    setExisting("keep");
    setBusy(null);
  }

  function choose(f: File) {
    reset();
    if (f.size > MAX_BYTES) {
      setMsg({ ok: false, text: "The file must be 5 MB or less." });
      return;
    }
    setFile(f);
    void read(f, {});
  }

  const change = (c: Partial<WeightImportOptions>) => file && void read(file, { ...choices, ...c });

  async function importNow() {
    if (!file || !preview) return;
    setBusy("importing");
    setMsg(null);
    try {
      const { dateColumn, weightColumn, units, dateFormat } = preview;
      const r = await api<WeightImportResult>("POST", "/api/weight/import", importForm(file, { dateColumn, weightColumn, units, dateFormat }, existing));
      reset();
      setMsg({ ok: true, text: resultText(r) });
      notifyWeightChanged(); // the Dashboard card and Goals reload
    } catch (e) {
      setMsg(errorMsg(e));
      setBusy(null);
    }
  }

  const columnSelect = (name: string, key: "dateColumn" | "weightColumn", p: WeightImportPreview) => (
    <label className={labelClass}>
      {name}
      <select aria-label={name} value={p[key]} disabled={!!busy} onChange={(e) => change({ [key]: Number(e.target.value) })} className={field}>
        {p.columns.map((c, i) => (
          <option key={i} value={i}>
            {c}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <Card title="Import weight history" description="Switching apps? Add your weigh-ins from a CSV file (up to 5 MB) — from Lose It, MyFitnessPal, Happy Scale, Libra, Withings, Fitbit or your own sheet. You'll see what will be saved before anything is.">
      {!preview && (
        <label className={labelClass}>
          Choose a CSV file
          <input
            key={inputKey.current}
            type="file"
            aria-label="Choose a CSV file"
            accept=".csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values"
            disabled={!!busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) choose(f);
            }}
            className={`${field} text-sm`}
          />
        </label>
      )}
      {busy === "reading" && !preview && <p className="mt-3 text-muted">Reading…</p>}
      {preview && file && (
        <div role="group" aria-label="Preview">
          <p className="text-sm text-subtle break-all">{file.name}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {columnSelect("Date column", "dateColumn", preview)}
            {columnSelect("Weight column", "weightColumn", preview)}
            <label className={labelClass}>
              Units in the file
              <select aria-label="Units in the file" value={preview.units} disabled={!!busy} onChange={(e) => change({ units: e.target.value as WeightImportOptions["units"] })} className={field}>
                <option value="lb">Pounds (lb)</option>
                <option value="kg">Kilograms (kg)</option>
              </select>
            </label>
            {preview.dateFormatMatters && (
              <label className={labelClass}>
                Date format
                <select aria-label="Date format" value={preview.dateFormat} disabled={!!busy} onChange={(e) => change({ dateFormat: e.target.value as WeightImportOptions["dateFormat"] })} className={field}>
                  <option value="mdy">Month/Day/Year</option>
                  <option value="dmy">Day/Month/Year</option>
                </select>
              </label>
            )}
          </div>

          <div className="mt-4 space-y-1">
            <p className="font-semibold">
              {preview.count === 0
                ? "No weigh-ins can be read with these choices. Try another column or date format."
                : preview.from === preview.to
                  ? `${plural(preview.count, "weigh-in")} on ${longDay(preview.from!)}`
                  : `${plural(preview.count, "weigh-in")} from ${longDay(preview.from!)} to ${longDay(preview.to!)}`}
            </p>
            {preview.existingDays > 0 && <p className="text-sm text-subtle">{`${plural(preview.existingDays, "of these days", "of these days")} already ${preview.existingDays === 1 ? "has" : "have"} a weigh-in in ByteSize.`}</p>}
            {preview.unreadable > 0 && (
              <div className="text-sm text-subtle">
                <p>{`${plural(preview.unreadable, "row")} can't be read:`}</p>
                <ul className="ml-4 list-disc">
                  {preview.problems.map((p) => (
                    <li key={p.line}>{`Line ${p.line}: ${p.reason}`}</li>
                  ))}
                  {preview.unreadable > preview.problems.length && <li>{`and ${plural(preview.unreadable - preview.problems.length, "more")}`}</li>}
                </ul>
              </div>
            )}
          </div>

          {preview.rows.length > 0 && (
            <table className="mt-4 w-full text-sm">
              <caption className="mb-1 text-left font-medium text-subtle">First rows as they will be saved</caption>
              <thead>
                <tr className="text-left text-subtle">
                  <th className="py-1 font-medium">Date</th>
                  <th className="py-1 text-right font-medium">Weight</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {preview.rows.map((r) => (
                  <tr key={r.day}>
                    <td className="py-1.5">{longDay(r.day)}</td>
                    {r.existing && existing === "keep" ? (
                      <td className="py-1.5 text-right text-subtle">Already in ByteSize — kept</td>
                    ) : (
                      <td className="py-1.5 text-right tabular-nums">{formatWeight(r.weightKg, user.units)}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {preview.existingDays > 0 && (
            <fieldset className="mt-4">
              <legend className={`${labelClass} mb-1`}>Days that already have a weigh-in</legend>
              {(
                [
                  ["keep", "Keep what's in ByteSize"],
                  ["replace", "Replace with the file's"],
                ] as const
              ).map(([value, text]) => (
                <label key={value} className="flex items-center gap-2 py-1">
                  <input type="radio" name="existing" value={value} checked={existing === value} disabled={!!busy} onChange={() => setExisting(value)} className="size-4 accent-[var(--color-action)]" />
                  {text}
                </label>
              ))}
            </fieldset>
          )}

          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" onClick={() => void importNow()} disabled={!!busy || preview.count === 0} className={primaryButton}>
              {busy === "importing" ? "Importing…" : "Import"}
            </button>
            <button type="button" onClick={reset} disabled={busy === "importing"} className={secondaryButton}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <Notice msg={msg} />
    </Card>
  );
}
