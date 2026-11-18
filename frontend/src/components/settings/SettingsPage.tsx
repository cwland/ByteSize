import { ChevronLeft, ChevronRight, LogOut, ScrollText, Shield, User, Users, HardDrive, Link2 } from "lucide-react";
import { settingsSectionFromHash, useHash } from "../../routes";
import { useSession } from "../../session";
import LogsSettings from "./LogsSettings";
import DataSettings from "./DataSettings";
import IntegrationsSettings from "./IntegrationsSettings";
import ProfileSettings from "./ProfileSettings";
import SecuritySettings from "./SecuritySettings";
import UsersSettings from "./UsersSettings";
import { useWide } from "../../wide";

// admin: only admins see it (people, everyone's logs). Integrations is everyone's: admins also see the
// server-wide services there (AI, food data, restaurants). twoUp: on wide screens its cards sit in two columns.
const TABS = [
  { id: "profile", label: "Profile", hint: "Name, units, time zone, appearance", admin: false, Icon: User, Panel: ProfileSettings },
  { id: "security", label: "Security", hint: "Password, passkeys, devices", admin: false, Icon: Shield, Panel: SecuritySettings },
  { id: "integrations", label: "Integrations", hint: "Culury meal plan and recipes", adminHint: "AI, food data, restaurants, Culury", admin: false, twoUp: true, Icon: Link2, Panel: IntegrationsSettings },
  { id: "data", label: "Data", hint: "Download your data", adminHint: "Your data and backups", admin: false, Icon: HardDrive, Panel: DataSettings },
  { id: "users", label: "Users", hint: "Add and manage people", admin: true, Icon: Users, Panel: UsersSettings },
  { id: "logs", label: "Logs", hint: "What ByteSize has been doing", admin: true, Icon: ScrollText, Panel: LogsSettings },
] as const;

// Addresses from before Integrations held them (#/settings/ai, #/settings/food-sources)
const MOVED: Record<string, string> = { ai: "integrations", "food-sources": "integrations" };

const row = "flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-pressed";
const rowIcon = "flex size-9 shrink-0 items-center justify-center rounded-full bg-pressed text-action";

// Settings: a list of rows with chevrons (#/settings); a row opens its section (#/settings/security).
// Wide screens: tabs across the top and the section below; #/settings (or a tab you can't see) opens the first.
export default function SettingsPage() {
  const { user, signOut } = useSession();
  const wide = useWide();
  const tabs = TABS.filter((t) => user.isAdmin || !t.admin);
  const asked = settingsSectionFromHash(useHash());
  const wanted = MOVED[asked] ?? asked;
  const tab = tabs.find((t) => t.id === wanted);

  if (wide) {
    const active = tab ?? tabs[0];
    return (
      <div>
        <div className="flex items-center gap-4">
          <h1 className="mr-auto text-3xl font-bold">Settings</h1>
          <button type="button" onClick={signOut} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold text-subtle hover:bg-pressed hover:text-ink">
            <LogOut className="size-4" aria-hidden="true" /> Sign out
          </button>
        </div>
        <nav aria-label="Settings sections" className="mt-5 border-b border-line">
          <div role="tablist" aria-label="Settings sections" aria-orientation="horizontal" className="-mb-px flex overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {tabs.map((t) => (
              <a
                key={t.id}
                role="tab"
                aria-selected={t.id === active.id}
                href={`#/settings/${t.id}`}
                className={`shrink-0 border-b-2 px-4 py-3 font-semibold whitespace-nowrap ${t.id === active.id ? "border-action text-ink" : "border-transparent text-subtle hover:text-ink"}`}
              >
                {t.label}
              </a>
            ))}
          </div>
        </nav>
        <div
          role="tabpanel"
          aria-label={active.label}
          className={`mt-5 ${"twoUp" in active ? "gap-5 lg:columns-2 [&>*]:mb-5 [&>*]:break-inside-avoid" : "flex flex-col gap-3"}`}
        >
          <active.Panel />
        </div>
      </div>
    );
  }

  if (tab) {
    return (
      <div className="pt-2">
        <a href="#/settings" className="inline-flex items-center gap-1 rounded-full py-1 pr-3 text-sm font-semibold text-link hover:bg-pressed">
          <ChevronLeft className="size-4" /> Settings
        </a>
        <h1 className="mt-2 px-1 text-2xl font-bold">{tab.label}</h1>
        <div role="tabpanel" aria-label={tab.label} className="mt-4 flex flex-col gap-3">
          <tab.Panel />
        </div>
      </div>
    );
  }

  return (
    <div className="pt-2">
      <h1 className="px-1 text-2xl font-bold">Settings</h1>
      <nav aria-label="Settings sections" className="mt-4">
        <div role="tablist" aria-orientation="vertical" className="divide-y divide-line overflow-hidden rounded-2xl bg-container">
          {tabs.map((t) => (
            <a key={t.id} role="tab" aria-selected={false} aria-label={t.label} href={`#/settings/${t.id}`} className={row}>
              <span className={rowIcon}>
                <t.Icon className="size-5" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{t.label}</span>
                <span className="block truncate text-sm text-muted">{user.isAdmin && "adminHint" in t ? t.adminHint : t.hint}</span>
              </span>
              <ChevronRight className="size-5 shrink-0 text-inactive" aria-hidden="true" />
            </a>
          ))}
        </div>
      </nav>
      <div className="mt-3 overflow-hidden rounded-2xl bg-container">
        <button type="button" onClick={signOut} className={row}>
          <span className={rowIcon}>
            <LogOut className="size-5" aria-hidden="true" />
          </span>
          <span className="flex-1 font-semibold">Sign out</span>
        </button>
      </div>
    </div>
  );
}
