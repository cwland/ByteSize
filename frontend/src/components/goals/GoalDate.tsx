import { CalendarClock } from "lucide-react";
import { useSettingsMe } from "../../day";
import { formatDay, formatDayRange } from "../../dateFormat";
import { todayIn } from "../../selectedDay";
import { useSession } from "../../session";
import type { GoalDate, Units } from "../../types";
import { formatWeight } from "../../units";
import { useAllWeight } from "../../weight";
import { Notice } from "../ui/Notice";
import { linkButton } from "../ui/styles";

export type GoalDateCopy =
  | { kind: "ok"; weeks: string; date: string; range: string; pace: string; toGo: string }
  | { kind: "text"; text: string }
  | { kind: "no_goal" };

const weeksText = ({ min, max }: { min: number; max: number }) => (min === max ? `${min} ${min === 1 ? "week" : "weeks"}` : `${min}–${max} weeks`);

/**
 * The Goal date widget's words (§40a) from the server's numbers (GET /api/weight goalDate): weeks as a range, the day
 * at the current pace and the range's first and last days (in the person's date format), the pace and how far to go.
 * An estimate, never a promise: "around", and a range.
 */
export function goalDateCopy(g: GoalDate, units: Units, dateFormat: string | undefined, today: string): GoalDateCopy {
  const day = (d: string) => formatDay(d, dateFormat, today);
  switch (g.status) {
    case "ok":
      return {
        kind: "ok",
        weeks: weeksText(g.weeks),
        date: day(g.date),
        range: formatDayRange(g.earliest, g.latest, dateFormat, today),
        pace: `−${formatWeight(g.kgPerWeek, units)} a week`,
        toGo: `${formatWeight(g.toGoKg, units)} to go`,
      };
    case "reached":
      return { kind: "text", text: "You've reached your goal 🎉" };
    case "not_heading":
      return { kind: "text", text: "At this pace you're not heading toward your goal yet" };
    case "not_enough":
      return { kind: "text", text: "Keep weighing in — about two weeks of weigh-ins gives an estimate" };
    default:
      return { kind: "no_goal" };
  }
}

// Goal date (Goals page; also offered on the Dashboard): when the trend reaches the goal weight at the current pace
export default function GoalDateWidget() {
  const { user } = useSession();
  const { dateFormat } = useSettingsMe();
  const { data, error } = useAllWeight();
  const copy = data ? goalDateCopy(data.goalDate, user.units, dateFormat, todayIn(user.timezone)) : null;
  return (
    <section aria-label="Goal date" className="rounded-2xl bg-container p-5">
      <h2 className="flex items-center gap-2 text-lg font-bold">
        <CalendarClock aria-hidden="true" className="size-5 text-action" /> Goal date
      </h2>
      {error && <Notice msg={{ ok: false, text: error }} />}
      {copy?.kind === "ok" && (
        <div className="mt-2">
          <p className="text-lg">
            At your pace: <strong>{copy.weeks}</strong>, around <strong>{copy.date}</strong>
          </p>
          <p className="text-sm text-subtle tabular">{copy.range}</p>
          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <div>
              <dt className="sr-only">Pace</dt>
              <dd className="font-semibold tabular">{copy.pace}</dd>
            </div>
            <div>
              <dt className="sr-only">To go</dt>
              <dd className="font-semibold tabular">{copy.toGo}</dd>
            </div>
          </dl>
        </div>
      )}
      {copy?.kind === "text" && <p className="mt-2">{copy.text}</p>}
      {copy?.kind === "no_goal" && (
        <p className="mt-2">
          <a href="#/goals/details" className={linkButton}>
            Set a goal weight
          </a>{" "}
          to see when you'll reach it
        </p>
      )}
    </section>
  );
}
