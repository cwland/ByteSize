import Navigation from "./Navigation";
import Placeholder from "./Placeholder";
import { Logo } from "./ui/Logo";
import { pageFromHash, useHash, type Page } from "../routes";
import { initialsOf, useSession } from "../session";

// The signed-in app: the header, the navigation and the page for the address
export default function AppShell() {
  const page: Page = pageFromHash(useHash());
  const { user, signOut } = useSession();
  return (
    <div className="flex min-h-screen flex-col bg-page">
      <header className="flex h-14 items-center gap-2 border-b border-line bg-container px-4">
        <Logo className="size-8" />
        <span className="text-lg font-bold">ByteSize</span>
        <span className="ml-auto flex size-8 items-center justify-center rounded-full bg-brand-subtle text-xs font-bold text-primary" title={user.displayName ?? user.username}>
          {initialsOf(user)}
        </span>
        <button type="button" onClick={signOut} className="text-sm font-semibold text-link hover:underline">
          Sign out
        </button>
      </header>
      <div className="flex min-h-0 flex-1">
        <Navigation page={page} />
        <main className="min-w-0 flex-1 pb-20 sm:pb-6">
          {page === "today" && <Placeholder title="Today" />}
          {page === "log" && <Placeholder title="Food log" />}
          {page === "foods" && <Placeholder title="My foods" />}
          {page === "settings" && <Placeholder title="Settings" />}
        </main>
      </div>
    </div>
  );
}
