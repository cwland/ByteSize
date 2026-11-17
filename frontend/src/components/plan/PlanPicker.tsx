import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "../../api";
import { useSession } from "../../session";
import type { Plan, PlansResponse, Targets } from "../../types";
import { KG_PER_LB, fmt } from "../../units";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { primaryButton, secondaryButton } from "../ui/styles";

const ONE_LINERS: Record<Plan["id"], string> = {
  relaxed: "Gentle and easy to keep up",
  steady: "A balanced pace that suits most people",
  accelerated: "Faster, and takes more focus",
  vigorous: "The fastest pace, and the hardest to sustain",
};

// 0.5 -> "½", 1.5 -> "1½"
const halves = (n: number) => (Number.isInteger(n) ? String(n) : `${Math.floor(n) || ""}½`);

// No plan is safe to follow (every one is under the calorie floor)
export const noSafePlan = (plans: Plan[]) => plans.length > 0 && plans.every((p) => p.notRecommended && !p.recommended);

// Lose It!-style plan cards: swipe (scroll-snap, one per view on phones) or use the arrows on desktop.
// Opens on the recommended plan.
export default function PlanPicker({ data, onSelected, onOwnTargets }: { data: PlansResponse; onSelected: (t: Targets) => void; onOwnTargets: () => void }) {
  const { user } = useSession();
  const start = Math.max(0, data.plans.findIndex((p) => p.recommended));
  const [current, setCurrent] = useState(start);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const strip = useRef<HTMLDivElement>(null);

  const show = (i: number, smooth = true) => {
    const el = strip.current;
    const card = el?.children[i] as HTMLElement | undefined;
    if (el && card) el.scrollTo?.({ left: card.offsetLeft - el.offsetLeft, behavior: smooth ? "smooth" : "auto" });
    setCurrent(i);
  };
  useEffect(() => show(start, false), []); // eslint-disable-line react-hooks/exhaustive-deps

  const onScroll = () => {
    const el = strip.current;
    if (el && el.clientWidth) setCurrent(Math.round(el.scrollLeft / el.clientWidth));
  };

  const select = async (p: Plan) => {
    setBusy(true);
    try {
      const out = await api<{ targets: Targets }>("POST", "/api/plans/select", { plan: p.id });
      onSelected(out.targets);
    } catch (e) {
      setMsg(errorMsg(e));
      setBusy(false);
    }
  };

  const perWeek = (lb: number) => (user.units === "metric" ? `Lose ${Math.round(lb * KG_PER_LB * 10) / 10} kg per week` : `Lose ${halves(lb)} lb per week`);
  const arrow = "absolute top-1/2 z-10 hidden size-10 -translate-y-1/2 items-center justify-center rounded-full bg-pressed text-ink hover:bg-strong disabled:opacity-30 sm:flex";
  const unsafe = noSafePlan(data.plans);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">Choose your plan</h1>
      <p className="text-subtle">{data.explanation}</p>
      {unsafe && (
        <div role="alert" className="rounded-2xl bg-error-subtle p-4">
          <p className="font-semibold text-error">None of these plans is safe for you to follow on your own.</p>
          <p className="mt-1 text-ink">Set your targets with your care team, then enter them here.</p>
          <button type="button" onClick={onOwnTargets} className={`${primaryButton} mt-3`}>
            Set my own targets
          </button>
        </div>
      )}
      <div className="relative">
        <button type="button" aria-label="Previous plan" disabled={current <= 0} onClick={() => show(current - 1)} className={`${arrow} -left-2`}>
          <ChevronLeft className="size-5" />
        </button>
        <div ref={strip} onScroll={onScroll} className="flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth pb-2 [scrollbar-width:none]">
          {data.plans.map((p, i) => (
            <section
              key={p.id}
              role="group"
              aria-label={p.name}
              data-current={i === current}
              className="flex w-full shrink-0 snap-center flex-col gap-2 rounded-2xl bg-container p-5"
            >
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-2xl font-bold">{p.name}</h2>
                {p.recommended && <span className="rounded-full bg-primary px-3 py-1 text-xs font-bold text-on-primary">Recommended for you</span>}
                {p.notRecommended && <span className="rounded-full bg-error px-3 py-1 text-xs font-bold text-white">Not recommended</span>}
              </div>
              <p className="text-subtle">{ONE_LINERS[p.id]}</p>
              <ul className="mt-2 flex flex-col gap-1 font-semibold">
                <li>Eat {fmt(p.calories)} calories per day</li>
                <li>{perWeek(p.lbsPerWeek)}</li>
                <li className="text-subtle">{p.weeksToGoal === null ? "You're already at your goal" : `About ${p.weeksToGoal} weeks to reach goal`}</li>
              </ul>
              <button type="button" disabled={busy} onClick={() => select(p)} className={`${primaryButton} mt-3 self-start`}>
                Select
              </button>
            </section>
          ))}
        </div>
        <button
          type="button"
          aria-label="Next plan"
          disabled={current >= data.plans.length - 1}
          onClick={() => show(current + 1)}
          className={`${arrow} -right-2`}
        >
          <ChevronRight className="size-5" />
        </button>
      </div>
      <Notice msg={msg} />
      {!unsafe && (
        <button type="button" onClick={onOwnTargets} className={`${secondaryButton} self-center`}>
          Set my own targets
        </button>
      )}
    </div>
  );
}
