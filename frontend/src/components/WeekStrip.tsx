import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "../api";
import { onDayChanged, useSettingsMe } from "../day";
import { addDays, useSelectedDay, weekOf } from "../selectedDay";
import { IconButton } from "./ui/IconButton";

// The week strip under the top bar (Dashboard and Log): seven days a page, the selected day filled,
// today outlined, a dot under each day with food logged. Pages scroll sideways (swipe, trackpad,
// mouse wheel) one week at a time; ‹ › at the ends move a week. More weeks are added as you near
// either end, so it scrolls as far back or forward as you like.

const utc = (day: string) => new Date(`${day}T00:00:00Z`);
const fmt = (day: string, o: Intl.DateTimeFormatOptions) => utc(day).toLocaleDateString("en-US", { timeZone: "UTC", ...o });
const dayName = (day: string) => `${fmt(day, { weekday: "short" })} ${utc(day).getUTCDate()}`; // "Tue 17"

// "November 2026", "Nov – Dec 2026", "Dec 2026 – Jan 2027"
export function monthsOf(weekStartDay: string) {
  const a = weekStartDay;
  const b = addDays(a, 6);
  if (a.slice(0, 7) === b.slice(0, 7)) return fmt(a, { month: "long", year: "numeric" });
  if (a.slice(0, 4) === b.slice(0, 4)) return `${fmt(a, { month: "short" })} – ${fmt(b, { month: "short", year: "numeric" })}`;
  return `${fmt(a, { month: "short", year: "numeric" })} – ${fmt(b, { month: "short", year: "numeric" })}`;
}

// compact: the wide Dashboard and Log header's smaller strip (day buttons about 40 × 52 px)
export default function WeekStrip({ onVisibleWeek, compact = false }: { onVisibleWeek?: (weekStartDay: string) => void; compact?: boolean }) {
  const { weekStart } = useSettingsMe();
  // A new week start lays the weeks out afresh
  return <Weeks key={weekStart} weekStart={weekStart} onVisibleWeek={onVisibleWeek} compact={compact} />;
}

function Weeks({ weekStart, onVisibleWeek, compact }: { weekStart: number; onVisibleWeek?: (weekStartDay: string) => void; compact: boolean }) {
  const { day, todayDay, select } = useSelectedDay();
  const scroller = useRef<HTMLDivElement>(null);
  // Weeks laid out (first day of each), and the one on screen
  const [visible, setVisible] = useState(() => weekOf(day, weekStart)[0]);
  const [weeks, setWeeks] = useState(() => [addDays(visible, -7), visible, addDays(visible, 7)]);
  // A scroll the code asked for ("instant" on first show, "smooth" for ‹ › and the wheel), done after layout
  const pendingScroll = useRef<ScrollBehavior | null>("instant");
  const knownWidth = useRef(0); // the scroller's width the scroll position was set for
  const onScreen = useRef<string | null>(null); // the week on screen while weeks are added in front
  const gliding = useRef<{ left: number; until: number } | null>(null);
  const visibleRef = useRef(visible);
  const weeksRef = useRef(weeks);
  visibleRef.current = visible;
  weeksRef.current = weeks;

  useEffect(() => onVisibleWeek?.(visible), [visible, onVisibleWeek]);

  useLayoutEffect(() => {
    const el = scroller.current;
    const width = el?.clientWidth ?? 0;
    if (width) knownWidth.current = width;
    // Weeks added in front push the content right: put back the week that was on screen. Set, not
    // added to: some browsers (Chrome) re-snap to the same week by themselves, others (Safari) don't.
    if (onScreen.current) {
      if (el && width) el.scrollLeft = weeks.indexOf(onScreen.current) * width;
      onScreen.current = null;
    }
    // Always keep a week either side of the one on screen
    if (weeks[0] === visible) {
      if (el && width) onScreen.current = weeks[Math.round(el.scrollLeft / width)] ?? null;
      return setWeeks((w) => [addDays(w[0], -7), ...w]);
    }
    if (weeks[weeks.length - 1] === visible) return setWeeks((w) => [...w, addDays(w[w.length - 1], 7)]);
    const behavior = pendingScroll.current;
    pendingScroll.current = null;
    // jsdom has no layout (width 0) and no scrollTo
    if (!behavior || !el || !width || typeof el.scrollTo !== "function") return;
    const left = weeks.indexOf(visible) * width;
    if (Math.abs(el.scrollLeft - left) < 2) return;
    // While a smooth scroll runs, the weeks it passes aren't "on screen" (see onScroll)
    if (behavior === "smooth") gliding.current = { left, until: Date.now() + 1000 };
    el.scrollTo({ left, behavior });
  }, [weeks, visible]);

  // The selected day moved to another week (today on entering a page, midnight): show its week
  useEffect(() => {
    const w0 = weekOf(day, weekStart)[0];
    if (w0 === visibleRef.current) return;
    if (weeksRef.current.includes(w0)) {
      pendingScroll.current = "smooth";
    } else {
      setWeeks([addDays(w0, -7), w0, addDays(w0, 7)]);
      pendingScroll.current = "instant";
    }
    setVisible(w0);
  }, [day, weekStart]);

  const step = useCallback((n: number) => {
    const w = weeksRef.current[weeksRef.current.indexOf(visibleRef.current) + n];
    if (!w) return;
    pendingScroll.current = "smooth";
    setVisible(w);
  }, []);

  const realign = useCallback(() => {
    const el = scroller.current;
    if (!el || !el.clientWidth) return;
    knownWidth.current = el.clientWidth;
    gliding.current = null;
    el.scrollLeft = weeksRef.current.indexOf(visibleRef.current) * el.clientWidth;
  }, []);
  useEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth !== knownWidth.current) realign();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [realign]);

  // Swiping or trackpad scrolling: the page that snapped into view becomes the visible week
  const onScroll = () => {
    const el = scroller.current;
    if (!el || !el.clientWidth) return;
    // A resize (phone turned, window dragged) moves the snap points under the scroll position: keep the week
    if (el.clientWidth !== knownWidth.current) return realign();
    const g = gliding.current;
    if (g) {
      if (Math.abs(el.scrollLeft - g.left) >= 2 && Date.now() < g.until) return;
      gliding.current = null;
    }
    const w = weeksRef.current[Math.round(el.scrollLeft / el.clientWidth)];
    if (w && w !== visibleRef.current) setVisible(w);
  };

  // An up/down mouse wheel moves a week per gesture (sideways trackpad scrolling is left to the browser)
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let last = 0;
    let lastStep = 0;
    const on = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      const now = Date.now();
      if (now - last > 200 || now - lastStep > 700) {
        step(e.deltaY > 0 ? 1 : -1);
        lastStep = now;
      }
      last = now;
    };
    el.addEventListener("wheel", on, { passive: false });
    return () => el.removeEventListener("wheel", on);
  }, [step]);

  // Dots: days with food logged, loaded a week at a time for the visible week ±1, again when the log changes
  const [logged, setLogged] = useState<Set<string>>(() => new Set());
  const loaded = useRef(new Set<string>());
  const [reload, setReload] = useState(0);
  useEffect(
    () =>
      onDayChanged(() => {
        loaded.current.clear();
        setReload((r) => r + 1);
      }),
    [],
  );
  useEffect(() => {
    const i = weeks.indexOf(visible);
    for (const from of [weeks[i - 1], visible, weeks[i + 1]]) {
      if (!from || loaded.current.has(from)) continue;
      loaded.current.add(from);
      const to = addDays(from, 6);
      api<{ days: string[] }>("GET", `/api/days/logged?from=${from}&to=${to}`)
        .then((r) =>
          setLogged((was) => {
            const now = new Set([...was].filter((d) => d < from || d > to));
            for (const d of r.days) now.add(d);
            return now;
          }),
        )
        .catch(() => loaded.current.delete(from));
    }
  }, [weeks, visible, reload]);

  const arrow = "flex size-8 shrink-0 items-center justify-center rounded-full text-subtle hover:bg-pressed hover:text-ink";
  return (
    <div role="group" aria-label="Days" data-visible-week={visible} className="flex items-center gap-0.5">
      <IconButton label="Previous week" onClick={() => step(-1)} className={arrow}>
        <ChevronLeft className="size-5" />
      </IconButton>
      <div
        ref={scroller}
        onScroll={onScroll}
        className="flex min-w-0 flex-1 snap-x snap-mandatory overflow-x-auto overscroll-x-contain [overflow-anchor:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {weeks.map((w) => (
          <div key={w} role="group" aria-label={`Week of ${fmt(w, { month: "short", day: "numeric" })}`} className="grid w-full shrink-0 snap-start snap-always grid-cols-7">
            {weekOf(w, weekStart).map((d) => {
              const selected = d === day;
              const isToday = d === todayDay;
              const hasFood = logged.has(d);
              return (
                <button
                  key={d}
                  type="button"
                  aria-label={`${dayName(d)}${hasFood ? ", food logged" : ""}`}
                  aria-pressed={selected}
                  aria-current={isToday ? "date" : undefined}
                  onClick={() => select(d)}
                  className={`mx-auto flex ${compact ? "h-13" : "h-14"} w-10 flex-col items-center justify-center rounded-full ${
                    selected ? "bg-action text-on-primary" : `hover:bg-pressed ${isToday ? "text-action ring-2 ring-action ring-inset" : "text-ink"}`
                  }`}
                >
                  <span aria-hidden="true" className={`text-[11px] font-semibold uppercase ${selected || isToday ? "" : "text-subtle"}`}>
                    {fmt(d, { weekday: "narrow" })}
                  </span>
                  <span aria-hidden="true" className="tabular text-base leading-5 font-bold">
                    {utc(d).getUTCDate()}
                  </span>
                  <span aria-hidden="true" className="mt-0.5 flex h-1.5 items-center">
                    {hasFood && <span data-testid="logged-dot" className={`size-1.5 rounded-full ${selected ? "bg-on-primary" : "bg-primary"}`} />}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <IconButton label="Next week" onClick={() => step(1)} className={arrow}>
        <ChevronRight className="size-5" />
      </IconButton>
    </div>
  );
}
