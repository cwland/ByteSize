import { BookOpen, House, Settings, Syringe, Target } from "lucide-react";
import { isGlp1, myFoodsHref, type Page } from "../routes";
import { initialsOf, useSession } from "../session";
import { Logo } from "./ui/Logo";

// Wide screens: the side rail in place of the top bar and bottom tab bar. Logo (home), the pages (GLP-1 among
// them since it left Goals, §40a) with My foods, and Settings and the account at the bottom (no +: food is added from the Food widget; no Log page). Stays in view. It comes
// after the page in the DOM (the shell keeps one tree for both layouts) and is drawn first with order-first.
export default function Rail({ page }: { page: Page }) {
  const { user } = useSession();
  const glp1 = isGlp1(); // the GLP-1 page sits under the Dashboard; the shell redraws on every address change
  const item = (label: string, href: string, current: boolean, icon: JSX.Element) => (
    <a
      href={href}
      aria-current={current ? "page" : undefined}
      className={`flex w-16 flex-col items-center gap-1 rounded-xl py-2 text-[11px] font-bold ${current ? "bg-active text-action" : "text-subtle hover:bg-pressed hover:text-ink"}`}
    >
      {icon}
      <span>{label}</span>
    </a>
  );
  return (
    <nav aria-label="Main" className="sticky top-0 order-first flex h-screen w-[84px] shrink-0 flex-col items-center gap-2.5 bg-container py-5">
      <a href="#/" aria-label="ByteSize home" className="shrink-0 rounded-xl">
        <Logo className="size-11 rounded-xl" />
      </a>
      <div className="mt-3.5 flex flex-col gap-1.5">
        {item("Dashboard", "#/", page === "dashboard" && !glp1, <House aria-hidden="true" className="size-[22px]" />)}
        {item("Goals", "#/goals", page === "goals", <Target aria-hidden="true" className="size-[22px]" />)}
        {item("GLP-1", "#/glp1", page === "dashboard" && glp1, <Syringe aria-hidden="true" className="size-[22px]" />)}
        {item("My foods", myFoodsHref(), page === "myfoods", <BookOpen aria-hidden="true" className="size-[22px]" />)}
      </div>
      <div className="mt-auto flex flex-col items-center gap-3">
        {item("Settings", "#/settings", page === "settings", <Settings aria-hidden="true" className="size-[22px]" />)}
        <a
          href="#/settings/profile"
          aria-label="Your profile"
          title={user.displayName ?? user.username}
          className="flex size-10 items-center justify-center rounded-full bg-pressed text-xs font-bold text-ink hover:bg-strong"
        >
          {initialsOf(user)}
        </a>
      </div>
    </nav>
  );
}
