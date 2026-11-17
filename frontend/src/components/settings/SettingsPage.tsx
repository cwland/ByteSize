import { settingsSectionFromHash, useHash } from "../../routes";
import { useSession } from "../../session";
import AiSettings from "./AiSettings";
import LogsSettings from "./LogsSettings";
import ProfileSettings from "./ProfileSettings";
import SecuritySettings from "./SecuritySettings";
import UsersSettings from "./UsersSettings";

// admin: only admins see it (people, AI keys, everyone's logs)
const TABS = [
  { id: "profile", label: "Profile", admin: false, Panel: ProfileSettings },
  { id: "security", label: "Security", admin: false, Panel: SecuritySettings },
  { id: "users", label: "Users", admin: true, Panel: UsersSettings },
  { id: "ai", label: "AI services", admin: true, Panel: AiSettings },
  { id: "logs", label: "Logs", admin: true, Panel: LogsSettings },
] as const;

// Settings: one tab per section, the section in the address (#/settings/security)
export default function SettingsPage() {
  const { user } = useSession();
  const tabs = TABS.filter((t) => user.isAdmin || !t.admin);
  const wanted = settingsSectionFromHash(useHash());
  const tab = tabs.find((t) => t.id === wanted) ?? tabs[0];

  return (
    <div className="mx-auto max-w-3xl px-4 pt-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <nav aria-label="Settings sections" className="mt-3 overflow-x-auto border-b border-line">
        <div role="tablist" className="flex min-w-max gap-1">
          {tabs.map((t) => (
            <a
              key={t.id}
              role="tab"
              href={`#/settings/${t.id}`}
              aria-selected={tab.id === t.id}
              className={`-mb-px border-b-[3px] px-4 py-2.5 text-sm font-semibold whitespace-nowrap ${tab.id === t.id ? "border-action text-ink" : "border-transparent text-subtle hover:text-ink"}`}
            >
              {t.label}
            </a>
          ))}
        </div>
      </nav>
      <div role="tabpanel" aria-label={tab.label} className="mt-6 flex flex-col gap-6">
        <tab.Panel />
      </div>
    </div>
  );
}
