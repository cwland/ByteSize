import type { ReactNode } from "react";
import { useSelectedDay } from "../selectedDay";
import WeekStrip from "./WeekStrip";

// Wide screens: the page's title (with a note beside it and a line under it), and links or buttons at
// the right. Phones have the top bar instead.
export default function PageHeader({ title, note, sub, children }: { title: ReactNode; note?: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <header className="mb-2 flex flex-wrap items-center gap-x-6 gap-y-3">
      <div className="mr-auto min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h1 className="text-3xl font-bold">{title}</h1>
          {note && <span className="text-lg text-subtle">{note}</span>}
        </div>
        {sub && <p className="mt-1 text-subtle">{sub}</p>}
      </div>
      {children}
    </header>
  );
}

// Wide Dashboard and Log: one compact, centred block — the selected day ("Wednesday, Nov 18") above a
// small week strip, and a subtle line under it (the Dashboard's greeting). title: the page's own name,
// for screen readers, when the day isn't the page's heading (Log). children: links at the top right.
export function DayHeader({ title, sub, children }: { title?: string; sub?: ReactNode; children?: ReactNode }) {
  const { day } = useSelectedDay();
  const dateClass = "text-lg leading-6 font-bold";
  return (
    <header aria-label="Day" className="relative flex flex-col items-center gap-1 text-center">
      {title ? (
        <>
          <h1 className="sr-only">{title}</h1>
          <p className={dateClass}>{shortDate(day)}</p>
        </>
      ) : (
        <h1 className={dateClass}>{shortDate(day)}</h1>
      )}
      <div className="w-[23rem] max-w-full">
        <WeekStrip compact />
      </div>
      {sub && <p className="text-sm text-subtle">{sub}</p>}
      {children && <div className="absolute top-0 right-0 flex items-center gap-2">{children}</div>}
    </header>
  );
}

// "2026-11-18" -> "Wednesday, Nov 18"
export const shortDate = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "short", day: "numeric" });

