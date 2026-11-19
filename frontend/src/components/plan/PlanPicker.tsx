import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { api } from "../../api";
import { useSession } from "../../session";
import type { Plan, PlansResponse, Range, Targets } from "../../types";
import { KG_PER_LB, fmt } from "../../units";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { primaryButton, secondaryButton } from "../ui/styles";
import { IconButton } from "../ui/IconButton";

// 0.5 -> "½", 1.5 -> "1½"
const halves = (n: number) => (Number.isInteger(n) ? String(n) : `${Math.floor(n) || ""}½`);
const range = (r: Range) => `${fmt(r.min)}–${fmt(r.max)}`;

// No plan is safe to follow (every one is under the calorie floor)
// No safe way to lose weight: every weight-loss plan is under the floor (Maintenance doesn't count — it isn't a loss plan)
export const noSafePlan = (plans: Plan[]) => {
  const loss = plans.filter((p) => p.lbsPerWeek > 0);
  return loss.length > 0 && loss.every((p) => p.notRecommended) && !plans.some((p) => p.recommended);
};

// Plan cards as a peeking carousel: on a phone each card is ~82% wide and centred, so the
// neighbours show at both edges; swipe (scroll-snap), tap a dot or use the arrow keys. Opens
// centred on the recommended plan. From 768 px wide they sit in a grid (all five side by side from 1024 px).
export default function PlanPicker({ data, onSelected, onOwnTargets }: { data: PlansResponse; onSelected: (t: Targets) => void; onOwnTargets: () => void }) {
  const { user } = useSession();
  const start = Math.max(0, data.plans.findIndex((p) => p.recommended));
  const [current, setCurrent] = useState(start);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const strip = useRef<HTMLDivElement>(null);
  const last = data.plans.length - 1;

  // Centre card i in the strip
  const show = (i: number, smooth = true) => {
    const el = strip.current;
    const card = el?.children[i] as HTMLElement | undefined;
    if (el && card) el.scrollTo?.({ left: card.offsetLeft + card.offsetWidth / 2 - el.clientWidth / 2, behavior: smooth ? "smooth" : "auto" });
    setCurrent(i);
  };
  useEffect(() => show(start, false), []); // eslint-disable-line react-hooks/exhaustive-deps

  // After a swipe: the card nearest the middle is the current one
  const onScroll = () => {
    const el = strip.current;
    if (!el || !el.clientWidth) return;
    const mid = el.scrollLeft + el.clientWidth / 2;
    const dist = (c: Element) => Math.abs((c as HTMLElement).offsetLeft + (c as HTMLElement).offsetWidth / 2 - mid);
    const cards = Array.from(el.children);
    setCurrent(cards.reduce((best, c, i) => (dist(c) < dist(cards[best]) ? i : best), 0));
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      show(Math.min(last, Math.max(0, current + (e.key === "ArrowRight" ? 1 : -1))));
    }
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
      {/* Wide screens: break out of the phone-width column so four cards fit side by side */}
      <div className="-mx-3 md:relative md:left-1/2 md:mx-0 md:w-[min(76rem,calc(100vw-2rem))] md:-translate-x-1/2">
        <div
          ref={strip}
          role="region"
          aria-label="Plans"
          aria-roledescription="carousel"
          tabIndex={0}
          onScroll={onScroll}
          onKeyDown={onKeyDown}
          className="relative flex snap-x snap-mandatory gap-3 overflow-x-auto px-[9%] pt-1 pb-2 outline-none [scrollbar-width:none] focus-visible:ring-2 focus-visible:ring-action/40 md:grid md:grid-cols-3 lg:grid-cols-5 md:overflow-visible md:px-0 [&::-webkit-scrollbar]:hidden"
        >
          {data.plans.map((p, i) => (
            <section
              key={p.id}
              role="group"
              aria-label={p.name}
              aria-roledescription="plan"
              data-current={i === current}
              className={`flex w-[82%] shrink-0 snap-center flex-col gap-3 rounded-2xl bg-container p-5 transition-opacity md:w-auto md:opacity-100 ${
                i === current ? "" : "opacity-60"
              } ${p.recommended ? "ring-2 ring-primary" : ""}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-2xl font-bold">{p.name}</h2>
                {p.recommended && <span className="rounded-full bg-primary px-3 py-1 text-xs font-bold text-on-primary">Recommended for you</span>}
                {p.notRecommended && <span className="rounded-full bg-error px-3 py-1 text-xs font-bold text-white">Not recommended</span>}
              </div>
              <p className="text-subtle">
                <span className="block text-xs font-semibold text-muted">Best for</span>
                <span>{p.bestFor}</span>
              </p>
              <ul className="flex flex-col gap-1 font-semibold tabular">
                <li className="text-lg">Eat {range(p.targets.calories)} calories</li>
                <li>Protein {range(p.targets.protein_g)} g</li>
                <li>Fiber {range(p.targets.fiber_g)} g</li>
              </ul>
              <ul className="flex flex-col gap-1">
                {p.lbsPerWeek === 0 ? (
                  <li className="font-semibold">Hold your weight steady</li>
                ) : (
                  <>
                    <li className="font-semibold">{perWeek(p.lbsPerWeek)}</li>
                    <li className="text-subtle">{p.weeksToGoal === null ? "You're already at your goal" : `About ${p.weeksToGoal} weeks to reach your goal`}</li>
                  </>
                )}
              </ul>
              <button type="button" disabled={busy} onClick={() => select(p)} className={`${primaryButton} mt-auto self-start`}>
                Select
              </button>
            </section>
          ))}
        </div>
      </div>
      <div className="-mt-2 flex justify-center md:hidden">
        {data.plans.map((p, i) => (
          <IconButton key={p.id} label={`Show ${p.name}`} aria-current={i === current ? "true" : undefined} onClick={() => show(i)} className="p-1.5">
            <span className={`block size-2.5 rounded-full transition-colors ${i === current ? "bg-primary" : "bg-strong"}`} />
          </IconButton>
        ))}
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
