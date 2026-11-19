import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { api } from "../api";
import { onDayChanged, useSettingsMe } from "../day";
import { addDays, useSelectedDay, weekOf } from "../selectedDay";
import { IconButton } from "./ui/IconButton";

// Tap the date for a calendar (§39): one month at a time, a dot under days with food logged, today ringed, the
// viewed day filled, days after today dimmed. Only the X, Escape, choosing a day or tapping the date again close
// it (a click outside doesn't, §27). Arrow keys move between days, Enter chooses, Page Up/Down change month.

const utc = (day: string) => new Date(`${day}T00:00:00Z`);
const fmt = (day: string, o: Intl.DateTimeFormatOptions) => utc(day).toLocaleDateString("en-US", { timeZone: "UTC", ...o });
const SPAN = 42; // six weeks

const monthStart = (day: string) => `${day.slice(0, 7)}-01`;
// The same day of the month `n` months on, or that month's last day if it is shorter (Jan 31 + 1 -> Feb 28)
function addMonths(day: string, n: number) {
  const d = utc(day);
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d.getUTCDate(), last));
  return first.toISOString().slice(0, 10);
}

// The six-week grids already fetched (keyed by their first day) until the log changes
function useLoggedSpans() {
  const [spans, setSpans] = useState<Record<string, Set<string>>>({});
  const asked = useRef(new Set<string>());
  useEffect(
    () =>
      onDayChanged(() => {
        asked.current.clear();
        setSpans((s) => ({ ...s })); // wake the open calendar so it asks again; the old dots stay until the new answer
      }),
    [],
  );
  const need = useCallback((from: string) => {
    if (asked.current.has(from)) return;
    asked.current.add(from);
    api<{ days: string[] }>("GET", `/api/days/logged?from=${from}&to=${addDays(from, SPAN - 1)}`)
      .then((r) => setSpans((s) => ({ ...s, [from]: new Set(r.days) })))
      .catch(() => asked.current.delete(from));
  }, []);
  return { spans, need };
}

// children: what the trigger shows (the date). placement: "popover" right under it (wide), "bar" full width
// under the header the trigger is in (phones; the header must be positioned).
export default function DayPickerMenu({ children, placement, className = "" }: { children: ReactNode; placement: "popover" | "bar"; className?: string }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const { spans, need } = useLoggedSpans();
  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  }, []);
  return (
    <span className={placement === "popover" ? "relative inline-block" : ""}>
      <button
        ref={trigger}
        type="button"
        aria-label="Choose a day"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close(false) : setOpen(true))}
        className={className}
      >
        {children}
      </button>
      {open && <Calendar placement={placement} spans={spans} need={need} onClose={close} />}
    </span>
  );
}

function Calendar({ placement, spans, need, onClose }: { placement: "popover" | "bar"; spans: Record<string, Set<string>>; need: (from: string) => void; onClose: (refocus?: boolean) => void }) {
  const { day, todayDay, select } = useSelectedDay();
  const { weekStart } = useSettingsMe();
  const titleId = useId();
  const [cursor, setCursor] = useState(day); // the day with focus; its month is the one shown
  const keyboard = useRef(true); // move DOM focus when the cursor moves (on opening, and for keys; not for ‹ › clicks)
  const grid = useRef<HTMLDivElement>(null);

  const first = weekOf(monthStart(cursor), weekStart)[0];
  const cells = Array.from({ length: SPAN }, (_, i) => addDays(first, i));
  const logged = spans[first];
  useEffect(() => need(first), [first, need, spans]);

  useEffect(() => {
    const on = (e: globalThis.KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onClose]);

  useEffect(() => {
    if (!keyboard.current) return;
    grid.current?.querySelector<HTMLElement>(`button[data-day="${cursor}"]`)?.focus();
  }, [cursor]);

  const move = (to: string, viaKeyboard: boolean) => {
    keyboard.current = viaKeyboard;
    setCursor(to > todayDay ? todayDay : to);
  };
  const onKey = (e: KeyboardEvent) => {
    const step: Record<string, () => string> = {
      ArrowLeft: () => addDays(cursor, -1),
      ArrowRight: () => addDays(cursor, 1),
      ArrowUp: () => addDays(cursor, -7),
      ArrowDown: () => addDays(cursor, 7),
      PageUp: () => addMonths(cursor, -1),
      PageDown: () => addMonths(cursor, 1),
    };
    const to = step[e.key]?.();
    if (!to) return;
    e.preventDefault();
    move(to, true);
  };

  const nextMonthOk = monthStart(addMonths(cursor, 1)) <= todayDay;
  const arrow = "flex size-8 items-center justify-center rounded-full text-subtle hover:bg-pressed hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent";
  const choose = (d: string) => {
    select(d);
    onClose();
  };
  return (
    <div
      role="dialog"
      aria-label="Choose a day"
      data-placement={placement}
      className={`z-30 rounded-2xl bg-container p-3 shadow-xl shadow-black/40 ${
        placement === "popover" ? "absolute top-full left-1/2 mt-2 w-[19rem] -translate-x-1/2 text-left" : "absolute inset-x-0 top-full rounded-t-none"
      }`}
    >
      <div className={placement === "bar" ? "mx-auto max-w-[560px]" : ""}>
        <div className="mb-2 flex items-center gap-1">
          <IconButton label="Previous month" onClick={() => move(addMonths(cursor, -1), false)} className={arrow}>
            <ChevronLeft className="size-5" />
          </IconButton>
          <p id={titleId} aria-live="polite" className="flex-1 text-center font-bold">
            {fmt(cursor, { month: "long", year: "numeric" })}
          </p>
          <IconButton label="Next month" disabled={!nextMonthOk} onClick={() => move(addMonths(cursor, 1), false)} className={arrow}>
            <ChevronRight className="size-5" />
          </IconButton>
          <button type="button" onClick={() => choose(todayDay)} className="rounded-full px-3 py-1 text-sm font-semibold text-link hover:bg-pressed">
            Today
          </button>
          <IconButton label="Close" onClick={() => onClose()} className="flex size-8 items-center justify-center rounded-full text-subtle hover:bg-pressed hover:text-ink">
            <X className="size-5" />
          </IconButton>
        </div>
        <div ref={grid} role="group" aria-labelledby={titleId} onKeyDown={onKey}>
          <div role="row" aria-hidden="true" className="grid grid-cols-7 text-center text-[11px] font-semibold text-subtle uppercase">
            {weekOf(first, weekStart).map((d) => (
              <span key={d} data-weekday="">
                {fmt(d, { weekday: "narrow" })}
              </span>
            ))}
          </div>
          {Array.from({ length: 6 }, (_, row) => (
            <div key={row} role="row" className="grid grid-cols-7">
              {cells.slice(row * 7, row * 7 + 7).map((d) => {
                const viewed = d === day;
                const isToday = d === todayDay;
                const future = d > todayDay;
                const hasFood = logged?.has(d) ?? false;
                const inMonth = d.slice(0, 7) === cursor.slice(0, 7);
                return (
                  <button
                    key={d}
                    type="button"
                    data-day={d}
                    disabled={future}
                    tabIndex={d === cursor ? 0 : -1}
                    aria-label={`${fmt(d, { weekday: "long", month: "long", day: "numeric" })}, ${hasFood ? "logged" : "not logged"}`}
                    aria-pressed={viewed}
                    aria-current={isToday ? "date" : undefined}
                    onClick={() => choose(d)}
                    className={`mx-auto flex h-11 w-10 flex-col items-center justify-center rounded-full disabled:opacity-30 ${
                      viewed ? "bg-action text-on-primary" : `enabled:hover:bg-pressed ${isToday ? "text-action ring-2 ring-action ring-inset" : inMonth ? "text-ink" : "text-subtle"}`
                    }`}
                  >
                    <span aria-hidden="true" className="tabular text-base leading-5 font-bold">
                      {utc(d).getUTCDate()}
                    </span>
                    <span aria-hidden="true" className="mt-0.5 flex h-1.5 items-center">
                      {hasFood && <span data-testid="logged-dot" className={`size-1.5 rounded-full ${viewed ? "bg-on-primary" : "bg-primary"}`} />}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
