# I6 — Passkeys and Authentik (OAuth) sign-in on iPhone

Short design, written overnight. Source: the iOS design (2026-11-19, §6.2 sign-in and server changes 3–4) and
Cory's answers before bed: the passkey host is the testing address (`bytesize-testing.clanders.duckdns.org`), and the
Apple Team ID is a server setting he fills in later (`IOS_APP_ID`). Ships as 0.10.0.

## Why
The iPhone app signs in with a password only; when a server is OAuth-only it says "coming to the app soon". The web
already does passkeys and OAuth (Authentik). I6 brings both to the phone, as the iOS design planned.

## Approaches
- **Passkeys** — one sensible way: Apple's `ASAuthorizationPlatformPublicKeyCredentialProvider` with the server's host
  as relying party, using the existing `/api/passkeys/login/options|verify` routes. Apple only lets an app use a
  site's passkeys if the site lists the app: the server serves `/.well-known/apple-app-site-association` with
  `webcredentials.apps = [IOS_APP_ID]` (404 when unset), and the app has the Associated Domains entitlement
  `webcredentials:bytesize-testing.clanders.duckdns.org`. The phone sends `Origin: https://<host>` on those two calls,
  which is exactly the origin Apple puts in the passkey's signed client data — so the server's existing origin and
  rpId checks work unchanged.
- **OAuth** — one sensible way: `ASWebAuthenticationSession` (Safari's sheet) with callback scheme `bytesize`.
  - `POST /api/auth/oauth/start` takes `{ client: "ios", appKey }`: `appKey` is a random secret the app makes;
    the server stores its hash with the flow and doesn't set the browser cookie (Safari's sheet doesn't share the
    app's cookies — the cookie is what ties a web flow to its browser).
  - The callback, for an iOS flow, skips the cookie check and redirects to `bytesize://oauth?ticket=…` (errors:
    `bytesize://oauth?error=…`). The ticket keeps the key's hash.
  - `POST /api/auth/oauth/finish` for that ticket requires the same `appKey`: another app that grabs the
    `bytesize://` redirect can't use the ticket. (Same job the cookie does on the web.)
  - Considered and dropped: universal links for the callback (needs the same AASA plus an `applinks` route; more
    moving parts for no extra safety given the key).

## What gets built
- Server: AASA route; `client`/`appKey` on OAuth start, `client` and `app_key_hash` columns on `oauth_flows` and
  `app_key_hash` on `oauth_tickets` (migration 0029); callback/finish rules above; the sign-in options answer
  gains `passkeys: true|false` (passkeys usable from this host: HTTPS and allowed by `PASSKEY_ORIGINS`).
- iPhone (Kit): `PasskeyAPI.loginOptions/verify` with the Origin header; `OAuthAPI.start(appKey)/finish(ticket,
  appKey)`; `SignInModel` gains `signInWithPasskey(using:)` and `signInWithOAuth(using:)` driven by small protocols
  (`PasskeyAuthorizer`, `WebAuthSession`) so the model is tested without Apple's sheets.
- iPhone (app): "Sign in with a passkey" and "Sign in with Authentik" (the provider's label) on the sign-in screen,
  shown when the server offers them; the OAuth-only "coming soon" message goes. Entitlement and project settings.

## Calls I made
- `IOS_APP_ID` unset → AASA 404, and the app still builds; passkeys fail on the phone with Apple's own message until
  Cory sets it (documented in the deploy notes / changelog).
- Link Authentik from the phone (Settings › Security) stays on the web — sign-in only.
- Passkey *creation* stays on the web; the phone signs in with a passkey made there (same host).

## Tests
Server: AASA on/off; OAuth start with client ios (no cookie, key hash stored); callback → `bytesize://` with ticket
or error; finish refuses a missing/wrong key and accepts the right one; web flows unchanged. Kit: the model with fake
authorizer/session (success, cancel, server error); request shapes (Origin header, app key). UI: the buttons show
when offered (stub). Real passkey/Authentik sign-in needs Cory's phone (simulator can't).
