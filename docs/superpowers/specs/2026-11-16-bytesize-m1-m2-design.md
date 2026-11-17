# ByteSize — Milestones 1–2 Design (Scaffold, Food Engine, Daily Log)

Date: 2026-11-16 · Status: approved by Cory 2026-11-16 · Source spec: `ByteSize.md` (project doc)

## 1. Intent and why

ByteSize replaces Weight Watchers for Cory, who is losing weight on a GLP-1. On a GLP-1 the hard part is
eating *enough* protein and fiber and staying hydrated inside a calorie *range* — not just staying under a
cap. The WW app is clunky: custom foods are hard to create, find and edit; wrong barcode data can't be
fixed on the barcode itself; logs on the wrong day/meal must be deleted and re-entered; and there is no
link to his meal planning (Culury).

Milestones 1–2 deliver a self-hosted web app (mobile-first) where he can see his day at a glance and log
food fast, with a food engine that is local-first and correctable.

## 2. Goals, non-goals, anti-goals

**Goals (M1–M2)**
- Daily overview: calorie budget bar + protein / fiber / water rings, all driven by min–max ranges.
- Fast logging: smart meal default by time of day, recents/frequents, barcode lookup, text search.
- Food engine: local cache → Open Food Facts → USDA → AI estimate, with per-user corrections bound to barcodes.
- My Foods: create, search, sort and edit custom foods, recipes and quick meals easily.
- Move/copy any logged item to another day or meal.
- Optional read-only Culury link: meal-plan picker and Culury recipes in search.
- Logging streak.
- Multi-user with strict per-user isolation; accounts created by the admin.
- Docker image (amd64) + compose, `/health`, CI publishing to `ghcr.io/cwland/bytesize:latest`.

**Non-goals (later milestones)**
- GLP-1 medication/dose tracking, injection sites (M3).
- Weight entry, HealthKit ingestion, analytics/correlation charts, badges, goal (TDEE) calculator (M3).
- Email/nag reminders, backups/restore, personal API keys (M4).
- iOS app, live camera barcode scanning (iOS only), on-device label OCR, plate photo AI, basket scan (M5).
- "Save remainder for tomorrow" leftover queue (later; the fraction picker itself is in M2).

**Anti-goals (would be failure even if it "works")**
- Any query that can return another user's foods, logs, overrides, targets or settings.
- Logging a repeat food takes more than ~3 taps from the home screen.
- A database refresh or Culury edit silently changing a past day's logged numbers.
- Calories presented as a target to fill (it is a budget/range).
- Social, sharing or public features.
- Any write to Culury.

## 3. Constraints

- Fresh repo `cwland/ByteSize` (currently LICENSE only). **Culury is read-only reference**: copy/adapt code
  and look-and-feel; never change Culury.
- Stack matches Culury so code ports cleanly: Node 22, TypeScript, Fastify 5, Drizzle ORM, PostgreSQL 16,
  zod, React 18, Vite 6, Tailwind 4, lucide-react, Vitest + Testing Library. Monorepo layout like Culury
  (`backend/`, `frontend/`, root `package.json` with `concurrently`).
- Docker builds **linux/amd64 only**.
- TDD: every feature is built test-first (backend Vitest against a real Postgres test DB via
  `TEST_DATABASE_URL`, frontend Vitest + Testing Library).
- USDA FoodData Central requires a free api.data.gov key; Open Food Facts needs none (must send a
  descriptive User-Agent).
- Single home-lab server behind Nginx Proxy Manager / Traefik.

## 4. Approaches considered

| | Approach | Trade-off | Decision |
|---|---|---|---|
| A | Fresh app, same stack as Culury; port Culury modules (auth, passkeys, sessions, theme/app shell, AI failover, logs; later mail, backup, API keys) when a milestone needs them, adapting each to per-user | Slower first days; clean schema with `user_id` everywhere; no recipe baggage | **Chosen by Cory** |
| B | Fork Culury and strip | Everything works on day one, but Culury is a single shared household (recipes, meal_plan, api_keys have no user column); retrofitting isolation is the riskiest change for data separation | Rejected |
| C | Extract shared package used by both apps | Requires changing Culury (read-only); heavy for a personal app | Rejected |

## 5. Decided by Cory

- Approach A. ByteSize is its own app with its own database; Culury is only called through its API.
- amd64-only Docker builds.
- Personal use, but other people can have accounts **that Cory creates**; each user's data fully separate.
- Home screen modeled on WW's ring screen (screenshot provided): rings front and center, and calories shown
  as a **budget bar at the top** (mockup option C).
- Targets are **ranges**, not caps (e.g. calories 1500–2000, protein 110–130 g).
- Smart default meal by time of day; logging must be fast.
- Custom foods must be easy to create, find (without remembering exact names) and edit.
- Wrong database data must be fixable *on the barcode* so the next scan returns the corrected food.
- Logged items must be movable to another day or meal.
- Likes: streaks / gamification (logging streak now, badges later), weight tracking and HealthKit (later milestones).
- Culury link: when a Culury key is configured, a button while logging looks up the meal plan; pick item + portion.
  Plans are not 1:1 with days (leftovers, cooking early), and any Culury recipe should be searchable even if unplanned.

## 6. Design

### 6.1 Repository layout (mirrors Culury)
```
backend/   Fastify API (src/app.ts, src/index.ts, src/db, src/lib, src/routes, src/cli)
frontend/  React + Vite SPA (src/components, src/api.ts, src/themes.ts …)
docs/superpowers/specs|plans/
Dockerfile, docker-compose.yml, docker-compose.dev.yml, .env.example
.github/workflows/build.yml
logo.jpg (source art for icons)
```
The backend serves the built frontend as static files in production (as Culury does). Default port **4100**
(so it can run beside Culury's 4000). `GET /health` returns `{ ok, db, version }` and checks the DB.

### 6.2 Ported from Culury in M1 (adapted)
| Culury source | ByteSize use | Adaptation |
|---|---|---|
| `lib/auth.ts`, `lib/sessions.ts`, `routes/auth.ts`, `routes/passkeys.ts`, `routes/oauth.ts`, `AuthScreen`, `SignInSettings`, `SecuritySettings` | Password + passkey sign-in, sessions; OAuth optional | **No public registration.** First-run setup wizard creates the admin; admin creates/disables users in Settings › Users. Password reset via CLI (`npm run reset-password`) until mail arrives in M4. |
| `themes.ts`, `index.css`, `ThemePicker`, `AppShell`, `Navigation`, `settingsUi`, `inputs`, `Popup`, `Icons` | Look and feel, light/dark/system, responsive shell | Add an **"Avocado"** theme as default (greens from the logo); dark mode default `system`. |
| `lib/ai.ts`, `lib/aiHelpers.ts`, `AiSettings` | Multi-provider AI with ordered failover (local Ollama → cloud) | Admin-level services (shared by all users); new prompts for nutrition estimation. |
| `lib/appLog.ts`, `routes/logs.ts`, `LogsSettings` | App log + viewer | Admin sees all; a user sees only events tagged with their user id. |
| `lib/secrets.ts` | Encrypt stored secrets (AI keys, USDA key, Culury keys) | as-is |
| `SetupWizard`, `ProfileSettings` | First run + profile | Profile adds units, timezone, targets, meal windows. |

Mail, backup/restore and personal API keys are ported in M4.

### 6.3 Data model (Postgres, Drizzle)

Every user-owned table has `user_id integer not null references users on delete cascade` and an index
leading with `user_id`. All user-data access goes through a repository layer that **requires** a `userId`
argument; route handlers never build user-data queries directly. An isolation test suite creates two users
and asserts every endpoint returns/edits only the caller's rows.

Shared (not user-owned):
- `users` (id, email, name, password_hash, is_admin, disabled, timezone, units `imperial|metric`, theme, mode, created_at)
- `passkeys`, `sessions`, `login_events`, `app_log` (as Culury)
- `app_settings` (key/value: `ai` services, `usda_api_key_enc`, OFF user-agent contact)
- `food_cache` — normalized external results, shared because label data is the same for everyone:
  `id, source ('off'|'usda'), source_id, barcode (nullable, indexed), name, brand, serving_size, serving_unit,
  serving_grams (nullable), nutrients jsonb, raw jsonb, fetched_at`. Unique `(source, source_id)`.

User-owned:
- `user_settings` (user_id PK, culury_url, culury_key_enc, meal_windows jsonb, net_carbs boolean)
- `targets` (user_id, nutrient, min, max, effective_from date) — history kept so past days are judged
  against the targets in force then. Nutrients with targets in M2: calories, protein, fiber, water;
  optional carbs, fat, sodium.
- `user_foods` — everything the user owns that can be logged:
  `id, user_id, kind ('custom'|'override'|'recipe'|'quick_meal'), name, brand, barcode (nullable),
  base_cache_id (nullable → food_cache, for overrides), servings jsonb (list of named servings with grams/ml),
  nutrients jsonb (per base serving), ai_fields text[] (which nutrients are AI-estimated), notes,
  use_count, last_used_at, archived, created_at, updated_at`.
  Unique `(user_id, barcode)` where kind in ('custom','override') and barcode not null.
- `recipe_items` (recipe_id → user_foods, position, food_ref {type:'user_food'|'cache', id}, quantity, unit) and
  `user_foods.servings_per_recipe` for per-serving math. *(Claude's call)* A recipe's per-serving nutrients are
  **stored** on save and recalculated only when the user edits the recipe (or taps "Recalculate"); cache refreshes
  never change a recipe on their own.
  Quick meals use the same table. *(Claude's call)* Logging a quick meal creates **one log entry per item**
  (each with its own snapshot), so items can be adjusted, moved or deleted individually; Recent shows the
  quick meal itself as one tappable row.
- `log_entries` — `id, user_id, day date (user's local date), meal ('breakfast'|'lunch'|'dinner'|'snacks'|'supplements'),
  name, brand, source ('user_food'|'cache'|'culury'|'ai'|'quick'), source_ref text, quantity numeric, unit,
  fraction numeric default 1, per_serving jsonb (**snapshot of the food's per-serving nutrients**),
  servings jsonb (**snapshot of the food's serving definitions**), nutrients jsonb (computed totals for this entry),
  ai_estimated boolean, created_at, updated_at`. Index `(user_id, day)`.
  *(Claude's call)* Editing a portion rescales from the entry's own snapshot and never re-reads the source food,
  so past days never change silently. Move/copy copies the row including snapshots.
  Water is logged as entries in the Supplements/Hydration slot with `nutrients.water_ml`.

Nutrient keys (jsonb, per serving, metric internally): `calories, protein_g, fiber_g, carbs_g, fat_g, sugar_g,
added_sugar_g, sugar_alcohol_g, sodium_mg, potassium_mg, magnesium_mg, water_ml`. Missing = unknown (not 0).
Display converts to the user's units (oz / fl oz / lb for imperial).

### 6.4 Food lookup engine

**Barcode** (`GET /api/foods/barcode/:code`), first hit wins:
1. The caller's `user_foods` with that barcode (custom or override) → tagged "Your edit"/"My food".
2. `food_cache` by barcode (fresh within 30 days).
3. Open Food Facts product API → normalize → upsert cache.
4. USDA FDC branded search by GTIN/UPC → normalize → upsert cache.
5. Not found → offer "Create food for this barcode" (prefilled barcode), with an "Estimate with AI" helper
   from a name/description.
If a found item is missing key nutrients (calories/protein/fiber/carbs/fat), the UI offers "Fill gaps with AI";
filled fields are listed in `ai_fields` and shown with an "AI-estimated" badge.

Barcode normalization: strip non-digits; treat UPC-A (12) and EAN-13 with leading 0 as the same code;
store the 13-digit form.

**Text search** (`GET /api/foods/search?q=`), results grouped in this order:
My Foods (name/brand fuzzy, using Postgres `pg_trgm`) → Culury recipes (if linked) → cache → Open Food Facts
search → USDA search (Foundation/SR Legacy first for whole foods, then Branded). External calls run in parallel
with a timeout (~3 s) so slow sources don't block local results; the UI shows local groups immediately and
streams/appends external groups.

**Correcting a food** ("Edit" on any cache result): creates an `override` user_food copying the cached values
with `base_cache_id` and barcode. Future barcode lookups for that user return the override first. Cache refreshes
update `food_cache` only, never overrides. The override screen shows a "Database values changed since your edit"
note when the cache row's values differ from the copy it was made from (optional nicety; builder's call).

**Units**: mass↔mass and volume↔volume always; mass↔volume only when the food has a serving with both grams
and ml (or a known density). Named servings ("1 scoop", "1 bar") are first-class. Fraction quick-picks:
¼, ⅓, ½, ¾, full.

### 6.5 Culury link (end of M2, optional per user)
- Settings › Integrations: Culury base URL + **read-only** API key (stored encrypted), with a "Test" button
  calling Culury `GET /api/key-check`.
- **Meal-plan picker** in the log flow: `GET {culury}/api/plan?from=day-3&to=day+4`, grouped by day, with
  the item matching the target day+meal on top. Plan recipe ids are fetched for nutrition.
- **Search**: Culury recipes appear as a group in text search (builder confirms the Culury recipe-search
  query parameter from `routes/recipes.ts`).
- Logging a Culury recipe: choose servings or a fraction; nutrients are computed from Culury's per-serving
  nutrition and **snapshotted** into the log entry. If the recipe has no nutrition, offer AI estimate (flagged).
- Logged Culury recipes appear in Recent (by `source_ref = culury:<recipeId>`).
- ByteSize never writes to Culury. Culury failures show a quiet inline "Culury unavailable" and never block logging.

### 6.6 Screens

**Home (Today)** — mobile-first, works on desktop:
- Day strip (scrollable, today highlighted) — tap to switch day.
- Calorie **budget bar**: shaded target band (min–max); gray below min, green in range, amber above max;
  text "362 to go" / "In range" / "180 over".
- Rings: protein, fiber, water. A ring is full at the range **minimum**; past max shows a small "over" tick
  (no alarm). Values like "97 / 110–130 g".
- Buttons: **Photo** (upload a photo — see 6.6a), **+ {Meal}** (smart default), **Food log**.
  Live camera barcode scanning is **iOS-app only (M5)**; the web app never opens a live camera scanner.
  A barcode number can always be typed in the add-food search box.
- Quick water buttons (+8 oz / +16 oz, configurable).
- Logging streak (consecutive days with ≥1 food entry, counting today once it has an entry; days in a
  future Vacation mode won't break it — M3).

**6.6a Photo upload (barcode or nutrition label)** — decided by Cory: no live scanning on web, but upload a photo.
- One "Photo" action accepts an image from the device (on iPhone this offers the photo library or camera
  capture via the standard file input — this is a still photo, not a live scanner).
- The server first tries to **decode a barcode** from the image (a server-side decoder library, e.g. a zxing
  port — builder's choice). If one is found → normal barcode lookup (6.4).
- If no barcode is found, or the user chose "Nutrition label", the image goes to an AI service that supports
  photos (Culury's AI services carry a `photos` flag) to **extract** name, brand, serving size, and nutrients.
  The result opens prefilled in the New food / Edit food screen for review — nothing is saved without the
  user confirming. Extracted fields are flagged AI-estimated until the user saves them.
- A barcode photo and a label photo can be combined: if both are provided, the saved food is bound to the
  barcode (custom food, or an override if the barcode already exists in the cache), so future lookups return it.
- *(Claude's call)* Uploaded images are stored per user under `data/app/uploads/<user_id>/` (included in backups
  in M4), resized to a max of ~1600 px, and linked from the food they created.
- If no photo-capable AI service is configured, label extraction is hidden and only barcode decoding works.

**Smart meal default**: per-user `meal_windows` (defaults: breakfast until 10:30, lunch until 14:30,
snacks until 17:00, dinner until 21:00, snacks after). Uses the user's timezone. Always changeable in the flow.

**Add food flow** (one sheet): search box focused, tabs/sections Recent · Frequent · My Foods · Meal plan
(if Culury) · results. Tap an item → portion sheet (servings, unit, fraction chips) → Log. Long-press/⋯ on a
recent item → "Log again" in one tap.

**Food log (day view)**: entries grouped by meal with per-meal totals. Each entry: edit portion, **Move to…**
(date + meal picker), **Copy to…**, delete. Multi-select to move/copy several. "Copy yesterday's breakfast".

**My Foods**: one searchable list of custom foods, overrides, recipes and quick meals; filter chips by kind;
sort by Recent / Most used / A–Z; tap → edit screen. "New food" (manual entry, optional barcode, "Estimate with
AI"), "New recipe" (add ingredients via the same search, servings count → per-serving totals), "New quick meal".

**Settings**: Profile (units, timezone, theme), Targets (ranges), Meal times, Integrations (Culury),
Security (password, passkeys, sessions); admin-only: Users, AI services, Food sources (USDA key), Logs.

### 6.7 API (all JSON under `/api`, session cookie auth; per-user scoped)
- `auth/*`, `passkeys/*` (ported)
- `GET /api/day/:date` → entries, totals, targets in force, streak
- `POST /api/log`, `PATCH /api/log/:id`, `DELETE /api/log/:id`, `POST /api/log/move` (ids, day, meal, copy?)
- `GET /api/foods/search`, `GET /api/foods/barcode/:code`, `GET /api/foods/recent`, `GET /api/foods/frequent`
- `GET|POST|PATCH|DELETE /api/my-foods[/:id]`, `POST /api/my-foods/:id/override-from-cache`
- `POST /api/ai/estimate` (text → nutrients), `POST /api/ai/fill-gaps`
- `POST /api/photos/analyze` (multipart image + mode `auto|barcode|label`) → `{ barcode?, lookup?, extracted? }`
- `GET|PUT /api/targets`, `GET|PUT /api/settings/me`
- `GET /api/culury/plan`, `GET /api/culury/search`, `GET /api/culury/recipe/:id`, `POST /api/culury/test`
- Admin: `GET|POST|PATCH /api/admin/users`, `GET|PUT /api/admin/settings`, `GET /api/logs`
- `GET /health`

### 6.8 Errors and resilience
- External sources (OFF, USDA, AI, Culury) each have timeouts and are logged to `app_log` with the source;
  failure of one never fails the request — results from the others still return.
- AI calls use the failover chain from the ported AI service.
- Validation with zod on every route; errors use Culury's `HttpError` style and friendly copy.

### 6.9 Deployment and CI
- Multi-stage `Dockerfile` (build frontend + backend, run on `node:22-alpine`), runs migrations on start.
- `docker-compose.yml`: `bytesize` + `postgres:16-alpine`, `./data/app` and `./data/postgres` volumes,
  healthchecks, `.env.example` (POSTGRES_*, SESSION/JWT secret, PORT=4100, PUBLIC_URL for passkeys).
- `.github/workflows/build.yml` **in M1** (moved up from M4 so every push is tested): on every push run backend
  + frontend tests against a Postgres service; on `main` build **linux/amd64** and push
  `ghcr.io/cwland/bytesize:latest` (and `:vX.Y.Z` on tags).
- Branding: favicon, PWA manifest and app icons generated from `logo.jpg` (8-bit avocado). The file lives in
  Cory's local ByteSize folder and is committed to the repo root in M1.
- Home layout reference (mockup option C): day strip; calorie bar with range band and "N to go" text; three
  concentric rings (protein outer, fiber middle, water inner) with value labels; three buttons
  (Photo · + {Meal} · Food log); streak strip. Dark navy surfaces in the WW reference; ByteSize uses the Avocado theme.

### 6.10 Milestone breakdown
**M1 — Scaffold**: repo layout, tooling, DB + migrations, `/health`, Docker/compose, CI, ported auth
(setup wizard, admin-created users, passwords, passkeys, sessions), theme/app shell with Avocado theme and
logo, AI service + settings, app log, settings shell, user isolation test harness.

**M2 — Food engine and daily log**: nutrient model and units, targets (ranges), food cache + OFF + USDA +
AI estimate/gap-fill, overrides bound to barcodes, My Foods (custom/recipe/quick meal), Home screen (budget
bar, rings, smart meal button, water quick-add, streak), add-food flow, day log with move/copy, net-carbs
toggle, typed barcode lookup, photo upload (barcode decode + AI label extraction), then the Culury link.

## 7. Left to the builder
- Exact component structure, file names inside the layout above, and migration ordering.
- OFF/USDA field mapping details and normalization code.
- Fuzzy-search tuning (`pg_trgm` thresholds) and ranking within groups.
- Exact ring/bar styling within the Avocado theme, matching mockup option C.
- Whether OAuth providers are wired in M1 or left disabled until needed (passwords + passkeys are required).
- Mapping Culury custom meal-plan slots (e.g. "second-breakfast") onto ByteSize's five meals.
