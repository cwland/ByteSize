# ByteSize M4a — Backups, restore, Download my data — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A daily whole-server backup with admin-only restore, and a per-person "Download my data" zip.

**Architecture:** The app writes its own backup, like Culury (`/home/claude/ref/Culury/backend/src/lib/backup.ts` is a read-only reference; never change that repo): a `.tar.gz` with `bytesize.json` (every table's rows) and `uploads/`. Restore runs in one transaction. A separate per-user export builds a zip of CSVs + JSON + that person's photos. Settings › Data is the UI.

**Tech Stack:** Fastify 5, Drizzle, Postgres 16, zod, Vitest (real test DB) · React 18, Vite, Tailwind 4, Vitest + Testing Library (`src/test/fakeServer.ts`, `renderWithSession.tsx`, `src/test/fixtures.ts`). New backend dependencies allowed: `tar` and one small zip writer (e.g. `fflate`). No others.

**Spec:** `docs/superpowers/specs/2026-11-16-bytesize-m1-m2-design.md` §15 (project-wide rules in the earlier sections).

## Global Constraints

- Only an admin (`requireAdmin`) can list, make, download, delete or restore backups. `GET /api/export` returns only the caller's own data (`requireUser`); never another person's rows or photos, never password hashes, passkeys, sessions or any secret.
- Secrets in a backup stay exactly as stored (encrypted); nothing decrypted is ever written to a file, a log line or a response.
- Unknown nutrients stay absent/blank, never 0 (CSV cells blank).
- Time comes from `app.now()`; files live under `app.dataDir` (`backups/`, `uploads/`). Tests use the temp data dir the test app already gets.
- Backup names match `^bytesize-\d{4}-\d{2}-\d{2}-\d{6}(-[a-z-]+)?\.tar\.gz$`; any name from a request is checked against it before touching the disk.
- Every backup, restore, delete and export writes an activity-log line (`logEvent`, category `schedule` for the daily one, `api` for the rest) with who and what; never file contents.
- Wording is plain English for a non-technical reader; errors say what to do next.
- Follow the neighbouring code and test style; do not run prettier; TDD (test first, watch it fail); never commit anything under `.superpowers` or `.worktrees`.
- Commit trailer: `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01USvJpJf39Kr8xnLNCPjdCH`.

## Review Focus

1. A hostile restore file (paths with `..`, absolute paths, symlinks/hard links, device entries, a huge `bytesize.json`, entries outside `bytesize.json` and `uploads/<digits>/<name>`) writes nothing outside the data folder and is refused or ignored cleanly.
2. A restore that fails part-way (a bad row, a newer `schema`, garbage JSON, not a gzip) leaves the database and the photos exactly as they were; a failure after the database commit while swapping photos is logged and doesn't lose the old photos (they're in the safety backup).
3. A backup taken while people are logging is a consistent snapshot (all tables read in one repeatable-read transaction) and round-trips every column type (timestamps, numerics, jsonb, booleans, nulls) exactly.
4. Export isolation: with two people, A's zip holds none of B's rows or photos; CSV cells with commas, quotes, newlines, and ones starting with `= + - @` are escaped so a spreadsheet won't run them.
5. A backup name from the URL/body can't reach other files (`../`, encoded slashes); two backups/restores at once → the second gets 409; a backup made on an older schema restores (missing columns take defaults), a newer one is refused before anything is emptied.

---

### Task A: Backup, restore and the daily schedule (backend)

**Files:**
- Create: `backend/src/lib/backup.ts`, `backend/src/routes/backups.ts`, `backend/tests/backup.test.ts`
- Modify: `backend/src/app.ts` (register routes, start the schedule), `backend/package.json` (+`tar`), `.env.example`, `docker-compose.yml` only if an env needs passing, `README.md` ("Backups" section), `backend/tests/deploy-config.test.ts` if it lists env names

**Interfaces — Produces:**
- `BACKUP_NAME: RegExp`; `SKIP_TABLES = ["sessions", "restaurant_searches"]` plus the restaurant points counter row (it lives in `app_settings`; skip that key only).
- `writeBackup(app, label?: string): Promise<{ name: string; size: number; createdAt: string; photos: number }>` — `bytesize-YYYY-MM-DD-HHMMSS[-label].tar.gz` in `<dataDir>/backups`, written to `.<name>.tmp` then renamed.
- `listBackups(app): Promise<{ name; size; createdAt }[]>` newest first; `pruneBackups(app, keep)`.
- `restoreBackup(app, file: string, by: { userId: number }): Promise<{ schema: number; users: number; photos: number }>` — validates fully first, writes a `before-restore` safety backup, then one transaction: empty every backed-up table, insert rows (tables in foreign-key order from the Drizzle schema; columns matched by name), reset id sequences to max(id); deletes all sessions; after commit swaps `uploads/` (old folder moved aside, removed on success).
- `unreadableKeys(app): Promise<string[]>` — plain labels ("OpenAI key", "USDA key", "Spoonacular key", "FatSecret secret", "Cory's Culury key" → for per-user keys use "Culury key for <name>") of saved secrets `decryptSecret` can't open with the current `JWT_SECRET`.
- `scheduleBackups(app)` — hourly check: when the local hour ≥ `BACKUP_HOUR` (default 3) and no un-labelled backup exists since today's `BACKUP_HOUR`, write one and prune to `BACKUP_KEEP` (default 14). `BACKUP_KEEP=0` turns the daily backup off.
- A module-level lock: a backup or restore while another runs throws an error the routes turn into 409 `{ error: "A backup is already running." }`.
- `bytesize.json`: `{ app: "bytesize", format: 1, schema: <rows in drizzle's migrations table>, createdAt, tables: { <sql table name>: rows[] } }`.

**Routes (all `requireAdmin`):**
- `GET /api/admin/backups` → `{ backups: [{ name, size, createdAt }], keep: number, unreadableKeys: string[] }`
- `POST /api/admin/backups` → `{ backup: { name, size, createdAt } }`
- `GET /api/admin/backups/:name` → the file (`application/gzip`, attachment); 404 for an unknown or non-matching name
- `DELETE /api/admin/backups/:name` → `{ ok: true }`
- `POST /api/admin/backups/restore` — JSON `{ name, confirm }` or multipart (`file`, `confirm`), `confirm` must be exactly `RESTORE` (else 400 "Type RESTORE to confirm."). Uploads stream to a temp file (limit 1 GB) — never held in memory. → `{ restored: { schema, users, photos }, unreadableKeys: string[] }`. Errors: 400 "That isn't a ByteSize backup.", 400 "This backup is from a newer ByteSize. Update first.", 409 as above.

- [ ] **Step 1: Failing tests** in `backend/tests/backup.test.ts` (use the helpers other route tests use; seed through the API where practical):
  - `round trip`: seed two people with profile/body/targets, a custom food with a photo upload, a recipe with items, log entries (some nutrients unknown), weigh-ins, shots + side effects, a vacation, a restaurant favourite, AI + food-source keys, a Culury link; snapshot every backed-up table (`select * order by 1`) → `POST backups` → change and delete data and a photo → restore by name → every table equals the snapshot, the photo file is back, new ids don't collide (insert one more log entry succeeds), the admin's old token now gets 401, and a `-before-restore` backup exists.
  - `every table is backed up or skipped on purpose`: the set of tables in the Drizzle schema equals backed-up ∪ `SKIP_TABLES`.
  - `not admin`: a member gets 403 on all five routes.
  - `confirm`: restore without `RESTORE` → 400, nothing changed.
  - `bad files`: plain text, a gzip that isn't a tar, a tar without `bytesize.json`, JSON with `app: "other"`, `schema` higher than the server → 400 with the right message and the tables + photos unchanged (compare snapshots), no safety backup left behind for a file refused at validation.
  - `hostile archive`: a tar built in the test with `../evil.txt`, `/abs.txt`, `uploads/1/../../evil.txt`, a symlink entry and `uploads/1/ok.jpg` → restore succeeds for the valid parts; no file exists outside `dataDir`; only `ok.jpg` lands.
  - `failure mid-restore`: a backup whose JSON has a row violating a constraint → 400/500 with a plain message; tables and photos unchanged.
  - `older schema`: a backup JSON with a lower `schema` and one column missing from `users` rows (e.g. the week-start column) → restores; that column holds its default.
  - `names`: `GET/DELETE /api/admin/backups/..%2F..%2F.env` and a name not matching → 404; restore `{ name: "../x" }` → 400.
  - `lock`: two `POST backups` at once → one 200, one 409.
  - `schedule` (drive the check function directly with the app clock): before `BACKUP_HOUR` nothing; after it one backup; a second check the same day none; the next day another; with 15 existing, the oldest is pruned to keep 14; a `-before-restore` one doesn't count as today's.
  - `unreadableKeys`: with a secret row encrypted under another `JWT_SECRET`, the list names it; with good keys it's empty.
  - `activity log`: backup, delete, restore each add a line naming the admin and the file.
- [ ] **Step 2:** Run `npx vitest run tests/backup.test.ts` — Expected: FAIL (module/routes missing).
- [ ] **Step 3:** Implement `lib/backup.ts` and `routes/backups.ts` to the interfaces above. Reading: all tables inside one `REPEATABLE READ` read-only transaction. Extraction: `tar.x` with `strict` and a filter that keeps only regular files named `bytesize.json` or `uploads/<digits>/<safe name>`; cap `bytesize.json` at 200 MB. Rows are inserted with their original ids in batches.
- [ ] **Step 4:** Register in `app.ts` (`app.register(backupRoutes)`; `scheduleBackups(app)` next to the other schedules, not started in tests unless asked — follow how `scheduleUploadCleanup` behaves under test). Add `BACKUP_KEEP`, `BACKUP_HOUR` to `.env.example` with one-line comments; README "Backups" section (where the files are, restore on a fresh server: start ByteSize, create the first admin, Settings › Data › Restore from a file; keep the same `JWT_SECRET` or re-enter keys).
- [ ] **Step 5:** `npm test` (whole backend suite) and `npx tsc -p tsconfig.test.json` — Expected: all pass, no type errors.
- [ ] **Step 6:** Commit `feat: daily backups and admin restore`.

### Task B: Download my data (backend)

**Files:**
- Create: `backend/src/lib/exportData.ts`, `backend/src/routes/export.ts`, `backend/tests/export.test.ts`
- Modify: `backend/src/app.ts` (register), `backend/package.json` (+ the zip writer), `backend/tests/isolation.test.ts` (one case)

**Interfaces — Produces:**
- `GET /api/export` (`requireUser`) → `application/zip`, `Content-Disposition: attachment; filename="bytesize-<name slug>-<YYYY-MM-DD>.zip"` (the day in the person's time zone, `todayFor`). Rate limit 5/hour per person.
- Zip contents: `food-log.csv`, `weigh-ins.csv`, `shots.csv`, `side-effects.csv`, `my-foods.csv`, `bytesize-export.json`, `photos/<file>`.
  - `food-log.csv` columns: `Day, Meal, Food, Brand, Amount, Calories, Protein (g), Carbs (g), Fat (g), Fiber (g), Sugar (g), Sodium (mg), AI estimated` — from each entry's own snapshot; blank when unknown. Use the nutrient keys the log snapshot actually has; keep this column order and add any further tracked nutrients after Sodium.
  - `weigh-ins.csv`: `Day, Weight (kg), Weight (lb), Note` (only the columns the table has). `shots.csv`: `Day, Medication, Dose, Site, Note`. `side-effects.csv`: `Day, Effect, Severity, Note`. `my-foods.csv`: `Name, Brand, Kind, Serving, Calories, Protein (g), Carbs (g), Fat (g), Fiber (g)`.
  - `bytesize-export.json`: `{ app: "bytesize", format: 1, exportedAt, user: { name, email, timezone, units }, … }` with every table that has a `user_id`, filtered to this person, minus `sessions`, `passkeys`, `login_events`, and with no `password_hash`, encrypted key or token fields (the Culury link exports as `{ url }` only).
- `toCsv(rows: (string | number | null | undefined)[][]): string` — RFC 4180 quoting, `\r\n` lines, a leading `'` added to cells starting with `=`, `+`, `-`, `@`, tab or CR when the cell is text (numbers are left as numbers).

- [ ] **Step 1: Failing tests** in `backend/tests/export.test.ts` (unzip the response in the test with the same library):
  - contents: after seeding (as Task A's round trip, single person) the zip has exactly the seven kinds of entries; `food-log.csv` has one line per entry in day order with the header above; an entry with unknown protein has an empty cell, not 0.
  - `toCsv`: commas, quotes, newlines quoted; `=SUM(A1)` and `@cmd` get the leading `'`; `-5` as a number stays `-5`.
  - json: holds the person's rows from every `user_id` table (assert the table list against the Drizzle schema minus the excluded ones, so a new per-user table can't be forgotten) and no key named like `password`, `hash`, `apiKey`, `secret`, `token`.
  - photos: the person's uploaded photo is in `photos/`.
  - signed-out → 401; activity-log line written.
  - in `isolation.test.ts`: A's export contains none of B's food names, weigh-ins, or photo ids; B's Culury address is absent.
- [ ] **Step 2:** Run `npx vitest run tests/export.test.ts` — Expected: FAIL.
- [ ] **Step 3:** Implement `lib/exportData.ts` (`buildExport(app, userId)` returning the zip as a stream or Buffer) and `routes/export.ts`.
- [ ] **Step 4:** `npm test`, `npx tsc -p tsconfig.test.json` — Expected: pass.
- [ ] **Step 5:** Commit `feat: Download my data`.

### Task C: Settings › Data (frontend)

**Files:**
- Create: `frontend/src/components/settings/DataSettings.tsx`, `DataSettings.test.tsx`
- Modify: `frontend/src/components/settings/SettingsPage.tsx` (a "Data" tab for everyone, hint "Your data and backups" for admins / "Download your data" otherwise — one tab, `admin: false`), `frontend/src/types.ts`, `frontend/src/api.ts` (helpers for an authenticated file download and a multipart upload if none exist), `frontend/src/test/fixtures.ts`

**Interfaces — Consumes** (exact shapes from Tasks A and B): `GET /api/admin/backups` → `{ backups: { name: string; size: number; createdAt: string }[]; keep: number; unreadableKeys: string[] }`; `POST /api/admin/backups` → `{ backup }`; `GET /api/admin/backups/:name` (file); `DELETE /api/admin/backups/:name`; `POST /api/admin/backups/restore` (JSON `{ name, confirm }` or multipart `file` + `confirm`) → `{ restored: { schema, users, photos }, unreadableKeys }`; `GET /api/export` (zip). Errors arrive as `{ error: string }` with 400/409.

**Behaviour:**
- Everyone: a "Your data" card — "Download my data" button (authenticated fetch → blob → saved with the server's file name), with one line: "A zip with your food log, weigh-ins, shots and foods as spreadsheets, plus everything else in one file." While it works: "Preparing…"; errors in a Notice.
- Admin only (members never call `/api/admin/backups`): a "Backups" card — "ByteSize backs up everything each night and keeps the newest {keep}." · **Back up now** · the list (date and time in the person's time zone, size as "2.4 MB", a "before restore" tag for safety backups) with Download, Restore, Delete per row · "Restore from a file" (a file input accepting `.tar.gz`). Empty list: "No backups yet."
- Delete asks "Delete this backup?" inline (no browser confirm dialogs).
- Restore opens a confirmation panel: "Restoring replaces everything on this server — every person's data — with this backup. A safety backup is saved first. Everyone will need to sign in again." with a text box "Type RESTORE to confirm" — the Restore button is disabled until the box holds exactly `RESTORE`. While it runs: "Restoring…" and all buttons disabled. On success: "Restored. Sign in again to continue." with a **Sign in** button that clears the session (use the app's existing sign-out/session reset); if `unreadableKeys` is non-empty also list them: "These saved keys couldn't be read with this server's secret and need entering again: …".
- When `GET backups` returns `unreadableKeys`, show the same warning at the top of the Backups card.
- A 409 shows the server's message.

- [ ] **Step 1: Failing tests** in `DataSettings.test.tsx`: member sees only "Your data" and no request to `/api/admin/backups`; admin sees the list newest first with sizes and the before-restore tag; Back up now posts and the new one appears; Delete needs the inline confirm then sends DELETE; Restore button disabled until `RESTORE` typed (not `restore`), then posts `{ name, confirm: "RESTORE" }` and shows the sign-in message; restore from a file sends multipart with `confirm`; unreadable keys warning renders from both responses; a 409 message is shown; Download my data requests `/api/export`. In `SettingsPage.test.tsx`: the Data tab shows for members and admins.
- [ ] **Step 2:** Run `npx vitest run src/components/settings/DataSettings.test.tsx` — Expected: FAIL.
- [ ] **Step 3:** Implement to the behaviour above, using the existing settings cards, buttons, `Notice` and form styles (look at `FoodSourcesSettings.tsx` and `UsersSettings.tsx`).
- [ ] **Step 4:** `npm test`, `npx tsc --noEmit -p .`, `npm run build` — Expected: pass.
- [ ] **Step 5:** Commit `feat: Settings › Data — backups, restore, Download my data`.
