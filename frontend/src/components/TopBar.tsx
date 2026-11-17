import { useState } from "react";
import { Logo } from "./ui/Logo";
import { initialsOf, useSession } from "../session";
import WeekStrip, { monthsOf } from "./WeekStrip";

// Logo (home) · month of the week shown · avatar (Settings), and under it the week strip
// (Dashboard and Log only: `days`)
export default function TopBar({ days = true }: { days?: boolean }) {
  const { user } = useSession();
  const [week, setWeek] = useState<string | null>(null);
  return (
    <header className="sticky top-0 z-20 bg-page/95 pt-[env(safe-area-inset-top)] backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[560px] items-center gap-2 px-3">
        <a href="#/" aria-label="ByteSize home" className="shrink-0 rounded-full">
          <Logo className="size-9 rounded-full" />
        </a>
        <p className="flex-1 text-center font-bold">{days && week ? monthsOf(week) : ""}</p>
        <a
          href="#/settings"
          aria-label="Open settings"
          title={user.displayName ?? user.username}
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-pressed text-xs font-bold text-ink hover:bg-strong"
        >
          {initialsOf(user)}
        </a>
      </div>
      {days && (
        <div className="mx-auto max-w-[560px] px-1 pb-2">
          <WeekStrip onVisibleWeek={setWeek} />
        </div>
      )}
    </header>
  );
}
