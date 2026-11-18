import { api } from "./api";

// Leaving for the OAuth provider's page (tests swap browser.go to see where it would go)
export const browser = { go: (url: string) => window.location.assign(url) };

/** Sign in (or, signed in, Link my account): the server says where the provider's page is, and the browser goes there. */
export async function goToProvider(path: "/api/auth/oauth/start" | "/api/auth/oauth/link/start") {
  const { url } = await api<{ url: string }>("POST", path, {});
  browser.go(url);
}

/** What the provider's return left in the address (#/oauth?ticket=…, #/?oauth_error=…, #/settings/security?oauth=linked). */
export function oauthReturn(hash = window.location.hash) {
  const q = new URLSearchParams(hash.split("?")[1] ?? "");
  return { ticket: hash.startsWith("#/oauth?") ? q.get("ticket") : null, error: q.get("oauth_error"), linked: q.get("oauth") === "linked" };
}

/** Takes the provider's leftovers out of the address, without a new history entry. */
export function clearOAuthReturn(path: string) {
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${path}`);
}
