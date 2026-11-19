import { useEffect, useId, useState } from "react";
import { api } from "../../api";
import { useSession } from "../../session";
import { todayIn } from "../../selectedDay";
import { shortDay } from "../../format";
import type { Badge, Units } from "../../types";
import { lbToKg } from "../../units";
import { Notice, errorMsg, type Msg } from "../ui/Notice";

// A badge for people: name, what earns it, an emoji. Weight-loss badges keep their lb id but read in kg
// for metric, rounded down to the half kg so the label never claims more than was lost (5 lb → 2 kg).
export function badgeInfo(id: string, units: Units): { name: string; earns: string; icon: string } {
  const lost = /^lost_(\d+)$/.exec(id);
  if (lost) {
    const lb = Number(lost[1]);
    const amount = units === "metric" ? `${Math.floor(lbToKg(lb) * 2) / 2} kg` : `${lb} lb`;
    return { name: `${amount} down`, earns: `Lose ${amount} from your starting weight`, icon: "📉" };
  }
  const streak = /^streak_(\d+)$/.exec(id);
  if (streak) return { name: `${streak[1]}-day streak`, earns: `Log food ${streak[1]} days in a row`, icon: "🔥" };
  switch (id) {
    case "first_weigh_in":
      return { name: "First weigh-in", earns: "Log your first weigh-in", icon: "⚖️" };
    case "halfway":
      return { name: "Halfway there", earns: "Get halfway to your goal weight", icon: "🚩" };
    case "goal_reached":
      return { name: "Goal reached", earns: "Reach your goal weight", icon: "🎯" };
    case "shots_on_time_4":
      return { name: "4 shots on time", earns: "Take 4 weekly shots on time in a row", icon: "💉" };
    case "goal_met":
      return { name: "Goal met", earns: "Complete a goal you set", icon: "🏆" };
    default:
      return { name: id, earns: "", icon: "🏅" };
  }
}

function BadgeTile({ badge, units, thisYear }: { badge: Badge; units: Units; thisYear: string }) {
  const nameId = useId();
  const info = badgeInfo(badge.id, units);
  const locked = !badge.earnedOn;
  return (
    <li aria-labelledby={nameId} data-locked={locked || undefined} className={`flex gap-2 rounded-xl bg-page p-3 ${locked ? "opacity-60 grayscale" : ""}`}>
      <span aria-hidden="true" className="text-2xl leading-none">
        {info.icon}
      </span>
      <div className="min-w-0">
        <p id={nameId} className="text-sm font-bold">
          {info.name}
        </p>
        {badge.earnedOn ? (
          <p className="text-xs text-subtle">{`Earned ${shortDay(badge.earnedOn, !badge.earnedOn.startsWith(thisYear))}`}</p>
        ) : (
          <p className="text-xs text-muted">
            <span className="font-semibold">Locked</span> · {info.earns}
          </p>
        )}
      </div>
    </li>
  );
}

// Goals › Badges: every badge, earned ones with their date, locked ones greyed with what earns them
export default function Badges() {
  const { user } = useSession();
  const [badges, setBadges] = useState<Badge[] | null>(null);
  const [msg, setMsg] = useState<Msg>(null);

  useEffect(() => {
    api<{ badges: Badge[] }>("GET", "/api/badges")
      .then((r) => setBadges(r.badges))
      .catch((e) => setMsg(errorMsg(e)));
  }, []);

  const thisYear = todayIn(user.timezone).slice(0, 4);
  return (
    <section aria-label="Badges" className="rounded-2xl bg-container p-5">
      <h2 className="text-lg font-bold">Badges</h2>
      <Notice msg={msg} />
      {badges && (
        <ul className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">
          {badges.map((b) => (
            <BadgeTile key={b.id} badge={b} units={user.units} thisYear={thisYear} />
          ))}
        </ul>
      )}
    </section>
  );
}
