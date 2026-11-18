import { useEffect, useState } from "react";
import { api } from "../../api";
import { savedDate } from "../log/SavedCopy";
import { Confirm } from "../ui/Confirm";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { field, linkButton, noAutofill, secondaryButton } from "../ui/styles";
import { SOURCE_TITLES, type AnySource } from "./FoodSourcesSettings";

// As GET /api/admin/saved-barcodes sends it: one page (50) of kept foods that have a barcode, newest first
type SavedBarcode = { cacheId: number; barcode: string; name: string; brand: string | null; source: string; savedAt: string; deletesAt: string | null; inUse: boolean };
type Page = { total: number; page: number; pageSize: number; items: SavedBarcode[] };

const plural = (n: number) => `${n} saved barcode${n === 1 ? "" : "s"}`;

// Settings › Integrations › Saved barcodes (admin): every kept barcode — refresh it from its source or delete it,
// search by name or barcode, 50 at a time, or delete all that nothing uses
export function SavedBarcodes() {
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
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
    api<Page>("GET", `/api/admin/saved-barcodes?page=${page}${q ? `&q=${encodeURIComponent(q)}` : ""}`).then(
      (p) => {
        if (!live) return;
        // Past the last page (its last rows were deleted): back to the last page there is
        const last = Math.max(1, Math.ceil(p.total / p.pageSize));
        if (page > last) setPage(last);
        else setData(p);
      },
      (e) => live && setMsg(errorMsg(e)),
    );
    return () => void (live = false);
  }, [q, page, reload]);

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
  return (
    <section aria-label="Saved barcodes" className="rounded-2xl bg-container p-5 [column-span:all]">
      <h2 className="text-lg font-bold">Saved barcodes</h2>
      <p className="mt-1 text-sm text-subtle">Every barcode ByteSize keeps a copy of. Each is deleted when its source's hours run out, unless something uses it.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input {...noAutofill} type="search" aria-label="Search saved barcodes" placeholder="Search by name or barcode" value={typed} onChange={(e) => setTyped(e.target.value)} className={`${field} mt-0 basis-full rounded-full sm:max-w-xs sm:flex-1 sm:basis-auto`} />
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
      {data && pages > 1 && (
        <div className="mt-3 flex items-center gap-3 text-sm">
          <button type="button" className={linkButton} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous page
          </button>
          <span>
            Page {page} of {pages}
          </span>
          <button type="button" className={linkButton} disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Next page
          </button>
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
