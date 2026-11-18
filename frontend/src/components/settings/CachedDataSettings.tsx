import { useEffect, useState } from "react";
import { api } from "../../api";
import { savedDate } from "../log/SavedCopy";
import { Confirm } from "../ui/Confirm";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { field, linkButton, noAutofill, secondaryButton } from "../ui/styles";
import { Pager } from "../ui/Pager";
import { pillClass } from "../log/SourcePills";
import { SOURCE_TITLES, type AnySource } from "./FoodSourcesSettings";

// As GET /api/admin/saved-barcodes sends it: one page of kept foods that have a barcode, newest first; sources: how many
// each source has (following the search, not the source filter)
type SavedBarcode = { cacheId: number; barcode: string; name: string; brand: string | null; source: string; savedAt: string; deletesAt: string | null; inUse: boolean };
type Page = { total: number; page: number; pageSize: number; sources: Record<string, number>; items: SavedBarcode[] };

const SOURCE_ORDER: AnySource[] = ["off", "usda", "fatsecret", "spoonacular"];
const PER_PAGE = [10, 20, 30, 40, 50];
const PER_PAGE_KEY = "bytesize.cachedPerPage"; // remembered on this device
function savedPerPage(): number {
  try {
    const n = Number(localStorage.getItem(PER_PAGE_KEY));
    if (PER_PAGE.includes(n)) return n;
  } catch {
    // storage blocked
  }
  return 10;
}

const plural = (n: number) => `${n} saved barcode${n === 1 ? "" : "s"}`;

// Settings › Cached data (admin, §32): every kept barcode — refresh it from its source or delete it, search by name or
// barcode, filter by source, 10 to 50 at a time with pages, or delete all that nothing uses
export default function CachedDataSettings() {
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(savedPerPage);
  const [off, setOff] = useState<Set<string>>(new Set()); // sources whose pill is turned off
  const [known, setKnown] = useState<Set<string>>(new Set()); // sources seen so far: their pills stay even at 0
  const [data, setData] = useState<Page | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState<number | "all" | null>(null);
  const [asking, setAsking] = useState(false);
  const [reload, setReload] = useState(0);

  // The search waits for a pause in typing, and starts again at page 1
  useEffect(() => {
    const next = typed.trim();
    if (next === q) return; // nothing new to search (e.g. on first show): the page stays
    const t = setTimeout(() => {
      setQ(next);
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [typed, q]);

  useEffect(() => {
    let live = true;
    // Every pill off: an empty list, which the server reads as no sources
    const allOff = SOURCE_ORDER.filter((s) => known.has(s)).every((s) => off.has(s)) && known.size > 0;
    const sources = allOff ? "&sources=" : off.size ? `&sources=${SOURCE_ORDER.filter((s) => !off.has(s)).join(",")}` : "";
    api<Page>("GET", `/api/admin/saved-barcodes?page=${page}&pageSize=${perPage}${q ? `&q=${encodeURIComponent(q)}` : ""}${sources}`).then(
      (p) => {
        if (!live) return;
        setKnown((k) => (Object.keys(p.sources).every((s) => k.has(s)) ? k : new Set([...k, ...Object.keys(p.sources)])));
        // Past the last page (its last rows were deleted): back to the last page there is
        const last = Math.max(1, Math.ceil(p.total / perPage));
        if (page > last) setPage(last);
        else setData(p);
      },
      (e) => live && setMsg(errorMsg(e)),
    );
    return () => void (live = false);
  }, [q, page, perPage, off, reload]);

  const toggle = (source: string) => {
    setOff((o) => {
      const next = new Set(o);
      if (!next.delete(source)) next.add(source);
      return next;
    });
    setPage(1);
  };
  const choosePerPage = (n: number) => {
    setPerPage(n);
    setPage(1);
    try {
      localStorage.setItem(PER_PAGE_KEY, String(n));
    } catch {
      // storage blocked: it lasts until this page closes
    }
  };

  const act = async (which: number | "all", run: () => Promise<string | null>) => {
    setBusy(which);
    setMsg(null);
    try {
      const said = await run();
      if (said) setMsg({ ok: true, text: said });
      setReload((n) => n + 1);
    } catch (e) {
      setMsg(errorMsg(e));
    } finally {
      setBusy(null);
    }
  };
  const refresh = (r: SavedBarcode) =>
    act(r.cacheId, async () => {
      const out = await api<{ result: "updated" | "up_to_date" }>("POST", `/api/admin/saved-barcodes/${r.cacheId}/refresh`);
      return `${r.name}: ${out.result === "updated" ? "Updated" : "Up to date"}`;
    });
  const remove = (r: SavedBarcode) => act(r.cacheId, async () => (await api("DELETE", `/api/admin/saved-barcodes/${r.cacheId}`), null));
  const removeUnused = () =>
    act("all", async () => {
      const out = await api<{ deleted: number }>("POST", "/api/admin/saved-barcodes/delete-unused");
      return `Deleted ${plural(out.deleted)}`;
    });

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const pills = SOURCE_ORDER.filter((s) => known.has(s));
  return (
    <section aria-label="Saved barcodes" className="rounded-2xl bg-container p-5 [column-span:all]">
      <h2 className="text-lg font-bold">Saved barcodes</h2>
      <p className="mt-1 text-sm text-subtle">Every barcode ByteSize keeps a copy of. Each is deleted when its source's hours run out, unless something uses it.</p>
      {pills.length > 0 && (
        <div role="group" aria-label="Sources" className="mt-3 flex flex-wrap gap-1.5">
          {pills.map((s) => (
            <button key={s} type="button" aria-pressed={!off.has(s)} onClick={() => toggle(s)} className={pillClass(!off.has(s))}>
              {`${SOURCE_TITLES[s]} (${data?.sources[s] ?? 0})`}
            </button>
          ))}
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input {...noAutofill} type="search" aria-label="Search saved barcodes" placeholder="Search by name or barcode" value={typed} onChange={(e) => setTyped(e.target.value)} className={`${field} mt-0 basis-full rounded-full sm:max-w-xs sm:flex-1 sm:basis-auto`} />
        <label className="flex items-center gap-2 text-sm font-medium text-subtle">
          Show
          <select aria-label="Show" value={perPage} onChange={(e) => choosePerPage(Number(e.target.value))} className={`${field} mt-0 w-auto rounded-full py-1.5`}>
            {PER_PAGE.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className={secondaryButton} disabled={busy !== null || !data?.total} onClick={() => setAsking(true)}>
          Delete all not in use
        </button>
      </div>
      {data && <p className="mt-3 text-sm font-semibold">{plural(data.total)}</p>}
      <Notice msg={msg} />
      {data && data.items.length > 0 && (
        <ul className="mt-2 divide-y divide-line">
          {data.items.map((r) => (
            <li key={r.cacheId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">
                  {r.name}
                  {r.brand && <span className="font-normal text-subtle">{` · ${r.brand}`}</span>}
                </p>
                <p className="text-xs text-subtle">
                  <span className="tabular">{r.barcode}</span>
                  {` · ${SOURCE_TITLES[r.source as AnySource] ?? r.source} · Saved ${savedDate(r.savedAt)} · `}
                  {r.inUse || !r.deletesAt ? <span className="font-semibold">Kept — in use</span> : `Deletes ${savedDate(r.deletesAt)}`}
                </p>
              </div>
              <div className="flex gap-3 text-sm">
                <button type="button" aria-label={`Refresh ${r.name}`} className={linkButton} disabled={busy !== null} onClick={() => void refresh(r)}>
                  Refresh
                </button>
                <button type="button" aria-label={`Delete ${r.name}`} title={r.inUse ? "In use: kept" : undefined} className={linkButton} disabled={busy !== null || r.inUse} onClick={() => void remove(r)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {data && data.total > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-subtle">{`${(data.page - 1) * data.pageSize + 1}–${Math.min(data.page * data.pageSize, data.total)} of ${data.total}`}</span>
          {pages > 1 && <Pager page={data.page} pages={pages} onPage={setPage} />}
        </div>
      )}
      {!data && !msg && <p className="mt-3 text-muted">Loading…</p>}
      {asking && (
        <Confirm
          title="Delete all saved barcodes not in use?"
          text="Barcodes used in a recipe or quick meal, starred, edited or logged are kept."
          confirmLabel="Delete"
          onCancel={() => setAsking(false)}
          onConfirm={() => {
            setAsking(false);
            void removeUnused();
          }}
        />
      )}
    </section>
  );
}
