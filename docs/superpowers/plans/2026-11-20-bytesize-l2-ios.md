# L2 iPhone — Adding food Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every way of adding food on the iPhone starts in the right meal, and the foods Cory repeats are one tap away
(SPEC-07, SPEC-08, SPEC-10).

**Architecture:** Logic in ByteSizeKit (`TrackFoodModel`, `FoodLogModel`, `ShellModel`, `FoodAPI`, `Food`), tested with
XCTest against `HTTPStub`. Views in the app target; Track Food's `NavigationStack` becomes the hub that pushes Scan,
Photo and Describe. UI covered by XCUITest against the in-app `StubServer`. One small additive server field.

**Tech Stack:** SwiftUI (iOS 17+), Swift 6, XcodeGen, XCTest/XCUITest; Fastify + Vitest for the one server change.

**Spec:** `docs/superpowers/specs/2026-11-20-bytesize-l2-ios-design.md` (backlog: `docs/backlog/2026-11-19-ui-feedback-specs.md`)

## Global Constraints

- Meals with an Add row and always shown: Breakfast, Lunch, Dinner, Snacks. Supplements & water: only when it has entries, no Add.
- Add row text: "Add to <Meal title>" (e.g. "Add to Lunch").
- Quick sections, in order: "Same as yesterday" (header button "Log all"), "Favorites", "Recently tracked". Frequent is gone.
- Empty quick sections are hidden; all empty → "Foods you log show up here."
- Hub buttons under the search field, in order: Photo, Scan, Describe.
- After any log in the hub: stay in Track Food (Scan stays on its camera), show "Logged <name>"; Log all → "Logged <N> foods".
- Bookmark symbols: `bookmark` / `bookmark.fill`; only for foods whose `kind` is `cache` or `user_food` and `isLoggable`.
- Culury recipes and quick meals: no +, no bookmark (as today: not loggable on iPhone).
- (+) menu keeps four buttons; no two buttons' frames (icon + label) intersect.
- Version 0.5.0 with a What's new entry; backend and frontend package versions equal.

## Review Focus

1. **The day being looked at isn't today** (Cory scrolled to yesterday): "Same as yesterday" means the day before *that*
   day, and + / Log all land on the selected day, not today. Pinned in Task 3.
2. **Yesterday had a meal entry with no food behind it** (an AI estimate): it shows, + copies it, tapping it does
   nothing. Pinned in Task 3.
3. **Meal changed inside a pushed Photo/Describe screen**: the search shows that meal after Back, and the next + logs
   into it. Pinned in Tasks 3 and 6.
4. **A favorite toggled while offline/failing**: the bookmark returns to its old state and the message shows; the
   Favorites section is unchanged. Pinned in Task 3.
5. **Opening Track Food from Lunch's Add at 8 am** (time-of-day meal is Breakfast): the sheet says Lunch and logs to
   Lunch. Pinned in Tasks 4 and 5.

---

### Task 1: Server — a correction says which database food it corrects

**Files:**
- Modify: `backend/src/lib/foods.ts` (FoodResult type and `toResult` for user foods)
- Test: `backend/tests/favorites.test.ts`

**Interfaces:**
- Produces: every food result carries `baseCacheId: number | null` — the `food_cache` id a correction (`override`) is
  of; `null` for database foods, custom foods, recipes, quick meals.

- [ ] **Step 1: Failing test** `it("a favorite shown as its correction says which database food it corrects")`: cache a
  food, create an override of it, `PUT /api/foods/favorites {food:{kind:"cache",id}}`, then
  `GET /api/foods/favorites` → `foods[0].kind === "user_food"` and `foods[0].baseCacheId === <cache id>`; a plain
  cached food's result has `baseCacheId: null`.
- [ ] **Step 2:** `cd backend && npx vitest run tests/favorites.test.ts` → FAIL (`baseCacheId` undefined).
- [ ] **Step 3:** add the field in `toResult` (from `user_foods.base_cache_id`; cache results `null`).
- [ ] **Step 4:** full `npx vitest run` and `npm run typecheck` → all pass (update exact-object expectations that now
  include `baseCacheId`).
- [ ] **Step 5:** commit `feat(server): food results carry baseCacheId`.

### Task 2: Kit — Food knows its last amount and its original; the wheel starts there

**Files:**
- Modify: `ios/ByteSizeKit/Sources/ByteSizeKit/Models/Food.swift`, `.../Features/PortionModel.swift`
- Test: `ios/ByteSizeKit/Tests/ByteSizeKitTests/ModelsTests.swift`, `PortionModelTests.swift`

**Interfaces:**
- Produces: `public struct LastPortion: Codable, Equatable, Hashable, Sendable { servingIndex: Int; unit: String; quantity: Double; fraction: Double }`;
  `Food.last: LastPortion?`, `Food.baseCacheId: Int?` (both optional when decoding); `LogEntry.sourceRef: String?`
  (the server's `"cache:42"` / `"user_food:9"`, already sent).
  `PortionModel(food:meal:)` starts at `food.last` when present (unit from `AmountUnit(rawValue:)`, `.serving` →
  `.serving(servingIndex)`, amount `quantity × fraction` split by `PortionModel.split`).

- [ ] **Step 1: Failing tests** `testEntryDecodesSourceRef` (`"sourceRef":"cache:42"` → `"cache:42"`; absent → nil),
  `testFoodDecodesLastAndBase` (JSON with `"last":{"servingIndex":1,"unit":"serving","quantity":6,"fraction":1},"baseCacheId":7`
  → `last?.quantity == 6`, `baseCacheId == 7`; JSON without them → both nil) and `testThePortionStartsAtTheLastAmount`
  (prunes food with that `last` → `choice == .serving(1)`, `whole == 6`, `previewCalories == 180`).
- [ ] **Step 2:** Mac: `cd ios/ByteSizeKit && swift test --filter 'ModelsTests|PortionModelTests'` → FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** `swift test` → all pass.
- [ ] **Step 5:** commit `feat(kit): Food.last and baseCacheId; the wheel starts at the last amount`.

### Task 3: Kit — quick sections, + logging, Log all, favorites

**Files:**
- Modify: `ios/ByteSizeKit/Sources/ByteSizeKit/API/FoodAPI.swift`, `.../Features/TrackFoodModel.swift`
- Test: `ios/ByteSizeKit/Tests/ByteSizeKitTests/TrackFoodModelTests.swift`, `FoodAPITests.swift`

**Interfaces:**
- Consumes: Task 2's `Food.last`, `Food.baseCacheId`; existing `LogAPI.day(_:)`, `LogAPI.move(ids:day:meal:copy:)`, `DayMath.add(_:to:)`.
- Produces:
  - `FoodAPI.sameAsYesterday(day: String, meal: Meal) -> Endpoint<FoodList>` (`GET /api/foods/same-as-yesterday?day=&meal=`),
    `FoodAPI.favorites() -> Endpoint<FoodList>`, `FoodAPI.addFavorite(_ food: Food) -> Endpoint<FavoriteRefs>` (PUT body `{food:{kind,id}}`),
    `FoodAPI.removeFavorite(kind: String, id: Int) -> Endpoint<FavoriteRefs>`; `struct FavoriteRefs: Codable { refs: [String] }`.
  - `public struct YesterdayItem: Identifiable, Equatable { let entry: LogEntry; let food: Food? }` (food = the
    same-as-yesterday food whose `ref` equals `entry.sourceRef`, or whose `baseCacheId` makes `"cache:<id>"` equal it;
    else nil).
  - `TrackFoodModel`: `yesterday: [YesterdayItem]`, `favorites: [Food]`, `recent: [Food]` (`frequent` removed);
    `load()` fetches yesterday's day (`DayMath.add(-1, to: dayStore.selected)`, entries with `meal == self.meal`), same-as-yesterday
    foods, favorites and recent in parallel; `init(api:dayStore:meal: Meal? = nil, now:)` uses `meal` when given;
    `quickLog(_ food: Food) async -> Bool` (logs at `food.last` or 1 × servings[0]);
    `copyYesterday(_ item: YesterdayItem) async -> Bool` and `logAllYesterday() async -> Bool` (move with `copy: true`
    into `dayStore.selected`, `self.meal`); `isFavorite(_ food: Food) -> Bool`; `toggleFavorite(_ food: Food) async`.
  - All logging paths set `lastLogged` ("Banana" / "\(n) foods"), reload the day and `load()` the sections.
  - `isFavorite`: a favorite with the same `ref`, or one whose `baseCacheId` makes `"cache:\(id)"` equal `food.ref`, or
    both with the same non-nil `baseCacheId`. `toggleFavorite` off: DELETE the food's own ref and, if it has a
    `baseCacheId`, `cache:<baseCacheId>` too; on: PUT the food. Optimistic; on failure restore `favorites` and set `message`.

- [ ] **Step 1: Failing tests** (each its own XCTest, stubbed routes):
  - `testQuickSectionsLoadForTheMealAndTheDayBeforeTheSelectedOne` — selected `2026-11-18`, meal `.lunch` → requests
    `GET /api/day/2026-11-17` and `same-as-yesterday?day=2026-11-18&meal=lunch`; `yesterday` holds only that day's lunch entries; no request to `/api/foods/frequent`.
  - `testAnEntryWithoutAFoodIsStillShownButHasNoFood` — yesterday lunch has an AI entry (`sourceRef` null) → item with `food == nil`.
  - `testPlusLogsAtTheLastAmount` — `quickLog(prunes with last 6 × "1 prune")` → POST body `servingIndex 1, unit "serving", quantity 6`, day = selected, meal = model.meal; `lastLogged == "Prunes"`.
  - `testCopyingOneOfYesterdaysEntries` — `copyYesterday(item)` → POST `/api/log/move` `{ids:[id], day: selected, meal: "lunch", copy: true}`.
  - `testLogAllCopiesEveryEntryOfThatMeal` — two lunch entries → one move with both ids; `lastLogged == "2 foods"`.
  - `testAMealGivenWhenOpeningWinsOverTheTimeOfDay` — `TrackFoodModel(api:dayStore:meal:.lunch, now: 8 am)` → `meal == .lunch`.
  - `testBookmarkAddsAndRemoves` — toggle on → PUT; `isFavorite` true; toggle off → DELETE `cache/42`; false.
  - `testUnbookmarkingACorrectionRemovesTheStoredFavorite` — favorites list holds `user_food:9` with `baseCacheId 42`; `isFavorite(cache 42 food)` true; toggle off → DELETEs `user_food/9` and `cache/42`.
  - `testAFailedToggleGoesBack` — PUT returns 500 → `isFavorite` false again, `message` set, `favorites` unchanged.
  - `FoodAPITests.testFavoriteAndSameAsYesterdayEndpoints` — paths, methods, query and body.
- [ ] **Step 2:** `swift test --filter 'TrackFoodModelTests|FoodAPITests'` → FAIL (compile errors on the new API).
- [ ] **Step 3:** implement; update existing TrackFood tests that expected `frequent`.
- [ ] **Step 4:** `swift test` → all pass.
- [ ] **Step 5:** commit `feat(kit): Same as yesterday, Favorites, Recently tracked; + and Log all; bookmark toggle`.

### Task 4: Kit — the four meals always, and opening Track Food in a meal

**Files:**
- Modify: `.../Features/FoodLogModel.swift`, `.../Features/ShellModel.swift`
- Test: `FoodLogModelTests.swift`, `ShellModelTests.swift`

**Interfaces:**
- Produces: `FoodLogModel.sections` = Breakfast, Lunch, Dinner, Snacks always (empty: `entries == []`, `totals == nil`),
  then Supplements only when it has entries; `[]` while the day hasn't loaded. `Meal.addable: Bool` (true for the four).
  `ShellModel.open(_ action: QuickAction, meal: Meal? = nil)` sets `activeAction` and `activeMeal`, closes the menu;
  `choose(_:)` stays as `open(action, meal: nil)`; `activeMeal` cleared when `activeAction` becomes nil.

- [ ] **Step 1: Failing tests** `testEmptyMealsStillShow` (a day with only a dinner entry → sections `[breakfast, lunch, dinner, snacks]`, lunch empty with nil totals; supplements absent),
  `testSupplementsShowWhenLogged`, `testOpeningTrackFoodInAMeal` (`open(.track, meal: .lunch)` → `activeAction == .track`, `activeMeal == .lunch`, `menuOpen == false`).
- [ ] **Step 2:** `swift test --filter 'FoodLogModelTests|ShellModelTests'` → FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** `swift test` → all pass.
- [ ] **Step 5:** commit `feat(kit): every meal shows; Track Food opens in a meal`.

### Task 5: App — Food Log Add rows, quick sections, + and bookmark (with UI tests)

**Files:**
- Modify: `ios/ByteSize/FoodLog/FoodLogView.swift`, `ios/ByteSize/Logging/TrackFoodSheet.swift`,
  `ios/ByteSize/Logging/PortionSheet.swift` (`FoodPortionView` bookmark), `ios/ByteSize/Shell/MainTabView.swift`
  (seed the meal), `ios/ByteSize/Testing/StubServer.swift`
- Test: `ios/ByteSizeUITests/SmokeUITests.swift`

**Interfaces:**
- Consumes: Tasks 3–4.
- Produces: accessibility ids `addTo-<meal rawValue>` (Add rows), `quickAdd-<food name>` (+), `logAllYesterday`,
  `bookmark` (toolbar button, label "Add to Favorites" / "Remove from Favorites"); section headers as in Global Constraints.
  `FoodPortionView` gains `favorite: (isOn: Bool, toggle: () async -> Void)?` (nil hides the button).
- Stub server: `GET /api/foods/same-as-yesterday`, `GET/PUT/DELETE /api/foods/favorites…` (in-memory set of refs),
  yesterday's day with a Lunch entry "Oatmeal" (food) and "Plate estimate" (AI, no `sourceRef`), `POST /api/log/move` copy.

- [ ] **Step 1: Failing UI tests:**
  - `testEmptyMealsHaveAddAndOpenInThatMeal` — Food Log → `addTo-lunch` exists → tap → Track Food's meal picker reads "Lunch".
  - `testPlusLogsFromSameAsYesterdayAndLogAll` — open from `addTo-lunch` → "Same as yesterday" shows Oatmeal and Plate estimate → `quickAdd-Oatmeal` → "Logged Oatmeal" → `logAllYesterday` → "Logged 2 foods" → Close → Food Log Lunch shows Oatmeal and Plate estimate.
  - `testBookmarkMakesAFavorite` — search "prun" → Prunes → `bookmark` → Back → clear search → "Favorites" shows Prunes.
- [ ] **Step 2:** Mac UI run of these three → FAIL.
- [ ] **Step 3:** implement; remove the "Nothing logged yet" text.
- [ ] **Step 4:** full UI suite → all pass; screenshot each new screen (`15-food-log-add`, `16-quick-sections`, `17-bookmark`).
- [ ] **Step 5:** commit `feat(ios): meal Add rows, quick sections with + and Log all, bookmark`.

### Task 6: App — Track Food hub and (+) menu spacing (with UI tests)

**Files:**
- Modify: `TrackFoodSheet.swift`, `ScanSheet.swift`, `PhotoSheet.swift`, `DescribeSheet.swift`, `MainTabView.swift`
  (`QuickActionSheet`), `ios/ByteSize/Shell/RadialMenu.swift`
- Test: `SmokeUITests.swift`

**Interfaces:**
- Consumes: Task 3's `TrackFoodModel.meal`.
- Produces: hub button ids `hub-photo`, `hub-scan`, `hub-describe`. Scan/Photo/Describe take an `onLogged: (String) -> Void`
  and a `Binding<Meal>` (or the track model) so they use and change Track Food's meal; pushed inside Track Food they pop
  back with "Logged …"; opened from the (+) menu they behave as in 0.4.0. `EstimateModel.meal` follows the bound meal.

- [ ] **Step 1: Failing UI tests:**
  - `testHubOpensScanInsideTrackFoodAndBack` — Track Food → `hub-scan` → camera screen (or typed-barcode field) → Back → search field visible, sheet still open.
  - `testDescribeInTheHubLogsIntoTheChosenMealAndComesBack` — open from `addTo-dinner` → `hub-describe` → describe "2 eggs and toast" → Log all → back on search with "Logged 2 foods" (or the estimate's names) → Close → entries under Dinner.
  - `testQuickAddMenuButtonsDontOverlap` — open (+) → frames of the four action buttons (icon + label) pairwise don't intersect.
- [ ] **Step 2:** Mac UI run → FAIL.
- [ ] **Step 3:** implement (push via `navigationDestination(for: QuickAction.self)` inside Track Food; adjust radius/spread in `RadialMenu`).
- [ ] **Step 4:** full UI suite → all pass; screenshots `18-hub`, `3-quick-add`.
- [ ] **Step 5:** commit `feat(ios): Track Food hub; (+) menu spacing`.

### Task 7: Version and round end

**Files:** `backend/package.json`, `frontend/package.json` (+ locks), `frontend/src/changelog.ts`

- [ ] **Step 1:** `npm version 0.5.0 --no-git-tag-version` in both; changelog 0.5.0 "Adding food on iPhone": meals always
  show with Add; Same as yesterday / Favorites / Recently tracked with one-tap +; Log all; bookmark; Photo/Scan/Describe
  inside Track Food; (+) menu spacing.
- [ ] **Step 2:** backend `npx vitest run` + `npm run typecheck`; frontend `npx vitest run`, `npx tsc --noEmit`,
  `npm run build`; Mac kit + full UI suite → all green.
- [ ] **Step 3:** commit `chore: 0.5.0`; push; GitHub Actions green; final review (fresh reviewer); fix pass; PR, merge,
  deploy to bytesize-testing (approved process).
