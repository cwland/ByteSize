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

## 8. Backlog (not scheduled)
- **Restaurant menus (US chains)** — requested by Cory 2026-11-16. Search restaurant items by chain and log them.
  Candidate sources to evaluate: Nutritionix API (restaurant/branded items, paid tiers), MenuStat (NYC Health's
  free dataset of top US chains, but the public download looks dated — verify freshness), USDA FDC branded/restaurant
  foods (already integrated), and AI estimation for local restaurants not in any database. Fits as another source
  in the 6.4 search waterfall with results cached in `food_cache`.
- **iPhone: unknown barcode → scan the label** — requested by Cory 2026-11-17, for the iOS app (M5). When a scanned
  barcode isn't found anywhere, offer "Add it": photograph the Nutrition Facts panel, read it (AI vision / on-device
  text recognition), and create the food with that barcode filled in. The food is saved as the person's own, so the
  next scan of that barcode finds it instantly — kept on the phone for offline use and synced to their account.

## 9. Addendum 2026-11-16 — Lose It! look and plans (decided by Cory)

Supersedes the visual parts of 6.6 and the "goal calculator (M3)" non-goal.

**Look and feel (Lose It!):** dark mode default (near-black page, charcoal rounded cards), light mode kept. Orange accent
for actions (Add Food, Select, floating **+**), green for "under / in range". Top bar: ‹ date › with calendar and avatar.
Bottom tab bar: Dashboard · Log · Goals · (later tabs) with a floating orange **+** to log. *(Claude's call)* Avocado green
stays the brand/logo color; orange is the action color, as in Lose It!. Lose It! artwork is not copied.

**Today card — option B (Cory):** "Budget: min–max cals" with a semicircle calorie gauge (Food left, Exercise right,
remaining in the middle; green in range, amber over), and **rings kept** for protein, fiber and water beneath it.
Replaces the calorie bar of 6.6 option C.

**Log screen:** meal cards (Breakfast/Lunch/Dinner/Snacks) with "N calories suggested", items with a small icon,
calories on the right, a one-line macro summary, and an Add Food button. "Done logging" switch with streak.
Health cards: Weight, Water (tap glasses), GLP-1, Sleep (later milestones fill these).

**Goals screen:** weight chart with projection to goal, Journey milestones, "Set another goal" categories (M3 analytics).

**Food icons (M2):** every food has a category with an icon. Category from Open Food Facts tags / USDA food group /
AI on save; user can change it. Start with an openly licensed emoji-style set (Twemoji or OpenMoji); 8-bit pixel food
icons matching the logo are a later upgrade (could be generated on Cory's ComfyUI). Packaged foods may show the OFF
product thumbnail.

**Weight-loss plan picker (moved into M2, Cory):** first run (and Goals › Plan) asks height, current weight, goal weight,
age, sex, activity level, on a GLP-1 (yes/no). Mifflin-St Jeor BMR × activity = TDEE. Four plans, swipeable cards:
Relaxed ½ lb/wk (TDEE−250), Steady 1 lb/wk (−500), Accelerated 1½ lb/wk (−750), Vigorous 2 lb/wk (−1000); each shows
cal/day, lb/week, weeks to goal. **GLP-1-aware recommendation (Cory, 2026-11-16 23:20):** recommend Steady; on a
GLP-1 never recommend faster than Accelerated. Never recommend a plan below max(1,200 cal, 0.65 × TDEE); such plans are
tagged "Not recommended". If Steady is below that floor, recommend the fastest plan at or above it. The chosen plan sets targets: calories range = plan ± 150 (editable), protein floor 0.7 g/lb of goal weight
(range to 1.0 g/lb), fiber 25–38 g, water 64 oz+. AI writes a one-to-two-sentence explanation of the recommendation and
can suggest re-planning as weight changes.

**More decisions (Cory, 2026-11-16 23:20):**
- Exercise calories are shown on the Dashboard but do **not** raise the calorie budget.
- Protein target from **goal weight**: floor 0.7 g/lb, top 1.0 g/lb.
- Milestone 2 is split: **2a** = plan picker, food engine, Dashboard, Log; **2b** = My Foods polish (recipes, quick meals),
  photo upload, Culury link. 2a is built unattended overnight and, when all tests and the final review pass, merged to main
  and pushed.

## 10. Addendum 2026-11-17 — feedback round after using 2a (decided by Cory)

**Plans:** ask a full **birthdate** (exact age; future date projections). Activity question becomes "How active is your day,
not counting workouts?" — mostly sitting ×1.2 · on your feet some of the day or a daily walk ×1.3 · on your feet most of the
day ×1.4 · physical job ×1.5 (Cory: desk + 1–2 mile daily walk = ×1.3). Existing bodies are asked to review once.
Each plan has its own ranges, shown on its card and set as targets when selected: calories plan ±50; protein per lb of goal
weight — relaxed 0.8–0.9, steady 0.9–1.0, accelerated 0.95–1.05, vigorous 1.0–1.1; fiber — relaxed/steady 30–35 g,
accelerated 28–32 g, vigorous 25–30 g; water unchanged. Cards carry "Best for" lines (relaxed: easing into a new dose,
minimal side effects, strength gains; steady: the sweet spot — sustainable loss, high energy, no muscle loss; accelerated:
strong appetite suppression when eating more feels forced; vigorous: fastest loss, hardest to sustain). Plan cards are a
carousel where neighbours peek in (dots under it); all four side by side on wide screens. Goals has "Edit my details".

**Logging (Weight Watchers-inspired):** entry rows show the amount first then the unit ("4 fl oz", "2 slices"). Add Food
sheet: meal name at the very top as a dropdown (changes the meal), date under it, search with a barcode button;
"Same as yesterday?" (yesterday's same meal, one + logs all) and "Recently tracked" for that meal type; a quick-add + on
recents, yesterday and search results — tap logs, shows ✓ briefly, back to + for another. Rows show coloured pills for
calories, protein and fiber (ring colours). Tapping a food opens a "Track food" detail sheet: summary (calories, protein,
fiber), Serving row (whole number + fraction + unit picker), nutritional insights, full nutrition facts, big Track button.
Liquids offer ml, fl oz, cups with fractions, tbsp, tsp; a drink known only in grams uses 1 g ≈ 1 ml, marked approximate.
Saturated fat is tracked.

## 11. Addendum 2026-11-17 — round 2b-2: week strip, AI services, food search (decided by Cory)

Already shipped on main the same morning (small fixes from Cory's testing): Add Food list scrolls on its own; quick add
✓ in dev, shown 2 s; log entries keep the food's photo; emoji from the name before the category; sheets scroll inside
so corners stay rounded; changing the unit keeps the number; drinks measured in grams start in fl oz (metric: ml).

**Why:** fewer taps to move between days, an AI setup a non-technical person can finish, and search that finds plain
foods even when misspelled.

**A. Week strip (Dashboard and Log).** Replaces the date with ‹ ›. Seven day buttons (weekday letter + date number),
selected day filled, today marked, a dot under each day with at least one food entry. Scrolls sideways (wheel, trackpad,
swipe) through earlier/later weeks; ‹ › at the ends move a week. Entering the Dashboard or Log always selects today.
New per-account setting "Week starts on" (Settings › Profile), default Sunday, any day allowed. Dots come from a new
read-only `GET /api/days/logged?from=&to=` (days with entries, the caller's only). Water-only days get no dot.
- Approaches: (1) strip of weeks, scroll-snapped per week — chosen; (2) endless day list — hard to page by week;
  (3) month calendar pop-up — more taps, not what Cory described.

**B. AI services.** "Validate" replaces "Find models": checks the key and loads the model list in one call, saying
"Key works · N models" or why not. Model becomes a dropdown: "Recommended" group on top, the rest A–Z; when no model is
set the first recommended one is picked. Recommendation is by family, newest version first, so it keeps working as
names change: Claude — Haiku (fast, reads photos, main pick), then Sonnet; OpenAI — newest "mini", then the newest
flagship; Gemini — newest "Flash", then "Pro"; OpenRouter — the same families by provider prefix; Home AI — no
recommendation (A–Z only). Each service collapses (▸/▾); saved services start collapsed, new ones open; collapsed shows
name + model. Order is set by dragging a ⠿ handle (mouse or touch); the ↑↓ buttons go; arrow keys on a focused handle
move it.
- Approaches: (1) family rules — chosen; (2) a fixed list of model names — stale within months; (3) ask the AI to
  pick — slow, circular.

**C. Food search.** Typos forgiven for saved foods too (pg_trgm, like your own foods). Plain whole foods come first:
USDA Foundation / SR Legacy results are asked for separately from Branded and shown as a "Basic foods" group above the
branded groups; inside each group, names starting with the search words come first. When a search finds little and a
close spelling is known from saved foods, show "Did you mean banana?" (tap re-searches).
- Approaches: (1) ranking + separate basic-foods call — chosen; (2) seeding a fixed list of whole foods — stale, large;
  (3) spell-check library — heavy, misses food words.

**Builder's calls:** strip shows one week per screen width (scroll-snap); dot colour = primary; the week-start setting
lives in user_settings (`week_start` 0–6); "Did you mean" only when fewer than 3 results; the recommendation lists at
most 2 models per provider.

## 12. Addendum 2026-11-17 — round 2b-3: photo upload, recipes, quick meals, My Foods (decided by Cory)

**Why:** the fastest possible logging — read a label once instead of typing it, and log regular meals and home
cooking in one tap. Recipes made in Culury will come through the later Culury link; ByteSize recipes cover the rest.

**A. Photo (barcode or nutrition label)** — implements 6.6a.
- Where: a camera button beside the barcode button in Add Food, and a **Photo** button on the Dashboard (opens Add
  Food on the photo step for the smart-default meal). Uses a plain file input (`accept="image/*"`), so an iPhone
  offers camera or library; no live scanner on web.
- `POST /api/photos/analyze` (multipart: up to 2 images, field `mode` = `auto|barcode|label`) →
  `{ barcode?: string, food?: FoodResult, draft?: FoodDraft, errors: SourceError[] }`.
  1. Each image is normalised with sharp (auto-rotate, max 1600 px, JPEG) before anything else.
  2. Barcode: decoded **on the server** (zxing-wasm; approaches: server decoder — chosen; browser
     BarcodeDetector — no iPhone Safari support; AI reading digits — misreads digits). A found barcode goes
     through the normal barcode lookup (6.4); found → `food`, the same as a typed barcode.
  3. Label: when no barcode food was found (or mode = label), the image goes to the first AI service with
     photos on (task "photo"), which returns name, brand, serving size (label + grams/ml) and nutrients per
     serving as JSON. Result → `draft`, all fields marked AI-estimated, opened in the New food form for review.
     Nothing is saved without the user tapping Save.
  4. Barcode + label together: the draft carries the barcode, so the saved food is bound to it (custom, or an
     override when the barcode is already in the cache) and future lookups return it.
- No photo-capable AI service: label reading is hidden ("Add an AI service that reads photos to read labels"),
  barcode decoding still works.
- Images: limit 12 MB each upload; the normalised copy is kept per user under `data/app/uploads/<user_id>/`
  and linked from the food it created (`user_foods.image_path`); served only to its owner. Unused uploads
  (no food saved) are deleted after 24 h.

**B. Recipes**
- A recipe = name, ingredients (picked with the normal food search, each with an amount), **number of
  servings**, **weight of one serving** (g; optional), notes. Example: chili, 6 servings of 350 g.
- Per-serving nutrients = sum of ingredients ÷ servings, **stored on save** (recalculated only when edited or
  "Recalculate" is tapped). Unknown ingredient nutrients make the recipe's total unknown for that nutrient.
- Logging: servings = [{ "1 serving (350 g)", grams 350 }] (+ "100 g" base when the weight is known), so the
  amount picker logs 1 serving and switching to g lets the person type 300 — nutrients update as they type.
- Stored as `user_foods.kind = 'recipe'` + `recipe_items` (6.3).

**C. Quick meals**
- A named group of foods with amounts. Made from scratch in My Foods, or from a logged meal: "Save as a meal"
  on the meal card (takes that meal's entries and portions).
- Appears in Add Food search and Recently tracked as one row with total pills; quick add logs **one entry per
  item** (each snapshotted, so each can be adjusted, moved or deleted); tapping opens it to adjust items first.
- Stored as `user_foods.kind = 'quick_meal'` + `recipe_items` (servings count 1).

**D. My Foods** (Settings-free screen, reached from the Log page and Add Food)
- One searchable list of the person's custom foods, corrections (overrides), recipes and quick meals; filter
  chips All · Foods · Recipes · Meals; sort Recent · Most used · A–Z; tap → edit; buttons New food, New recipe,
  New quick meal; archive (hide) instead of delete when it has been logged.

**Approaches (storage):** (1) one `user_foods` table with kinds + `recipe_items` — chosen (spec 6.3; search,
recents and logging already work on `user_foods`); (2) separate recipes/meals tables — every search and log path
would need a third source; (3) recipes as JSON inside user_foods — no per-ingredient queries, harder to edit.

**Builder's calls:** ingredients can be any food (database, mine, another recipe one level deep — no recipe
inside a recipe inside a recipe); a quick meal can't contain another quick meal; the per-serving weight is
optional (without it, logging is by servings only); AI label reading uses the "photo" task with the
existing failover.

**Settled after the builder check (Claude's calls):**
1. *Quick meal as one recent row.* `log_entries.group_ref` (text, nullable) — every entry logged from a quick meal
   gets `quick:<id>`. Recently tracked shows the quick meal once (its last use, from `group_ref`) and does not
   repeat its items for that use. "Same as yesterday" copies entries, so it shows the items.
2. *Items and changing foods.* `recipe_items` keeps a live reference (`food_kind` 'user_food'|'cache', `food_id`)
   plus a snapshot (name, the item's amount, its nutrients at save time). A recipe's stored per-serving numbers
   never change by themselves; Edit → Save and "Recalculate" use the foods' current values, falling back to the
   snapshot (with a note) for an item whose food is archived or gone. A quick meal logs each item from its
   current food, or from the snapshot if the food is archived or gone. Removing a food from My Foods deletes it
   when it was never logged and isn't in a recipe or meal; otherwise it is archived (hidden), as today.
3. *Recipe math and servings.* `servings[0]` = "1 serving (350 g)" with grams 350 (or "1 serving" with no grams
   when no serving weight is given); `nutrients` are per that serving. With a weight, the amount picker offers g
   and oz as for any food; without one, servings only. A nutrient unknown on any ingredient is unknown on the
   recipe (shown "?"/"—" like other foods). An ingredient amount that can't be measured (e.g. "2 slices" of a
   food with no gram weight in a unit it lacks) is a form error: "Choose an amount this food can be measured in".
   Quick meals store their item totals as `nutrients` too (servings [{ "1 meal" }]), recomputed on save.
4. *Photos end to end.* `POST /api/photos/analyze` stores each normalised image and returns `photoId`s; a
   `draft` carries `photoId` (and `barcode` when one decoded). `POST/PUT /api/my-foods` accept `photoId` and
   link it (`user_foods.image_path`). `GET /api/photos/:id` serves an image to its owner only (404 otherwise);
   user foods report `imageUrl` = that path, so search rows and log entries show it. Unlinked uploads are deleted
   by an in-process cleanup (on start and hourly, logged under "schedule"). With two images in auto mode: the
   decoder tries every image, the first barcode wins; images with no barcode go to the AI as the label. A
   barcode whose food is found → that food (label image dropped); a barcode found nowhere → the draft carries the
   barcode and the AI reads the other image (or the same one if only one was sent).
5. *Quick meal items.* Each item stores its own amount and unit. Adjusting items before logging changes only that
   log. "Save as a meal" builds items from each entry's food (`source_ref`) and its logged portion; water entries
   and entries whose food can't be found are left out and listed ("Left out: …"). A quick meal may contain
   recipes but not quick meals; a recipe may contain other recipes one level deep.
6. *My Foods.* A routed page `#/log/my-foods` (no new nav tab): a "My Foods" button on the Log page and a link
   in Add Food; Back returns where you came from. `GET /api/my-foods` gains `kind` (all|foods|recipes|meals)
   and `sort` (recent|used|az).
7. *Search and kinds.* Recipes and quick meals sit in the "My foods" group. `FoodResult` gains
   `foodKind: 'custom'|'override'|'recipe'|'quick_meal'` (existing 'ai' rows read as 'custom'); rows show a small
   "Recipe"/"Meal" tag and their stored total pills; kinds validated by zod.
8. *Uploads.* 12 MB per image, 2 images, request cap 25 MB; register @fastify/multipart; zxing-wasm must run on
   node:22-alpine in Docker (builder verifies; if it can't, fall back to another pure-JS decoder and record it).
   Uploads live under the existing `./data/app` volume.
9. *Smaller.* The Dashboard Photo button opens the file picker straight away (auto mode) and then Add Food on the
   smart-default meal with the result. "Recalculate" is for when ingredient data changed; editing recalculates
   anyway. Corrections (overrides) are edited with the existing override form.

## 13. Addendum 2026-11-17 — M3: weight, GLP-1, trends, badges (scope approved by Cory: "build it out and we can look at it")

**Why:** logging shows what was eaten; M3 shows whether it is working — weight trend toward the goal, the GLP-1
routine, and small rewards for consistency. Reminders are in-app only (Cory); phone notifications wait for iOS.

**A. Weight.** `weigh_ins` (user_id, day, weight_kg, note; one per day — a second entry that day replaces it).
Entered in the person's units from a Dashboard Weight card and from Goals. Trend = exponentially smoothed weight
(time-aware: trend += (w − trend) × (1 − 0.9^days since the previous weigh-in)), so water swings don't mislead.
Projection: least-squares slope of the trend over the last 28 days (needs ≥ 2 weigh-ins at least 7 days apart);
losing → projected goal date = today + (trend − goal) ÷ rate; otherwise "Not enough weigh-ins yet" / "Not losing
right now". The latest weigh-in becomes `user_body.weight_kg` (the plan's weight). When the latest weight is 10 lb
(4.54 kg) or more from the weight the current targets were set with, Goals suggests "Your weight has changed —
check your plan". Existing accounts get one starting weigh-in from their body weight (migration).
Goals shows a chart (weigh-in dots, trend line, goal line, dose-change markers), start/now/goal and lost-so-far.

**B. GLP-1.** `glp1_settings` (medication, dose_mg, injection weekday 0–6, weekly). `glp1_shots` (day, medication,
dose_mg, site, note; one per day). Sites: abdomen_left, abdomen_right, thigh_left, thigh_right, arm_left, arm_right;
the suggested site is the next in that order after the last shot's (changeable). Next due = last shot + 7 days
(no shots yet: the next injection weekday, today included). Dashboard GLP-1 card: "Next shot Fri" before; "Injection
day" on the day; "Injection overdue by N days" after — until a shot is logged. Logging a shot with a different
dose updates the current dose; dose history = the shots' dose changes. Side effects: `side_effects` (day, effects
{nausea, low_appetite, fatigue, constipation, diarrhea, heartburn, headache: 1 mild | 2 medium | 3 strong}, note;
one per day, optional). After-injection view: over the last 12 weeks, average calories and protein by days since
the most recent shot (day 0–6), over days with food logged; shown once there are ≥ 2 shots. A GLP-1 page
(`#/glp1`) holds setup, shot log, site picker, side-effect check-in and history; reached from the card and Goals.
Only for accounts whose body profile says they use a GLP-1 (others can turn it on in the page).

**C. Weekly trends.** `GET /api/trends/weekly?weeks=12`: per week (the person's week start) — days logged, average
calories/protein/fiber/water over logged days, each judged against the targets in force (below/in range/above),
and that week's change in trend weight. Shown on Goals as a compact table/bars.

**D. Badges, streak, vacation.** Badges (stored when first earned, with the date): first weigh-in; 5 lb lost, then
every 10 lb (10, 20, …) measured start → trend; halfway to goal; goal reached; logging streak 7, 30, 100 days;
4 shots on time in a row (within 1 day of due). New badges show once as a small celebration on the Dashboard, then
live on Goals. Vacation mode: date ranges (`vacations`) in which a day without food doesn't break the streak (it
neither counts nor resets); set on Goals.

**Approaches (trend):** (1) exponential smoothing — chosen (standard for daily weigh-ins, works with gaps);
(2) 7-day moving average — jumps when a day drops out, poor with gaps; (3) raw line — misleading.
**Builder's calls:** charts are hand-drawn SVG (no chart library); badges computed server-side on read and stored
on first earn; all new tables carry user_id and are isolation-tested; weights stored in kg, shown in the person's units.

## 14. Addendum 2026-11-17 — round 2c: Culury link and restaurant menus (decided by Cory)

**Why:** log what was actually cooked (planned in Culury) and what was eaten out (mostly big chains) without
typing nutrition by hand.

**A. Culury link** — implements 6.5; nothing changes in Culury.
- Settings › Integrations (per person): Culury address + a read-only Culury API key (sent as `X-API-Key`, stored
  encrypted in `user_settings.culury_url` / `culury_key_enc`), "Test connection" (calls `GET {culury}/api/plan`
  for today), Remove.
- Add Food gets a **Meal plan** button (only when linked): `GET {culury}/api/plan?from=day−3&to=day+4`, grouped by
  day, the selected day's matching meal first; notes without a recipe ("Leftovers") are shown but not loggable.
- Culury recipes appear as a "Culury" group in food search (`GET {culury}/api/recipes?q=`), after My foods.
- A Culury recipe becomes a loggable food: nutrients per serving from its `nutrition` (calories, fat,
  saturatedFat, carbs, fiber, sugar, addedSugar, protein, sodium mg); servings [{ "1 serving", grams from
  `servingSize` when it contains "(NNN g)" }]; logging snapshots it (source `culury`, source_ref
  `culury:<recipeId>`), so it shows in Recently tracked. No nutrition in Culury → offer "Estimate with AI"
  (flagged AI-estimated) before logging. `nutrition.outdated` shows a small "may be out of date" note.
- Culury unreachable or key refused → the button/group shows a plain message; logging everything else still works.
  3 s timeout like other sources. The server makes the calls (the key never reaches the browser).

**B. Restaurants (big US chains)** — data from Spoonacular's menu-items API with the admin's own free key
(Nutritionix no longer gives personal keys; MenuStat's public data is historical). Free plan: 50 points/day then
refused (HTTP 402), 1 request/second, backlink required.
- Settings › Food sources (admin): Spoonacular key (encrypted, like the USDA key), Test.
- Add Food gets a **Restaurants** tab (only when a key is set; otherwise a line saying how to add one): type a
  chain and/or item ("chipotle chicken bowl"); results grouped by chain with calories; recent chains as chips;
  star an item to keep it under Favourites for that chain.
- To live within 50 points: search only on Enter/after an 800 ms pause and ≥ 3 letters; at most 1 call/second
  (server-side queue); search results kept 24 h (same query → no call); an item's nutrition is fetched once and
  kept. Only items the person searched or logged are stored (as `food_cache` rows, source `spoonacular`); no bulk
  copying. Today's remaining lookups are shown ("38 lookups left today") from the API's quota headers; when
  refused: "Today's restaurant lookups are used up. They reset at midnight UTC — or use Describe it."
- A small "Restaurant data from spoonacular.com" link sits on the tab (their backlink rule).
- The restaurant source sits behind an adapter interface (search, item) so another provider can replace it.

**Approaches (restaurants):** (1) Spoonacular adapter with a personal key — chosen (explicit chain-menu coverage,
self-serve key); (2) FatSecret Basic — free and roomier, but restaurant coverage unstated; kept as the fallback
adapter if Spoonacular disappoints; (3) bundled MenuStat — no key, but data years old.
**Builder's calls:** restaurant items use the same Track food sheet and amount picker as other foods (per item,
with grams when the API gives a serving weight); favourites are a per-user table; Culury recipes are not copied
into My Foods (always read live, snapshotted when logged); the builder reads Spoonacular's endpoint docs before
coding and records the exact endpoints and point costs used.

**§14 update (Cory, same day): build both restaurant sources.** FatSecret (Basic plan: free, 5,000 calls/day, US
data, attribution required) is a second adapter. Order: Spoonacular first; FatSecret is used when Spoonacular has
no key, is out of points (402), fails, or returns nothing for the search. Each result carries its source; the tab
shows the credit for whichever sources are configured ("Restaurant data from spoonacular.com" / "Powered by
FatSecret"). FatSecret results are not kept beyond the request except items the person logs or stars (its free
plan lists no storage permission); Spoonacular search results may be kept 24 h. Settings › Food sources gets
FatSecret credentials (client ID + secret, encrypted) with Test. The Restaurants tab appears when either source is
configured. Builder's call: one person's favourites and recent chains work across both sources.

## 15. M4a — Backups, restore and "Download my data" (Cory, 2026-11-17)

M4 is three independent pieces, built one at a time: **(a) backups/restore**, (b) personal API keys, (c) email.
This section is (a).

**Intent.** Cory is about to put real data in; losing the server must not lose it. Only the admin can back up or
restore the server. Every person can take their own data out, but can't back up or restore anything.

**Goals**
- A daily backup of the whole server (every person's data + uploaded photos) in `<data dir>/backups`, newest 14
  kept (`BACKUP_KEEP`), written around 03:00 server time (`BACKUP_HOUR`); checked hourly so a server that was off
  at 03:00 still gets its backup.
- Settings › Data (admin): the list of backups (name, date, size), **Back up now**, **Download**, **Delete**,
  **Restore** (from the list or an uploaded file).
- Restore replaces everything on the server. Before it: a safety backup (`…-before-restore`) is written and the
  admin types `RESTORE`. After it: every session is ended (everyone signs in again).
- Settings › Data (everyone): **Download my data** — a zip with spreadsheets (`food-log.csv`, `weigh-ins.csv`,
  `shots.csv`, `side-effects.csv`, `my-foods.csv`) plus `bytesize-export.json` (everything of theirs: profile,
  body and plans, targets, foods, recipes and quick meals with items, log entries, weigh-ins, GLP-1, badges,
  vacations, favourites) and their photos.

**Non-goals.** Per-person restore; importing an export; off-site copies (the folder is plain files for the
homelab's own backup tooling); backing up from an API key (comes with (b)).
**Anti-goals.** A restore that leaves the server half old, half new. A backup or export that leaks another
person's data or any readable secret. A restore file that can write outside the data folder.

**Approaches**
1. **App-level backup (chosen):** a `.tar.gz` holding `bytesize.json` (every table's rows, written by the app) and
   `uploads/`. Restore runs in one database transaction: empty every table, insert the backup's rows, fix the id
   counters; photos are swapped in after the transaction commits. Same shape as Culury's; no extra programs in
   the image; fully testable with the test database.
2. `pg_dump`/`pg_restore`: an exact database copy, but needs PostgreSQL's tools inside the app image (matching
   the database's version) and a restore has to drop the database the app is connected to.
3. Copying `./data/postgres` files: only safe with the database stopped.

**Design**
- `bytesize.json`: `{ app: "bytesize", format: 1, schema: <number of migrations applied>, createdAt, tables: {
  <table>: rows[] } }`. Tables come from the Drizzle schema, so a new table is included without touching the
  backup code (a test fails if a table is neither backed up nor on the short skip list).
- Not backed up (rebuilt or pointless to keep): `sessions`, `restaurant_searches`, the points counter. Kept:
  everything else, including `food_cache` (log entries point at it) and the activity log.
- Older backups: a backup whose `schema` is lower than the server's is restored column-by-name (columns the
  backup lacks take their defaults; ones the server no longer has are dropped). A backup from a **newer** version
  is refused with "This backup is from a newer ByteSize. Update first."
- Saved secrets (AI, USDA, Spoonacular, FatSecret, Culury keys; passkeys) stay encrypted as stored. They only
  open with the same `JWT_SECRET`; after restoring onto a server with a different one, Settings › Data says
  which keys need entering again instead of failing silently. Password hashes restore as they are.
- Reading a backup file: only `bytesize.json` and `uploads/<user id>/<id>.<ext>` regular files are taken out;
  anything else (links, absolute or `..` paths) is ignored. Upload size limit 1 GB; the JSON is validated before
  anything is emptied.
- Backups are written to a temporary name and renamed, so a half-written file is never listed. One backup or
  restore at a time; a second request gets "A backup is already running."
- Routes (admin): `GET /api/admin/backups`, `POST /api/admin/backups`, `GET /api/admin/backups/:name`,
  `DELETE /api/admin/backups/:name`, `POST /api/admin/backups/restore` (`{ name, confirm }` or a file upload with
  `confirm`). Everyone: `GET /api/export` (their zip). Backup names are matched against a strict pattern.
- Each backup, restore, delete and export is written to the activity log (who, what, size).
- README gets a "Backups" section: where the files are, how to restore on a fresh server, the `JWT_SECRET` note.

**Builder's calls.** CSV dates are the person's local days; nutrient columns are blank (never 0) when unknown.
The export leaves out other people's data, password hash, passkeys and sessions. New dependencies allowed: `tar`
and one small zip writer.

## 16. One Integrations tab; show and copy saved keys (Cory, 2026-11-17)

**Asked for.** "All API keys should have an eyeball next to them so I can see them if needed and a copy to
clipboard button." and "Put all integrations under one tab in settings under Integrations, in their own sections
with a title."

**This changes an earlier rule.** Until now a saved key never left the server (§ secrets: only `hasKey`). Cory
wants to see and copy them. The rule becomes: a saved key is never sent with a page or a list; it is sent only when
the person who may see it presses the eye or copy button, one key at a time.

**Integrations tab** (Settings › Integrations, shown to everyone; replaces the "AI services" and "Food sources"
tabs). Sections, each a card with a title, in this order:
1. **AI services** (admin) — the existing AI services editor, unchanged in behaviour.
2. **Food databases** (admin) — Open Food Facts (no key needed) and the USDA key.
3. **Restaurant menus** (admin) — Spoonacular key, FatSecret ID and secret, the credits line.
4. **Culury** (everyone, their own link) — the existing address + key form.
Members see only Culury. Old addresses `#/settings/ai` and `#/settings/food-sources` open Integrations. Every
piece of wording that said "Settings › Food sources" or "Settings › AI services" says "Settings › Integrations".

**Eye and copy** on every key field (AI service keys, USDA, Spoonacular, FatSecret ID and secret, Culury key):
- Eye: shows what is typed; when nothing is typed and a key is saved, fetches the saved key and shows it. Pressing
  it again hides it. A shown saved key that hasn't been edited is not treated as a new key to save.
- Copy: copies what is typed, or else the saved key (fetched, not displayed). The button reads "Copied" for two
  seconds. Works on plain-http home-network addresses too (fallback when the browser's clipboard API is refused);
  if copying is impossible: "Couldn't copy. Show the key and copy it by hand."
- Who: server-wide keys — admin only. Culury key — only its owner. Nobody can fetch another person's.
- Each fetch is written to the activity log (who, which key — never the key), is rate-limited, and is answered
  with `Cache-Control: no-store`.
- A saved key that can't be read (the server's `JWT_SECRET` changed): "This key can't be read. Enter it again."

**Routes.** `GET /api/settings/ai/:id/key` (admin) → `{ key }` · `GET /api/admin/food-sources/:source/key` (admin;
`usda`, `spoonacular` → `{ key }`; `fatsecret` → `{ clientId, clientSecret }`) · `GET /api/settings/culury/key`
(the caller's own) → `{ key }`. 404 when none is saved, 409 with the message above when unreadable.

**Later (M4b).** ByteSize's own personal API keys will be stored encrypted rather than one-way hashed so they get
the same eye and copy; the cost is that a backup plus the server's `JWT_SECRET` can read them.

## 17. Wide-screen layout — option A (Cory, 2026-11-17)

**Asked for.** Use more of the screen on the web, like Culury, with Settings tabs across the top. Keep the current
phone layout as it is — it is the template for the iPhone app. Cory picked option A ("side rail") from the layout
proof-of-concepts (design canvas "ByteSize web layout options"; the artboards are the reference for look and
spacing: Main = Dashboard, OptionA-Log, OptionA-Goals, Settings-Integrations for the tab strip).

**Rule.** Below 1024 px wide (Tailwind `lg`) nothing changes: same markup, same tests. From 1024 px up:
- **Side rail** instead of the bottom tab bar and top bar: logo; the orange + (log food — same action as today's
  floating +); Dashboard, Log, Goals, My foods (icon + label, active one highlighted); Settings and the account
  button at the bottom. The rail stays in view while the page scrolls.
- **Page header**: page title (Dashboard shows the selected day as "Tuesday, November 17" with "Good evening,
  <name> · <n>-day streak" when there is a streak), and on Dashboard and Log the week strip (same behaviour as
  today's, drawn as a row of day buttons with dots and ‹ › ).
- **Dashboard** in three columns (wrapping to two/one as the width shrinks): (1) the budget card + four quick
  buttons — Search food, Barcode photo, Label photo, Restaurants — each opening Add food at that view for the meal of
  the moment; (2) "Today's food": the selected day's entries by meal with calories, an "Open the log" link, and an
  "+ Add food" button under an empty meal with its suggested calories; (3) water, weight (with a small trend line of
  recent weigh-ins), GLP-1 next shot (only when GLP-1 is on), streak. Existing cards keep their behaviour.
- **Log**: meal cards in a responsive grid (two across when there is room; supplements & water full width) with a
  "Day totals" table beside it: calories, protein, carbs, fat, fiber, sugar, sodium, water — eaten vs target range
  ("—" when there is no target; unknown stays blank, never 0). "My foods" link in the header.
- **Goals**: plan card and weight card side by side; weekly trends as a table (scrolls sideways if narrow); badges
  in a grid (about four across); vacation mode and the GLP-1 link beside the badges.
- **My foods, GLP-1, other pages**: wider content column (about 1180 px max), no other change.
- **Settings**: tabs across the top (Culury style: underline on the active tab, scrolls sideways when they don't
  fit), each tab's panel below, content up to about 1180 px with cards side by side where the mockup shows them.
  Phones keep the list-with-chevrons. Addresses stay the same (`#/settings/<tab>`); `#/settings` on a wide screen
  opens the first tab.
- **Add food and other sheets**: on wide screens they open as a centred window (max about 640 px wide, about 85%
  of the screen tall, rounded, dimmed backdrop, Escape and backdrop click close) instead of sliding up from the
  bottom. Same content.

**Not in this step.** New data or routes; the Log mockup's Shortcuts box; the Email and App info tabs (their own
steps); option C's docked Add food panel.

## 18. An on/off switch per integration (Cory, 2026-11-18)

**Asked for.** "In the integrations, there should be a slider to turn each one on; if they are on they are
expanded, if they are off they are closed."

**Cards.** Settings › Integrations shows one card per integration, each with a switch in its title row:
AI services, Open Food Facts, USDA, FatSecret, Spoonacular (admin) and Culury (everyone, their own link). The
existing "Food databases" / "Restaurant menus" grouping becomes these separate cards (order: AI services, Open Food
Facts, USDA, FatSecret, Spoonacular, Culury; on wide screens two columns as now). The restaurant credits line moves
to the Spoonacular and FatSecret cards (one line each).
- **On**: the card is open — its keys, fields and buttons show — and ByteSize uses the source.
- **Off**: the card shows only its title row and a one-line status ("Off — not used"), and ByteSize does not use
  the source anywhere: food search, barcode lookups, photo/label lookups that fall back to search, restaurant
  search and items, Culury plan/recipes/search. A source that is off is skipped silently — not reported as an
  error, not counted as a failure, no outside call made.
- The switch is a real switch (`role="switch"`, labelled "<Name> on"), saves at once (no Save button), and the
  card opens/closes with it. Switching on a card that has nothing set up opens it with its key field ready.
- **Turning off keeps** the saved key and settings; switching back on uses them again. Removing a key stays the
  separate button inside the card.
- **Starting state** (also for existing servers): Open Food Facts on; USDA, FatSecret, Spoonacular on if a key is
  saved, else off; Culury on if linked, else off; AI services keeps its existing on/off ("AI is on" moves into the
  card's title row).
- An off source cannot be "on but missing a key" the other way round: if a card is on with no key yet, it behaves
  as today (source unused until a key is saved) and the card says so.
- Members see only the Culury card; the server-wide switches are admin-only on the server too.
- Restaurants view in Add food: shown only when FatSecret or Spoonacular is on and has a key. Meal plan button and
  Culury results: only when the person's Culury is on and linked.

**Storage.** The admin switches live with the food-source settings in `app_settings` (no secret involved); the
Culury switch is a column on the person's settings row (migration). Both are included in backups automatically
(they are rows of backed-up tables).
## 19. Import weight history from a CSV file (Cory, 2026-11-18)

**Asked for.** "Ability to import weight data. I'm switching apps so I want to load a CSV file of my weight loss
history into my new app. Add that as an option in setup as a weight data import option." Cory went to bed after
asking; the calls below are the builder's, to be shown to him in the morning.

**Where.** Settings › Data, a new card for everyone: **Import weight history**. It adds weigh-ins to the person's
own history only.

**Flow.**
1. **Choose a CSV file** (up to 5 MB). Nothing is saved yet.
2. **Preview.** ByteSize reads the file in the browser-independent server step (`POST /api/weight/import/preview`,
   multipart) and shows:
   - the column it picked for the **date** and for the **weight** (each a dropdown of the file's columns, so the
     person can correct a wrong guess);
   - **units**: lb or kg — guessed from the header ("lb", "lbs", "pounds", "kg", "kilograms") and otherwise from
     the person's own units setting — changeable;
   - **date format** when it can't be told apart (e.g. 03/04/2025 could be March 4 or April 3): "Month/Day/Year" or
     "Day/Month/Year", guessed from the file (a first number above 12 settles it), defaulting to Month/Day/Year;
   - a summary: "214 weigh-ins from Jan 3, 2025 to Nov 16, 2026", how many days already have a weigh-in in
     ByteSize, how many rows can't be read (with the first few line numbers and why), and the first 10 rows as they
     will be saved (date, weight in the person's units).
3. **Days that already have a weigh-in**: "Keep what's in ByteSize" (default) or "Replace with the file's".
4. **Import** (`POST /api/weight/import`, the same file plus the chosen options) → "Imported 214 weigh-ins".
   Weight charts, trend, projection, goals and badges then include them (they already read the weigh-ins table).

**Reading rules.**
- Separator: comma, semicolon or tab (detected); quoted fields; a UTF-8 byte-order mark; Windows line ends.
- Date: YYYY-MM-DD, YYYY/MM/DD, M/D/YYYY or D/M/YYYY (per the chosen format), with or without a time after it,
  and month-name forms like "Jan 3, 2025" / "3 Jan 2025". A date with a time keeps its calendar day as written
  (no time-zone shifting).
- Weight: a number (a decimal comma like "98,4" is accepted when the separator isn't a comma); text after the
  number such as "lb"/"kg" is ignored; must be 30–350 kg (about 66–771 lb), the weigh-in form's own range, or the row is skipped as unreadable.
- Several rows for the same day: the last one in the file wins (most apps export one per day; Withings-style
  exports can have more).
- Future dates are skipped. Blank lines are ignored.
- Column guess: date = first column whose header contains "date"/"day"/"time" (else the first column whose values
  parse as dates); weight = first column whose header contains "weight"/"wt"/"body mass" (else the first numeric
  column that isn't the date). Known exports this should handle without changes: Lose It (Date, Weight),
  MyFitnessPal measurement export (Date, Weight), Happy Scale, Libra (semicolon), Withings ("Date","Weight (lb)" /
  "Weight (kg)"), Fitbit (Date, Weight), a hand-made two-column sheet.
- Added in review: files wider than 50 columns are refused; exact headers ("date", "weight", "weight (lb)",
  "weight (kg)", "body weight") win over partial matches; two-digit years read as 20YY (19YY if that would be in the
  future); UTF-16 (Excel "Unicode Text", with its byte-order mark) and Windows-1252 files are read; an unclosed quote
  is reported with its line number; at most 100 unreadable-row reasons are kept (the count is exact).
- Stored as kilograms like every weigh-in (exact conversion 0.45359237); notes from a "note"/"notes"/"comment"
  column if there is one, otherwise none.

**Safety.** The whole import is one transaction; nothing is saved if it fails. Rate-limited (10 a minute per
person). Each import is written to the activity log (who, how many rows, date range — not the file). The file is
not kept.

**Not in this step.** Importing food logs, body-fat or other measurements; Apple Health's XML export (CSV only —
the README can say how to get a CSV from Apple Health via a third-party app); undo (a person can delete weigh-ins
as today).

## 20. Accounts: email, forgot password, command-line reset, OAuth sign-in (Cory, 2026-11-17/18)

**Asked for.** "Reset passwords from the main screen: enter your email, get a six-digit code if an account matches,
then set a new password — only when email is set up." "Reset the admin password from the command line." "Add OAuth
like Culury has; just use that code." Culury (`/home/claude/ref/Culury`, read-only) is the reference: copy its
code and behaviour, adapted to ByteSize's names and per-user model. Agreed in conversation; built as one step with
§21.

**Email (Settings › Email, admin).** Copied from Culury's EmailSettings + lib/mail.ts: provider presets (Gmail,
Outlook, iCloud, Fastmail, custom), From address, username, password (encrypted, never returned; eye + copy like
§16), server/port/security under "More options", the app's own address (used in emails), and **Send test email**,
which must succeed before Save. `SMTP_*`, `MAIL_FROM`, `APP_URL` in `.env` remain a fallback. The tab sits in the
Settings tab strip (wide) / list (phone) after Integrations.

**Forgot password (sign-in screen).** Shown only when email is set up. Steps: enter email → "If an account uses
that email, we've sent a 6-digit code." (same answer whether or not it matches) → enter the code and a new password
(same rules as elsewhere) → signed in. Code: 6 digits, random, stored hashed, valid 15 minutes, single use, 5 wrong
tries kills it, a new request replaces the old code; rate-limited per address and per email (e.g. 5 an hour);
email subject "Your ByteSize code: 123456"-style with the code in the body and "If you didn't ask, ignore this".
Resetting ends the person's other sessions (like a password change) and is written to the activity log (who, not
the code). A disabled account can't reset. Accounts without an email never get a code.

**Command line.** `npm run reset-password -- <username>` (without a username: the first admin) prints a new random
password once, or takes `--password` from a prompt (or `NEW_PASSWORD`; never as an argument); ends that account's sessions; logged. `npm run auth:reset`
turns OAuth-only off and OAuth sign-in off (locked-out escape). `EMERGENCY_DISABLE_OAUTH=true` in `.env` does the
same at start. README "Locked out?" section with the Docker and Mac commands.

**OAuth / OpenID Connect sign-in (Settings › Security, admin config).** Copied from Culury: on/off, button name,
issuer/discovery URL, client ID, client secret (encrypted, eye + copy), redirect URI shown to copy, **Test
connection**, **Link my account** for each person, optional **OAuth only** (hides the password form; not allowed
until the admin's own account is linked at that provider; turns itself off when the provider or client ID changes). PKCE + state +
nonce as Culury, and each sign-in is tied to the browser that started it. New accounts are not created by OAuth
(admins add people as today).

*Ruling (review, 2026-11-18): no email matching.* An OAuth sign-in only works for an account its owner linked with
**Link my account** while signed in. Profile emails are never verified, and self-hosted providers often let people
change their email while still calling it verified, so matching on email could hand over any account, an admin's
included. An unlinked sign-in says: "This sign-in isn't linked to a ByteSize account yet. Sign in with your password,
then use Link my account in Settings › Security." The redirect URI uses ByteSize's configured address (Settings ›
Email's app address, `APP_URL`, `PASSKEY_ORIGINS`) when one is set; a request from another address is refused.

**Not in this step.** Invite-by-email for new people (later), email for anything else.

## 21. Food lookups: local first, the lookup order, cache hours, FatSecret plan, saved barcodes (Cory, 2026-11-17/18)

**Asked for.** "All values cached locally during lookups; always check locally first before an API call. I scan the
same barcodes repeatedly." The lookup order table (barcode: Open Food Facts → FatSecret → USDA; restaurants:
FatSecret → Spoonacular; whole foods: USDA → FatSecret → Open Food Facts; packaged text search: FatSecret → USDA →
Open Food Facts). "Note when it's a cached version and let users override to re-cache." "A list of all cached UPCs
in setup to delete or refresh." "Make the order clear in the setup menus." Follow-ups agreed: a FatSecret
**Basic/Premier** choice (Premier enables barcode lookups); a **"Keep results for (hours)"** field per integration,
1–9999, defaults from each source's terms, with an automatic cleanup.

**Local first.** Every outside answer ByteSize keeps is reused while it is fresher than its source's hours; only
then does ByteSize call out. That covers barcodes, item details and typed searches (a search's answer per source
and query is remembered for that source's hours; the same query again calls nothing). Restaurant searches follow
their source's hours (Spoonacular 1 h, FatSecret 24 h by default) — replacing the fixed 24 h.

**Hours per source** (Settings › Integrations, in each card; whole hours 1–9999):
Open Food Facts 9999, USDA 9999, FatSecret 24, Spoonacular 1 (defaults; terms: FatSecret 24 h, Spoonacular 1 h).
An hourly cleanup deletes kept answers older than their hours, except items in use (logged entries keep their own
copy anyway; recipe/quick-meal items, starred restaurant items and "My foods" edits based on a kept item are kept).
For FatSecret the link barcode → FatSecret food id is kept for good (allowed by its terms); after its details are
cleaned up, the next scan fetches only that one food (one call).

**FatSecret plan** (FatSecret card): Basic (free) / Premier. Premier adds FatSecret to barcode lookups. If Premier is
chosen but the key lacks barcode access (FatSecret answers "missing scope"), ByteSize says so once on the card
("Your FatSecret key doesn't include barcode lookups yet") and skips FatSecret for barcodes.

**Order.**
- Barcode: saved copy → Open Food Facts → FatSecret (Premier only) → USDA. First hit wins and is kept.
- Restaurants: saved copy → FatSecret → Spoonacular (swapped from today's order).
- Typed search: results grouped in this order: My foods, Basic foods (USDA whole foods), FatSecret, USDA branded,
  Open Food Facts (Culury results stay where they are today). FatSecret typed search uses the existing FatSecret
  key (Basic allows search).
- Sources switched off (§18) are skipped; the order table shows them "Off — skipped".

**Saved-copy note.** A food that came from a kept copy shows "Saved copy from <date>" with **Check for changes**
(on search rows and in the food's detail / Track food). Check for changes calls that source once for that item,
updates the kept copy, and says "Up to date" or "Updated". It is the "re-cache" override.

**Settings › Integrations additions.**
- "How ByteSize looks foods up": the order table at the top (as in the mockup), sources that are off marked.
- **Saved barcodes** card (admin): every kept barcode — barcode, food, from, saved, deleted (when its hours run
  out, or "Kept — in use"), Refresh and Delete per row, search by name or barcode, count, paging (50 at a time),
  "Delete all not in use".

**Not in this step.** App info stats (next step).

## 22. Source pills on food search (Cory, 2026-11-18)

**Asked for.** "When I search for a food when logging, it's showing me Culury first based on ingredients. Let's have
pills at the top that show sources; FatSecret highlighted by default, Basic and Culury off; users can toggle them;
show the number of results, e.g. (Culury (8))." "USDA and Open Food Facts should be on by default."

**Pills.** Above the search results in Add food (typed search only — a barcode match shows as today), one pill per
source group that was searched: My foods, FatSecret, Basic (USDA whole foods), USDA (branded), Open Food Facts, Culury, each
with its result count, e.g. "Culury (8)". A pill that is on is highlighted and its group shows; off hides it.
Order: My foods, FatSecret, Basic, USDA, Open Food Facts, Culury. Pills are real toggle buttons (`aria-pressed`, 44 px tall,
wrap on phones).
- Defaults: My foods, FatSecret, USDA and Open Food Facts on; Basic and Culury off.
- **My foods** is a pill too, first and on by default ("my foods should also be a pill that is turned on").
  Recents (shown before you type) and saved restaurant items are not pills.
- The **My Foods** button in Add food's row of options (Describe it, Create food, My Foods, Restaurants) is removed
  ("it doesn't need to take you to that screen when searching"); the My foods page stays reachable from the side
  rail / Log header / phone navigation as today.
- A source with no results still shows its pill with (0); a source switched off in Integrations (§18) or with no key
  gets no pill; a source that failed shows its pill with "!" and the existing error line in its group when on.
- If every pill that is on has 0 results but another has some: "Nothing from FatSecret. Tap Basic (12) to see those."
  (names the pills that are on, and the first pill with results).
- **Remembered** per person on that device (browser storage, keyed by user id; wrapped so a browser without storage
  just uses the defaults). Builder's call — Cory answered the defaults question only.
- Search still asks all sources at once (no extra calls when a pill is turned on).

## 23. Describe it: feedback, "Did you mean", and no more "ran out of room" (Cory, 2026-11-18)

**Asked for.** "When using Describe it it needs some feedback on the screen when you push the button — right now it
just sits there." "It needs to make assumptions: if I misspell cheerios as 'cherios' it should assume I mean
Cheerios instead of failing, with feedback like 'Did you mean XXX' and let the user say yes." "I got 'OpenRouter's
answer couldn't be read (it ran out of room)' on several queries." Follow-up: "Don't say OpenRouter — just say
'Estimating… asking AI'."

**Feedback.** Pressing the Describe it button (and the AI estimate button anywhere it appears, e.g. Estimate with
AI on a recipe) shows at once: the button disabled, and right next to the line "Estimating… asking AI" a spinning wheel that keeps turning the whole time it works (so it is plainly doing something); the wheel respects reduced-motion settings by pulsing instead of spinning. If the
first AI service fails and another is asked, the line becomes "Still estimating… trying another AI". A **Cancel**
button stops waiting (the request is aborted; nothing is logged). No AI service names are shown in these lines.
Errors that reach the person don't name the service either: "The AI couldn't estimate that. Try again, or describe
it differently."

**Assumptions.** The AI is told: assume the most likely food the person meant (misspellings, brand names written
loosely, missing words); only give up when nothing sensible fits. The answer says what it took the text to mean
(`name`) and whether that differs from what was typed in a way worth confirming (`assumed: true` plus
`interpretedAs`, e.g. "Cheerios"). When `assumed` is true, the estimate is shown with **Did you mean Cheerios?**
above it and two buttons: **Yes** (carries on with that estimate the same way as any estimate: the New food form filled in, then Track food) and **No, change it** (back to the
text box with the person's words, ready to edit). When the AI truly can't guess, it answers so and the person sees
"Couldn't work out what that is. Try describing it differently."

**"Ran out of room".** Cause: the estimate allowed 1,200 tokens, and models that "think" first (common on
OpenRouter) used them up before answering. Fix:
- The food estimate (and the other AI asks that return JSON) gets a larger budget (4,000 tokens for an estimate).
- OpenRouter asks for low reasoning effort on these asks (already supported in ai.ts; pass it here).
- When an answer is cut off for length, the same service is asked once more with double the budget before moving to
  the next service; only then is it a failure.

**Not in this step.** Estimating from a photo (unchanged), voice input.

## 24. Compact, centred date header (Cory, 2026-11-18)

**Asked for.** "Clean this up a bit — make something more compact and centred for the date" (the wide Dashboard
header: big "Wednesday, November 18" on the left, greeting under it, a large week strip far right).

**Change (wide screens, Dashboard and Log):** one centred block at the top of the page:
- the week strip in the middle, smaller (day buttons about 40 px wide, 52 px tall, single-letter day over the
  number, dot under logged days, ‹ › at the ends), with the selected day filled as now;
- directly above it, one short centred line: "Wednesday, Nov 18" (about 18 px, bold);
- directly below it, one small subtle line: "Good morning, Cory · 2-day streak" (first name only; the streak part
  only when there is a streak). On Log the subtle line is left out.
Total header height about 120 px instead of about 160. Phones unchanged.

## 25. Barcode: upload a photo of it too (Cory, 2026-11-18)

**Asked for.** "When using the barcode scanner it should allow a user to upload a photo of the barcode as well, just
like the photo scan." (Add food › barcode button opens "Type the barcode number" only.)

**Change.** Under the barcode number box, a button **Upload a barcode photo** (camera/image icon) opens the same
photo picker the camera button uses, already set to barcode mode (the server reads the barcode from the photo as it
does today); on phones it offers the camera or the photo library as the photo picker already does. Reading the
photo shows the same feedback as other photo reads; a found barcode goes through the usual barcode lookup; "No
barcode found in that photo" offers to try another photo or type the number. The barcode number box also tells
password managers to leave it alone (`autocomplete="off"`, `data-1p-ignore`, `data-lpignore`), so the 1Password
button no longer appears in it.

## 26. Password managers only on sign-in fields (Cory, 2026-11-18)

**Asked for.** "1Password should ignore all fields other than username and passwords."

**Change.** Every text, number, search and textarea field in the app carries `data-1p-ignore`, `data-lpignore="true"`
and `data-bwignore` (1Password, LastPass, Bitwarden) and a suitable `autocomplete` value (`off` for search and data
fields), done once in the shared input components/class helpers rather than field by field where possible, so new
fields get it too. Exceptions — left for password managers, with the right `autocomplete`: the sign-in username
(`username`) and password (`current-password`); setting or changing a password and the forgot-password new
password (`new-password`); the forgot-password email (`email`) and the 6-digit code (`one-time-code`). Saved API-key
fields (§16) are ignored too (their reveal/copy covers that). A test walks the main screens and asserts every
input outside that list carries the ignore attributes.

## 27. Dashboard rearranged; no + in the side rail (Cory, 2026-11-18)

**Asked for.** "Remove the + from the menu — users can select Add food from the food log area." "Move the budget
widget to the middle and the food log on the left; put water under the middle widget." "Remove the buttons for
Search food etc. on the budget widget — users don't need them there."

**Change (wide screens):**
- The side rail loses the + button (logo, then Dashboard, Log, Goals, My foods; Settings and account at the bottom).
  Adding food is from "+ Add food" in Today's food and on the Log page. Phones keep their + in the bottom bar
  (the iPhone template is unchanged).
- Dashboard columns: **left** Today's food; **middle** the budget card with **water** directly under it; **right**
  weight, next shot, streak. Still wraps to two/one columns as the width shrinks, in that order (food, budget,
  water, …).
- The four quick buttons (Search food, Barcode photo, Label photo, Restaurants) are removed from the Dashboard.
- Today's food: every meal gets a "+ Add food" button (also meals that already have food, after their last item),
  so food can always be added from there.
- **Day totals on the Dashboard** ("add this widget to the Dashboard as well, on the right, top"): the Log page's Day
  totals card (calories, protein, carbs, fat, fiber, sugar, sodium, water — eaten vs target, same component and
  rules) sits at the top of the right column, above weight, next shot and streak, for the selected day.
- Pop-up windows don't close on a click outside them — only the X in the corner or Escape closes them ('when entering an item, the window should not close if you click out of it by accident').

## 28. Dashboard widgets you can arrange; no Log page (Cory, 2026-11-18)

**Asked for.** "We don't need the Log page at all since all of this is on the Dashboard — lose it everywhere (phones
too: the web app can be used on a phone, but the native iOS app will be the main phone app)." "Make the changes I
want the default order of widgets. Add a feature where users can move the widgets into any column or order: an edit
mode where widgets become draggable across the columns, and they save their changes. We'll add more widgets later
as a widget library users pull onto the dashboard — take that into account."
Calls made for Cory (he didn't answer these; to confirm): the food widget keeps everything the Log page did; the
layout is saved on the server per person; edit mode can also remove widgets and add them back from a list.

**No Log page.** The Log page, its navigation entries (side rail and phone bottom bar) and `#/log` go;
`#/log` (and old links to it) open the Dashboard. Everything the Log page did moves into the Dashboard's **Food**
widget: meals with their entries (photo/icon, name, amount, calories, nutrient pills as the Log showed them), "+ Add
food" on every meal, tap an entry to edit it, delete, move to another meal, select several (move/delete/copy), copy
a meal to another day, save a meal as a quick meal, the Supplements & water section, Day totals stay a separate
widget. The week strip in the Dashboard header picks the day for every widget. Phones: the Dashboard is the home
tab; the bottom bar keeps the + (opens Add food for the meal of the moment) and drops Log.

**Widgets.** The Dashboard is a set of widgets in three columns (one column on phones, two at medium widths), each a
self-contained card with an id, a title, and a "fits" hint (narrow / wide). Today's widgets: Food, Budget, Water,
Day totals, Weight, Next shot (only shown when GLP-1 is on), Streak, plus the existing Dashboard cards that aren't
named here (e.g. new badges, after-injection prompt) keep their current behaviour above the columns.
- **Default layout** (Cory's order, §27): left: Food; middle: Budget, Water; right: Day totals, Weight, Next shot,
  Streak.
- **Edit mode**: an "Edit dashboard" button (pencil, in the Dashboard header). In edit mode: each widget shows a drag
  handle and a remove (×) button; widgets can be dragged within and across columns (mouse and touch), with a clear
  drop indicator; every move can also be done without dragging (each widget has Move up / Move down / Move left /
  Move right buttons or a "Move to…" menu, keyboard accessible); empty columns stay as drop targets. "Add widget"
  opens the widget list (the start of the library): every widget not on the dashboard, with its title and one line
  about it, added to the bottom of the shortest column (or dragged into place). **Save** stores the layout;
  **Cancel** puts it back; **Reset to default** restores Cory's default. Widgets don't fetch or work while in edit
  mode beyond showing themselves.
- **Saved on the server** per person (`GET/PUT /api/dashboard/layout`, `{ version: 1, columns: string[][] }`, a new
  per-user table or a JSON column on user_settings; backed up; included in "Download my data"). Unknown widget ids
  in a saved layout are dropped; widgets added to ByteSize later appear in the Add widget list (not forced onto
  everyone's dashboard) unless marked "new default". A widget id appears at most once. Validation: at most 3 columns,
  known ids only.
- **Phones / one column**: widgets show in reading order (left column top to bottom, then middle, then right); edit
  mode on a phone uses the Move up / Move down buttons (dragging optional).
- **Built for the library**: a single widget registry (id, title, description, fits, component, default column,
  "only when …" condition) that the Dashboard, Add widget list and layout validation all read; adding a widget later
  means adding one registry entry.
- **Next shot shows the date** ("put the date, not just the day of the week"): "Next shot Wed, Nov 19" (weekday,
  month, day; the year only when it isn't this year), wherever the next shot is shown (Next shot widget, GLP-1 page).
- **The Food widget uses the Log page's meal view exactly** (Cory: "make sure we are using this view on the main
  dashboard, where you can see the pills and click to edit"): each meal card as the Log page's MealCard draws it —
  "Breakfast: 246 cals", the meal's line of protein · carbs · fat · fiber, each entry with its photo/icon, name,
  amount and the calorie / protein / fiber pills — and tapping an entry opens it for editing as on the Log page.
  Reuse the MealCard component rather than a new list.
- **Adding the same food twice to a meal combines them** ("I added two eggs — it should auto combine them"): when a
  food is logged to a day and meal that already has an entry of the same food (same food reference; for foods
  without one, e.g. a quick add, the same name and the same nutrients per unit), the existing entry's amount grows
  instead of a second entry being added — 100 g + 100 g → 200 g, 1 large + 1 large → 2 large. Different units of the
  same food combine when both convert through grams (or millilitres), shown in the existing entry's unit; otherwise
  they stay separate. Nutrients are recomputed from the combined amount (unknown stays unknown). A short note "Added
  to the egg white already in Breakfast (now 200 g)" confirms it, with **Undo** (splits it back). Moving an entry
  into a meal that already has the same food combines the same way. Entries that are already duplicated stay as they
  are. Done on the server in the log route, so every way of adding (search, barcode, recents, quick add, AI,
  restaurants, Culury, quick meals) follows it; a quick meal adds each of its items this way.
- **Serving names pluralise correctly**: "6 pitted prunes", not "6 pitteds prunes" (the plural rule pluralised the
  first word of a multi-word serving name); fix the rule so only the noun takes the plural, with a test for the
  common serving names in the data.
- **Edit entry: Move, Copy and Delete as icons at the top** ("they should be at the top of the window and be icons,
  not words"): in the Edit entry window's title row, to the left of the X, three icon buttons — Move (arrow into a
  box / arrow-right-left), Copy (two squares), Delete (bin, error colour) — each with an accessible name and a hover
  tooltip ("Move to another meal or day", "Copy", "Delete"), 44 px targets. They leave the bottom of the window,
  which keeps only Save. Delete still asks inline before deleting.

## 29. App info: fun stats that count up (Cory, 2026-11-18)

**Asked for.** "An 'App info' section with fun usage stats — items scanned, items tracked, API calls, days logged,
items logged… — with numbers that count up over a few seconds."
Calls made for Cory (to confirm): it's a Settings tab everyone has, showing their own numbers; the admin also sees
the same stats for everyone on the server; counts of things ByteSize didn't record before start from today.

**Settings › App info** (new tab, last before Logs/Users where those exist; on phones a row in the settings list).
Big-number tiles in a grid (two across on phones, four on wide screens), each a number with a short label and a
small icon:
- From data ByteSize already keeps: **Days logged** (days with at least one entry), **Foods logged** (entries),
  **Different foods** (distinct foods/names logged), **My foods** (saved foods and recipes), **Weigh-ins**,
  **Pounds lost** (first to latest weigh-in, in the person's units; hidden when there's no loss), **Shots logged**
  (GLP-1 on only), **Longest streak**, **Member since** (date, not counted up).
- Counted from now on (a new per-person counter, see below): **Barcodes scanned** (barcode lookups, typed or photo),
  **Photos read** (label/barcode photos), **AI estimates** (Describe it), **Lookups saved** (searches and barcodes
  answered from the local copy instead of asking a service), and **Outside lookups** with a per-source breakdown
  (Open Food Facts, USDA, FatSecret, Spoonacular, Culury) as small lines under the tile. These tiles carry a
  footnote "Counting since <date this shipped>".
- Admin only, a second section **Everyone on this server**: people, days logged, foods logged, barcodes scanned,
  outside lookups, lookups saved — totals across all users. Nobody else sees other people's numbers.
- Footer line: ByteSize version.

**Count-up.** When the tab opens, each number counts up from 0 to its value over about 1.5 seconds with an ease-out,
tiles slightly staggered; thousands separators throughout. With "reduce motion" on, numbers appear at once. A
number that's 0 just shows 0. Screen readers get the final value (the animating text is aria-hidden with the real
value in an sr-only span).

**Counter.** A per-user `usage_counts` table (user id, key, count; one row per user and key). Incremented with an
atomic upsert where the event happens (barcode lookup, photo read, AI estimate, each outside call per source, each
local answer). Counting never delays or fails the request it counts (errors logged, not thrown). Backed up and in
"Download my data"; covered by the per-user isolation test. `GET /api/app-info` returns `{ you: {...}, everyone?:
{...}, countingSince, version }` (`everyone` for the admin only).

## 30. A drink with one serving opens at that serving, not 8 fl oz (Cory, 2026-11-18)

**Found in testing.** A restaurant drink opened from search starts at "1 shake", but once it is corrected (saved to
My foods) or comes from another source with a single named serving that has a volume, it opens at "8 fl oz" — the
cup's-worth fallback meant for drinks known only per 100 g.
**Rule.** Where a food starts: if its only serving names an item ("1 shake", "1 bottle (500 ml)", "1 can") it starts
at 1 of that serving, whatever the source. Only a serving that names no item — just an amount like "100 g" or
"100 ml" — falls back to a cup's worth (8 fl oz / 240 ml). Everything else in `defaultPortion` is unchanged
(a grams-only second serving still starts in fl oz/ml, same amount).

## 31. Unknown nutrients count as 0 on screen (Cory, 2026-11-18)

**Asked for.** "When calculating macros, if something is unknown or blank, treat it as 0 instead of saying unknown."
This replaces the earlier "unknown is never 0" rule **for what's shown**: totals, rings, day totals, meal lines,
entry pills, food details and recipe/meal sums add a missing value as 0 and show the number (no "?", no "+ some
unknown", no "N foods missing fiber", no "—" for a sum). **Stored data doesn't change**: a food that doesn't say its
fiber is still saved without it, so "fill in missing nutrients", Check for changes and later lookups can still fill
it, and editing a food still shows the field blank. Combining duplicate entries (§28) adds known amounts and leaves
a missing nutrient missing in storage. Places that aren't nutrient amounts keep their own wording (e.g. a restaurant
item with no calories in the menu list, a day with no food in the after-injection chart).

## 32. Cached data: its own Settings tab, with filters and pages (Cory, 2026-11-18)

**Asked for.** "Move Saved barcodes to its own menu item in setup, called Cached Data. Filters at the top for sources
(USDA etc.) for quick filtering. Only show 10 by default before the pages < 1 2 3 > show at the bottom. Let users
choose to see 10, 20, 30, 40, 50 in a dropdown near the filters."
Calls made for Cory (to confirm): the tab is admin-only, like Saved barcodes was; it holds the same list (kept
barcodes) — the per-source cache hours and lookup order stay in Integrations.

**Tab.** Settings › **Cached data** (admin only), after Integrations (wide: in the tab strip; phones: a row in the
settings list, `#/settings/cached-data`). The Saved barcodes section leaves Integrations; Integrations' food-source
cards get a one-line link "See cached data" to the tab. The list keeps everything it does today (search by name or
barcode, refresh from its source, delete, Delete all not in use, in-use marker, saved/deletes dates).
- **Source filters** at the top: one pill per source that has kept barcodes (Open Food Facts, USDA, FatSecret, …),
  each with its count, like the search pills (§22, same small size); all on to start; tapping one turns it off/on;
  the list, total and pages follow the pills. Search combines with them.
- **Per page**: a "Show" dropdown beside the filters — 10, 20, 30, 40, 50 — default 10, remembered on this device.
- **Pages** at the bottom: ‹ 1 2 3 … › (current page highlighted, first/last always shown, ellipsis when there are
  many, ‹ › disabled at the ends), plus "11–20 of 134". Changing filters, search or per-page goes back to page 1.
- Server: `GET /api/admin/saved-barcodes` takes `pageSize` (10–50, default 10; other values 400) and `sources`
  (comma list of source ids; unknown ids 400) and returns per-source counts for the pills (counts follow the search
  but not the source filter).

## 33. Choose how the date at the top is written (Cory, 2026-11-18)

**Asked for.** "In settings give options for users to change the date format at the top of the app; do variations
for international users as well. The default is what it is right now."
Calls made for Cory (to confirm): it's a per-person choice in Settings › Profile (beside units), saved on the server;
it changes the date in the page header (the compact centred date, §24) only — other dates in the app stay as they are.

**Choices** (shown in a dropdown, each option previewing today's date in that format):
- **Wednesday, Nov 18** — default (today's look; existing people keep it)
- Wed, Nov 18
- Wednesday, November 18
- 11/18/2026
- Wednesday 18 Nov
- Wed 18 Nov
- Wednesday 18 November
- 18/11/2026
- 18.11.2026
- 2026-11-18
The "Today"/"Yesterday" wording the header already uses, if any, stays as it is. Stored as a key per format
(e.g. `weekday-long-month-short`, `dmy-slash`, `iso`) in user_settings; unknown keys 400; included in backups and
"Download my data" with the rest of user_settings. Formatting is done in one helper (with tests for every choice) so
other places can adopt it later.

## 34. No greeting line; widgets closer to the dates (Cory, 2026-11-18)

**Asked for.** "Remove the greeting 'Good afternoon, Cory · 2-day streak' and move the widgets up closer to the
dates." The Dashboard header loses the greeting/streak line (the Streak widget still shows the streak); the gap
between the week strip and the first row of widgets shrinks to the normal card gap (about 12–16 px).

## 35. Personal API keys (M4b) (Cory, 2026-11-18)

**Asked for.** Personal API keys (M4 part b), with the eye and copy on every key (agreed in §16: stored encrypted so
they can be shown again). Purpose: let Cory's own tools (Home Assistant, n8n, Shortcuts, scripts) read and log his
data, and later the iPhone app.
Calls made for Cory (to confirm): keys belong to one person and act as that person only; two access levels; no key
can reach admin, settings, key, backup or reveal routes.

**Settings › API keys** (everyone; wide tab after Profile, phone row): list of the person's keys — name, the first
characters ("bs_live_3f9a…"), access level, created, last used ("Never" until used). **New key**: name (required,
1–60 chars) and access: **Read only** (default) or **Read and log** (may also add, edit and delete log entries,
weigh-ins, water and shots). The key (`bs_` + 32 random bytes base62) is shown right away with the eye and copy, and
can be shown again later with the eye (owner only; logged; `Cache-Control: no-store`; rate-limited like the other
reveal routes). **Rename**, **Change access**, **Delete** (asks first; takes effect immediately). At most 20 keys
per person.

**Using a key.** `Authorization: Bearer <key>` on any `/api` route the access level allows; the request runs as the
key's owner with the same per-user isolation as a signed-in session. Read only = GET routes of the person's own data
(day, log, foods, my foods, weight, GLP-1, goals/targets, trends, app info). Read and log adds the log/weight/water/
GLP-1 write routes. Never allowed with a key, whatever the level: anything under `/api/admin`, settings and
integration routes, API key routes, backups/restore/export, every "reveal a key" route, sign-in/sessions/passkeys/
password. A wrong, deleted or malformed key → 401 (same message for each); a key without access to a route → 403
"This key can only read" / "Keys can't do that". Rate limit per key (e.g. 120 requests a minute). Each use updates
last used (at most once a minute) and is counted in the app log at debug level (never the key itself).

**Storage.** `api_keys` (user id, name, prefix, a SHA-256 hash for lookup — unique, the key encrypted with
`encryptSecret` for the eye, access, created, last used). Backed up (encrypted copy readable only with the same
`JWT_SECRET`, as for other saved keys); not in "Download my data" beyond name/prefix/access/dates. Deleting a person
deletes their keys. Covered by the isolation test (one person can't list, show, rename or use another's key).

**Help.** Under the list, a short "How to use a key" box: the header line and two copyable curl examples (today's
day: `GET /api/day?date=YYYY-MM-DD`; log water: the water route) with the server's address filled in.

## 36. Invite someone by email (Cory, 2026-11-18)

**Asked for.** Invite by email for new people (the "later" in §20).
Calls made for Cory (to confirm): admin only, in Settings › Users; only offered when email is set up; the person
picks their own password from the link; an invite lasts 7 days.

**Invite.** Settings › Users gets **Invite by email** beside the existing Add person: name, username (suggested
from the email's first part, editable; same rules as Add person) and email. Sends an email: "<admin name> invited
you to ByteSize" with a button/link to `#/invite/<token>` on the configured app address. The person appears in the
list as **Invited** with the email, sent date, **Resend** (new link, old one stops working) and **Cancel invite**
(removes the pending person). Without email set up, the button is shown disabled with "Set up email in Settings ›
Email to invite people".

**Accepting.** The invite page shows "Welcome to ByteSize, <name>", the username (read-only), and new password +
confirm (same password rules as everywhere). On success the person is signed in and goes through first-run setup
like a newly added person. Used, cancelled, superseded or expired (7 days) links → "This invite link has expired or
was already used. Ask <admin> for a new one." Tokens: 32 random bytes, only a hash stored, single use, compared in
constant time; the accept route is rate-limited. An invited person can't sign in until they accept (no password).
Pending invites are skipped by backups like other short-lived tokens (the invited person row itself is kept).

## 38. Demo data for testing (Cory, 2026-11-18)

**Asked for.** "Is there a way to populate the version I'm testing on my Mac with a few months' worth of tracking and
weight loss?"
Cory (follow-up): "I want it in the data I'm testing so I can use it over and over again, not a special one."
Calls made for Cory (to confirm): a command-line tool like reset-password; it fills the account he tests with (his
own, admin included) and can be re-run to wipe and refill it.

**Command.** `cd backend && npm run seed-demo` (Docker: `docker compose exec -u node bytesize npm run seed-demo`).
Options: `--user <username>` (default: the account that set up the server, i.e. the first admin), `--days <n>`
(default 90, 7–365), `--replace`.
- Fills the named existing account (any account, admin included; it never creates accounts). Turns GLP-1 tracking on
  and sets goals (calories 1500–2000, protein 110–130 g, the app's usual other targets) only where they aren't set.
- If the account already has log entries, weigh-ins, water or shots, it stops and says to add `--replace`.
  `--replace` deletes that one account's log entries, weigh-ins, water, shots, and the foods/quick meals the seeder
  made on earlier runs, then fills it again — meant to be run over and over. Nothing else of that account (settings,
  keys, other My foods) and nothing of any other account is touched, except what filling it sets, which it says
  at the end ("Also set: …"): the body weight follows the latest weigh-in (as for any weigh-in), the GLP-1 settings
  match the seeded shots, and three App info counts are set (so re-runs give the same numbers); "Made a starter
  profile" when the account had no body details (needed for GLP-1 tracking and the weight goal). `--replace` also
  deletes that account's Undo records of combined entries (their entries are gone); earned badges are left as they
  are. It prints what it deleted and what it made.
- Plans (Cory, after testing: "everything before today says there is no plan"): when the account's earliest plan
  starts after the first seeded day (e.g. set up today), a copy of it — same plan and numbers — is added starting on
  the first seeded day, so every seeded day has a plan. Re-runs don't add another copy.
- Same output every run for the same options and day (seeded random), ending today in the server's time zone.

**What it makes** (all through the same tables/rules the app uses, so totals, rings, streaks, trends, badges and
App info read it normally):
- ~25 **My foods** with full nutrition (e.g. oatmeal, eggs, Greek yogurt, berries, banana, apple, almonds, protein
  shake, chicken breast, salmon, turkey sandwich, salad, rice, sweet potato, broccoli, cottage cheese, string
  cheese, granola bar, coffee with milk, a burrito bowl, pizza slice, a few with a barcode) and two quick meals.
- **Food log**: breakfast, lunch, dinner most days and snacks on many; daily calories mostly inside 1500–2000 with
  some over/under days, protein mostly 100–135 g; appetite a bit lower in the two days after each shot; about 1 day
  in 20 left empty (so streaks have breaks); today has breakfast only. Some entries combined amounts (e.g. 2 eggs).
- **Weigh-ins** most mornings (skips ~1 in 5): starts at 245 lb and trends down ~1.5–2 lb a week with day-to-day
  noise of about ±1.5 lb and one small plateau; stored in the person's units.
- **GLP-1 shots** weekly on the same weekday: 2.5 mg for 4 weeks, then 5 mg, then 7.5 mg; sites rotate.
- **Water** most days (4–9 glasses); supplements if the app tracks them.
- A few **App info** counts (barcodes scanned, lookups saved, AI estimates) so that tab isn't empty.
- Tested: the account is filled; a second run without --replace changes nothing; --replace refills it and touches
  only that account's tracking rows and seeded foods (other My foods and other accounts untouched); totals for a sample day are within the ranges above.

## 37. Cleanup round (Cory, 2026-11-18)

**Asked for.** Cory: "let's do … 3" — the small items deferred from the reviews of §23–34. Each is a fix with a test;
none changes how a feature is meant to work.
- **Describe it**: ‹ Back while an estimate runs cancels it (as Cancel does). The AI is told to fill
  `interpretedAs` only when it changed or guessed what was typed (a misspelling, an unclear name), not when it merely
  reworded clear input ("a large banana" must not ask "Did you mean Banana, large?").
- **Estimate area**: no stray gap above it while idle (the always-mounted status region takes no space when empty).
- **Header date**: shows the person's chosen format from the first paint (remembered on this device and confirmed
  when settings load), instead of the default flashing first; the same for week start if it has the same flash.
- **Combining entries** (§28): two adds of the same food racing into a meal never leave two rows (serialise per
  person, day and meal, e.g. an advisory lock); moves in opposite directions can't deadlock (lock rows in id order);
  Undo splits using what the combine actually added (unit, serving and amount recorded when combining) so a later
  change to the food's servings can't make Undo fail or pick the wrong serving; a note whose Undo became impossible
  (409) says so and then goes away on its own like any note; a note that appears while an are-you-sure is open is
  reachable inside it.
- **Plurals**: compound names whose first word is a measure but isn't the counted thing stay right — "2 tortilla
  chips", "2 cookie dough bites", "2 roll-ups" style names pluralise the last word; "cookies" etc. singularise
  correctly. Tests for each.
- **Edit dashboard**: keyboard focus stays on the moved widget's button after a move across columns (or on the
  nearest sensible control when that button becomes disabled).
- **Drag in a real browser**: check edit-mode drag within and across columns with a real browser (puppeteer, mouse
  events) on the wide layout, fix what doesn't work, and keep the script as a smoke test outside the unit suites.
- **Layout constants**: the frontend's layout version/column count are checked against the backend's by a test
  (as the ids already are).
- **Tests that flake when the machine is busy**: the backup "two backups at once" lock test and the occasional
  deadlock in the truncate between tests — make them deterministic rather than retried.
- **App info tests**: the failing-count test asserts the app_log line; Culury counts exactly; Check for changes is
  counted for every source (USDA, FatSecret, Spoonacular), not just Open Food Facts.
- **Drinks**: the comment on bare amounts says that "1 cup"/"2 tbsp" style servings count as bare amounts or not —
  whichever the code does — and a test pins it.

## 39. Tap the date for a calendar (Cory, 2026-11-18)

**Asked for.** "Make the date clickable; when clicked it pulls up a calendar view; a dot shows what days a user logged
info on."
Calls made for Cory (to confirm): a dot means the day has at least one food entry (the same rule as "Days logged" and
streaks; water, weigh-ins and shots alone don't count); tapping a day goes to that day.

**Opening it.** The centred date in the page header (§24/§33, in the person's chosen format) is a button
("Choose a day", aria-haspopup="dialog", aria-expanded). Tapping it opens a small calendar right under it (a popover on
wide screens; on phones the same panel full-width under the header). It closes with the X, Escape, choosing a day, or
tapping the date again — not by clicking outside (§27).

**Calendar.** One month at a time, opening on the month of the day being viewed: month and year title with ‹ › to
change month and a **Today** button; weekday letters starting on the person's week start; 6 rows. Each day shows its
number; a small dot under days with food logged; today has a ring; the day being viewed is filled. Days after today
are shown but can't be chosen (dimmed), matching the week strip. Arrow keys move between days, Enter chooses, Page Up/
Down change month; focus starts on the viewed day; screen readers hear "Wednesday, November 18, logged" / "not
logged".

**Server.** `GET /api/log/days?from=YYYY-MM-DD&to=YYYY-MM-DD` → `{ days: ["YYYY-MM-DD", …] }`, the person's dates with
at least one food entry in that range (inclusive; range at most 62 days, else 400; bad dates 400). Per-user isolation
test. The calendar asks for the visible 6-week span and caches months it has seen until a log change.

## 40. Goals page widgets, goal date, activity, and goals with a start and end (Cory, 2026-11-18)

**Asked for** (Cory, in his words, condensed): get rid of the GLP-1 button on Goals; Vacation mode belongs under
Settings › Profile; add fitness/habit goals by week or month with a start and end, progress charts, complete or not,
and a "Past goals" list when a new one replaces it — steps (from Apple Health), workouts, tracking days ("track 7
days this week"), and more; a widget for when you'll reach your goal weight at the current pace, as a range ("23–25
weeks, near April 5"); the Goals page's widgets movable like the Dashboard's. Habits (logging, protein, water) and
activity are all important; activity is entered by hand or comes from the phone when Health is on. Workout calories:
a plan setting — add them back, or just note the "earned" calories, or a weekly bank to spend on a treat.
**Why.** Cory is losing weight on a GLP-1 and wants the app to keep habits and activity visible week to week, and to
see where he's headed.
**Goals.** Habit and activity goals that run on the person's own data; honest progress (worked out from the data,
not ticked by hand); a goal date that admits uncertainty. **Non-goals.** AI Insights (a later project); reading Apple
Health from the web (the iPhone app, M5, will send it through the API); social/sharing. **Anti-goals.** Anything that
rewards eating under the plan (food calories never go into the bank); a goal date presented as a promise.

**Approaches considered.** (Chosen) reuse the §28 widget system with a layout per page; a separate Goals-only system
was dropped (every fix twice). Activity before goals — goals first was dropped (half the goal types would have no
data). Goal progress worked out live and frozen when the goal ends; storing daily progress was dropped (drifts from
the data). Three parts, built in order; each ships on its own.

### 40a. Goals page as widgets; goal-date widget; two moves

- **Widgets per page.** The §28 layout API gains a page: `GET/PUT /api/layouts/:page` with `page` ∈ {dashboard,
  goals} (the existing `/api/dashboard/layout` stays as an alias for dashboard). Each page has its own registry
  default, its own saved layout, edit mode, Add widget, Save/Cancel/Reset, phones in reading order — exactly as §28.
  A widget may be offered on both pages (registry entries list the pages they fit); each page's layout is separate.
- **Goals page widgets** (default order): left — **Your plan** (today's plan card: change plan, edit targets, edit
  my details), **Goal date**; right — **Weight** (the chart with start/now/goal), then full-width-ish **Weekly
  trends** and **Badges** in the right column under Weight. (Builder may adjust columns so the default looks like
  today's page.) Goal widgets from 40c are added here too.
- **Removed from Goals:** the "GLP-1 shots" button (GLP-1 is reached from the side menu / its own page). **Vacation
  mode** moves to Settings › Profile (same control and behaviour), not on Goals.
- **Goal date widget** ("Goal date"; also offered on the Dashboard). Uses the trend weight (§13 A) over the last 6
  weeks (at least 14 days and 6 weigh-ins, else "Keep weighing in — about two weeks of weigh-ins gives an estimate").
  Pace = the slope of a least-squares line through those trend points; the range comes from the slopes of the
  first and second halves of that window, or ±15% of the pace if that's wider, so a bumpy stretch widens it. Shows:
  "At your pace: **23–25 weeks**, around **Apr 5**" with the earliest–latest dates under it ("Mar 22 – Apr 19"),
  the pace ("−1.4 lb a week"), and how far to go ("39.4 lb to go"). Goal reached → "You've reached your goal 🎉";
  gaining or flat → "At this pace you're not heading toward your goal yet" (no date); no goal weight → a link to set
  one. Weeks rounded to whole weeks; dates in the person's date format (§33). Pure function with tests (steady,
  bumpy, gaining, reached, too little data, metric).

### 40b. Activity: steps and workouts, and workout calories in the plan

- **Data.** `activity_steps` (user, day, source `manual`|`health`, steps; one row per user/day/source) — the day's
  steps are the Health number when there is one, else the typed one. `workouts` (user, day, type, minutes,
  calories (nullable), source `manual`|`health`, an external id for Health de-duplication (unique per user when
  present), note). Types: walk, run, cycling, strength, swim, hike, yoga, HIIT, sport, other. Per-user isolation,
  backed up, in "Download my data".
- **Entering.** An **Activity** widget (Dashboard and Goals): the viewed day's steps (with a small bar toward the
  person's step goal if they have one), workouts listed (type icon, minutes, calories), and **+ Steps** (set the
  day's total) and **+ Workout** (type, minutes, calories optional with a "Estimate" helper from type × minutes ×
  body weight using standard MET values, note). Tap to edit/delete. Typed entries for days in the past are allowed;
  future days not.
- **API.** Routes to read/write steps and workouts, added to the API key allow-list: reading for Read only keys,
  writing for Read and log keys. Health-sourced writes (`source: "health"`) upsert by external id / by day, so a
  phone can resend safely. Documented in the "How to use a key" box with a Shortcut-friendly example for steps.
- **Workout calories in the plan** — a setting in Goals › Your plan ("Workout calories"), per person:
  1. **Just show them** (default): "Earned today: 320" on the budget and Day totals widgets; ranges unchanged.
  2. **Add to that day**: the day's calorie range (min and max) grows by earned × the *count* (25/50/75/100%,
     default 50%).
  3. **Weekly bank**: earned × count goes into a bank for the week (resets on the person's week start; unspent
     calories don't carry over; cap 1,000 a week by default, adjustable 0–5,000). The budget widget shows "Bank: 640
     this week" with a small per-day bar. A day that ends over its range takes the overage from the bank first and
     shows "Over by 250 — covered by your bank"; a covered day counts as in range for streaks, badges and goals.
     A **Treat** toggle when logging a food spends from the bank on purpose (the entry is marked as a treat and the
     bank shows it). Only workout calories go in — never food calories left unused.
  Changing the mode applies from that day forward (past days keep what they had, like plan changes).

### 40c. Goals with a start and end

- **A goal** = type, target number, period (**each week** — following the week start — **each month**, or **the
  whole stretch**), start date, end date (or "ongoing" for each-week/each-month goals), name (defaulted from the
  type). Types:
  - Habits: **Logging days** (days with food logged), **Protein days** (protein min reached), **Calorie days**
    (calories in range, bank-covered days count), **Water days** (water min reached), **Weigh-ins** (days weighed),
    **Fiber days**, **Streak** (reach an N-day streak within the stretch).
  - Activity: **Steps** (total per period, or average per day — pick), **Workouts** (count per period), **Active
    minutes** (total per period).
  - Weight: **Weight by a date** (trend weight at or under X by the end date).
- **Progress** is worked out from the data each time it's shown. Each goal is a widget (on Goals by default; can be
  added to the Dashboard): a ring for the current period ("4 of 6 days this week", "38,200 of 70,000 steps"), a small
  chart of past periods (bars, hit periods filled), and the overall result so far ("3 of 4 weeks hit"). When the end
  date passes, the result is **frozen** (✓ completed / ✗ missed, with the numbers) so later edits to old days can't
  flip it.
- **Managing.** + New goal (from the Goals page edit area and a "Goals" widget listing active goals with + New
  goal). Edit (target, name, end date) and End now. A new goal of the same type replaces the active one (the old
  one ends today and moves to Past goals). **Past goals**: a widget/list of finished goals newest first with ✓/✗,
  the dates and the final numbers; delete from there.
- **Data**: `goals` (user, type, target, period, start, end, name, created, ended, frozen result json). Isolation,
  backup, export. API routes readable by Read only keys.
- **Badges**: completing a goal earns a "Goal met" badge (the existing badge system).

**Left to the builder.** Visual design within the app's existing style; chart details; exact copy beyond the above;
how the registry marks which pages a widget fits.
