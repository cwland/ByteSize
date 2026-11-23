import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { IconButton } from "./IconButton";

// A bottom sheet on phones, a centered panel from 640 px; on wide screens (lg) a centred window about
// 640 px wide and 85% of the screen tall (tall sheets fill it). Only the X and Escape close it: a click on
// the dimmed backdrop doesn't (a slip while entering an item would lose it).
// heading: a title (default: the label) or your own header content (e.g. a dropdown)
// top: content pinned under the header (e.g. a search box); then only the children scroll, in a region named bodyLabel
// bottom: content pinned under the scrolling part (e.g. a chat's message box)
// small: a few lines (Move to…): a narrow window from 640 px, not a wide one
export function Sheet({ label, heading = label, onClose, onBack, tall = false, small = false, top, bottom, bodyLabel = "Content", children }: { label: string; heading?: ReactNode; onClose: () => void; onBack?: () => void; tall?: boolean; small?: boolean; top?: ReactNode; bottom?: ReactNode; bodyLabel?: string; children: ReactNode }) {
  const pinned = top !== undefined;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 sm:items-center lg:items-center lg:p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={`max-h-[92vh] ${tall ? "min-h-[92vh] lg:h-[85vh] lg:min-h-0" : ""} flex flex-col overflow-hidden w-full ${small ? "max-w-[560px] sm:max-w-[400px]" : "max-w-[560px] lg:max-w-[640px]"} rounded-t-3xl bg-container p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:rounded-3xl lg:max-h-[85vh] lg:rounded-3xl lg:shadow-2xl lg:shadow-black/50`}
      >
        <div className="mb-4 flex shrink-0 items-center gap-2">
          {onBack && (
            <button type="button" onClick={onBack} className="rounded-full px-2 py-1 text-sm font-semibold text-link hover:bg-pressed">
              ‹ Back
            </button>
          )}
          {typeof heading === "string" ? <h2 className="flex-1 truncate text-lg font-bold">{heading}</h2> : <div className="min-w-0 flex-1">{heading}</div>}
          <IconButton label="Close" onClick={onClose} className="flex size-9 items-center justify-center rounded-full text-subtle hover:bg-pressed hover:text-ink">
            <X className="size-5" />
          </IconButton>
        </div>
        {pinned && <div className="shrink-0">{top}</div>}
        {/* Scrolling happens inside, so the panel's rounded corners stay rounded */}
        <div role={pinned ? "region" : undefined} aria-label={pinned ? bodyLabel : undefined} data-sheet-body="" className="-mx-5 min-h-0 flex-1 overflow-y-auto px-5">
          {children}
        </div>
        {bottom !== undefined && <div className="shrink-0 pt-3">{bottom}</div>}
      </div>
    </div>
  );
}
