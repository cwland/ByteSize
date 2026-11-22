import { ChevronLeft, ChevronRight, Lightbulb, LogOut, ScrollText, Shield, User, Users, Database, HardDrive, Info, KeyRound, Link2, Mail } from "lucide-react";
import { settingsSectionFromHash, useHash } from "../../routes";
import { useSession } from "../../session";
import ApiKeysSettings from "./ApiKeysSettings";
import AppInfoSettings from "./AppInfoSettings";
import CachedDataSettings from "./CachedDataSettings";
import LogsSettings from "./LogsSettings";
import DataSettings from "./DataSettings";
import EmailSettings from "./EmailSettings";
import IntegrationsSettings from "./IntegrationsSettings";
import ProfileSettings from "./ProfileSettings";
import SecuritySettings from "./SecuritySettings";
import UsersSettings from "./UsersSettings";
import { useWide } from "../../wide";

// admin: only admins see it (people, everyone's logs). Integrations is everyone's: admins also see the
// server-wide services there (AI, food data, restaurants). twoUp: on wide screens its cards sit in two columns.
const TABS = [
  { id: "profile", label: "Profile", hint: "Name, units, time zone, appearance", admin: false, Icon: User, Panel: ProfileSettings },
  { id: "users", label: "Users", hint: "Add and manage people", admin: true, Icon: Users, Panel: UsersSettings },
  { id: "api-keys", label: "API keys", hint: "Keys for your own tools and scripts", admin: false, Icon: KeyRound, Panel: ApiKeysSettings },
  { id: "security", label: "Security", hint: "Password, passkeys, devices", admin: false, Icon: Shield, Panel: SecuritySettings },
  { id: "integrations", label: "Integrations", hint: "RecipeHub meal plan and recipes", adminHint: "AI, food data, restaurants, RecipeHub", admin: false, twoUp: true, Icon: Link2, Panel: IntegrationsSettings },
  { id: "cached-data", label: "Cached data", hint: "Saved barcodes and what ByteSize keeps", admin: true, Icon: Database, Panel: CachedDataSettings },
  { id: "email", label: "Email", hint: "Sending email, forgot password", admin: true, Icon: Mail, Panel: EmailSettings },
  { id: "data", label: "Data", hint: "Download your data", adminHint: "Your data and backups", admin: false, Icon: HardDrive, Panel: DataSettings },
  { id: "app-info", label: "App info", hint: "Fun numbers: foods logged, scans, lookups", adminHint: "Your numbers, and everyone's", admin: false, Icon: Info, Panel: AppInfoSettings },
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

  // On wide screens #/settings (or a tab you can't see) opens the first tab. The open section sits in one
  // slot whichever way the page is drawn, so crossing 1024 px keeps a half-filled form.
  const active = wide ? (tab ?? tabs[0]) : tab;
  return (
    <div className={wide ? undefined : "pt-2"}>
      {wide ? (
        <>
          {/* Sign out lives in the rail's account menu on wide screens (SPEC-23) */}
          <h1 className="text-3xl font-bold">Settings</h1>
          <nav aria-label="Settings sections" className="mt-5 flex overflow-x-auto border-b border-line [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {tabs.map((t) => (
              <a
                key={t.id}
                aria-current={t.id === active?.id ? "page" : undefined}
                href={`#/settings/${t.id}`}
                className={`-mb-px shrink-0 border-b-2 px-4 py-3 font-semibold whitespace-nowrap ${t.id === active?.id ? "border-action text-ink" : "border-transparent text-subtle hover:text-ink"}`}
              >
                {t.label}
              </a>
            ))}
          </nav>
        </>
      ) : tab ? (
        <>
          <a href="#/settings" className="inline-flex items-center gap-1 rounded-full py-1 pr-3 text-sm font-semibold text-link hover:bg-pressed">
            <ChevronLeft className="size-4" /> Settings
          </a>
          <h1 className="mt-2 px-1 text-2xl font-bold">{tab.label}</h1>
        </>
      ) : (
        <>
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
        </>
      )}
      {active && (
        <div
          role="tabpanel"
          aria-label={active.label}
          className={wide ? `mt-5 ${"twoUp" in active ? "gap-5 lg:columns-2 [&>*]:mb-5 [&>*]:break-inside-avoid" : "flex flex-col gap-3"}` : "mt-4 flex flex-col gap-3"}
        >
          <active.Panel />
        </div>
      )}
      {!wide && !tab && (
        // §43: phones always have a way to Insights here (wide screens: the rail), whatever their Dashboard holds
        <div className="mt-3 overflow-hidden rounded-2xl bg-container">
          <a href="#/insights" aria-label="Insights" className={row}>
            <span className={rowIcon}>
              <Lightbulb className="size-5" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">Insights</span>
              <span className="block truncate text-sm text-muted">Weekly recap, protein help, ask a question</span>
            </span>
            <ChevronRight className="size-5 shrink-0 text-inactive" aria-hidden="true" />
          </a>
        </div>
      )}
      {!wide && !tab && (
        <div className="mt-3 overflow-hidden rounded-2xl bg-container">
          <button type="button" onClick={signOut} className={row}>
            <span className={rowIcon}>
              <LogOut className="size-5" aria-hidden="true" />
            </span>
            <span className="flex-1 font-semibold">Sign out</span>
          </button>
        </div>
      )}
    </div>
  );
}
