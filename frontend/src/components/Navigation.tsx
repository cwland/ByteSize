import { BookOpen, House, Settings, Utensils } from "lucide-react";
import { PAGES, type Page } from "../routes";

const ICONS: Record<Page, JSX.Element> = {
  today: <House className="size-5" />,
  log: <BookOpen className="size-5" />,
  foods: <Utensils className="size-5" />,
  settings: <Settings className="size-5" />,
};

// One nav: a bottom bar on phones, a side rail on wider screens
export default function Navigation({ page }: { page: Page }) {
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 flex h-16 items-stretch justify-around border-t border-line bg-container sm:static sm:h-auto sm:w-48 sm:flex-col sm:justify-start sm:gap-1 sm:border-t-0 sm:border-r sm:p-3">
      {PAGES.map((p) => (
        <a
          key={p.id}
          href={p.href}
          aria-current={page === p.id ? "page" : undefined}
          className={`flex flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium sm:flex-none sm:flex-row sm:justify-start sm:gap-3 sm:rounded-lg sm:px-3 sm:py-2 sm:text-sm ${
            page === p.id ? "text-action sm:bg-pressed" : "text-subtle hover:text-ink sm:hover:bg-page"
          }`}
        >
          {ICONS[p.id]}
          <span>{p.label}</span>
        </a>
      ))}
    </nav>
  );
}
