# ByteSize L1 — Amounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Log any food by count, size or weight/volume, through one server-derived unit list. The iPhone gets a
three-wheel amount picker, and both apps confirm big amounts.

**Architecture:**
- **Server:** a pure `withMeasures(servings, name)` appends derived servings (counts, sizes) after a food's own
  servings, inside `toResult`. `Serving` gains `per` (a fraction of servings[0], used when there's no weight) and
  `derived: true`.
- **Shared test cases:** a JSON vector file pins `amountFactor` for the server's TypeScript and a Swift port.
- **Apps:** the web `AmountPicker` and a new iOS `AmountWheel` use that list. A shared threshold gives a "That's a
  lot" confirm.

**Tech Stack:** Fastify + zod + Vitest (backend), React + Vitest (frontend), SwiftUI / XCTest / XCUITest (ios).

**Spec:** `docs/superpowers/specs/2026-11-19-bytesize-l1-amounts-design.md` (backlog SPEC-01, SPEC-09; I3 review minors).

## Global Constraints

- Derived servings are **only appended** after a food's stored servings; stored `servingIndex` values never change meaning.
- Derived servings are **never stored** on a food: the food save schema drops `derived` servings. A logged entry keeps
  them in its snapshot (as it keeps servings today).
- Fractions, both apps: `— ⅛ ¼ ⅓ ⅜ ½ ⅝ ⅔ ¾ ⅞` (values 0, .125, .25, 1/3, .375, .5, .625, 2/3, .75, .875).
- Amounts are sent as `quantity = whole + fraction`, `fraction: 1`, with the chosen `unit` (`serving` + servingIndex, or `g|oz|ml|fl_oz|cup|tbsp|tsp`).
- **Big amount:**
  - Trigger: `amountFactor(...) > 20` **or** previewed calories `> 2000`.
  - Copy: "That's a lot — log {N} cal of {name}?" with buttons **Log it** / **Change**. N is formatted with a
    thousands separator.
- iOS tests on the MacBook through the n8n runner, always `git checkout ios… l1-amounts` first. Kit: `swift test`.
  App: `xcodebuild test … CODE_SIGN_IDENTITY=-`.
- **End of round:** backend suite, frontend suite **and** `npm run build` (frontend + backend), iOS kit + UI, and the
  branch's GitHub Actions run green (it builds the Docker image on every push).

## Review Focus

1. **Editing a My Food after it was looked up:** the derived "1 prune" mustn't be saved back as a real serving
   (it would lose `per` and break). Pinned in Task 1 (save schema drops derived servings).
2. **An entry logged before L1 (`unit: "serving"`, index into old servings):** it still edits correctly with the wheel.
   Pinned in Task 6 (`PortionModel(entry:)` keeps its unit and index).
3. **A food with no grams or ml** ("5 crackers" with no weight): the counted unit works through `per`; g/oz aren't
   offered. Pinned in Tasks 1 and 5.
4. **Switching unit keeps the number** (3 cups → 3 tbsp), as on the web; calories follow at once. Pinned in Task 5.
5. **Imperial vs metric units on the wheel:** both lists are always offered (as on the web); no crash when a food has
   only ml. Pinned in Task 5.

---

### Task 1: Server — derived measures

**Files:** Create `backend/src/lib/measures.ts`. Modify:
- `backend/src/lib/nutrients.ts`: `Serving` gets `per?: number; derived?: true`; `amountFactor` uses `per`.
- `backend/src/lib/foods.ts:86`: `toResult` returns `withMeasures(withLiquidVolumes(...), row.name)`.
- `backend/src/lib/foods.ts:533`: the `serving` schema drops `derived` servings on save.

Test: `backend/tests/measures.test.ts`.

**Interfaces:** produces `withMeasures(servings: Serving[], name: string): Serving[]`, `SIZE_TABLE`, and
`amountFactor`, which for `unit: "serving"` with an index > 0 and no shared grams/ml uses
`quantity * servings[i].per` when `per` is set.

- [ ] **Step 1: Failing tests** (`describe("withMeasures")`):
  - `[{label:"5 prunes",grams:40}]` → second item `{label:"1 prune",grams:8,derived:true}`.
  - `[{label:"4 slices (56g)",grams:56}]` → `{label:"1 slice",grams:14,derived:true}`.
  - `[{label:"12 crackers"}]` (no weight) → `{label:"1 cracker",per:1/12,derived:true}`.
  - `[{label:"1 cup (240 g)",grams:240}]` and `[{label:"2 servings",grams:60}]` → unchanged.
  - The singular of "berries" is "berry".
  - An apple `[{label:"1 cup slices",grams:110}]`, name "Apple, raw" → adds 1 small / 1 medium / 1 large with
    the table grams (149 / 182 / 223).
  - An apple that already has "1 medium (182g)" → no sizes added.
  - Indices: every input serving is unchanged at the same index.
  - `amountFactor([{label:"12 crackers"},{label:"1 cracker",per:1/12}],1,"serving",6)` = 0.5.
  - Route test: `GET /api/foods/cache/:id` for a cached "Prunes" food returns the derived serving.
  - Route test: `POST /api/log` with `servingIndex: 1, quantity: 6` logs 1.2× calories (150 → 180).
  - Route test: `POST /api/my-foods` with a derived serving in `servings` saves without it.
- [ ] **Step 2:** Run `cd backend && npx vitest run tests/measures.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement. Count regex on a label: a leading number > 1, then a noun, then an optional
  parenthetical. Measuring words are skipped: g, gram, oz, ounce, lb, cup, tbsp, tsp, ml, fl, serving, container,
  package, pkg, bottle, can, scoop, portion. The size table covers apple, banana, orange, pear, peach, potato,
  sweet potato, egg, avocado and chicken breast (USDA standard grams).
- [ ] **Step 4:** Run that file, then the whole backend suite. Expected: all PASS.
- [ ] **Step 5:** Commit "server: foods offer counted and sized units (1 prune, 1 slice, small/medium/large)".

### Task 2: Shared amount vectors

**Files:** Create:
- `backend/tests/fixtures/amount-vectors.json` (about 12 cases: serving, other serving by grams/ml, `per`, g, oz,
  ml, cup, tbsp)
- `backend/tests/amount-vectors.test.ts` (each case's `amountFactor` within 1e-9)
- `ios/ByteSizeKit/Tests/ByteSizeKitTests/Resources/amount-vectors.json` (a byte-identical copy)
- `backend/tests/amount-vectors-copy.test.ts` (fails if the two files differ)

Modify `ios/ByteSizeKit/Package.swift` (test resources).

- [ ] Steps: write the vectors and both tests (RED for the copy test until the copy exists); add the copy; run them; commit
  "test: shared amount vectors for server and app".

### Task 3: Web — fractions, derived units, big-amount confirm

**Files:** Modify:
- `frontend/src/amounts.ts`: `FRACTION_CHOICES` becomes the eight-step list; `exactFraction` maps 1/3 and 2/3;
  add `isBigAmount(servings, portion, calories): boolean`.
- `frontend/src/types.ts`: `Serving` gains `per?`, `derived?`.
- `frontend/src/components/log/FoodDetail.tsx`: `submit` asks first.

Tests: `frontend/src/amounts.test.ts` and `FoodDetail` tests.

- [ ] **Step 1: Failing tests:**
  - The fraction select offers ⅛ and ⅞.
  - A food with a derived "1 prune" lists it in the unit select.
  - Choosing 6 × "1 prune" and Log sends `{servingIndex:1, unit:"serving", quantity:6, fraction:1}`.
  - 21 servings → dialog text "That's a lot — log 2,205 cal of Banana?". "Change" sends nothing; "Log it" sends.
  - 3 servings → no dialog.
- [ ] Steps 2–4: RED, then implement (a small confirm dialog in the existing sheet style), then GREEN plus the
  whole frontend suite and `npm run build`.
- [ ] Step 5: commit "web: eighths, counted units and a big-amount check".

### Task 4: iOS — servings with `per`, and AmountMath

**Files:**
- Modify `Models/LogEntry.swift`: `Serving` gains `per: Double?` and `derived: Bool?`.
- Create `Models/AmountMath.swift`:
  - `public enum AmountUnit: String, Codable, CaseIterable, Sendable { case serving, g, oz, ml, fl_oz, cup, tbsp, tsp }`
  - `public enum AmountMath { static func factor(_ servings: [Serving], servingIndex: Int, unit: AmountUnit, quantity: Double) -> Double? }`
    (nil = can't measure)
  - `static let fractions: [(Double, String)]` (the eight-step list)
  - `static func isBig(factor: Double, calories: Double) -> Bool`

Test `AmountMathTests.swift`, which reads `Resources/amount-vectors.json` with `Bundle.module`.

- [ ] Steps: RED (the vectors fail, the type is missing), then implement, then GREEN on the Mac; commit "ios: amount math matching the server".

### Task 5: iOS — PortionModel in units

**Files:** Modify:
- `Features/PortionModel.swift`: replace `quantityText`/`fraction` with `whole: Int`, `fraction: Double`,
  `choice: UnitChoice`.
- `Features/TrackFoodModel.swift`: `log` sends the unit.
- `API/FoodAPI.swift`: `log(food:day:meal:servingIndex:unit:quantity:)`.

Test `PortionModelTests.swift`, rewritten.

**Interfaces:**
- `public enum UnitChoice: Hashable { case serving(Int); case unit(AmountUnit) }`
- `PortionModel`:
  - `choices: [(UnitChoice, String)]`: the servings, then g/oz if servings[0] has grams, then ml/fl oz/cup/tbsp/tsp
    if it has ml.
  - `quantity: Double` (whole + fraction)
  - `canLog`, `previewCalories: Int?`, `isBig: Bool`
  - `wholeRange: [Int]`: 0–20, plus 25…1000 in the web's steps for g/ml.
  - `init(food:meal:)`
  - `init(entry: LogEntry)`: whole/fraction split from quantity × fraction, keeping the entry's unit and index.

- [ ] **Step 1: Failing tests:**
  - Defaults: 1 × servings[0].
  - 6 × "1 prune" (per 0.2) → 180 cal of a 150-cal "5 prunes".
  - Switching from 3 cups to tbsp keeps 3.
  - A food with only grams offers g and oz but not cup.
  - A food with only ml offers volume units but not g.
  - 0 + — → canLog false.
  - 21 servings → isBig.
  - `init(entry:)` for a pre-L1 entry (unit "serving", index 1, quantity 1.5, fraction 0.5) → whole 0, fraction ¾,
    choice .serving(1).
  - TrackFoodModel log body has `unit:"g"` when grams were chosen.
- [ ] Steps 2–5: RED → GREEN on the Mac → commit "ios: portions in any unit the food offers".

### Task 6: iOS — the three-wheel picker everywhere, and the confirm

**Files:**
- Create `ios/ByteSize/Logging/AmountWheel.swift`: whole | fraction | unit wheels, matching Cory's screenshot.
- Modify `Logging/PortionSheet.swift`: the wheel replaces the field and chips; Log asks first when `isBig`.
- Modify `FoodLog/EditEntrySheet.swift`: uses `PortionModel(entry:)` and the wheel.
- Modify `Features/FoodLogModel.swift`: `update(_:portion:)` sends servingIndex, unit, quantity, fraction 1.
- Modify `API/LogAPI.swift`: `update` adds `unit`.
- Modify `Logging/EstimateItemsView.swift`: tapping a row opens the wheel (unit column = the item's own servings);
  the stepper goes.

Tests: FoodLogModelTests (update body keys `fraction, quantity, servingIndex, unit`), and UI tests.

- [ ] **Step 1: Failing UI tests:**
  - `testTrackPrunesBySix`: in the stub, "Prunes" has servings "5 prunes" (40 g) and derived "1 prune". Track Food
    → "prunes" → set the wheels to 6 / — / "1 prune" → "About 180 calories" → Log → Food Log shows "Prunes".
  - `testEditEntryWithTheWheel`: Greek yogurt → wheels 3 / ½ → Save → the row shows "3½ × 1 cup".
  - `testBigAmountAsks`: 21 × banana → the "That's a lot" alert → Change → nothing logged.
- [ ] Steps 2–5: RED → stub routes ("prunes" search) → GREEN for the full iOS suite → screenshots looked at →
  commit "ios: three-wheel amount picker and the big-amount check".

### Task 7: I3 review leftovers

**Files:** Modify:
- `backend/src/lib/foods.ts` (`aiDraft`: clamp servings to 20 and grams/ml to ≤ 100000).
- `ios/.../FoodAPI.swift` (`saveFood` aiFields = keys whose value the person didn't change, passed in).
- `ios/.../ScanModel.swift`, `LabelReviewSheet.swift` (track edited keys).
- `ios/.../EstimateModel.swift` (`describe` clears items first).
- `ios/ByteSize/Logging/BarcodeScanner.swift` (`becameUnavailableWithError` → callback → message).
- `EstimateItemsView.swift` (one delete action).
- `PhotoSheet.swift` (non-loggable food → message "Track Culury recipes in the web app").
- `ios/.../APIClient.swift` (`URLError.timedOut` → `APIError.timedOut` "The AI took too long — try again" for AI
  endpoints; others unchanged).

Tests:
- backend `aiDraft` clamp case.
- Kit:
  - `saveFood` with edited calories sends aiFields without "calories".
  - A failed re-describe leaves `items == []`.
  - A timeout on `estimateItems` gives "The AI took too long — try again".

- [ ] Steps: RED → GREEN (backend file, then the Mac kit) → commit "fixes from the I3 review".

### Task 8: Round check and PR

- [ ] Run everything in Global Constraints' end-of-round list. Look at the wheel screenshots. Push `l1-amounts`.
  Confirm the GitHub Actions run is green (test + docker). Then the final whole-branch review and the PR against `main`.
