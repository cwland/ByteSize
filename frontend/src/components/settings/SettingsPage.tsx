import { Bot, ChevronLeft, ChevronRight, LogOut, ScrollText, Shield, User, Users, Database } from "lucide-react";
import { settingsSectionFromHash, useHash } from "../../routes";
import { useSession } from "../../session";
import AiSettings from "./AiSettings";
import LogsSettings from "./LogsSettings";
import FoodSourcesSettings from "./FoodSourcesSettings";
import ProfileSettings from "./ProfileSettings";
import SecuritySettings from "./SecuritySettings";
import UsersSettings from "./UsersSettings";

// admin: only admins see it (people, AI keys, everyone's logs)
const TABS = [
  { id: "profile", label: "Profile", hint: "Name, units, time zone, appearance", admin: false, Icon: User, Panel: ProfileSettings },
  { id: "security", label: "Security", hint: "Password, passkeys, devices", admin: false, Icon: Shield, Panel: SecuritySettings },
  { id: "users", label: "Users", hint: "Add and manage people", admin: true, Icon: Users, Panel: UsersSettings },
  { id: "ai", label: "AI services", hint: "Providers and failover order", admin: true, Icon: Bot, Panel: AiSettings },
  { id: "food-sources", label: "Food sources", hint: "Open Food Facts, USDA, restaurants", admin: true, Icon: Database, Panel: FoodSourcesSettings },
  { id: "logs", label: "Logs", hint: "What ByteSize has been doing", admin: true, Icon: ScrollText, Panel: LogsSettings },
] as const;

const row = "flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-pressed";
const rowIcon = "flex size-9 shrink-0 items-center justify-center rounded-full bg-pressed text-action";

// Settings: a list of rows with chevrons (#/settings); a row opens its section (#/settings/security)
export default function SettingsPage() {
  const { user, signOut } = useSession();
  const tabs = TABS.filter((t) => user.isAdmin || !t.admin);
  const wanted = settingsSectionFromHash(useHash());
  const tab = tabs.find((t) => t.id === wanted);

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
                <span className="block truncate text-sm text-muted">{t.hint}</span>
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
