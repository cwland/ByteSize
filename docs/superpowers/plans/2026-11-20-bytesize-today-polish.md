# Today polish (iPhone) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Dashboard and Food Log show what matters at a glance, move day by day without flicker, and Log shot
records dose, date and notes (SPEC-02–06, 11, 12).

**Architecture:** Logic in ByteSizeKit (`DayStore` cache and strip range, overview/summary helpers, a `ShotForm` model),
tested with XCTest against `HTTPStub`; one shared `DayStrip` view replaces the Dashboard week row and the Food Log
arrows; UI covered by XCUITest against the in-app `StubServer`. No server change.

**Tech Stack:** SwiftUI (iOS 17+), Swift 6, XcodeGen, XCTest/XCUITest.

**Spec:** `docs/superpowers/specs/2026-11-20-bytesize-today-polish-design.md`

## Global Constraints

- Strip range: 365 days back to 7 days ahead of the account's today; days after today dimmed and not selectable.
- Calorie bar: under range → light green; within → dark green (range band visible); over → red. Rings unchanged.
- Daily totals order: Calories, Protein, Carbs, Fat, Fiber, Sugar, Sodium, Water; target range where there is one, "—" where not.
- Food Log summary: calories eaten; remaining to the range max ("N left" / "over by N"); Protein eaten / min g; Fiber eaten / min g. No targets → calories eaten only.
- Shot: date only (one shot per day), default today, not in the future; dose from the medication's list (matched by brand name) or Custom (mg / units / ml; mg ≤ 100, units ≤ 1000, ml ≤ 100); notes multi-line; site defaults to suggested.
- "This becomes your current dose" shown when the dose differs from the settings and the date is on/after the latest shot.
- No `.id(selected)` on containers; numbers use `.contentTransition(.numericText())`; day changes animate `.easeInOut(duration: 0.2)`.
- Version 0.6.0 with a What's new entry.

## Review Focus

1. **Today rolls over while the app is open** (`dayMayHaveChanged`): the strip's range and "today" chip move with it;
   a cached yesterday-as-today isn't shown as today. Pinned in Task 1.
2. **Selecting a day whose load fails**: the previous day stays on screen with the error, the strip shows the chosen
   day, and the next successful load replaces it. Pinned in Task 1.
3. **A shot on a day that already has one, with a blank note**: prefilled note shows; clearing it deliberately sends
   an empty note. Pinned in Task 3.
4. **Settings with a compounded medication** ("Compounded Tirzepatide + B12", 25 units): only the custom field, prefilled
   25 units; sending keeps units. Pinned in Task 3.
5. **Calories exactly at the range min / max**: within (dark green), "0 left" at max. Pinned in Task 2.

---

### Task 1: Kit — DayStore cache, strip range, logged-day windows

**Files:**
- Modify: `ios/ByteSizeKit/Sources/ByteSizeKit/Features/DayStore.swift`, `.../Features/FoodLogModel.swift`
- Test: `ios/ByteSizeKit/Tests/ByteSizeKitTests/DayStoreTests.swift`, `FoodLogModelTests.swift`

**Interfaces:**
- Produces on `DayStore`:
  - `stripDays: [String]` — `DayMath.add(-365, to: today)` … `DayMath.add(7, to: today)`, ascending.
  - `canSelect(_ day: String) -> Bool` — within the strip range and `<= today`.
  - `select(_:)` ignores days `canSelect` refuses; **no longer sets `day = nil`**: a cached day is shown at once
    (`day = cache[d]`), otherwise the previous `day` stays until the new one arrives. `dayIsFor: String?` — the date the
    shown `day` belongs to (views use it to dim stale content if they want).
  - `invalidate(_ day: String)` — drops it from the cache (and reloads it now if it's `selected`).
  - `loadLogged(around day: String) async` — fetches `/api/days/logged` for the 62-day window
    `[day-31, day+30]` when that window isn't loaded yet; merges into `loggedDays`.
  - `shiftWeek` and `week(containing:)` removed once the views no longer use them (Task 4); leave them until then.
- `FoodLogModel.copy/move(_:to:meal:)` call `dayStore.invalidate(target)` after success.

- [ ] **Step 1: Failing tests** in `DayStoreTests`:
  - `testStripRunsAYearBackToAWeekAhead` — today 2026-11-19 → first `2025-11-19`, last `2026-11-26`, count 373; `canSelect("2026-11-20") == false`; `canSelect("2025-11-18") == false`.
  - `testSwitchingToALoadedDayShowsItAtOnce` — select 18, select 19 (stub delays day 18 the second time by 0.4 s) → right after `select("2026-11-18")` starts, `day?.day == "2026-11-18"` (from the cache) before the reload finishes.
  - `testSwitchingToANewDayKeepsThePreviousDayOnScreen` — stub delays day 17; during the load `day?.day == "2026-11-19"`, never nil; after, `"2026-11-17"`.
  - `testAFailedLoadKeepsTheShownDayAndSaysSo` — day 16 → 500; `day?.day == "2026-11-19"`, `selected == "2026-11-16"`, `error` set.
  - `testLoggedDotsLoadInWindows` — the window is `[day-31, min(day+30, today+7)]`: select 19 → one `/api/days/logged?from=2026-10-19&to=2026-11-26`; selecting 18 sends none; `loadLogged(around: "2026-08-01")` sends `from=2026-07-01&to=2026-08-31`.
  - `testANewTodayMovesTheStrip` — `dayMayHaveChanged` after the clock passes midnight → `stripDays.last == today+7`, selected moves to the new today.
  - `FoodLogModelTests.testCopyToAnotherDayDropsItsCachedCopy` — load day 18, then copy an entry of 19 to 18 → selecting 18 requests `/api/day/2026-11-18` again before showing cached content as fresh (assert a request was made and `day` matches the stub's new answer).
- [ ] **Step 2:** Mac `swift test --filter 'DayStoreTests|FoodLogModelTests'` → FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** `swift test` → all pass.
- [ ] **Step 5:** commit `feat(kit): day cache, strip range, logged-day windows`.

### Task 2: Kit — overview and Food Log summary helpers

**Files:**
- Modify: `ios/ByteSizeKit/Sources/ByteSizeKit/Features/Overview.swift`
- Test: `ios/ByteSizeKit/Tests/ByteSizeKitTests/OverviewTests.swift`

**Interfaces:**
- Produces:
  - `public enum BarFill { case under, within, over }` and `barFill(calories: Double, range: TargetRange) -> BarFill` (≥ min and ≤ max is within).
  - `public struct TotalRow: Equatable { let name: String; let amount: String; let target: String }` and
    `dailyTotals(_ day: DayView, units: Units) -> [TotalRow]` in the Global Constraints order; water in fl oz for
    imperial, ml for metric; target "1,500–2,000" / "110–130 g" / "—".
  - `public struct LogSummary: Equatable { let eaten: String; let left: String?; let protein: String?; let fiber: String? }` and
    `logSummary(_ day: DayView) -> LogSummary` — "1,138 eaten"; "362 left" / "0 left" / "over by 120"; "Protein 97 / 110 g"; "Fiber 18 / 25 g"; no targets → `left`, `protein`, `fiber` nil.

- [ ] **Step 1: Failing tests:** `testBarFillThresholds` (1499 under, 1500 within, 2000 within, 2001 over for 1500–2000),
  `testDailyTotalsInTheWebsOrder` (names in order; Calories target "1,500–2,000"; Carbs target "—"; Water "17 fl oz" imperial),
  `testLogSummary` (fixture day → "1,138 eaten", "862 left", "Protein 97 / 110 g", "Fiber 0 / 25 g"),
  `testLogSummaryAtTheMaxAndOver` (2000 → "0 left"; 2120 → "over by 120"), `testLogSummaryWithoutTargets`.
- [ ] **Step 2:** `swift test --filter OverviewTests` → FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** `swift test` → all pass.
- [ ] **Step 5:** commit `feat(kit): bar fill, daily totals, Food Log summary`.

### Task 3: Kit — Log shot with dose, date and notes

**Files:**
- Modify: `ios/ByteSizeKit/Sources/ByteSizeKit/API/BodyAPI.swift`, `.../Features/DashboardModel.swift`
- Create: `ios/ByteSizeKit/Sources/ByteSizeKit/Features/ShotForm.swift`
- Test: `ios/ByteSizeKit/Tests/ByteSizeKitTests/ShotFormTests.swift`

**Interfaces:**
- `Glp1Settings` gains `doseUnit: String?`; `Shot` gains `doseUnit: String?`, `note: String?`, `medication: String?`;
  `Glp1View` gains `shots: [Shot]?` (newest first) and `medications: [Glp1Medication]?`
  (`struct Glp1Medication: Codable, Equatable { name: String; ingredient: String; doses: [Double] }`).
- `BodyAPI.logShot(day: String, site: String, doseMg: Double?, doseUnit: String?, note: String?) -> Endpoint<Empty>`.
- `@Observable public final class ShotForm` — `init(view: Glp1View, today: String)`; `day: String` (setting it to a day
  with a shot prefills `site`, `doseMg`, `doseUnit`, `note` from it; a day without → settings' dose/unit, suggested
  site, empty note); `doses: [Double]` (the brand's list; empty when compounded); `custom: Bool`; `doseMg: Double`;
  `doseUnit: String`; `site: String`; `note: String`; `replaces: Bool` (the day has a shot); `becomesCurrentDose: Bool`
  (dose or unit differ from settings and `day >= latest shot day`); `error: String?` (dose out of the server's limits);
  `canSave: Bool`; `latestAllowedDay == today`.
- `DashboardModel.logShot(_ form: ShotForm) async throws` (replaces `logShot(site:)`).

- [ ] **Step 1: Failing tests:** `testBrandMedicationOffersItsDoses` (Zepbound 5 mg → doses [2.5,5,…,15], doseMg 5, custom false),
  `testCompoundedHasOnlyACustomDose` (settings "Compounded Tirzepatide + B12", 25 units → doses [], custom true, 25 / "units"),
  `testADayWithAShotOpensWithIt` (shots has 2026-11-18 site thigh_left, 7.5 mg, note "itchy" → set day → those values, `replaces == true`),
  `testClearingTheNoteSendsAnEmptyNote` (then note = "" → request body `note: ""`),
  `testADifferentDoseOnTheLatestShotSaysSo` (today, 7.5 vs settings 5 → `becomesCurrentDose`; a backdated day → false),
  `testDoseLimits` (custom 101 mg → error, `canSave == false`; 1000 units ok),
  `testLogShotSendsEverything` (PUT `/api/glp1/shots/2026-11-19` with site, doseMg, doseUnit, note).
- [ ] **Step 2:** `swift test --filter ShotFormTests` → FAIL.
- [ ] **Step 3:** implement; update `DashboardModelTests` / stub fixtures to brand names (`"Zepbound"`).
- [ ] **Step 4:** `swift test` → all pass.
- [ ] **Step 5:** commit `feat(kit): ShotForm — dose, date and notes`.

### Task 4: App — DayStrip, calendar and Food Log summary (with UI tests)

**Files:**
- Create: `ios/ByteSize/Common/DayStrip.swift`
- Modify: `ios/ByteSize/Dashboard/DashboardView.swift`, `ios/ByteSize/FoodLog/FoodLogView.swift`; delete
  `ios/ByteSize/Dashboard/CalendarStrip.swift` and `DayPickerSheet` once unused; remove `DayStore.shiftWeek`/`week(containing:)` if unused
- Test: `ios/ByteSizeUITests/SmokeUITests.swift`, `ios/ByteSize/Testing/StubServer.swift`

**Interfaces:**
- Consumes: Task 1 (`stripDays`, `canSelect`, `select`, `loadLogged(around:)`), Task 2 (`logSummary`).
- Produces ids: chips `day-<yyyy-mm-dd>`; header button `dayHeader` (label "Today" / "Wed, Nov 19"); calendar sheet
  `dayCalendar`; summary `logSummary`.

- [ ] **Step 1: Failing UI tests:** `testStripSelectsADayAndTheCalendarJumps` (Food Log → `day-<yesterday>` tap → header
  reads the long date; `dayHeader` → calendar → pick today → header "Today"); `testNoArrowsRemain` ("Previous day",
  "Next day", "Previous week", "Next week" don't exist); `testFoodLogSummaryShowsWhatsLeft` (`logSummary` contains
  "1,138 eaten" and "862 left"); `testTomorrowCantBeChosen` (tap `day-<tomorrow>` → header still "Today").
- [ ] **Step 2:** Mac UI run of those → FAIL.
- [ ] **Step 3:** implement (ScrollView(.horizontal) + `.scrollTargetBehavior(.viewAligned)` + `.scrollPosition(id:)` centred on
  the selected chip; dots from `loggedDays`; `onScrollTargetVisibilityChange` or `.onChange(of: scroll position)` → `loadLogged(around:)`;
  numbers with `.contentTransition(.numericText())`).
- [ ] **Step 4:** full UI suite → all pass; screenshots `21-strip`, `22-calendar`, `23-log-summary`.
- [ ] **Step 5:** commit `feat(ios): day strip, month calendar, Food Log summary`.

### Task 5: App — overview chevron, totals and bar colours (with UI tests)

**Files:** Modify `ios/ByteSize/Dashboard/OverviewCard.swift` (and palette tokens if needed); Test `SmokeUITests.swift`

**Interfaces:** Consumes Task 2 (`barFill`, `dailyTotals`). Produces ids `overviewChevron` (label "Show daily totals" /
"Hide daily totals"), `dailyTotals`. Expanded state in `@AppStorage("overviewExpanded")`.

- [ ] **Step 1: Failing UI test** `testOverviewExpandsToDailyTotals` — Dashboard: "Carbs" not shown; tap `overviewChevron`
  → `dailyTotals` shows Calories, Protein, Carbs, Fat, Fiber, Sugar, Sodium, Water; tap again → hidden.
- [ ] **Step 2:** UI run → FAIL.
- [ ] **Step 3:** implement; bar fill colours: under `success` at 45 % opacity, within `success`, over `error` (theme tokens).
- [ ] **Step 4:** full UI suite → pass; screenshot `24-overview-expanded`.
- [ ] **Step 5:** commit `feat(ios): overview chevron and daily totals; calorie bar colours`.

### Task 6: App — Log shot sheet; Settings divider (with UI tests)

**Files:** Modify `ios/ByteSize/Dashboard/SmallCards.swift` (`ShotSheet`), `ios/ByteSize/Profile/ProfileSheet.swift`,
`ios/ByteSize/Testing/StubServer.swift` (GLP-1 view with `medications`, `shots`, brand "Zepbound", PUT shot recorded);
Test `SmokeUITests.swift`

**Interfaces:** Consumes Task 3 (`ShotForm`, `DashboardModel.logShot(_:)`). Produces ids `shotDose` (picker),
`shotCustomDose` (field), `shotDate`, `shotNote`, `saveShot`, `currentDoseNote`.

- [ ] **Step 1: Failing UI tests:** `testLogShotWithDoseDateAndNote` (Dashboard → Log shot → dose 7.5 → `currentDoseNote`
  "This becomes your current dose" → note "left side sore" → Save → card's "Last:" line shows 7.5 mg);
  and a screenshot `26-settings` of Profile, checked by eye: the separator between Theme and Appearance runs the full row
  (a separator inset can't be asserted from XCUITest).
- [ ] **Step 2:** UI run → FAIL.
- [ ] **Step 3:** implement (Form: Date (DatePicker .date, `...today`), Dose (Picker over `doses` + "Custom…"; custom → TextField + unit Picker),
  Site, Notes (TextField axis .vertical); "Replaces the shot logged that day" when `replaces`; Settings: the Theme and
  Appearance rows get `.alignmentGuide(.listRowSeparatorLeading) { _ in 0 }` so the separator spans the row).
- [ ] **Step 4:** full UI suite → pass; screenshot `25-log-shot`.
- [ ] **Step 5:** commit `feat(ios): Log shot with dose, date and notes; Settings divider`.

### Task 7: Version and round end

- [ ] **Step 1:** `npm version 0.6.0 --no-git-tag-version` in backend and frontend; changelog 0.6.0 "Today on iPhone":
  day strip and month calendar; overview totals; bar colours; Food Log summary; Log shot with dose, date and notes.
- [ ] **Step 2:** backend vitest + typecheck; frontend vitest, tsc, build; Mac kit + full UI suite → all green.
- [ ] **Step 3:** commit; push; Actions green; final review (fresh reviewer); fix pass; PR, merge, deploy (approved process).
