import type { ReactNode } from "react";
import { useSettingsMe } from "../day";
import { formatDate } from "../dateFormat";
import { useSelectedDay } from "../selectedDay";
import DayPickerMenu from "./DayPicker";
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

// Wide Dashboard: one compact, centred block — the selected day (in the person's date format) above a small week
// strip (no greeting line, §34). children: buttons at the top right (Edit dashboard).
export function DayHeader({ children }: { children?: ReactNode }) {
  const { day } = useSelectedDay();
  const date = formatDate(day, useSettingsMe().dateFormat); // the way this person chose (Settings › Profile)
  return (
    <header aria-label="Day" className="relative flex flex-col items-center gap-1 text-center">
      {/* The heading keeps the date as its name; the button inside opens the calendar (§39) */}
      <h1 aria-label={date} className="text-lg leading-6 font-bold">
        <DayPickerMenu placement="popover" className="rounded-full px-3 hover:bg-pressed">
          {date}
        </DayPickerMenu>
      </h1>
      <div className="w-[23rem] max-w-full">
        <WeekStrip compact />
      </div>
      {children && <div className="absolute top-0 right-0 flex items-center gap-2">{children}</div>}
    </header>
  );
}

