import { Notice } from "../ui/Notice";
import { SOURCE_TITLES, type AnySource, type SourceKeys } from "./FoodSourcesSettings";

export const ORDER_TITLE = "How ByteSize looks foods up";

// Each lookup's outside sources in the order they're asked (after a saved copy; the first answer wins for barcodes
// and restaurants; a typed search lists them in this order)
const ORDER: { lookup: string; sources: (AnySource | null)[]; barcode?: true }[] = [
  { lookup: "Barcode", sources: ["off", "fatsecret", "usda"], barcode: true },
  { lookup: "Restaurants", sources: ["fatsecret", "spoonacular", null] },
  { lookup: "Typed search", sources: ["fatsecret", "usda", "off"] },
];

// Settings › Integrations (admin), at the top: the lookup order, with sources that won't be asked marked
export function LookupOrder({ sources }: { sources: SourceKeys }) {
  const s = sources.summary;
  const why = (source: AnySource, barcode: boolean): string | null => {
    if (!s) return null;
    if (!s[source].enabled) return "Off — skipped";
    if (source !== "off" && !s[source].hasKey) return "No key — skipped";
    if (barcode && source === "fatsecret") {
      if (s.fatsecret.plan !== "premier") return "(Premier only)";
      if (s.fatsecret.barcodeScopeMissing) return "(key lacks barcodes)";
    }
    return null;
  };
  return (
    <section aria-label={ORDER_TITLE} className="rounded-2xl bg-container p-5 [column-span:all]">
      <h2 className="text-lg font-bold">{ORDER_TITLE}</h2>
      <p className="mt-1 text-sm text-subtle">
        A saved copy is always checked first: a source is asked only when ByteSize has no copy newer than that source's “Keep results for” hours. Typed searches list your own foods first, then USDA
        whole foods (Basic foods).
      </p>
      {s ? (
        <div className="mt-3 overflow-x-auto">
          <table aria-label={ORDER_TITLE} className="w-full text-left text-sm">
            <thead className="text-xs tracking-wide text-muted uppercase">
              <tr>
                {["Lookup", "1st", "2nd", "3rd"].map((h) => (
                  <th key={h} scope="col" className="py-2 pr-3 font-bold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {ORDER.map((row) => (
                <tr key={row.lookup}>
                  <th scope="row" className="py-2 pr-3 font-semibold">
                    {row.lookup}
                  </th>
                  {row.sources.map((source, i) => {
                    const note = source && why(source, !!row.barcode);
                    return (
                      <td key={i} className={`py-2 pr-3 ${note && !note.startsWith("(") ? "text-muted" : ""}`}>
                        {source ? SOURCE_TITLES[source] : "—"}
                        {note && (
                          <>
                            {" "}
                            <span className="text-xs whitespace-nowrap text-muted">{note}</span>
                          </>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : sources.msg ? (
        <Notice msg={sources.msg} />
      ) : (
        <p className="mt-3 text-muted">Loading…</p>
      )}
    </section>
  );
}
