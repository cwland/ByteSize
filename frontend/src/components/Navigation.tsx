import { BookOpen, House, Plus, Settings, Target } from "lucide-react";
import { PAGES, myFoodsHref, type Page } from "../routes";

const ICONS: Record<Page, JSX.Element> = {
  dashboard: <House className="size-6" />,
  myfoods: <BookOpen className="size-6" />,
  goals: <Target className="size-6" />,
  settings: <Settings className="size-6" />,
};

// The bottom tab bar (phones and narrow windows): Dashboard, Goals, the floating orange + in the middle, My foods,
// Settings — the rail's pages (no Log page, §28)
export default function Navigation({ page, onAdd }: { page: Page; onAdd: () => void }) {
  const tab = (p: (typeof PAGES)[number]) => (
    <a
      key={p.id}
      href={p.id === "myfoods" ? myFoodsHref() : p.href}
      aria-current={page === p.id ? "page" : undefined}
      className={`flex flex-1 flex-col items-center justify-center gap-0.5 pt-2 pb-1.5 text-[11px] font-semibold ${page === p.id ? "text-action" : "text-muted hover:text-ink"}`}
    >
      {ICONS[p.id]}
      <span>{p.label}</span>
    </a>
  );
  return (
    <nav aria-label="Main" className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-container">
      <div className="relative mx-auto flex max-w-[560px] items-stretch">
        {PAGES.slice(0, 2).map(tab)}
        <div className="w-20 shrink-0" aria-hidden="true" />
        {PAGES.slice(2).map(tab)}
        <button
          type="button"
          aria-label="Log food"
          title="Log food"
          onClick={onAdd}
          className="absolute -top-7 left-1/2 flex size-16 -translate-x-1/2 items-center justify-center rounded-full bg-primary text-on-primary shadow-lg shadow-black/40 ring-4 ring-page hover:bg-primary-pressed"
        >
          <Plus className="size-8" strokeWidth={2.75} />
        </button>
      </div>
    </nav>
  );
}
