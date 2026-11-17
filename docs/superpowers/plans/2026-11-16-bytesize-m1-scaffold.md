# ByteSize Milestone 1 (Scaffold) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A running, tested, Dockerized ByteSize shell: admin setup, admin-created users with strict per-user isolation, password + passkey sign-in, Avocado-themed app shell with settings, AI service settings with failover, app logs, `/health`, and CI that publishes `ghcr.io/cwland/bytesize:latest` (amd64).

**Architecture:** Monorepo copied in shape from Culury (`backend/` Fastify + Drizzle + Postgres, `frontend/` React + Vite + Tailwind). Culury modules are copied from the read-only reference and adapted; Culury's shared-household model becomes per-user (`users.is_admin` replaces `role`, every user-owned row carries `user_id`). Auth stays Culury's model: JWT bearer token stored by the browser, one `sessions` row per device.

**Tech Stack:** Node 22, TypeScript 5.9, Fastify 5, Drizzle ORM 0.45 + drizzle-kit, pg, zod 4, bcryptjs, jsonwebtoken, @simplewebauthn/server|browser 13, React 18, Vite 6, Tailwind 4, lucide-react, Vitest 5, Testing Library, jsdom. Versions: use the same ranges as Culury's `backend/package.json` and `frontend/package.json`.

**Spec:** `docs/superpowers/specs/2026-11-16-bytesize-m1-m2-design.md` (sections 3, 6.1, 6.2, 6.3 "Shared" tables, 6.9, 6.10 M1).

**Culury reference:** `https://github.com/cwland/Culury` cloned read-only to a scratch folder (e.g. `../Culury`). Paths below like `Culury:backend/src/lib/auth.ts` refer to it. **Never commit to, push to, or edit Culury.**

## Global Constraints

- Default port **4100**; `PORT` env overrides.
- `GET /health` and `GET /api/health` both public, return `{ ok: true, db: true, version }` (503 with `db: false` if the DB query fails).
- Docker: **linux/amd64 only**. Image `ghcr.io/cwland/bytesize`, `:latest` from `main`, `:X.Y.Z` from `vX.Y.Z` tags.
- **No public registration.** The only account-creating routes are first-run `POST /api/auth/setup` (creates the admin, 409 afterwards) and admin-only `POST /api/admin/users`.
- Every user-owned table: `user_id integer not null references users(id) on delete cascade`, index leading with `user_id`. Route handlers get the caller's id only from `requireUser(req)`; never from the body or query.
- TDD: every step that adds behavior starts with a failing test. Backend tests run against a real Postgres test DB from `TEST_DATABASE_URL` (must contain `test`); files run serially (`fileParallelism: false`).
- Units values: `"imperial" | "metric"` (default `imperial`). Timezone: IANA name (default `America/Boise`), validated with `Intl.supportedValuesOf("timeZone")`.
- Default theme id `"avocado"`, default color mode `"system"`.
- UI copy: sentence case, no "please", no "successfully" (Culury's copy rules).
- `.gitignore` must include `node_modules/`, `dist/`, `data/`, `.env`, `.superpowers/`, `Claude outputs/`.

## Review Focus

1. **Disabled user with a live token** → their very next request gets 401 (not just blocked at next login). Test in Task 4.
2. **Removing the last admin** (disable or demote yourself or the only admin) → 409 "ByteSize needs at least one admin". Test in Task 4.
3. **Duplicate usernames differing only in case/spaces** ("Cory", " cory ") → admin create returns 409; login is case-insensitive. Test in Task 4.
4. **Secrets leaking** → `GET /api/settings/ai` never returns an API key, only `hasKey: true`; non-admins get 403 on AI settings, users and all-logs. Test in Task 7.
5. **Bad timezone or units** in profile (`"Mars/Base"`, `"stone"`) → 400, stored value unchanged; M2 day boundaries depend on it. Test in Task 5.

---

## File Structure

```
package.json                     root: setup/dev/test scripts (concurrently)
.gitignore  .dockerignore  .env.example  Dockerfile  docker-compose.yml  docker-compose.dev.yml
.github/workflows/build.yml
logo.jpg                         (already present)
scripts/make-icons.mjs           crops logo.jpg → frontend/public icons
backend/
  package.json tsconfig.json vitest.config.ts drizzle.config.ts .env.example
  drizzle/                       generated migrations (drizzle-kit generate)
  src/index.ts                   start server: env, migrations, serveWeb
  src/app.ts                     buildApp(opts): plugins, auth hook, routes
  src/web.ts                     serveWeb (from Culury, no share preview)
  src/db/index.ts migrate.ts run-migrations.ts schema.ts
  src/lib/errors.ts version.ts auth.ts sessions.ts security.ts guards.ts secrets.ts ai.ts appLog.ts users.ts
  src/routes/health.ts auth.ts admin-users.ts passkeys.ts profile.ts settings-ai.ts logs.ts
  src/cli/reset-password.ts
  tests/helpers.ts isolation.ts *.test.ts
frontend/
  package.json tsconfig.json vite.config.ts index.html
  public/favicon-32.png apple-touch-icon.png icon-192.png icon-512.png manifest.webmanifest
  src/main.tsx App.tsx api.ts session.tsx themes.ts index.css version.ts passkeys.ts
  src/components/AuthScreen.tsx SetupWizard.tsx AppShell.tsx Navigation.tsx Placeholder.tsx
  src/components/settings/SettingsPage.tsx ProfileSettings.tsx SecuritySettings.tsx UsersSettings.tsx AiSettings.tsx LogsSettings.tsx
  src/components/ui/  (Culury settingsUi.tsx inputs.tsx Popup.tsx Icons.tsx)
  src/test/setup.ts fakeServer.ts
```

---

### Task 1: Repo skeleton, DB, health, test harness

**Files:**
- Create: root `package.json`, `.gitignore`, `docker-compose.dev.yml`, `backend/{package.json,tsconfig.json,vitest.config.ts,drizzle.config.ts,.env.example}`, `backend/src/{app.ts,index.ts}`, `backend/src/db/{index.ts,migrate.ts,run-migrations.ts,schema.ts}`, `backend/src/lib/{errors.ts,version.ts}`, `backend/src/routes/health.ts`, `backend/tests/helpers.ts`
- Test: `backend/tests/health.test.ts`

**Interfaces:**
- Produces: `buildApp(opts: AppOptions): FastifyInstance` where `AppOptions = { db: Db; jwtSecret: string; logger?: boolean; aiFetch?: AiFetch; now?: () => Date }` (AI fields wired in Task 7). `createDb(url) → { db, pool }`, `type Db`, `runMigrations(db)`. `HttpError(status, message)`, `notFound(what)`, `badRequest(msg)`. `APP_VERSION` (read from backend/package.json, version `0.1.0`).
- Produces (tests): `setupTestApp(opts?) → TestApp` with `api(method, path, body?) → Promise<{ status: number; body: any }>` (uses `app.inject`, sends `Authorization: Bearer <token>` when set), `setToken(t)`, `reset()` (truncate all tables except drizzle's), `close()`, `db`, `app`. Login helpers are added in Task 3.

- [ ] **Step 1:** Copy Culury's root `package.json` scripts (`setup`, `dev`, `migrate`, `test`) renamed to bytesize; backend `package.json` with Culury's dependency ranges **minus** recipe-only packages (`cheerio`, `pdf-lib`, `pdfjs-dist`, `@napi-rs/canvas`, `fflate`, `tar`, `@fastify/swagger*`, `nodemailer`, `openid-client`); keep `sharp` and `@fastify/multipart` (needed in M2). `docker-compose.dev.yml` runs `postgres:16-alpine` on 5432 with databases `bytesize` and `bytesize_test`. Copy `vitest.config.ts` and `drizzle.config.ts` as-is.
- [ ] **Step 2: Write the failing test** `backend/tests/health.test.ts`:
  - `"health is public and reports the database"` → `GET /health` 200, body `{ ok: true, db: true, version: "0.1.0" }`; same for `GET /api/health`.
  - `"unknown api routes are 404 json"` → `GET /api/nope` 404, `body.error` is a string.
- [ ] **Step 3:** Run `cd backend && npm test -- health` → FAIL (no app).
- [ ] **Step 4:** Implement `db/*` (copy Culury's), an empty-but-valid `schema.ts`, `errors.ts`/`version.ts` (copy), `routes/health.ts` (runs `select 1`; 503 + `db:false` on failure), `app.ts` with Culury's error handler (ZodError → 400, HttpError → its status), `index.ts` (requires `DATABASE_URL` and a `JWT_SECRET` of ≥ 32 chars, else exits with a clear message; port 4100). `tests/helpers.ts` modeled on `Culury:backend/tests/helpers.ts` (drop schema, migrate, inject helper) without mail/import/updates fakes.
- [ ] **Step 5:** `npx drizzle-kit generate` (creates initial migration), then `npm test` → PASS.
- [ ] **Step 6: Commit** `git add -A ':!Claude outputs' && git commit -m "chore: backend skeleton, db, health"`

### Task 2: Schema for users, sessions, passkeys, settings, logs

**Files:**
- Modify: `backend/src/db/schema.ts`; Create migration via drizzle-kit
- Test: `backend/tests/schema.test.ts`

**Interfaces:**
- Produces tables (Drizzle names → SQL):
  - `users`: `id serial pk, username text unique not null (stored lowercased+trimmed), displayName, email, passwordHash not null, isAdmin boolean not null default false, disabled boolean not null default false, tokenVersion int default 0, theme text, colorMode text, units text default 'imperial', timezone text default 'America/Boise', setupDoneAt timestamptz, createdAt`.
  - `sessions`, `loginEvents`, `passkeys`: copied from `Culury:backend/src/db/schema.ts` unchanged.
  - `appSettings` (key pk, value jsonb, updatedAt): copied.
  - `appLog`: Culury's columns **plus** `userId integer references users on delete cascade` (null = system event) and index `(user_id, at)`. Categories: `"ai" | "api" | "auth" | "schedule" | "food"`.
- [ ] **Step 1: Write the failing test** `"every user-owned table cascades with its user"`: insert a user, a session, a passkey and an app_log row with `userId`; delete the user; assert all three rows are gone and an app_log row with `userId: null` remains.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Add the tables; `npx drizzle-kit generate`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: core schema`

### Task 3: Password auth, sessions, first-run setup

**Files:**
- Create: `backend/src/lib/{auth.ts,sessions.ts,security.ts,guards.ts,users.ts}`, `backend/src/routes/auth.ts`
- Modify: `backend/src/app.ts` (auth hook, security headers, rate limits), `backend/tests/helpers.ts`
- Test: `backend/tests/auth.test.ts`

**Interfaces:**
- Consumes: Task 2 tables.
- Produces: `req.auth?: { userId: number; sessionId: number; isAdmin: boolean }`. `requireUser(req): number` (401 if absent), `requireAdmin(req): number` (403 if not admin) in `lib/guards.ts`. `normalizeUsername(s): string` (trim + lowercase) in `lib/users.ts`. Routes: `GET /api/auth/status → { setupRequired, passwords: true }`, `POST /api/auth/setup {username,password,email?} → { token, user }`, `POST /api/auth/login {username,password} → { token, user }`, `GET /api/auth/me → { user }`, `POST /api/auth/password {current,next}`, `POST /api/auth/logout`, `POST /api/auth/logout-all`, `GET /api/auth/sessions`, `DELETE /api/auth/sessions/:id`, `GET /api/auth/logins`. `user` JSON shape: `{ id, username, displayName, email, isAdmin, theme, colorMode, units, timezone, setupDone }`.
- Produces (tests): `TestApp.login()` → runs setup as `cory`/`password123`, sets token, returns admin user.
- [ ] **Step 1:** Copy `Culury:backend/src/lib/{auth.ts,sessions.ts,security.ts}` unchanged except: drop `generateApiKey` (M4). Copy `Culury:backend/src/routes/auth.ts` and remove `/forgot`, `/reset`, `/seen-version`; `setup` sets `isAdmin: true`; replace `role` with `isAdmin` everywhere; the auth hook loads the user and rejects (401) when `disabled` or token version is stale. Login lockout after 5 failures (Culury's) stays.
- [ ] **Step 2: Write the failing tests** — port `Culury:backend/tests/auth.test.ts` cases `login`, `rejects short passwords` (min 8), `ignores capitalization in the username`, `rejects a bad token`, `locks out after 5 failed logins`, sessions list/revoke, logout-all; adapt `/api/info` → `/api/auth/me`. Add `"setup makes the first user an admin"` → `me.user.isAdmin === true`, and `"there is no sign-up route"` → `POST /api/auth/register` 404.
- [ ] **Step 3:** Run → FAIL. **Step 4:** Implement. **Step 5:** Run → PASS.
- [ ] **Step 6: Commit** `feat: password auth and sessions`

### Task 4: Admin user management and the isolation harness

**Files:**
- Create: `backend/src/routes/admin-users.ts`, `backend/tests/isolation.ts`
- Test: `backend/tests/admin-users.test.ts`, `backend/tests/isolation.test.ts`

**Interfaces:**
- Consumes: `requireAdmin`, `normalizeUsername`, `hashPassword`, `revokeAll(db, userId)`.
- Produces routes (admin only): `GET /api/admin/users → { users: AdminUserRow[] }` (`{ id, username, displayName, email, isAdmin, disabled, createdAt, lastSeenAt }`), `POST /api/admin/users {username, password, displayName?, email?, isAdmin?} → { user }`, `PATCH /api/admin/users/:id {displayName?, email?, isAdmin?, disabled?, password?}`. Setting `disabled: true` or a new `password` calls `revokeAll` and bumps `tokenVersion`.
- Produces (tests): `TestApp.createUser(username, opts?: { isAdmin?: boolean }) → Promise<{ id: number; token: string }>` (creates via admin API then logs in). `twoUsers(t) → Promise<{ a: {id, token}, b: {id, token} }>` in `tests/isolation.ts`, and `asUser(t, token, method, path, body?)`. M2 extends `isolation.test.ts` with every user-data route.
- [ ] **Step 1: Write the failing tests** (`admin-users.test.ts`):
  - `"members can't manage users"` → member token gets 403 on all three routes.
  - `"admin creates a user who can sign in"` → 200, then login as them works and `isAdmin` is false.
  - `"usernames are unique ignoring case and spaces"` → create `"Sam"` then `" sam "` → 409. *(Review Focus 3)*
  - `"disabling a user cuts off their current token"` → member token works, admin PATCH `disabled:true`, same token → 401; login → 401. *(Review Focus 1)*
  - `"can't remove the last admin"` → admin PATCH self `isAdmin:false` → 409 and PATCH self `disabled:true` → 409, body.error `"ByteSize needs at least one admin"`. With a second admin present, demoting self → 200. *(Review Focus 2)*
- [ ] **Step 2: Write the failing test** `isolation.test.ts` `"a user only sees their own sessions"` → `twoUsers`; `a` lists sessions → none belong to `b`; `a` DELETE `b`'s session id → 404.
- [ ] **Step 3:** Run → FAIL. **Step 4:** Implement. **Step 5:** Run → PASS.
- [ ] **Step 6: Commit** `feat: admin-managed users and isolation harness`

### Task 5: Profile, password-reset CLI

**Files:**
- Create: `backend/src/routes/profile.ts`, `backend/src/cli/reset-password.ts`
- Test: `backend/tests/profile.test.ts`

**Interfaces:**
- Produces: `PATCH /api/profile {displayName?, email?, theme?, colorMode?: "light"|"dark"|"system", units?: "imperial"|"metric", timezone?}` → `{ user }`; `POST /api/profile/setup-done`. Theme ids accepted: `avocado | fresh | harbor | terracotta-sage | slate-rose | midnight-coral`.
- CLI: `npm run reset-password -- <username>` prompts for a new password (or reads `NEW_PASSWORD` env), sets it, bumps `tokenVersion`. Package script also overridden in the Docker image as in Culury.
- [ ] **Step 1: Write the failing tests:** `"saves units, timezone and theme"`; `"rejects an unknown timezone or units"` → `"Mars/Base"` and `"stone"` each 400 and `me` unchanged *(Review Focus 5)*; `"setup-done marks the wizard finished"`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement (zod; timezone via `Intl.supportedValuesOf("timeZone").includes`). **Step 4:** Run → PASS.
- [ ] **Step 5:** Manually verify the CLI: `DATABASE_URL=… NEW_PASSWORD=newpass123 npx tsx src/cli/reset-password.ts cory` prints `Password changed for cory`; logging in with it works.
- [ ] **Step 6: Commit** `feat: profile settings and reset-password cli`

### Task 6: Passkeys

**Files:**
- Create: `backend/src/routes/passkeys.ts` (copy of `Culury:backend/src/routes/passkeys.ts`)
- Test: `backend/tests/passkeys.test.ts` (port of Culury's passkey tests)

**Interfaces:**
- Produces: Culury's passkey routes unchanged in shape (`/api/passkeys/register/options`, `/register/verify`, `/login/options`, `/login/verify`, `GET /api/passkeys`, `DELETE /api/passkeys/:id`, `PATCH /api/passkeys/:id`). `PASSKEY_ORIGINS` env as in Culury.
- [ ] **Step 1:** Port the passkey test file; add `"a disabled user can't sign in with a passkey"` → login/verify returns 401.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Copy the route, swap `role` → `isAdmin`, check `disabled`. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: passkey sign-in`

### Task 7: Secrets, AI services with failover, app log

**Files:**
- Create: `backend/src/lib/{secrets.ts,ai.ts,appLog.ts}`, `backend/src/routes/{settings-ai.ts,logs.ts}`
- Modify: `backend/src/app.ts` (decorate `app.ai`), `backend/tests/helpers.ts` (fake AI from Culury's helpers)
- Test: `backend/tests/ai-settings.test.ts`, `backend/tests/ai-failover.test.ts`, `backend/tests/logs.test.ts`

**Interfaces:**
- Produces: `encryptSecret(plain, secret)`, `decryptSecret(stored, secret)` (copied). `AiService` copied from `Culury:backend/src/lib/ai.ts` with its public methods (`status()`, `save(input)`, `test(...)`, `models(...)`, and the chat/JSON call used by Culury's `aiHelpers`) and `parseJsonReply`. AiTask stays `"quick" | "photo"` plus Culury's `"recipe"` renamed to `"food"`. `logEvent(db, { category, level, event, source?, detail?, userId? })`, `recentLogs(db, { userId?, category?, problemsOnly?, limit? })`.
- Routes: `GET /api/ai/status` (any user: `{ ready, provider, photos }`), admin-only `GET|PUT|DELETE /api/settings/ai`, `POST /api/settings/ai/test`, `POST /api/settings/ai/models` (Culury's shapes). `GET /api/logs?category&problems` → admin: all; member: only rows with their `userId`.
- [ ] **Step 1: Write the failing tests** — port `Culury:backend/tests/ai-settings.test.ts` and `ai-failover.test.ts` (failover to the second service when the first errors/times out; failures logged under category `ai`). Add `"members can't see or change AI settings"` → 403 on GET/PUT *(Review Focus 4)*; `"saved API keys are never sent back"` → after PUT with `apiKey: "sk-test"`, GET body contains no `"sk-test"` and the service shows `hasKey: true` *(Review Focus 4)*. Logs: `"members see only their own log lines"`, `"admin sees everything"`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Copy and adapt (drop recipe-specific prompts). **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: ai services with failover and app log`

### Task 8: Frontend foundation, Avocado theme, branding

**Files:**
- Create: `frontend/{package.json,tsconfig.json,vite.config.ts,index.html}`, `frontend/src/{main.tsx,App.tsx,api.ts,session.tsx,themes.ts,index.css,version.ts,passkeys.ts}`, `frontend/src/components/{AuthScreen,SetupWizard,AppShell,Navigation,Placeholder}.tsx`, `frontend/src/components/ui/*`, `frontend/src/test/{setup.ts,fakeServer.ts}`, `scripts/make-icons.mjs`, `frontend/public/*`
- Test: `frontend/src/themes.test.ts`, `frontend/src/App.test.tsx`

**Interfaces:**
- Consumes: backend auth routes (Task 3), profile (Task 5), passkeys (Task 6).
- Produces: `api<T>(method, path, body?)`, `getToken/setToken`, `ApiError` (copied from `Culury:frontend/src/api.ts`, drop recipe helpers). `useSession(): { user, refresh, signOut }`. `THEMES` with `"avocado"` first, `DEFAULT_THEME = "avocado"`, `applyTheme`, `applyMode`, `darkColors` (copied). Hash routes: `#/` Today, `#/log` Food log, `#/foods` My Foods, `#/settings/<section>`; Today/Log/Foods render `Placeholder` ("Coming in the next update") in M1.
- Avocado colors (light mode, from the logo): `page #f5f7f2, container #ffffff, line #e3e9dd, strong #cfd8c6, brand #5aa83c, brand-subtle #eef8d6, success #1f9d55, success-subtle #dcf5e5, error #d1433b, error-subtle #fde2df, warning #f2a20c, pressed #eef5e6, active #ddedc9, primary #1f3a1c, primary-pressed #142812, action #3f8a2a, link #3a7f24, ink #1c2419, subtle #48543f, muted #68745f, inactive #909a87`.
- Icons: `scripts/make-icons.mjs` (uses `sharp` from backend's node_modules) crops `logo.jpg` box `left 292, top 23, width 210, height 210` (the large avocado) and writes `favicon-32.png` (32), `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png` (nearest-neighbor resize to keep pixels crisp) on background `#3c424e`. `manifest.webmanifest`: name `ByteSize`, short_name `ByteSize`, theme_color `#5aa83c`, background_color `#3c424e`, display `standalone`.
- [ ] **Step 1: Write the failing tests:** `themes.test.ts` `"avocado is the default theme"` (`themeById(undefined).id === "avocado"`, `THEMES[0].colors.brand === "#5aa83c"`). `App.test.tsx` with `fakeServer`: `"first run shows the setup wizard"` (status `setupRequired:true` → heading "Set up ByteSize"); `"sign-in screen has no sign-up link"` (setupRequired false, no token → no element matching `/sign up|create account|register/i`); `"signed in shows Today, Food log, My foods and Settings"` in the navigation.
- [ ] **Step 2:** Run `cd frontend && npm test` → FAIL.
- [ ] **Step 3:** Copy and trim Culury's files (remove recipe, planner, discovery, inbox, timers, receive relay, What's new, update bar). AuthScreen: password + passkey sign-in only. SetupWizard: create admin account → profile (units, timezone default from browser) → done. Vite dev proxy target default port 4100.
- [ ] **Step 4:** Run `node scripts/make-icons.mjs` and look at `frontend/public/icon-192.png`: it shows the whole avocado, centered.
- [ ] **Step 5:** Run tests → PASS; `npm run build` succeeds.
- [ ] **Step 6: Commit** `feat: web app shell, avocado theme and icons`

### Task 9: Settings screens

**Files:**
- Create: `frontend/src/components/settings/{SettingsPage,ProfileSettings,SecuritySettings,UsersSettings,AiSettings,LogsSettings}.tsx`
- Test: `frontend/src/components/settings/SettingsPage.test.tsx`, `UsersSettings.test.tsx`

**Interfaces:**
- Consumes: routes from Tasks 3–7.
- Sections: Profile (name, email, units, timezone, theme picker incl. Avocado, light/dark/system), Security (change password, passkeys, signed-in devices, sign-in history), and for admins only: Users, AI services (Culury `AiSettings` as-is), Logs. Copy from Culury's matching components; UsersSettings is new (list, "Add person" form: username, display name, email, password, admin switch; disable/enable; reset password).
- [ ] **Step 1: Write the failing tests:** `"members don't see admin sections"` (user `isAdmin:false` → no "Users", "AI services", "Logs" tabs); `"admin adds a person"` (fill form, submit → `POST /api/admin/users` sent with `{ username: "sam", password: "password123", isAdmin: false }`, new row appears); `"server's last-admin error is shown"` (PATCH answers 409 with the message → text "ByteSize needs at least one admin" visible).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: settings screens`

### Task 10: Production serving, Docker, compose

**Files:**
- Create: `backend/src/web.ts` (from Culury, without share previews), `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `.env.example`
- Modify: `backend/src/index.ts` (call `serveWeb` when `WEB_DIR` set)
- Test: `backend/tests/web.test.ts`

**Interfaces:**
- Dockerfile: Culury's three stages; runtime `node:22-bookworm-slim`, `ENV PORT=4100 DATA_DIR=/app/data WEB_DIR=/app/web`, `EXPOSE 4100`, healthcheck fetching `http://127.0.0.1:4100/health`, `reset-password` script pointed at `dist/cli/reset-password.js`, runs as `node`.
- Compose: services `bytesize` (`image: ${BYTESIZE_IMAGE:-ghcr.io/cwland/bytesize:latest}`, `build: .`, port `${PORT:-4100}:4100`, `./data/app:/app/data`, depends on healthy db) and `db` (`postgres:16-alpine`, `./data/postgres`), env as Culury's (`DATABASE_URL` without password + `PGPASSWORD`).
- `.env.example`: `POSTGRES_USER=bytesize`, `POSTGRES_PASSWORD=change-me`, `POSTGRES_DB=bytesize`, `JWT_SECRET=` (comment: `openssl rand -base64 48`), `PORT=4100`, `TRUST_PROXY`, `PASSKEY_ORIGINS`, `TZ=America/Boise`.
- [ ] **Step 1: Write the failing test** `web.test.ts`: with a temp `WEB_DIR` containing `index.html`, `GET /` and `GET /settings/profile` return that html; `GET /api/nope` is still JSON 404; `GET /health` still JSON.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Verify the image:** `docker buildx build --platform linux/amd64 -t bytesize:local --load .`, then with a `.env` from the example: `docker compose up -d` and `curl -s localhost:4100/health` → `{"ok":true,"db":true,"version":"0.1.0"}`; open `http://localhost:4100` → setup wizard. `docker compose down`.
- [ ] **Step 6: Commit** `feat: docker image and compose`

### Task 11: CI publishing to GHCR

**Files:**
- Create: `.github/workflows/build.yml`

**Interfaces:**
- Copy `Culury:.github/workflows/build.yml` with: Postgres service user/db `bytesize`/`bytesize_test`; image `ghcr.io/${{ github.repository_owner }}/bytesize`; tags `latest` (default branch), semver, short sha; `platforms: linux/amd64`; push only on `main` and `v*` tags; smoke test replaced by: run the loaded image's node and `require('sharp')` resizing a 3000×2000 image to 1600 wide (keeps the M2 photo resize honest).
- [ ] **Step 1:** Write the workflow.
- [ ] **Step 2:** Validate locally: `npx --yes @action-validator/cli .github/workflows/build.yml` → no errors.
- [ ] **Step 3: Commit** `ci: test and publish amd64 image to ghcr`
- [ ] **Step 4:** After Cory pushes, check the Actions run is green and `ghcr.io/cwland/bytesize:latest` exists (package visibility may need to be set to public once in GitHub's package settings).

### Task 12: Milestone check

- [ ] **Step 1:** `npm test` at the root → backend and frontend all pass.
- [ ] **Step 2:** `cd backend && npm run typecheck`, `cd frontend && npm run build` → no errors.
- [ ] **Step 3:** Fresh `docker compose up` walk-through: setup admin → sign out → sign in with password → add a passkey → sign in with it → create user "sam" → sign in as sam in a private window: no Users/AI/Logs sections → admin disables sam → sam's window gets signed out on next action → save an AI service and press Test → Logs shows the test.
- [ ] **Step 4:** Update `README.md` (what ByteSize is, docker compose quick start, reset-password command). Commit `docs: readme for milestone 1`.
