import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Logo } from "./ui/Logo";
import { initialsOf, useSession } from "../session";
import { dayLabel, useSelectedDay } from "../selectedDay";

// Logo (home) · ‹ [calendar] Mon, Nov 16 › · avatar (Settings)
export default function TopBar() {
  const { user } = useSession();
  const { day, prev, next, today, isToday } = useSelectedDay();
  const arrow = "flex size-9 items-center justify-center rounded-full text-subtle hover:bg-pressed hover:text-ink";
  return (
    <header className="sticky top-0 z-20 bg-page/95 pt-[env(safe-area-inset-top)] backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[560px] items-center gap-2 px-3">
        <a href="#/" aria-label="ByteSize home" className="shrink-0 rounded-full">
          <Logo className="size-9 rounded-full" />
        </a>
        <div className="flex flex-1 items-center justify-center gap-1">
          <button type="button" aria-label="Previous day" onClick={prev} className={arrow}>
            <ChevronLeft className="size-5" />
          </button>
          <button
            type="button"
            aria-label="Go to today"
            title={isToday ? "Today" : "Go to today"}
            onClick={today}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 font-bold hover:bg-pressed"
          >
            <CalendarDays className={`size-4 ${isToday ? "text-action" : "text-subtle"}`} aria-hidden="true" />
            <span className="tabular">{dayLabel(day)}</span>
          </button>
          <button type="button" aria-label="Next day" onClick={next} className={arrow}>
            <ChevronRight className="size-5" />
          </button>
        </div>
        <a
          href="#/settings"
          aria-label="Open settings"
          title={user.displayName ?? user.username}
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-pressed text-xs font-bold text-ink hover:bg-strong"
        >
          {initialsOf(user)}
        </a>
      </div>
    </header>
  );
}
