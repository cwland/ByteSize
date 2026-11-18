import { useCallback, useEffect, useState } from "react";
import { applyMode, applyTheme } from "./themes";
import { api, ApiError, getToken, setToken } from "./api";
import AuthScreen from "./components/AuthScreen";
import InvitePage, { inviteTokenFromHash } from "./components/InvitePage";
import { useHash } from "./routes";
import AppShell from "./components/AppShell";
import SetupWizard from "./components/SetupWizard";
import { SessionContext, type User } from "./session";
import { forgetSettings } from "./day";

type AuthState =
  | { status: "loading" }
  | { status: "offline" } // the server can't be reached (e.g. restarting): keep the sign-in and retry
  | { status: "setup" } // first run: no accounts yet
  | { status: "login" }
  | { status: "in"; user: User };

export default function App() {
  const [auth, setAuth] = useState<AuthState>({ status: "loading" });
  const inviteToken = inviteTokenFromHash(useHash()); // an invite email's link

  // The account's theme (Settings › Profile) wins over the one this browser remembered
  const userTheme = auth.status === "in" ? auth.user.theme : undefined;
  const userMode = auth.status === "in" ? auth.user.colorMode : undefined;
  useEffect(() => {
    if (userTheme) applyTheme(userTheme);
  }, [userTheme]);
  useEffect(() => {
    if (userMode) applyMode(userMode);
  }, [userMode]);

  const check = useCallback(async () => {
    try {
      const status = await api<{ setupRequired: boolean }>("GET", "/api/auth/status");
      if (status.setupRequired) return setAuth({ status: "setup" });
      if (!getToken()) return setAuth({ status: "login" });
      const me = await api<{ user: User }>("GET", "/api/auth/me");
      setAuth({ status: "in", user: me.user });
    } catch (e) {
      // Only a "not signed in" answer ends the session. Anything else (server restarting, network
      // down) keeps the sign-in and tries again.
      if (!(e instanceof ApiError) || e.status === 0 || e.status >= 500) {
        setAuth((a) => (a.status === "in" ? a : { status: "offline" }));
        setTimeout(() => void check(), 3000);
        return;
      }
      setToken(null);
      setAuth({ status: "login" });
    }
  }, []);

  useEffect(() => {
    void check();
    const onLogout = () => void check();
    window.addEventListener("bytesize:logout", onLogout);
    return () => window.removeEventListener("bytesize:logout", onLogout);
  }, [check]);

  // Every sign-in starts on the Dashboard
  const signedIn = (token: string, user: User) => {
    setToken(token);
    if (window.location.hash !== "#/") window.location.hash = "#/";
    setAuth({ status: "in", user });
  };

  if (auth.status === "loading") return <div className="min-h-screen bg-page" />;
  if (auth.status === "offline") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-page p-6 text-center">
        <div role="status" className="rounded-2xl bg-container px-8 py-6">
          <p className="text-lg font-bold">Can't reach ByteSize right now</p>
          <p className="mt-1 text-subtle">The server may be restarting. Trying again…</p>
        </div>
      </div>
    );
  }
  if (auth.status === "setup") return <SetupWizard onAccount={signedIn} onDone={() => void check()} />;
  if (inviteToken) return <InvitePage token={inviteToken} onDone={signedIn} />;
  if (auth.status === "login") return <AuthScreen onDone={signedIn} />;

  const setUser = (user: User) => setAuth({ status: "in", user });
  // First sign-in (the admin's, or someone the admin added): the profile step of the wizard
  if (!auth.user.setupDone) return <SetupWizard user={auth.user} onAccount={signedIn} onDone={setUser} />;

  const signOut = () => {
    api("POST", "/api/auth/logout").catch(() => {}); // this device shows as signed out
    forgetSettings(auth.user.id); // their date look and the rest aren't kept on this device
    setToken(null);
    setAuth({ status: "login" });
  };

  return (
    <SessionContext.Provider
      value={{
        user: auth.user,
        setUser,
        refresh: check,
        replaceToken: (token) => setToken(token),
        signOut,
        signOutEverywhere: async () => {
          await api("POST", "/api/auth/logout-all", {});
          signOut();
        },
      }}
    >
      <AppShell />
    </SessionContext.Provider>
  );
}
