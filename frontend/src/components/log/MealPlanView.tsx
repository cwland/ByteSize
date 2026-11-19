import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { api } from "../../api";
import { addDays, dayLabel, todayIn } from "../../selectedDay";
import { useSession } from "../../session";
import type { CuluryPlan, Meal } from "../../types";
import { Notice, errorMsg, type Msg } from "../ui/Notice";

// "second-breakfast" -> "Second breakfast"
const slotText = (slot: string) => {
  const s = slot.replace(/[-_]+/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : "Planned";
};

// The meal plan from Culury: days around the selected one as sections (the server sends the selected day
// first, its matching meal first). A recipe opens to be tracked; a note ("Leftovers") is shown, greyed, not loggable.
export default function MealPlanView({ day, meal, onOpen }: { day: string; meal: Meal; onOpen: (recipeId: number) => Promise<void> }) {
  const { user } = useSession();
  const [plan, setPlan] = useState<CuluryPlan | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [opening, setOpening] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    api<CuluryPlan>("GET", `/api/culury/plan?day=${day}&meal=${meal}`).then(
      (p) => live && setPlan(p),
      (e) => live && setMsg(errorMsg(e)),
    );
    return () => void (live = false);
  }, [day, meal]);

  const today = todayIn(user.timezone);
  const heading = (d: string) => (d === today ? `Today · ${dayLabel(d)}` : d === addDays(today, -1) ? "Yesterday" : dayLabel(d));
  const open = async (id: number) => {
    setOpening(id);
    setMsg(null);
    try {
      await onOpen(id);
    } catch (e) {
      setMsg(errorMsg(e));
    } finally {
      setOpening(null);
    }
  };

  if (!plan) return msg ? <Notice msg={msg} /> : <p className="px-2 text-muted">Loading the meal plan…</p>;
  return (
    <div className="flex flex-col gap-4">
      {plan.errors.map((e) => (
        <p key={e.source} className="rounded-xl bg-pressed px-3 py-2 text-sm text-subtle">
          {e.message}
        </p>
      ))}
      {!plan.errors.length && !plan.days.length && <p className="px-2 text-subtle">Nothing planned in Culury for these days.</p>}
      <Notice msg={msg} />
      {plan.days.map((d) => {
        const title = heading(d.day);
        return (
          <section key={d.day} aria-label={title}>
            <h3 className="px-1 text-xs font-bold tracking-wide text-muted uppercase">{title}</h3>
            <ul className="mt-2 flex flex-col gap-2">
              {d.items.map((it, i) => {
                const extra = [it.note && it.note !== it.title ? it.note : null, it.recipeId && it.servings && it.servings !== 1 ? `${it.servings} servings planned` : null].filter(Boolean).join(" · ");
                const text = (slotColor: string) => (
                  <span className="min-w-0 flex-1">
                    <span className={`block text-xs font-semibold tracking-wide uppercase ${slotColor}`}>{slotText(it.slot)}</span>
                    <span className="block truncate font-semibold">{it.title}</span>
                    {extra && <span className="block truncate text-sm text-subtle">{extra}</span>}
                  </span>
                );
                return it.recipeId === null ? (
                  <li key={i} className="flex items-center rounded-2xl border border-dashed border-line px-3 py-2.5 text-muted">
                    {text("")}
                  </li>
                ) : (
                  <li key={i}>
                    <button
                      type="button"
                      disabled={opening !== null}
                      onClick={() => void open(it.recipeId!)}
                      className="flex w-full items-center gap-2 rounded-2xl bg-pressed px-3 py-2.5 text-left hover:bg-strong disabled:opacity-60"
                    >
                      {text("text-action")}
                      {opening === it.recipeId && <span className="shrink-0 text-sm text-subtle">Opening…</span>}
                      <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-inactive" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
