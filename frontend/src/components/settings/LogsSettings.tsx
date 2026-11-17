import { useCallback, useEffect, useState } from "react";
import { api } from "../../api";
import { when } from "../../format";
import { Card } from "../ui/Card";
import { Choice } from "../ui/Choice";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { secondaryButton } from "../ui/styles";

// A line as GET /api/logs sends it
interface LogRow {
  id: number;
  at: string;
  userId: number | null;
  category: "ai" | "api" | "auth" | "schedule" | "food";
  level: "info" | "warning" | "error";
  source: string | null;
  event: string;
  detail: string | null;
}
type Filter = "all" | LogRow["category"];

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "food", label: "Food" },
  { value: "ai", label: "AI" },
  { value: "auth", label: "Sign-in" },
  { value: "api", label: "API" },
  { value: "schedule", label: "Scheduled" },
];
const LEVEL: Record<LogRow["level"], { mark: string; cls: string; label: string }> = {
  info: { mark: "✓", cls: "text-success", label: "OK" },
  warning: { mark: "!", cls: "text-warning", label: "Warning" },
  error: { mark: "✕", cls: "text-error", label: "Error" },
};

// Settings › Logs: what the app did and what went wrong, newest first (last 30 days)
export default function LogsSettings() {
  const [rows, setRows] = useState<LogRow[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  const load = useCallback(async () => {
    const q = new URLSearchParams();
    if (filter !== "all") q.set("category", filter);
    if (problemsOnly) q.set("problems", "true");
    try {
      setRows(await api<LogRow[]>("GET", `/api/logs${q.size ? `?${q}` : ""}`));
      setMsg(null);
    } catch (e) {
      setMsg(errorMsg(e));
    }
  }, [filter, problemsOnly]);
  useEffect(() => void load(), [load]);

  return (
    <Card title="Logs" description="The last 30 days, newest first.">
      <div className="flex flex-wrap items-center gap-3">
        <Choice label="Show" value={filter} options={FILTERS} onChange={setFilter} />
        <label className="flex items-center gap-2 text-sm text-subtle">
          <input type="checkbox" checked={problemsOnly} onChange={(e) => setProblemsOnly(e.target.checked)} />
          Problems only
        </label>
        <button type="button" onClick={() => void load()} className={`${secondaryButton} ml-auto py-1.5 text-sm`}>
          Refresh
        </button>
      </div>
      <Notice msg={msg} />
      {rows?.length === 0 && <p className="mt-4 text-muted">Nothing to show.</p>}
      {rows && rows.length > 0 && (
        <ul className="mt-4 divide-y divide-line">
          {rows.slice(0, 500).map((r) => (
            <li key={r.id} className="flex gap-3 py-2 text-sm">
              <span className={`w-4 shrink-0 font-bold ${LEVEL[r.level].cls}`} title={LEVEL[r.level].label} aria-label={LEVEL[r.level].label}>
                {LEVEL[r.level].mark}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{r.event}</p>
                {r.detail && <p className="break-words text-subtle">{r.detail}</p>}
                <p className="text-xs text-muted">
                  {when(r.at)}
                  {r.source && ` · ${r.source}`}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
