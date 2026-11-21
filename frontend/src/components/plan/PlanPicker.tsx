import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
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

// Plan cards as a carousel at every width (SPEC-20), inside the page column: as many whole cards as fit the strip
// (1 on a phone, then 2, 3, 4 — 5 only when they truly fit), never a sliver. ‹ and › step one card, greyed at the
// ends; swipe (scroll-snap), the dots and the arrow keys work too. Opens with the recommended plan in view.
const GAP = 12; // gap-3

export default function PlanPicker({ data, onSelected, onOwnTargets }: { data: PlansResponse; onSelected: (t: Targets) => void; onOwnTargets: () => void }) {
  const { user } = useSession();
  const start = Math.max(0, data.plans.findIndex((p) => p.recommended));
  const [current, setCurrent] = useState(start);
  // The first card in view, and how many fit (1 until measured: a phone, or a test without layout)
  const [first, setFirst] = useState(start);
  const [fit, setFit] = useState(1);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const strip = useRef<HTMLDivElement>(null);
  const last = data.plans.length - 1;

  const measure = () => {
    const el = strip.current;
    const card = el?.children[0] as HTMLElement | undefined;
    if (!el || !card || !card.offsetWidth) return 1;
    return Math.max(1, Math.min(data.plans.length, Math.round((el.clientWidth + GAP) / (card.offsetWidth + GAP))));
  };

  // Scroll so card `from` leads the row, with `cur` the current card
  const moveTo = (from: number, cur: number, n: number, smooth: boolean) => {
    const el = strip.current;
    const target = el?.children[from] as HTMLElement | undefined;
    const zero = (el?.children[0] as HTMLElement | undefined)?.offsetLeft ?? 0;
    if (el && target) el.scrollTo?.({ left: target.offsetLeft - zero, behavior: smooth ? "smooth" : "auto" });
    setFit(n);
    setFirst(from);
    setCurrent(cur);
  };

  // Bring card i into view (moving the row only as far as needed, or centring it) and make it the current one
  const show = (i: number, smooth = true, centre = false) => {
    const n = measure();
    let from = first;
    if (centre) from = i - Math.floor((n - 1) / 2);
    else if (i < from) from = i;
    else if (i > from + n - 1) from = i - n + 1;
    moveTo(Math.max(0, Math.min(from, data.plans.length - n)), i, n, smooth);
  };
  useEffect(() => show(start, false, true), []); // eslint-disable-line react-hooks/exhaustive-deps

  // After a swipe: the card at the strip's start leads; on a phone (one card) it's the current one
  const onScroll = () => {
    const el = strip.current;
    if (!el || !el.clientWidth) return;
    const cards = Array.from(el.children) as HTMLElement[];
    const zero = cards[0]?.offsetLeft ?? 0;
    const lead = cards.reduce((best, c, i) => (Math.abs(c.offsetLeft - zero - el.scrollLeft) < Math.abs(cards[best].offsetLeft - zero - el.scrollLeft) ? i : best), 0);
    const n = measure();
    setFit(n);
    setFirst(lead);
    setCurrent((c) => (n === 1 ? lead : Math.min(lead + n - 1, Math.max(lead, c))));
  };

  // ‹ ›: one card at a time. With one card in view that's the next plan; with several, the row moves by one
  const step = (by: -1 | 1) => {
    const n = measure();
    if (n <= 1) return show(Math.min(last, Math.max(0, current + by)));
    const from = Math.max(0, Math.min(first + by, data.plans.length - n));
    moveTo(from, Math.min(from + n - 1, Math.max(from, current)), n, true);
  };
  const atStart = fit <= 1 ? current === 0 : first === 0;
  const atEnd = fit <= 1 ? current === last : first >= data.plans.length - fit;

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
      <div className="flex items-stretch gap-2">
        <button
          type="button"
          aria-label="Previous plan"
          title="Previous plan"
          disabled={atStart}
          onClick={() => step(-1)}
          className="flex size-10 shrink-0 items-center justify-center self-center rounded-full bg-container text-ink shadow-sm ring-1 ring-line hover:bg-pressed disabled:opacity-30 disabled:hover:bg-container"
        >
          <ChevronLeft aria-hidden="true" className="size-5" />
        </button>
        <div
          ref={strip}
          role="region"
          aria-label="Plans"
          aria-roledescription="carousel"
          tabIndex={0}
          onScroll={onScroll}
          onKeyDown={onKeyDown}
          className="@container relative flex min-w-0 flex-1 snap-x snap-mandatory gap-3 overflow-x-auto pt-1 pb-2 outline-none [scrollbar-width:none] focus-visible:ring-2 focus-visible:ring-action/40 [&::-webkit-scrollbar]:hidden"
        >
          {data.plans.map((p, i) => (
            <section
              key={p.id}
              role="group"
              aria-label={p.name}
              aria-roledescription="plan"
              data-current={i === current}
              className={`flex w-full shrink-0 snap-start flex-col gap-3 rounded-2xl bg-container p-5 transition-opacity @xl:w-[calc((100%-0.75rem)/2)] @xl:opacity-100 @4xl:w-[calc((100%-1.5rem)/3)] @6xl:w-[calc((100%-2.25rem)/4)] @7xl:w-[calc((100%-3rem)/5)] ${
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
        <button
          type="button"
          aria-label="Next plan"
          title="Next plan"
          disabled={atEnd}
          onClick={() => step(1)}
          className="flex size-10 shrink-0 items-center justify-center self-center rounded-full bg-container text-ink shadow-sm ring-1 ring-line hover:bg-pressed disabled:opacity-30 disabled:hover:bg-container"
        >
          <ChevronRight aria-hidden="true" className="size-5" />
        </button>
      </div>
      <div className="-mt-2 flex justify-center">
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
