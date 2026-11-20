# I4 Goals & My Foods (iPhone, + SPEC-17) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Goals and My Foods tabs replace their placeholders, and the day strip and calendar reach 7 days ahead
for pre-logging food.

**Architecture:** Logic in ByteSizeKit (`GoalsModel`, `MyFoodsModel`, `QuickMealModel`, `DayStore` changes, new
`GoalsAPI` / `MyFoodsAPI` endpoints), tested with XCTest against `HTTPStub`; SwiftUI screens in `ios/ByteSize/Goals`
and `ios/ByteSize/MyFoods`, covered by XCUITest against the in-app `StubServer`. No server change.

**Tech Stack:** SwiftUI (iOS 17+), Swift 6, Swift Charts, XcodeGen, XCTest/XCUITest.

**Spec:** `docs/superpowers/specs/2026-11-20-bytesize-i4-goals-myfoods-design.md`

## Global Constraints

- No server change. Routes: `GET /api/goals`, `GET /api/targets`, `GET /api/weight`, `PUT|DELETE /api/weigh-ins/:day`,
  `GET /api/my-foods?q&kind&sort`, `GET /api/my-foods/:id`, `POST /api/log` (food), `POST /api/log/meal`.
- Goals tab copy: "Goals and targets are managed in the ByteSize web app."
- My Foods empty copy: "Foods you create, correct or save as recipes on the web show up here" (no foods, no search,
  filter All); "No matches" otherwise.
- Filters: All · Foods · My edits · Recipes · Quick meals → server kind all · foods · foods · recipes · meals; Foods drops
  `foodKind == "override"`, My edits keeps only it. Sorts: Recent · Most used · A–Z → `recent` · `used` · `az`.
- Weight deltas: newest first; change = this weigh-in − the one before; ↓ green (loss), ↑ red (gain), "—" when 0
  (to 0.01 kg); the oldest has none.
- Chart ranges: 1W = days `>= today-6`, 1M `>= today-29`, 3M `>= today-89`, All = every weigh-in.
- Weigh-in day: today or earlier only. Log shot: today or earlier only (unchanged).
- Day strip and calendar: 365 days back to 7 days ahead, all selectable. On a future day the Dashboard's water,
  Log weight and Log shot buttons are disabled with the hint "That day hasn't happened yet".
- Logging on a picked day sends that day; the default meal stays the time of day's (`Meal.suggested`).
- Version 0.7.0 with a What's new entry.

## Review Focus

1. **Search typed fast** ("ch" → "chi" → "chicken"): an older, slower answer must not replace a newer one. Pinned in Task 2.
2. **A quick meal whose item food is archived** (`available: false`): it still shows and logs from its saved values;
   nothing crashes on empty `servings`. Pinned in Task 2.
3. **No weigh-ins / no targets / no goals** (a new account): every Goals card shows its empty line, no chart. Pinned in Task 1.
4. **Deleting the only weigh-in, or the latest one**: history, chart and the Dashboard weight card all update. Pinned in Task 1.
5. **Today rolls over while a future day is selected** (tomorrow becomes today): its buttons enable, today+8 becomes
   selectable. Pinned in Task 3.

---

### Task 1: Kit — Goals tab model and API

**Files:**
- Create: `ios/ByteSizeKit/Sources/ByteSizeKit/API/GoalsAPI.swift`, `.../Features/GoalsModel.swift`
- Modify: `.../API/BodyAPI.swift` (`WeighIn`, `WeightView`), `.../Features/DashboardModel.swift` (`reloadWeight()` public)
- Test: `ios/ByteSizeKit/Tests/ByteSizeKitTests/GoalsModelTests.swift`

**Interfaces:**
- Produces in `GoalsAPI.swift`:
  - `struct Goal: Codable, Identifiable { id: Int; type: String; name: String; target: Double; period: String; measure: String?; start: String; end: String?; progress: GoalProgress }`
  - `struct GoalProgress: Codable { state: String; current: PeriodProgress?; hit: Int; done: Int; of: Int?; needed: Int?; startKg: Double? }`
  - `struct PeriodProgress: Codable { start: String; end: String; value: Double?; target: Double; status: String }`
  - `struct GoalsView: Codable { active: [Goal] }` (past ignored); `struct TargetsResponse: Codable { targets: DayTargets? }`
  - `enum GoalsAPI { static func goals() -> Endpoint<GoalsView>; static func targets() -> Endpoint<TargetsResponse> }`
- `WeighIn` gains `note: String?`; `WeightView` gains `start: WeightPoint?`, `trendKg: Double?`, `lostKg: Double?`,
  `goalDate: GoalDateView?` with `struct GoalDateView: Codable { status: String; date: String? }` — all optional so the
  Dashboard's existing fixtures still decode.
- Produces `GoalsModel` (`@MainActor @Observable`):
  - `init(api: APIClient, dayStore: DayStore, units: Units, weightChanged: @escaping () async -> Void = {})`
  - `goals: [Goal]`, `targets: DayTargets?`, `weight: WeightView?`, `message: String?`, `loaded: Bool`
  - `enum WeightRange: String, CaseIterable { case week = "1W", month = "1M", threeMonths = "3M", all = "All" }`, `range: WeightRange` (default `.month`)
  - `chartPoints: [WeighIn]` (in range, oldest first); `history: [WeightRow]` with `struct WeightRow: Identifiable { day: String; weightKg: Double; changeKg: Double? }` (id = day)
  - `load() async` (goals, targets and all weigh-ins — `BodyAPI.weight()` with no `from` — together)
  - `logWeight(display: Double, day: String) async throws` (refuses `day > dayStore.today` with "Choose today or an earlier day", no request), `deleteWeighIn(day: String) async`
  - both reload weight and call `weightChanged` after success
  - `static func progressText(_ g: Goal, units: Units) -> String`; `static func overallText(_ g: Goal) -> String?`
- `DashboardModel.reloadWeight() async` (today's private `loadWeight`, made public).

- [ ] **Step 1: Failing tests** in `GoalsModelTests` (today 2026-11-19, Boise; stub weigh-ins 2026-08-01 90.0, 2026-11-05 84.0, 2026-11-12 83.0, 2026-11-19 82.28):
  - `testLoadsGoalsTargetsAndWeight` — `goals.count == 2`, `targets?.calories.max == 2000`, `weight?.lostKg` decoded.
  - `testRangesCutTheChart` — `.week` → days [11-19]; `.month` → [11-05, 11-12, 11-19]; `.threeMonths` same; `.all` → 4 points.
  - `testHistoryIsNewestFirstWithChanges` — days [11-19, 11-12, 11-05, 08-01]; changes ≈ [-0.72, -1.0, -6.0, nil].
  - `testProgressText` — protein_days week current value 3 target 5 → "3 of 5 days this week"; month → "3 of 5 days this month";
    stretch → "3 of 5 days so far"; steps total value 8200 target 10000 → "8,200 of 10,000 steps"; weight_by_date
    target 75, end 2026-12-31, imperial → "Reach 165.3 lb by Dec 31"; state "upcoming" start 2026-12-01 → "Starts Tue, Dec 1".
  - `testOverallText` — hit 2 needed 4 of 5 → "2 of 4 needed (5 weeks)" for a week goal; `needed == nil` → nil.
  - `testLogWeightRefusesAFutureDay` — `logWeight(display: 180, day: "2026-11-20")` throws, no PUT sent.
  - `testLogAndDeleteReloadAndTellTheDashboard` — log → PUT `/api/weigh-ins/2026-11-19` with kg, then GET `/api/weight`, `weightChanged` called once; delete 11-19 → DELETE, reload, called again.
  - `testEmptyAccount` — goals `[]`, targets null, weigh-ins `[]` → `goals.isEmpty`, `targets == nil`, `chartPoints.isEmpty`, `history.isEmpty`, `message == nil`.
  - `testDeletingTheLastWeighInEmptiesHistory` — stub returns `[]` after DELETE → `history.isEmpty`.
- [ ] **Step 2:** Mac `swift test --filter GoalsModelTests` → FAIL (no such type).
- [ ] **Step 3:** implement. Day counts in `progressText` use the goal types ending `_days` and `weigh_ins` ("weigh-ins");
  `workouts` → "workouts", `active_minutes` → "minutes"; dates via the existing `DayText` helpers.
- [ ] **Step 4:** Mac `swift test` → all pass (Dashboard tests included).
- [ ] **Step 5:** commit `feat(kit): Goals model — goals, targets, weight chart and history`.

### Task 2: Kit — My Foods and quick meals

**Files:**
- Create: `.../API/MyFoodsAPI.swift`, `.../Features/MyFoodsModel.swift`, `.../Features/QuickMealModel.swift`
- Modify: `.../Features/PortionModel.swift` (init from a meal item)
- Test: `MyFoodsModelTests.swift`, `QuickMealModelTests.swift`

**Interfaces:**
- `MyFoodsAPI`: `list(q: String, kind: String, sort: String) -> Endpoint<FoodList>` (empty q omitted);
  `detail(id: Int) -> Endpoint<MyFoodDetailResponse>`; `logMeal(foodId: Int, day: String, meal: Meal, items: [MealItemBody]) -> Endpoint<EntriesResponse>`.
- `struct MealItem: Codable { food: FoodRef; name: String; icon: String; servingIndex: Int; unit: String; quantity: Double; fraction: Double; servings: [Serving]; perServing: Nutrients; nutrients: Nutrients; available: Bool }`,
  `struct FoodRef: Codable, Hashable { kind: String; id: Int }`, `struct MyFoodDetailResponse: Codable { food: MyFoodDetail }`,
  `struct MyFoodDetail: Codable { items: [MealItem]? }` (only the items are needed; the list already has the food),
  `struct MealItemBody: Encodable { food: FoodRef; servingIndex: Int; unit: String; quantity: Double; fraction: Double }`.
- `PortionModel.convenience init(item: MealItem, meal: Meal)` — like `init(entry:)`: per-serving = `item.perServing`, amount = quantity × fraction split onto the wheel.
- `MyFoodsModel` (`@MainActor @Observable`): `init(api:dayStore:now:)`; `enum Filter: CaseIterable { all, foods, edits, recipes, meals }` with `title` ("All", "Foods", "My edits", "Recipes", "Quick meals"); `enum Sort: String, CaseIterable { recent, used, az }` with `title` ("Recent", "Most used", "A–Z");
  `query`, `filter`, `sort`, `foods: [Food]`, `message`, `emptyText: String?`; `load() async`; `queryChanged() async` (waits 300 ms, then loads unless a newer change came); `meal: Meal` (= `Meal.suggested`); `log(_ food: Food, portion: PortionModel) async -> Bool` (`FoodAPI.log` to `dayStore.selected`, then `dayStore.reload()`).
- `QuickMealModel` (`@MainActor @Observable`): `init(api:dayStore:food:meal:)`; `rows: [Row]` with `struct Row: Identifiable { id: Int; item: MealItem; included: Bool; portion: PortionModel }` (id = position); `toggle(_ id: Int)`; `totalCalories: Int` (included rows); `canLog: Bool`; `load() async`; `logAll() async -> Bool` (sends included rows: `unit` = portion.unit raw, `quantity` = portion.quantity, `fraction` 1, `servingIndex`; then `dayStore.reload()`); `message`.

- [ ] **Step 1: Failing tests:**
  - `MyFoodsModelTests.testFiltersMapToTheServer` — `.all` → kind=all; `.foods` and `.edits` → kind=foods; `.recipes` → recipes; `.meals` → meals; sort `.used` → sort=used.
  - `testFoodsAndMyEditsSplitOverrides` — server returns custom "Oat bars" + override "Banana (mine)" → `.foods` shows only Oat bars, `.edits` only Banana (mine).
  - `testEmptyText` — no foods, no query, `.all` → the long empty copy; with query "zz" → "No matches"; with results → nil.
  - `testANewerSearchWins` — query "ch" answered after 0.4 s, query "chicken" at once → `foods` ends as chicken's answer.
  - `testLogSendsTheSelectedDay` — select 2026-11-21 (future), log → POST /api/log `day` "2026-11-21".
  - `QuickMealModelTests.testLoadsItemsAllIncluded` — 3 items → 3 rows, all included, `totalCalories` = sum of item calories.
  - `testLeavingOneOutLogsTheRest` — toggle row 1, `logAll()` → POST /api/log/meal with `foodId`, `day`, `meal`, 2 items (rows 0 and 2) with their amounts.
  - `testChangingAnAmountIsSent` — row 0 portion whole 2 → sent quantity 2.
  - `testNothingIncludedCantLog` — toggle all off → `canLog == false`; `logAll()` sends nothing, returns false.
  - `testAnArchivedItemStillLogs` — item `available: false`, `servings` one entry → row present, included, sent.
  - `testServerErrorShowsMessage` — 400 `{"error":"..."}` → `logAll()` false, `message` is the server's text.
- [ ] **Step 2:** Mac `swift test --filter 'MyFoodsModelTests|QuickMealModelTests'` → FAIL.
- [ ] **Step 3:** implement (newer-search guard: a load counter as `TrackFoodModel.loadNumber` does).
- [ ] **Step 4:** Mac `swift test` → all pass.
- [ ] **Step 5:** commit `feat(kit): My Foods list and quick meal logging`.

### Task 3: Kit — SPEC-17 days ahead

**Files:** Modify `.../Features/DayStore.swift`, `.../Features/DashboardModel.swift`; Test `DayStoreTests.swift`, `DashboardModelTests.swift`

**Interfaces:**
- `DayStore.canSelect(_:)` — within `[today-365, today+7]`; `isFuture(_ day: String) -> Bool` (`day > today`); `selectedIsFuture: Bool`.
- `DashboardModel.addWater(ml:)` sends nothing on a future selected day (sets no message; the button is disabled).

- [ ] **Step 1: Failing tests:** replace `testStripRunsAYearBackToAWeekAhead`'s `canSelect("2026-11-20") == false` with `true`, add `canSelect("2026-11-26") == true`, `canSelect("2026-11-27") == false`; `testTomorrowIsFuture` (`isFuture("2026-11-20")`, not today); `testRolloverMakesTomorrowToday` (select 11-20, clock passes midnight, `dayMayHaveChanged` → `selectedIsFuture == false`, `canSelect("2026-11-27") == true`); `DashboardModelTests.testNoWaterOnAFutureDay` (select 11-20, `addWater(ml: 237)` → no POST).
- [ ] **Step 2:** Mac `swift test --filter 'DayStoreTests|DashboardModelTests'` → FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** Mac `swift test` → all pass.
- [ ] **Step 5:** commit `feat(kit): pick up to 7 days ahead`.

### Task 4: App — Goals tab (with UI tests)

**Files:**
- Create: `ios/ByteSize/Goals/GoalsView.swift` (targets card, goal cards, chart, history), `ios/ByteSize/Goals/LogWeightSheet.swift`
- Modify: `ios/ByteSize/Shell/TodayModels.swift` (`goals: GoalsModel`, `weightChanged` → `dashboard.reloadWeight()`), `ios/ByteSize/Shell/MainTabView.swift` (`.goals`), `ios/ByteSize/Testing/StubServer.swift` (`/api/goals` two goals, `/api/targets`, `/api/weight` the Task 1 series with trend, `goalDate` ok, PUT/DELETE weigh-ins kept in stub state)
- Test: `ios/ByteSizeUITests/SmokeUITests.swift`

**Interfaces:** Consumes Task 1. Produces ids `goalsTargets`, `goal-<id>`, `weightChart`, `range-1W|1M|3M|All`,
`logWeight`, `weightField`, `weightDay`, `saveWeight`, `history-<yyyy-mm-dd>`. Loads on first appearance and on pull to refresh.

- [ ] **Step 1: Failing UI tests:** `testGoalsShowTargetsGoalsAndChart` (Goals tab → `goalsTargets` contains "Managed in the ByteSize web app" copy, `goal-1` shows "3 of 5 days this week", `weightChart` exists, tap `range-All`);
  `testLogWeightAddsToHistory` (`logWeight` → 180 → `saveWeight` → `history-<today>` shows "180"); `testSwipeDeletesAWeighIn` (swipe `history-<oldest>` → Delete → gone);
  `testWeightDayCantBeFuture` (the sheet's date picker has no day after today — assert `weightDay` value is today after trying to pick tomorrow).
- [ ] **Step 2:** Mac UI run of those → FAIL.
- [ ] **Step 3:** implement: Swift Charts `PointMark` (weigh-ins) + `LineMark` (trend) + `RuleMark` dashed (goal); summary row Start · Trend · Lost · Goal date ("—" when absent); the targets card lists calories, protein, fiber and water ranges plus the goal weight (`weight.goalKg`, in the account's units); the weight sheet says "A second weigh-in that day replaces the first."; history rows with ↓ green `success` / ↑ red `error` / "—"; empty lines "No targets set", "No active goals", "No weigh-ins yet".
- [ ] **Step 4:** full UI suite (both halves) → all pass; screenshots `31-goals`, `32-log-weight`.
- [ ] **Step 5:** commit `feat(ios): Goals tab — targets, goals, weight chart and history`.

### Task 5: App — My Foods tab and quick meals (with UI tests)

**Files:**
- Create: `ios/ByteSize/MyFoods/MyFoodsView.swift`, `ios/ByteSize/MyFoods/QuickMealView.swift`
- Modify: `TodayModels.swift` (`myFoods: MyFoodsModel`), `MainTabView.swift` (`.myFoods`; `PlaceholderScreen.swift` deleted when unused), `StubServer.swift` (`/api/my-foods` with a custom food, an override, a recipe "Chili" and a quick meal "Usual breakfast" of 3 items; `/api/my-foods/:id`; `POST /api/log/meal` adds entries to the stub day)
- Test: `SmokeUITests.swift`

**Interfaces:** Consumes Task 2. Produces ids `myFoodsSearch`, `filter-all|foods|edits|recipes|meals`, `sortMenu`,
`myFood-<id>`, `mealItem-<n>` (toggle), `logMeal`. A food row pushes `FoodPortionView(food:meal:pushed: true, log: myFoods.log)`;
a quick meal row pushes `QuickMealView`.

- [ ] **Step 1: Failing UI tests:** `testMyFoodsFiltersAndLogsARecipe` (My Foods → `filter-recipes` → only Chili → tap → Log → Food Log shows Chili);
  `testQuickMealLeavesOneOut` (`filter-meals` → Usual breakfast → untick `mealItem-1` → `logMeal` → Food Log shows items 0 and 2, not 1);
  `testMyEditsShowsOnlyCorrections`; `testSearchFindsAFood` (type "oat" → Oat bars only).
- [ ] **Step 2:** Mac UI run → FAIL.
- [ ] **Step 3:** implement (filter chips in a horizontal scroll; sort in a toolbar `Menu`; `.searchable` → `queryChanged()`;
  quick meal list styled like the Describe item list: icon, name, amount, calories, check; tap an item → the wheel sheet; total and Log all at the bottom).
- [ ] **Step 4:** full UI suite → pass; screenshots `33-my-foods`, `34-quick-meal`.
- [ ] **Step 5:** commit `feat(ios): My Foods tab and quick meal logging`.

### Task 6: App — SPEC-17 days ahead (with UI tests)

**Files:** Modify `ios/ByteSize/Common/DayStrip.swift` (calendar range to today+7; chips use `canSelect`), `ios/ByteSize/Dashboard/SmallCards.swift` (water, Log weight, Log shot disabled on `selectedIsFuture` with the hint), `SmokeUITests.swift`

**Interfaces:** Consumes Task 3. Produces id `futureHint`.

- [ ] **Step 1: Failing UI tests:** replace `testTomorrowCantBeChosen` with `testTomorrowCanBeChosenToPreLog` (tap `day-<tomorrow>` → header shows tomorrow's date → add a food via a meal's Add → it's listed); `testFutureDayDisablesWaterWeightAndShot` (Dashboard, tomorrow → water buttons, "Log weight", "Log shot" not enabled, `futureHint` reads "That day hasn't happened yet").
- [ ] **Step 2:** Mac UI run → FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** full UI suite → pass; screenshot `35-tomorrow`.
- [ ] **Step 5:** commit `feat(ios): pick days ahead to pre-log food`.

### Task 7: Version and round end

- [ ] **Step 1:** `npm version 0.7.0 --no-git-tag-version` in backend and frontend; changelog 0.7.0 "Goals and My Foods on iPhone":
  Goals tab (targets, goals, weight chart, history, log weight); My Foods tab (filters, sort, quick meals); pick up to 7 days ahead.
- [ ] **Step 2:** backend vitest + typecheck; frontend vitest, tsc, build; Docker image build; Mac kit + full UI suite → all green.
- [ ] **Step 3:** commit; push; Actions green; final review (fresh reviewer); fix pass; PR, merge, deploy (approved process).
