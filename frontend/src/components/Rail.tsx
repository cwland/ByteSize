import { useEffect, useRef, useState } from "react";
import { BookOpen, House, Lightbulb, LogOut, Settings, Syringe, Target, User } from "lucide-react";
import { isGlp1, myFoodsHref, type Page } from "../routes";
import { initialsOf, useSession } from "../session";
import { Logo } from "./ui/Logo";
import { useSettingsMe } from "../day";
import { IconLink } from "./ui/IconButton";
import { Confirm } from "./ui/Confirm";
import { showWhatsNew, versionLabel } from "../version";

// Wide screens: the side rail in place of the top bar and bottom tab bar. Logo (home), the pages (GLP-1 among
// them since it left Goals, §40a) with My foods and Settings (SPEC-24), and at the bottom the account menu (SPEC-23)
// and the version (SPEC-18) (no +: food is added from the Food widget; no Log page). Stays in view. It comes
// after the page in the DOM (the shell keeps one tree for both layouts) and is drawn first with order-first.
export default function Rail({ page }: { page: Page }) {
  const { user } = useSession();
  const glp1 = isGlp1(); // the GLP-1 page sits under the Dashboard; the shell redraws on every address change
  const glp1On = !!useSettingsMe().glp1On; // the GLP-1 item only for people tracking it (from the settings: no pop-in, §46)
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
      <IconLink href="#/" label="ByteSize home" className="shrink-0 rounded-xl">
        <Logo className="size-11 rounded-xl" />
      </IconLink>
      <div className="mt-3.5 flex flex-col gap-1.5">
        {item("Dashboard", "#/", page === "dashboard" && !glp1, <House aria-hidden="true" className="size-[22px]" />)}
        {item("Goals", "#/goals", page === "goals", <Target aria-hidden="true" className="size-[22px]" />)}
        {item("Insights", "#/insights", page === "insights", <Lightbulb aria-hidden="true" className="size-[22px]" />)}
        {glp1On && item("GLP-1", "#/glp1", page === "dashboard" && glp1, <Syringe aria-hidden="true" className="size-[22px]" />)}
        {item("My foods", myFoodsHref(), page === "myfoods", <BookOpen aria-hidden="true" className="size-[22px]" />)}
        {item("Settings", "#/settings", page === "settings", <Settings aria-hidden="true" className="size-[22px]" />)}
      </div>
      <div className="mt-auto flex flex-col items-center gap-2">
        <AccountMenu />
        {/* W1 / SPEC-18: the version, in the bottom-left corner; it opens What's new */}
        <button type="button" onClick={showWhatsNew} aria-label={`What's new in ${versionLabel}`} title="What's new in this version" className="rounded px-1 text-[11px] text-muted hover:text-link hover:underline">
          {versionLabel}
        </button>
      </div>
    </nav>
  );
}

// SPEC-23: the avatar opens the account menu (as in Culury): who's signed in, Profile & security, Sign out, and
// Sign out everywhere (asks first). Escape or a click outside closes it.
function AccountMenu() {
  const { user, signOut, signOutEverywhere } = useSession();
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const avatar = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      avatar.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const name = user.displayName?.trim() || user.username;
  const under = user.email || (name === user.username ? null : user.username);
  const itemClass = "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left font-medium hover:bg-pressed";

  return (
    <div ref={box} className="relative">
      <button
        ref={avatar}
        type="button"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        title={name}
        onClick={() => setOpen((o) => !o)}
        className="flex size-10 items-center justify-center rounded-full bg-pressed text-xs font-bold text-ink hover:bg-strong"
      >
        {initialsOf(user)}
      </button>
      {open && (
        <div role="menu" aria-label="Account" className="absolute bottom-0 left-full z-40 ml-3 w-64 rounded-2xl bg-container p-2 shadow-xl ring-1 ring-line">
          <div className="border-b border-line px-3 pt-2 pb-3">
            <p className="truncate font-bold">{name}</p>
            {under && <p className="truncate text-sm text-subtle">{under}</p>}
          </div>
          <div className="flex flex-col pt-2">
            <a role="menuitem" href="#/settings/profile" onClick={() => setOpen(false)} className={itemClass}>
              <User aria-hidden="true" className="size-5 text-subtle" />
              Profile & security
            </a>
            <button role="menuitem" type="button" onClick={signOut} className={itemClass}>
              <LogOut aria-hidden="true" className="size-5 text-subtle" />
              Sign out
            </button>
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false);
                setAsking(true);
              }}
              className={`${itemClass} text-error`}
            >
              <LogOut aria-hidden="true" className="size-5" />
              Sign out everywhere
            </button>
          </div>
        </div>
      )}
      {asking && (
        <Confirm
          title="Sign out everywhere?"
          text="This browser and every other device signed in to ByteSize will need to sign in again."
          confirmLabel="Sign out everywhere"
          onCancel={() => setAsking(false)}
          onConfirm={() => {
            setAsking(false);
            void signOutEverywhere();
          }}
        />
      )}
    </div>
  );
}
