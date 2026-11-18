import type { ReactNode } from "react";
import WeekStrip from "./WeekStrip";

// Wide screens: the page's title (with a note beside it and a line under it), the week strip on
// Dashboard and Log, and links or buttons at the right. Phones have the top bar instead.
export default function PageHeader({ title, note, sub, days = false, children }: { title: ReactNode; note?: ReactNode; sub?: ReactNode; days?: boolean; children?: ReactNode }) {
  return (
    <header className="mb-2 flex flex-wrap items-center gap-x-6 gap-y-3">
      <div className="mr-auto min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h1 className="text-3xl font-bold">{title}</h1>
          {note && <span className="text-lg text-subtle">{note}</span>}
        </div>
        {sub && <p className="mt-1 text-subtle">{sub}</p>}
      </div>
      {days && (
        <div className="w-[28rem] max-w-full rounded-full bg-container px-2 py-1.5">
          <WeekStrip />
        </div>
      )}
      {children}
    </header>
  );
}

// "2026-11-17" -> "Tuesday, November 17"
export const longDate = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" });
