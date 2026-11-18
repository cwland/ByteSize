import { ChevronLeft, ChevronRight } from "lucide-react";

/** The page numbers to show: the first, the last and the ones beside the current, with … where pages are left out. */
export function pageList(page: number, pages: number): (number | "…")[] {
  const want = new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages));
  const sorted = [...want].sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  sorted.forEach((n, i) => {
    const prev = sorted[i - 1];
    if (prev !== undefined && n - prev === 2) out.push(prev + 1); // one page missing: just show it
    else if (prev !== undefined && n - prev > 2) out.push("…");
    out.push(n);
  });
  return out;
}

const btn = "inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-sm font-semibold disabled:opacity-40";

// ‹ 1 2 3 … 14 ›
export function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (page: number) => void }) {
  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center gap-1">
      <button type="button" aria-label="Previous page" className={`${btn} hover:bg-pressed`} disabled={page <= 1} onClick={() => onPage(page - 1)}>
        <ChevronLeft className="size-5" aria-hidden="true" />
      </button>
      {pageList(page, pages).map((n, i) =>
        n === "…" ? (
          <span key={`gap${i}`} aria-hidden="true" className="px-1 text-muted">
            …
          </span>
        ) : (
          <button key={n} type="button" aria-label={`Page ${n}`} aria-current={n === page ? "page" : undefined} className={`${btn} ${n === page ? "bg-primary text-on-primary" : "hover:bg-pressed"}`} onClick={() => onPage(n)}>
            {n}
          </button>
        ),
      )}
      <button type="button" aria-label="Next page" className={`${btn} hover:bg-pressed`} disabled={page >= pages} onClick={() => onPage(page + 1)}>
        <ChevronRight className="size-5" aria-hidden="true" />
      </button>
    </nav>
  );
}
