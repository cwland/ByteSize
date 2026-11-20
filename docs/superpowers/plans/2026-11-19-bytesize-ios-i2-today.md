# ByteSize iOS — Round I2 (Today) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Dashboard (date strip, Today's Overview, Water, Weight, Streak, Badges, Shot tracking — rearrangeable and saved to
the server) and the Food Log (entries by meal, edit portion, swipe Move / Copy / Delete with Undo) for the selected day.

**Architecture:** Builds on I1 (`ios-i1`). One `DayStore` (@Observable) owns `selectedDate` and the loaded day; Dashboard and
Food Log both read it and re-fetch after every write (the server does all nutrition math). Two small server additions,
test-first in Vitest: an `ios` widget layout page, and a 10-minute trash so a deleted log entry can be restored exactly.

**Tech Stack:** Swift 6 / SwiftUI / Observation / XCTest (iOS 17+), Fastify + Drizzle + Postgres + Vitest (server).

**Spec:** `docs/superpowers/specs/2026-11-19-bytesize-ios-design.md` (§6.3, §6.4 Dashboard + Food Log, §6.7 changes 1 and 7,
§6.10 "I2"). I1 plan (conventions, Mac runner): `docs/superpowers/plans/2026-11-19-bytesize-ios-i1-foundation.md`.

## Global Constraints

- Everything in I1's Global Constraints still holds (iOS 17, no third-party packages, server-only networking, Keychain token,
  accessibility labels on icon-only controls, tests on the MacBook via n8n "Claude – MacBook Pro Command Runner";
  simulator test runs **signed** with `CODE_SIGN_IDENTITY=-`).
- Server is the source of truth for all numbers: the app never sums nutrients itself; it shows `GET /api/day/:date`'s
  `totals`, `meals` and `targets`. Unknown nutrients count as 0 (Cory's rule) — missing keys display as 0.
- Targets are ranges (`{min, max}`): the calorie budget bar shows "N to go" (below min), "In range", "N over" (above max);
  rings are full at the range **minimum**.
- "Today" is the account's timezone (`User.timezone`, e.g. `America/Boise`), not the phone's, so the app and web agree.
- Units: `User.units` `imperial` → lb and fl oz; `metric` → kg and ml. The server stores kg and ml.
- Meals in order: breakfast, lunch, dinner, snacks, supplements — titles "Breakfast", "Lunch", "Dinner", "Snacks",
  "Supplements & water".
- Delete is immediate with a 5-second Undo toast; Undo restores the entry exactly (same id, portion, time, AI flag).
- Server tests: `cd backend && npm test` against a local Postgres 16 (`TEST_DATABASE_URL`, default
  `postgresql://bytesize:bytesize@localhost:5432/bytesize_test`). New migrations via `npm run db:generate`.
- No change to the web app's behavior.
- The entry edit sheet changes amount and serving only: changing the meal is Move, and entries have no editable time on the
  server (the spec's "time" field is dropped for now).

## Review Focus

1. **Day boundary in another timezone** (phone in Eastern, account in Boise, 11:30 pm) → "Today" and the date strip use the
   account's day; logging lands on the day shown. Pinned in Task 4.
2. **Undo after the trash window or after the entry was moved/copied elsewhere** → a clear "That's too late to undo" toast,
   nothing duplicated. Pinned in Tasks 2 and 8.
3. **A day with no targets yet (no plan chosen on the web)** → Overview shows totals without bars/rings and a line
   "Choose a plan in the web app to see your targets", no crash. Pinned in Task 5.
4. **A late 401 from a previous login's request** (signed out and back in quickly) → must not sign out the new login.
   Pinned in Task 3 (deferred minor from I1).
5. **Switching days quickly** (tap three days fast on the strip) → the screen ends on the last day tapped, never an older
   day's answer arriving late. Pinned in Task 4.

---

## File structure

```
backend/src/lib/widgets.ts                  + NATIVE_PAGES ["ios"], ALL_LAYOUT_PAGES, PAGE_WIDGETS.ios
backend/src/routes/dashboard.ts             page param accepts ALL_LAYOUT_PAGES
backend/src/db/schema.ts                    + logTrash table
backend/drizzle/0024_log_trash.sql          generated
backend/src/routes/log.ts                   DELETE moves the row to the trash; POST /api/log/:id/restore
backend/tests/ios-widgets.test.ts           ios page accepted; ids match ios/…/DashboardWidget.swift
backend/tests/log-restore.test.ts           delete → restore round trip and its refusals
ios/ByteSizeKit/Sources/ByteSizeKit/
  Models/{Nutrients,Meal,LogEntry,DayView,Units}.swift
  API/LogAPI.swift, API/BodyAPI.swift       endpoint builders (log, day, layouts, weight, glp1, badges, settings/me)
  Features/DayStore.swift                   selectedDate, today, week strip, logged dots, load/reload
  Features/Overview.swift                   budget-bar and ring maths (pure)
  Features/DashboardModel.swift             widget layout + edit mode + widget data (weight, shot, badges, water buttons)
  Features/Badges.swift                     badge id → name + emoji (ported from frontend/src/components/goals/Badges.tsx)
  Features/FoodLogModel.swift               sections, edit, move/copy, delete + undo
ios/ByteSize/Dashboard/*.swift              DashboardView, widgets, edit drawer, weight + shot sheets
ios/ByteSize/FoodLog/*.swift                FoodLogView, EntryRow, EditEntrySheet, MoveCopySheet, UndoToast
ios/ByteSize/Testing/StubServer.swift       + day, logged, layouts, weight, glp1, badges, settings/me, log writes
ios/ByteSizeUITests/SmokeUITests.swift      + dashboard + food log checks
```

---

### Task 1: Server — `ios` widget layout page

**Files:** Modify `backend/src/lib/widgets.ts`, `backend/src/routes/dashboard.ts`. Test `backend/tests/ios-widgets.test.ts`.
Create `ios/ByteSizeKit/Sources/ByteSizeKit/Features/DashboardWidget.swift` (only the enum).

**Interfaces:**
- Produces (server): `export const NATIVE_PAGES = ["ios"] as const; export const ALL_LAYOUT_PAGES = [...LAYOUT_PAGES, ...NATIVE_PAGES]`;
  `PAGE_WIDGETS.ios = ["calendar", "overview", "water", "weight", "streak", "badges", "shots"]`. `LAYOUT_PAGES` (web) is unchanged so
  `widgets-sync.test.ts` still compares only web pages. Goal widgets are not offered on `ios`.
- Produces (Swift): `public enum DashboardWidget: String, CaseIterable, Sendable { case calendar, overview, water, weight, streak, badges, shots }`
  (`allCases` order = the default layout).

- [ ] **Step 1: Failing tests** — `GET /api/layouts/ios` → 200 `null` for a new user; `PUT /api/layouts/ios {version:1, columns:[["overview","water"]]}` → saved and read back; `PUT` with `"food"` (a web widget) → 400; the ids in `PAGE_WIDGETS.ios` equal the `case` names parsed from `DashboardWidget.swift` (read as text, like `widgets-sync.test.ts`).
- [ ] **Step 2: Run** `cd backend && npx vitest run tests/ios-widgets.test.ts` → FAIL ("There's no such page").
- [ ] **Step 3: Implement**; the Dashboard-only extras in `dashboard.ts` (`offerInsights`) stay keyed to `"dashboard"`.
- [ ] **Step 4: Run** the file, then the whole backend suite → PASS.
- [ ] **Step 5: Commit** — `server: ios widget layout page`

### Task 2: Server — undo for deleted log entries

**Files:** Modify `backend/src/db/schema.ts`, `backend/src/routes/log.ts`; generate `backend/drizzle/0024_log_trash.sql`. Test `backend/tests/log-restore.test.ts`.

**Interfaces:**
- Produces: table `log_trash (id serial pk, user_id int not null → users on delete cascade, entry_id int not null, row jsonb not null, deleted_at timestamptz not null)`, index `(user_id, entry_id)`.
  `DELETE /api/log/:id` (unchanged answer: 204) now, in one transaction, deletes the row and inserts it (all columns, as JSON) into `log_trash`, and removes that user's trash older than 10 minutes.
  `POST /api/log/:id/restore` → 200 `{ entry: LogEntry }` re-inserting the row with its original `id`, `createdAt` and every field, then removes it from the trash. 404 `"That's too late to undo"` when it isn't in the caller's trash, is older than 10 minutes, or an entry with that id exists.
- Constant `TRASH_MS = 10 * 60 * 1000` in `log.ts`.

- [ ] **Step 1: Failing tests** — delete then restore → `GET /api/day/:date` has the entry with the same id, quantity, fraction, `aiEstimated`, and the same position (createdAt order); restore twice → second 404; another user's restore of my id → 404 and my trash untouched; restore after `app.now()` advanced 11 minutes → 404 `"That's too late to undo"`; a delete purges that user's trash older than 10 minutes (row count); restoring a water entry works.
- [ ] **Step 2: Run** → FAIL (route missing). **Step 3: Implement** (schema → `npm run db:generate` → route). Re-inserting with an explicit id must not break the `log_entries` id sequence (ids only come back, never new).
- [ ] **Step 4: Run** the file and the whole backend suite → PASS. **Step 5: Commit** — `server: restore a deleted log entry within 10 minutes`

### Task 3: iOS — models, endpoints, and the late-401 fix

**Files:** Create `Models/{Nutrients,Meal,LogEntry,DayView,Units}.swift`, `API/LogAPI.swift`, `API/BodyAPI.swift`; modify `Auth/AuthModels.swift` (`User.timezone: String?`), `Auth/SessionStore.swift`. Tests `ModelsTests.swift`, `LogAPITests.swift`, `SessionStoreTests.swift` (+1).

**Interfaces:**
- `public struct Nutrients: Codable, Equatable, Sendable { public subscript(_ key: String) -> Double }` (missing → 0; decodes any `{key: number|null}`), keys used: `calories, protein_g, fiber_g, carbs_g, fat_g, water_ml`.
- `public enum Meal: String, Codable, CaseIterable, Sendable { case breakfast, lunch, dinner, snacks, supplements; public var title: String }`; `Meal.suggested(at: Date, in: TimeZone) -> Meal` using the server's default meal windows (breakfast < 10:30, lunch < 14:30, snacks < 17:00, dinner < 21:00, else snacks).
- `public struct Serving: Codable, Equatable, Sendable { label: String; grams: Double?; ml: Double? }`;
  `public struct LogEntry: Codable, Identifiable, Equatable, Sendable { id, day: String, meal: Meal, name, brand: String?, icon: String, servingIndex: Int, unit: String, quantity: Double, fraction: Double, servings: [Serving], nutrients: Nutrients, aiEstimated: Bool, source: String; var isWater: Bool { source == "water" }; var amountText: String }` — `amountText`: water → "500 ml" (or fl oz by units, passed in), food → "1.5 × 1 cup" / "½ × 1 bar" for fractions ¼ ⅓ ½ ¾.
- `public struct Range: Codable, Equatable, Sendable { min: Double; max: Double }`; `public struct DayTargets: Codable … { calories, protein_g, fiber_g, water_ml: Range }`; `public struct MealTotals: Codable … { calories, protein_g, carbs_g, fat_g, fiber_g: Double }`;
  `public struct DayView: Codable, Equatable, Sendable { day: String; entries: [LogEntry]; totals: Nutrients; meals: [String: MealTotals]; targets: DayTargets?; streak: Int }`.
- `public enum Units { case imperial, metric }` with `weight(kg:) -> String` ("181.4 lb" / "82.3 kg", one decimal), `water(ml:) -> String` ("16 fl oz" / "500 ml", whole numbers), `kg(fromDisplay:)`.
- Endpoints (`public enum LogAPI`): `day(_ day: String) -> Endpoint<DayView>` (GET `/api/day/:day`), `logged(from:to:) -> Endpoint<LoggedDays>` (`{days: [String]}`), `water(ml: Int, day: String)` (POST `/api/log` `{water_ml, day}`) → `Endpoint<EntryResponse>`, `update(id:quantity:fraction:servingIndex:unit:)` (PATCH, only non-nil fields) → `EntryResponse`, `delete(id:) -> Endpoint<Empty>`, `restore(id:) -> Endpoint<EntryResponse>`, `move(ids:day:meal:copy:) -> Endpoint<EntriesResponse>`.
  `public enum BodyAPI`: `settings() -> Endpoint<MySettings>` (`{waterButtonsMl: [Int], weekStart: Int, glp1On: Bool}`), `weight(from:) -> Endpoint<WeightView>` (`{weighIns:[{day, weightKg, trendKg}], latest: {day, weightKg}?, goalKg: Double?}`), `saveWeight(day:kg:)` (PUT `/api/weigh-ins/:day` `{weightKg}`), `deleteWeight(day:)`, `glp1() -> Endpoint<Glp1View>` (`{settings:{medication,doseMg,injectionWeekday}?, lastShot:{day,medication,doseMg,site}?, nextDue: String?, status: "none"|"upcoming"|"due"|"overdue", overdueDays: Int, suggestedSite: String}`), `logShot(day:site:doseMg:)` (PUT `/api/glp1/shots/:day`), `badges() -> Endpoint<BadgesView>` (`{badges:[{id, earnedOn: String?, count: Int?}]}`), `layout() -> Endpoint<SavedLayout?>` and `saveLayout(_ ids: [String])` (GET/PUT `/api/layouts/ios`, body `{version: 1, columns: [ids]}`).
- `SessionStore`: each login gets a generation number; a client's sign-out-on-401 hook only acts if its generation is the current one.

- [ ] **Step 1: Failing tests** — decode a real-shaped `GET /api/day` fixture (copy one from `backend/tests/log.test.ts` expectations: entries with fraction 0.5, a water entry, `targets: null` variant, `nutrients` with a null value); `Nutrients["fiber_g"] == 0` when missing; `Meal.suggested` at 07:00 / 12:00 / 15:00 / 18:00 / 22:00 in `America/Boise`; `amountText` for 2 × "1 cup", ½ × "1 bar", 500 ml water imperial → "17 fl oz"; `Units` formatting; each endpoint's method, path and JSON body (PATCH sends only given fields); `testOldLoginCannotSignOutNewOne` — client from login 1 gets a 401 after login 2 → still signed in.
- [ ] **Step 2: Run** `swift test` → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** — `ios: day, log and body models and endpoints; ignore a stale login's 401`

### Task 4: iOS — `DayStore` (selected day, today, week strip)

**Files:** Create `Features/DayStore.swift`. Test `DayStoreTests.swift`.

**Interfaces:**
- `@MainActor @Observable public final class DayStore { public init(api: APIClient, timeZone: TimeZone, weekStart: Int = 0, now: @escaping () -> Date = Date.init); public private(set) var selected: String; public var today: String; public private(set) var day: DayView?; public private(set) var loading: Bool; public private(set) var error: String?; public private(set) var loggedDays: Set<String>; public func select(_ day: String) async; public func reload() async; public func week(containing day: String) -> [String]; public func shiftWeek(_ by: Int) async }` — days are `YYYY-MM-DD` strings in the account's timezone.

- [ ] **Step 1: Failing tests** — `today` for `2026-11-20T06:30Z` in `America/Boise` is `2026-11-19`; `week(containing: "2026-11-19")` with weekStart 0 → Sun 11-15 … Sat 11-21, with 1 → Mon 11-16 … Sun 11-22; `select` loads `/api/day/<d>` and `/api/days/logged?from=&to=` for that week; **race**: select A (slow), then B (fast) → `selected == B` and `day.day == B` after both finish (use `HTTPStub` with a delay per path — add `.delayed(TimeInterval, Reply)` to `HTTPStub`); `reload` keeps the day; a failed load sets `error` and keeps the previous `day`.
- [ ] **Step 2–4:** RED → implement (each load carries a request number; answers for an older number are dropped) → GREEN.
- [ ] **Step 5: Commit** — `ios: DayStore for the selected day`

### Task 5: iOS — Overview maths and badge names

**Files:** Create `Features/Overview.swift`, `Features/Badges.swift`. Tests `OverviewTests.swift`, `BadgesTests.swift`.

**Interfaces:**
- `public enum BudgetStatus: Equatable { case toGo(Int), inRange, over(Int) }`; `public func budget(calories: Double, range: Range) -> BudgetStatus`; `public extension BudgetStatus { var text: String }` → "362 to go", "In range", "180 over".
- `public func ringProgress(value: Double, range: Range) -> (fraction: Double, over: Bool)` — fraction = value / min capped at 1; `over` when value > max; min 0 → fraction 1.
- `public struct BadgeInfo: Equatable { name: String; icon: String }`; `public func badgeInfo(_ id: String, units: Units) -> BadgeInfo` — **port the exact names and icons from `frontend/src/components/goals/Badges.tsx`** (lost_N lb ↔ kg rule included).
- `public func overviewNotice(_ day: DayView) -> String?` → "Choose a plan in the web app to see your targets" when `targets == nil`.

- [ ] **Step 1: Failing tests** — budget 1138 in 1500–2000 → `.toGo(362)` "362 to go"; 1750 → `.inRange`; 2180 → `.over(180)` "180 over"; ring 97 of 110–130 → 0.8818…, not over; 140 → 1, over; min 0 → 1; every badge id the server's `badgeList` can produce (`first_weigh_in`, `lost_5`, `lost_10`, `halfway`, `goal_reached`, `streak_7`, `shots_on_time_4`, `goal_met`) has the web's name and icon; `lost_5` metric → "2 kg" wording as the web does; notice for a day without targets.
- [ ] **Step 2–4:** RED → implement → GREEN. **Step 5: Commit** — `ios: overview maths and badge names`

### Task 6: iOS — Dashboard model (layout, edit mode, widget data, water/weight/shot actions)

**Files:** Create `Features/DashboardModel.swift`. Test `DashboardModelTests.swift`.

**Interfaces:**
- `@MainActor @Observable public final class DashboardModel { public init(api: APIClient, dayStore: DayStore, units: Units); public private(set) var widgets: [DashboardWidget]; public var hidden: [DashboardWidget] { allCases not in widgets }; public private(set) var editing: Bool; public func load() async; public func startEditing(); public func move(from: IndexSet, to: Int); public func remove(_ w: DashboardWidget); public func add(_ w: DashboardWidget); public func finishEditing() async; public func cancelEditing(); public private(set) var waterButtonsMl: [Int]; public private(set) var weight: WeightView?; public private(set) var glp1: Glp1View?; public private(set) var glp1On: Bool; public private(set) var badges: [BadgeItem]; public func addWater(ml: Int) async; public func logWeight(display: Double) async throws; public func logShot(site: String) async throws; public private(set) var message: String? }`
- Layout load: saved `columns[0]` filtered to known ids (unknown dropped); `null` → `DashboardWidget.allCases`; `shots` hidden by default when `glp1On == false`. `finishEditing` PUTs the order; `cancelEditing` restores the order from before `startEditing`.
- Badges widget shows earned badges, newest `earnedOn` first, at most 4.
- `addWater` posts to `selectedDate` then `dayStore.reload()`; `logWeight` converts from display units, PUTs for `selectedDate`, reloads weight; `logShot` PUTs today's shot with the suggested or chosen site, reloads glp1.

- [ ] **Step 1: Failing tests** — default layout when none saved; saved `[["water","overview","food"]]` → `[.water, .overview]`; `shots` hidden by default without GLP-1; edit → move/remove/add → finish → PUT body `{"version":1,"columns":[[…]]}`; cancel restores; `addWater(250)` posts `{water_ml:250, day: selected}` and reloads the day; `logWeight(181.4)` imperial → PUT `weightKg` 82.28 (±0.01) to `/api/weigh-ins/<selected>`; a 400 from the server sets `message`; badges ordering/limit.
- [ ] **Step 2–4:** RED → implement → GREEN. **Step 5: Commit** — `ios: dashboard model`

### Task 7: iOS — Dashboard views

**Files:** Create `ios/ByteSize/Dashboard/{DashboardView,CalendarStrip,OverviewCard,WaterCard,WeightCard,StreakCard,BadgesCard,ShotCard,WidgetDrawer,WeightSheet,ShotSheet}.swift`; modify `Shell/MainTabView.swift` (Dashboard tab shows `DashboardView`), `RootView.swift`/`ByteSizeApp.swift` (create `DayStore` + `DashboardModel` per sign-in using `user.timezone`, `units`, and `settings().weekStart`).

- [ ] **Step 1:** Build the views (no new logic — everything comes from Tasks 4–6). Card style: `container` background, `line` border, 16 pt corners, as on sign-in. Overview: calorie budget bar with the range band and status text, three rings (protein, fiber, water) with "97 / 110–130 g", carbs and fat figures, the notice when no targets. Calendar strip: 7 days, today marked, dot on logged days, swipe/arrows for weeks, tap selects. Edit: toolbar "Edit" (and long-press on any card) → cards wiggle-free list with drag handles and (−); "Add widget" opens the drawer of hidden widgets; "Done" saves.
- [ ] **Step 2: Verify** — Mac build and existing tests green; simulator screenshot with the stub (Task 10 adds the stub data) checked in Task 10.
- [ ] **Step 3: Commit** — `ios: dashboard widgets`

### Task 8: iOS — Food Log model

**Files:** Create `Features/FoodLogModel.swift`. Test `FoodLogModelTests.swift`.

**Interfaces:**
- `@MainActor @Observable public final class FoodLogModel { public init(api: APIClient, dayStore: DayStore); public var sections: [MealSection] { meals in order with at least one entry, each with its entries and the server's per-meal totals }; public func update(_ entry: LogEntry, quantity: Double, fraction: Double, servingIndex: Int) async; public func move(_ entry: LogEntry, to day: String, meal: Meal) async; public func copy(_ entry: LogEntry, to day: String, meal: Meal) async; public func delete(_ entry: LogEntry) async; public private(set) var undo: UndoOffer?; public func undoDelete() async; public func dismissUndo(); public private(set) var message: String? }`
  with `public struct MealSection: Identifiable { meal: Meal; entries: [LogEntry]; totals: MealTotals }` and `public struct UndoOffer: Equatable { entryId: Int; name: String }`.
- Every write reloads the day. `delete` sets `undo` (the toast is shown for 5 s by the view, which then calls `dismissUndo`). `undoDelete` calls restore; 404 → `message = "That's too late to undo"`.
- Moving an entry into a meal that already has the same food grows that entry (server behavior) — the model just reloads.

- [ ] **Step 1: Failing tests** — sections order and empty meals skipped; `update` sends only changed fields and reloads; `move` → POST `/api/log/move` `{ids:[id], day, meal, copy:false}`; `copy` → `copy:true`; delete → 204, `undo == UndoOffer(id, name)`, day reloaded without it; `undoDelete` → POST restore, reload, `undo == nil`; restore 404 → message "That's too late to undo"; a failing write sets `message` from the server and keeps the day.
- [ ] **Step 2–4:** RED → implement → GREEN. **Step 5: Commit** — `ios: food log model`

### Task 9: iOS — Food Log views

**Files:** Create `ios/ByteSize/FoodLog/{FoodLogView,EntryRow,EditEntrySheet,MoveCopySheet,UndoToast}.swift`; modify `MainTabView.swift` (Food Log tab).

- [ ] **Step 1:** Header with the selected date (◀ ▶ to change day, tap for a date picker) and the day's calories vs budget text. List grouped by meal (meal title + per-meal calories; rows: icon, name, brand, `amountText`, calories, "AI" chip when `aiEstimated`). Tap row → `EditEntrySheet` (quantity stepper/field, fraction chips ¼ ⅓ ½ ¾ 1, serving picker from `servings`; water: just the amount). `.swipeActions(edge: .leading)` **Copy** (`doc.on.doc`); `.swipeActions(edge: .trailing)` **Delete** (destructive, `trash`) and **Move** (`arrow.right.circle`). Move/Copy → `MoveCopySheet` (graphical date picker + meal picker, defaulting to the entry's meal). `UndoToast` at the bottom above the tab bar: "Deleted <name> · Undo", auto-hides after 5 s. Empty day: "Nothing logged yet — tap + to track food".
- [ ] **Step 2: Verify** — Mac build + all tests green.
- [ ] **Step 3: Commit** — `ios: food log screen`

### Task 10: Stub server data, UI tests and screenshots

**Files:** Modify `ios/ByteSize/Testing/StubServer.swift`, `ios/ByteSizeUITests/SmokeUITests.swift`.

- [ ] **Step 1: Failing UI tests** — `testDashboardShowsToday`: after sign-in, "Today's overview" card and "362 to go" (stub day: 1138 kcal, 1500–2000) exist; tap "+8 oz" (or first water button) → water total text changes. `testFoodLogSwipeDeleteAndUndo`: Food Log tab → row "Greek yogurt" exists → swipe left → "Delete" → row gone and "Undo" visible → tap Undo → row back. `testEditLayout`: Edit → remove "Badges" → Done → Badges card gone; relaunch keeps it gone (stub stores the PUT in memory per launch; check within the same launch instead if relaunch resets).
- [ ] **Step 2: Run** on the Mac → FAIL. **Step 3: Implement** stub routes with a small in-memory day (3 food entries + 1 water), logged days, layouts (in memory), weight (5 weigh-ins), glp1 (on, last shot 6 days ago), badges (3 earned), settings/me, log PATCH/DELETE/restore/move/water.
- [ ] **Step 4: Run** the full suite (`swift test`, `xcodebuild test`, backend `npm test`, frontend `npx vitest run`) → all PASS; save screenshots (dashboard, dashboard edit, food log, swipe actions, edit sheet, undo toast) to `~/Documents/ByteSize-shots` and look at each.
- [ ] **Step 5: Commit** — `ios: UI tests for dashboard and food log`; push `ios-i2`.
