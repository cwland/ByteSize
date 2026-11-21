# Track Food top Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the top of the iPhone Track Food screen. It gets our own search field (so Close is there from the first frame), a Photo · Scan · Describe row, a collapsible "Show results from" row holding the meal picker, and web-style source chips that filter results on the phone.

**Architecture:** A new Kit type, `SourceFilter`, owns the chip choice and the open/closed flag. It saves both per account in UserDefaults and turns a `SearchResult` into what to show: chips, groups, errors and a hint. `TrackFoodModel` keeps the raw last answer. `TrackFoodSheet` binds to both.

**Tech Stack:** Swift 6, SwiftUI (iOS 26), XCTest. Kit tests run with `swift test` on the Mac; UI tests run with `xcodebuild test`.

**Spec:** docs/superpowers/specs/2026-11-20-bytesize-track-food-top-design.md

## Global Constraints

- Chip order and labels match the web exactly: mine "My foods", fatsecret "FatSecret", basic "Basic", usda "USDA", off "Open Food Facts", culury "Culury".
- Defaults match the web: mine, fatsecret, usda and off on; basic and culury off.
- A USDA failure marks Basic as failed too.
- Groups from a source that isn't a chip always show. An answer with no `searched` field shows all its groups.
- The Sources row starts collapsed. Its summary reads "Show results from · N of M", where M counts the sources this search asked and N counts those that are on. Before any search, the summary is just "Show results from".
- Defaults keys: `sources.<account>.choice` (a JSON object of id→Bool) and `sources.<account>.open` (Bool).
- No server or web changes.

## Review Focus

1. A saved choice from an older build that is missing a key (or holds junk): use the default for that key and don't crash. (Task 1 test.)
2. Barcode answers: no chips, and the barcode group always shows. (Task 2 test.)
3. Every chip off, with results in the off ones: the hint must still offer a source to turn on, not leave a blank list. (Task 1 test.)
4. Two accounts on one phone: one account's chips don't leak into the other's. (Task 1 test.)
5. Typing fast after toggling a chip: the filter applies to the newest answer, not a stale one. Covered by the existing `testTheLastSearchWins` plus the view reading `found`. (Task 2 keeps it green.)

---

### Task 1: SourceFilter (Kit)

**Files:**
- Modify: `ByteSizeKit/Sources/ByteSizeKit/Models/Food.swift` (`SearchResult` gains `public let searched: [String]?`, plus a memberwise `public init` with `searched` defaulting to nil)
- Create: `ByteSizeKit/Sources/ByteSizeKit/Features/SourceFilter.swift`
- Test: `ByteSizeKit/Tests/ByteSizeKitTests/SourceFilterTests.swift`

**Interfaces:**
- Produces:
  - `public enum SearchSource: String, CaseIterable, Sendable { case mine, fatsecret, basic, usda, off, culury; public var label: String }`
  - `public struct SourceChip: Equatable, Identifiable { public let source: SearchSource; public let on: Bool; public let count: Int; public let failed: Bool; public var id: String }`
  - `public struct SourceHint: Equatable { public let names: [String]; public let more: SourceChip }`
  - `public struct SourceView: Equatable { public let chips: [SourceChip]; public let groups: [FoodGroup]; public let errors: [SourceError]; public let hint: SourceHint? }`
  - `@MainActor @Observable public final class SourceFilter`:
    - `init(defaults: UserDefaults, account: String)`
    - `public private(set) var choice: [SearchSource: Bool]`
    - `public var open: Bool` (saved on set)
    - `func toggle(_: SearchSource)` (saves the choice)
    - `func view(of: SearchResult) -> SourceView`
    - `func summary(for: SearchResult?) -> String`

- [ ] **Step 1: Write the failing tests** in `SourceFilterTests` (each test gets a fresh `UserDefaults(suiteName: UUID)`):
  - `testDefaultsMatchTheWeb`: `choice` is `[.mine:true,.fatsecret:true,.basic:false,.usda:true,.off:true,.culury:false]`, and `open == false`.
  - `testChipsFollowSearchedInWebOrder`: searched `["usda","mine","basic"]` with groups mine(2) and usda(3) gives chips `[mine, basic, usda]`, counts `[2,0,3]`, on `[true,false,true]`.
  - `testAnOffChipHidesItsGroupButNotSavedFoods`: groups `basic`, `usda` and `saved` with searched `["basic","usda"]` show `usda` and `saved` only. After `toggle(.basic)`, all three show.
  - `testNoSearchedShowsEverything`: `searched == nil` gives no chips and every group.
  - `testUSDAFailureMarksBasic`: errors `[usda]` with searched `["basic","usda"]` marks both chips failed. The usda error is kept while Basic or USDA is on, and dropped once both are off.
  - `testHintWhenTheOnesOnFoundNothing`: searched `["mine","basic"]` with mine(0) and basic(4) gives a hint with `names == ["My foods"]`, `more.source == .basic`, `more.count == 4`.
  - `testHintWithEveryChipOff`: everything off and basic(4) gives a hint with `names == []` and `more.source == .basic`.
  - `testChoiceAndOpenAreRememberedPerAccount`: account "a" toggles `.basic` and sets `open = true`. A new `SourceFilter` for "a" sees both; one for "b" sees the defaults.
  - `testJunkOrMissingKeysFallBackToDefaults`: stored `{"basic":true,"usda":"x"}` gives basic true, usda true (the default), and the other keys at their defaults. Stored non-JSON data gives the defaults.
  - `testSummaryCountsAskedSources`: nil gives `"Show results from"`; searched of 6 with basic and culury off gives `"Show results from · 4 of 6"`.
  - In `ModelsTests`, `testSearchResultDecodesSearched`: JSON with `"searched":["usda"]` decodes, and JSON without the field decodes with `searched == nil`.

- [ ] **Step 2: Run them and watch them fail.** On the Mac: `cd ios/ByteSizeKit && swift test --filter 'SourceFilterTests|ModelsTests'`. Expected: they don't compile (`SourceFilter` isn't defined).

- [ ] **Step 3: Implement** `SourceFilter.swift` and the `SearchResult` change to the interfaces above, following the web's `viewOf` in `frontend/src/components/log/SourcePills.tsx`. Store the choice as JSON `Data` of `[String: Bool]`.

- [ ] **Step 4: Run them and watch them pass.** Same command. Expected: all pass. Then run the whole `swift test`. Expected: green.

- [ ] **Step 5: Commit**: `feat(ios): source filter for Track Food search (web pills)`.

### Task 2: TrackFoodModel keeps the raw answer

**Files:**
- Modify: `ByteSizeKit/Sources/ByteSizeKit/Features/TrackFoodModel.swift`
- Test: `ByteSizeKit/Tests/ByteSizeKitTests/TrackFoodModelTests.swift`

**Interfaces:**
- Consumes: `SearchResult.searched` from Task 1.
- Produces: `public private(set) var found: SearchResult?`.
  - A typed search sets it to the server's answer.
  - A barcode hit sets it to `SearchResult(groups: [barcode group], errors: [], suggestion: nil, searched: nil)`.
  - Under two characters, an error, or an unknown barcode clears it to nil.
  - `groups` stays as it is today, for callers that don't filter.
  - "Nothing found" only shows when the answer itself has no foods.

- [ ] **Step 1: Write the failing tests**:
  - `testATypedSearchKeepsTheAnswer`: `found?.searched == ["basic","usda"]` comes through from the stubbed answer.
  - `testABarcodeHitHasNoSources`: `found?.searched == nil` and there is one group.
  - `testClearingTheSearchClearsTheAnswer`: after a query of "a", `found == nil`.

- [ ] **Step 2: Run** `swift test --filter TrackFoodModelTests`. Expected: FAIL (`found` doesn't exist).

- [ ] **Step 3: Implement** `found` as above.

- [ ] **Step 4: Run** the whole `swift test`. Expected: green, `testTheLastSearchWins` included.

- [ ] **Step 5: Commit**: `feat(ios): Track Food keeps the search answer for filtering`.

### Task 3: The new top of Track Food (app + UI tests)

**Files:**
- Modify:
  - `ByteSize/Logging/TrackFoodSheet.swift`
  - `ByteSize/Shell/TodayModels.swift` (adds `let sources: SourceFilter`, built with `defaults:` set to the same per-launch suite logic as `healthDefaults`, renamed `appDefaults`)
  - `ByteSize/Shell/MainTabView.swift` (passes `today.sources` into `TrackFoodSheet`)
  - `ByteSize/Testing/StubServer.swift`: the search stub answers with `"searched":["mine","basic","usda"]`. For "ban" it returns basic: Banana and usda: "Banana, raw" (a new `Self.bananaRaw`). For "prun" it returns usda: Prunes.
- Test: `ByteSizeUITests/SmokeUITests.swift`

**Interfaces:**
- Consumes: `SourceFilter` (Task 1), `TrackFoodModel.found` (Task 2).
- Produces these accessibility ids:
  - `trackSearch`: a TextField with prompt "Search foods or type a barcode", focused on appear via `@FocusState`, with a clear button labelled "Clear search".
  - `hub-photo`, `hub-scan`, `hub-describe` (kept).
  - `sourcesToggle`: the row button, with accessibilityValue "open" or "closed".
  - `source-<id>`: each chip, with label like "USDA 3" and the value "on" or "off".
  - `sourceHint`: the hint button, which turns `more` on.

Layout, top to bottom:
1. The search field as the List's first row: `listRowBackground(Color.clear)`, container-colored, height 44, corner radius 12.
2. The tool row: three equal buttons, each an icon above a label, `minHeight: 52`.
3. The Sources row: a chevron rotated 90° when open, the summary text, and `MealPicker` on the right. The old MealPicker section is removed.
4. When open and there are chips, a wrapping flow of chips. Use a `Layout`-based `FlowLayout` in the same file: on chips are primary fill with on-primary text, off chips are outlined with subtle text, failed chips get a "!" mark.
5. The rest as today, with search results drawn from `sources.view(of: found).groups` (and its errors and hint).

`.searchable` is removed, and so is the `searchShown` state. Where the old code set `searchShown = true`, the new code focuses the field instead.

- [ ] **Step 1: Write and update the UI tests.**
  - The helpers `trackSearch`/`trackSearchHere` and tests 209–300 switch from `app.searchFields.firstMatch` to `app.textFields["trackSearch"]`.
  - New tests:
    - `testCloseIsThereFromTheStartAndTheSearchKeepsItsWidth`: open Track Food. Close exists on the first check (`exists`, no wait, right after `trackSearch` appears). Read the field's `frame.width`, wait 1.5 s, and the width is unchanged.
    - `testSourceChipsFilterTheResults`: search "banana" and see "Banana, raw" (USDA). Basic is off by default, so "Banana" is absent and `sourceHint` is absent (USDA found one). Tap `sourcesToggle` and `source-basic` to see "Banana". Tap `source-usda` and "Banana, raw" disappears.
    - `testSourcesRowRemembersOpen`: open the row and close the sheet. Reopening Track Food shows `sourcesToggle` with value "open".
    - The existing hub tests (`testHubOpensScanInsideTrackFoodAndBack`, `testAMealChosenInsideDescribeComesBackToTheSearch`) stay unchanged.

- [ ] **Step 2: Run the new tests on the old code** (Mac runner, iPhone 17 Pro). Expected: FAIL, because `trackSearch`, `sourcesToggle` and the chips don't exist. Capture a screenshot of the old first frame to `~/Documents/bs-shots/trackfood/`.

- [ ] **Step 3: Implement** the sheet, TodayModels, MainTabView and StubServer changes above.

- [ ] **Step 4: Run** the new tests, then the full UI suite in its three parts. Expected: all green except the known flaky `testEditDashboardLayout` (rerun alone). Take screenshots with the row closed and open for Cory.

- [ ] **Step 5: Commit**: `feat(ios): Track Food top — tool row, collapsible sources, Close from the first frame`. Add the changelog line under a new 0.8.1, "Track Food: Photo, Scan and Describe next to the search; pick which sources show".
