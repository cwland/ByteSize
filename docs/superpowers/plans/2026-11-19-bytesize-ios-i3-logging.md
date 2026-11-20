# ByteSize iOS — Round I3 (Logging) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The four (+) actions log food for real: **Track Food** (search, recent, frequent → portion → log), **Scan Food** (live barcode
→ portion; not found → photograph the nutrition label → save a food bound to that barcode → portion), **Photo** (barcode, label, or a
plate of food → AI items to adjust → log) and **Describe Food** ("2 eggs, toast and coffee" → AI items → log).

**Architecture:** Builds on I2 (`ios-i2`). Three server additions, test-first in Vitest: plate photos, multi-item estimates, and a
route that logs AI-estimated items straight into the day (marked AI, not saved to My Foods). In the app, one model per action in
`ByteSizeKit` (tested with `HTTPStub`), a shared portion sheet, and VisionKit's live scanner. Every log reloads the `DayStore`.

**Tech Stack:** Swift 6 / SwiftUI / VisionKit (`DataScannerViewController`) / PhotosUI (`PhotosPicker`) / XCTest; Fastify + Vitest.

**Spec:** `docs/superpowers/specs/2026-11-19-bytesize-ios-design.md` (§6.4 radial menu actions, §6.7 changes 5–6, §6.10 "I3"; backlog:
scan the label when a barcode isn't found).

## Global Constraints

- I1/I2 Global Constraints hold (server-only networking, iOS 17, tests on the MacBook via the n8n runner, signed simulator runs,
  accessibility labels, account timezone, units).
- Logging uses `POST /api/log` `{day, meal, food: {kind: "cache"|"user_food", id}, servingIndex, unit: "serving", quantity, fraction}`
  for a found food; the day is `DayStore.selected`, the meal defaults to `Meal.suggested(at: now, in: account zone)` and can be changed.
- **AI-estimated items** (Describe, plate photos) are logged with the new `POST /api/log/estimates` and are **not** saved to My Foods
  (Claude's call: three foods for one breakfast would clutter My Foods). They show the "AI" chip in the log.
- **A label read for an unknown barcode is saved** as a custom food bound to that barcode (`POST /api/my-foods` with `barcode`,
  `photoId`, `aiFields` = every nutrient read), so the next scan finds it (Cory's backlog item).
- Nothing is logged or saved without a final tap.
- AI features: when the server has no AI service (`503`) the action says "Describe Food needs an AI service — set one up in the web
  app" (Photo: "…a photo AI service…"); barcode scanning and Track Food still work.
- The portion sheet works in the food's own servings (`unit: "serving"`), with quantity and the fraction chips ¼ ⅓ ½ ¾ All; grams/oz
  units stay on the web for now. Calories shown before logging are an "≈" preview (`per-serving × amount`); the server's numbers rule after.
- Camera: `NSCameraUsageDescription` = "ByteSize uses the camera to scan barcodes and photograph food and nutrition labels."
- Server tests: `cd backend && npm test` (Postgres 16 local). AI answers are faked as in `backend/tests/photos.test.ts` (`t.ai`).

## Review Focus

1. **Scanner on a device without camera access** (denied, or simulator) → "Camera isn't available — type the barcode instead" with
   the typed field; no crash. Pinned in Task 7.
2. **The AI returns nothing usable / no AI service** → a clear message, nothing logged, the text kept so they can edit and retry.
   Pinned in Tasks 2, 3, 8.
3. **Logging to a day that isn't today** (looking at yesterday) → the entry lands on the selected day, not today. Pinned in Task 6.
4. **Barcode found after a label was saved** (scan → not found → label → save → scan again) → the saved food comes back first.
   Pinned in Task 7 (server already does this; the test proves the app binds the barcode).
5. **Estimated items with zero / huge amounts** (user types 0 or 1000 servings) → refused with the server's words, nothing logged.
   Pinned in Task 3.

---

### Task 1: Server — plate photos

**Files:** Modify `backend/src/routes/photos.ts` (mode enum + plate branch), `backend/src/lib/foods.ts` (plate prompt + parser).
Test `backend/tests/photos-plate.test.ts` (fakes from `photoFakes.ts`).

**Interfaces:** `POST /api/photos/analyze` multipart `mode=plate` (1 image) → `{ photoIds, plate: { items: EstimateItem[] }, errors, labelReading }`
with `type EstimateItem = { food: AiDraft; servingIndex: number; quantity: number }` (servingIndex 0, quantity = how many of `food.servings[0]`).
Unusable AI answer → `plate: { items: [] }` plus `errors: [{ source: "ai", message: "Couldn't make out the food in that photo" }]`. No photo
AI service → `labelReading: false` and no AI call. Nothing is saved besides the uploaded photo (as label photos are).

- [ ] **Step 1: Failing tests** — plate photo → AI asked once with the image and a "foods on this plate" prompt; answer
  `{"items":[{"name":"Grilled chicken","servings":[{"label":"1 breast","grams":170}],"nutrients":{"calories":280,"protein_g":53},"quantity":1}, …]}`
  → two items with `food.icon` set and `quantity` kept; quantity missing → 1; unusable answer → empty items + the error; no photo AI → no call.
- [ ] **Step 2–4:** RED → implement (reuse `aiDraft` per item; cap at 12 items) → GREEN; whole backend suite green.
- [ ] **Step 5: Commit** — `server: plate photos list the foods on the plate`

### Task 2: Server — multi-item estimate

**Files:** Modify `backend/src/routes/foods.ts`, `backend/src/lib/foods.ts`. Test `backend/tests/estimate-items.test.ts`.

**Interfaces:** `POST /api/ai/estimate-items {text}` (2–500 chars) → `{ items: EstimateItem[], assumed: boolean, interpretedAs?: string }`
(plain JSON; no streaming). AI says unknown → 422 `AI_NO_IDEA` (same words as `/api/ai/estimate`); no AI → 503 as today; unusable → 502 `AI_COULDNT_ESTIMATE`.

- [ ] **Step 1: Failing tests** — "2 eggs, toast and coffee" with a faked AI answer of three items → three items, eggs `quantity` 2; one-item text works;
  `{"unknown":true}` → 422; AI off → 503; text "a" → 400; at most 12 items kept.
- [ ] **Step 2–4:** RED → implement → GREEN (+ whole suite). **Step 5: Commit** — `server: estimate several foods from one description`

### Task 3: Server — log AI-estimated items

**Files:** Modify `backend/src/routes/log.ts`. Test `backend/tests/log-estimates.test.ts` (+ a case in `isolation.test.ts`).

**Interfaces:** `POST /api/log/estimates { day?, meal?, items: [{ name, brand?, icon?, servings (1–20), nutrients (per servings[0]), servingIndex, quantity, fraction? }] (1–12) }`
→ `{ entries: LogEntry[] }`. Each entry: `source: "ai"`, `sourceRef: null`, `aiEstimated: true`, nutrients cleaned (`cleanNutrients`) and scaled with
`portionNutrients`; day/meal default as `POST /api/log`. Quantity must be > 0 and ≤ 100 (the existing `portionFields.quantity` rules).

- [ ] **Step 1: Failing tests** — two items → two entries in that meal/day with `aiEstimated` and scaled nutrients (2 × egg = 2 × 78 cal); `GET /api/day` shows them;
  quantity 0 → 400 with the portion field's message; 13 items → 400; another user's day is untouched (isolation); entries are not in `GET /api/my-foods`.
- [ ] **Step 2–4:** RED → implement (one transaction) → GREEN (+ whole suite). **Step 5: Commit** — `server: log AI-estimated foods without saving them`

### Task 4: iOS — food models, multipart uploads and endpoints

**Files:** Create `ByteSizeKit/Sources/ByteSizeKit/Models/Food.swift`, `API/FoodAPI.swift`; modify `API/APIClient.swift` (`Endpoint` can carry a multipart body).
Test `FoodAPITests.swift`.

**Interfaces:**
- `public struct Food: Codable, Identifiable, Equatable, Sendable { kind: String ("cache"|"user_food"|"culury"), id: Int, name, brand: String?, icon: String, barcode: String?, servings: [Serving], nutrients: Nutrients, aiFields: [String], source: String, foodKind: String?; var ref: String { "\(kind):\(id)" }; var isLoggable: Bool { kind != "culury" && foodKind != "recipe-without-servings" } }` (Culury recipes are out of scope: shown, not loggable, "Track Culury recipes in the web app").
- `public struct AiDraft: Codable, Equatable, Sendable { name, brand: String?, icon: String, category: String?, barcode: String?, servings: [Serving], nutrients: Nutrients, aiFields: [String]?, photoId: String? }`
- `public struct EstimateItem: Codable, Equatable, Sendable { var food: AiDraft; var servingIndex: Int; var quantity: Double }`
- `SearchResult { groups: [{source, label, foods: [Food]}], errors: [{source, message}], suggestion: String? }`, `BarcodeResult { code: String, food: Food? }`,
  `PhotoResult { photoIds: [String], barcode: String?, food: Food?, draft: AiDraft?, plate: { items: [EstimateItem] }?, errors: [...], labelReading: Bool }`, `EstimateItems { items, assumed, interpretedAs? }`.
- `public enum FoodAPI`: `search(_ q: String)`, `barcode(_ code: String)`, `recent(meal: Meal?)`, `frequent(meal: Meal?)` (`{foods: [Food]}`),
  `log(food:day:meal:servingIndex:quantity:fraction:) -> Endpoint<EntryResponse>` (`unit: "serving"`), `logEstimates(_ items: [EstimateItem], day:meal:) -> Endpoint<EntriesResponse>`,
  `estimateItems(_ text: String) -> Endpoint<EstimateItems>`, `analyzePhoto(jpeg: Data, mode: PhotoMode, barcode: String?) -> Endpoint<PhotoResult>` (multipart: `images` file + `mode` field),
  `saveFood(_ draft: AiDraft, barcode: String?) -> Endpoint<FoodResponse>` (`POST /api/my-foods` with `aiFields` = every nutrient key read, `photoId`).
- `public enum PhotoMode: String { case auto, barcode, label, plate }`.
- `Endpoint` gains `init(multipart: [MultipartPart], …)`; `APIClient` sets `Content-Type: multipart/form-data; boundary=…`.

- [ ] **Step 1: Failing tests** — decode real-shaped search/barcode/photo/estimate JSON (copy shapes from `backend/tests/foods*.test.ts`, `photos.test.ts`); `log` body keys exactly
  `day, meal, food{kind,id}, servingIndex, unit, quantity, fraction`; multipart body contains the boundary, `name="mode"` value `plate`, `name="images"; filename="photo.jpg"` with `Content-Type: image/jpeg`;
  `saveFood` sends `barcode` and `aiFields` (sorted nutrient keys) and `photoId`.
- [ ] **Step 2–4:** RED → implement → GREEN. **Step 5: Commit** — `ios: food search, barcode, photo and estimate endpoints`

### Task 5: iOS — `PortionModel`

**Files:** Create `Features/PortionModel.swift`. Test `PortionModelTests.swift`.

**Interfaces:** `@MainActor @Observable public final class PortionModel { public init(name: String, icon: String, servings: [Serving], nutrients: Nutrients, meal: Meal); public var servingIndex: Int; public var quantityText: String; public var fraction: Double; public var meal: Meal; public var quantity: Double?; public var canLog: Bool; public var previewCalories: Int?; public static let fractions: [Double] }`
— `previewCalories` = `nutrients["calories"]` (per `servings[0]`) × serving factor × quantity × fraction, rounded; the factor between servings uses grams (or ml) when both servings have them, else 1 (preview only).

- [ ] **Step 1: Failing tests** — defaults (serving 0, "1", All); "1.5" → 1.5; "," decimal accepted; "0", "", "abc" → `canLog` false; ½ × 2 of a 100-cal serving → 100; switching to a "1 tbsp (15 g)" serving from "1 cup (240 g)" scales the preview by 15/240.
- [ ] **Step 2–4:** RED → GREEN. **Step 5: Commit** — `ios: portion model`

### Task 6: iOS — `TrackFoodModel`

**Files:** Create `Features/TrackFoodModel.swift`. Test `TrackFoodModelTests.swift`.

**Interfaces:** `@MainActor @Observable public final class TrackFoodModel { public init(api: APIClient, dayStore: DayStore, now: @escaping () -> Date = Date.init); public var query: String; public private(set) var recent: [Food]; public private(set) var frequent: [Food]; public private(set) var groups: [FoodGroup]; public private(set) var searching: Bool; public private(set) var message: String?; public var meal: Meal; public func load() async; public func search() async; public func log(_ food: Food, portion: PortionModel) async -> Bool }`
— `meal` starts as `Meal.suggested(at: now(), in: dayStore.zone)`; search needs ≥ 2 characters (else groups cleared, no request); a newer search's answer wins (request counter);
an all-digits query of 8–14 characters is a barcode → `FoodAPI.barcode`; `log` posts to `dayStore.selected` and `portion.meal`, reloads the day, returns success.

- [ ] **Step 1: Failing tests** — load fetches recent + frequent for the suggested meal; "gr" searches, "g" doesn't; typed "0012345678905" uses the barcode route;
  out-of-order answers (`.delayed`) keep the last query's groups; **log on a non-today selected day posts that day** (Review Focus 3); a server 400 sets `message` and returns false.
- [ ] **Step 2–4:** RED → GREEN. **Step 5: Commit** — `ios: track food model`

### Task 7: iOS — `ScanModel` (barcode, then label when not found)

**Files:** Create `Features/ScanModel.swift`. Test `ScanModelTests.swift`.

**Interfaces:** `@MainActor @Observable public final class ScanModel { public enum Step: Equatable { case scanning, looking(String), found(Food), notFound(String), readingLabel, review(AiDraft, barcode: String), saved(Food), failed(String) }; public private(set) var step: Step; public init(api: APIClient); public func scanned(_ code: String) async; public func readLabel(jpeg: Data) async; public func save(_ draft: AiDraft) async; public func restart() }`
— a code read while not `.scanning` is ignored (the scanner fires repeatedly); `scanned` normalizes digits only; label → `analyzePhoto(mode: .label, barcode:)`;
`save` → `saveFood(draft, barcode:)` → `.saved(food)` (then the portion sheet logs it like a found food).

- [ ] **Step 1: Failing tests** — found → `.found`; a second read while `.looking` sends no second request; not found → `.notFound(code)`; label read → `.review(draft, barcode)`;
  label unreadable (no draft, error) → `.failed("Couldn't read that label. Try again with the whole Nutrition Facts panel in view.")`; save posts the barcode and → `.saved`;
  **then scanning the same code returns the saved food** (stub answers the barcode with the saved food after the save) (Review Focus 4).
- [ ] **Step 2–4:** RED → GREEN. **Step 5: Commit** — `ios: scan model with label fallback`

### Task 8: iOS — `EstimateModel` (Describe and plate photos)

**Files:** Create `Features/EstimateModel.swift`. Test `EstimateModelTests.swift`.

**Interfaces:** `@MainActor @Observable public final class EstimateModel { public var text: String; public private(set) var items: [EstimateItem]; public private(set) var busy: Bool; public private(set) var message: String?; public private(set) var assumedNote: String?; public var meal: Meal; public init(api: APIClient, dayStore: DayStore, now: () -> Date = Date.init); public func describe() async; public func photo(jpeg: Data) async -> PhotoOutcome; public func setQuantity(_ q: Double, at i: Int); public func remove(at i: Int); public func logAll() async -> Bool }`
with `public enum PhotoOutcome: Equatable { case food(Food), draft(AiDraft), items, nothing }` (`auto` mode first; a found barcode → `.food`, a label → `.draft`; else asks `plate`).
— `assumedNote` = "Took it as “\(interpretedAs)”" when `assumed`; 503 → message "Describe Food needs an AI service — set one up in the web app"; 422/502 → the server's words; text kept on failure.

- [ ] **Step 1: Failing tests** — describe → items; quantity edit and remove; logAll posts `/api/log/estimates` with the selected day and meal and reloads; 503 / 422 messages, text kept;
  photo: barcode found → `.food`; plate → `.items` filled; plate with no items → message "Couldn't make out the food in that photo"; logAll with no items does nothing.
- [ ] **Step 2–4:** RED → GREEN. **Step 5: Commit** — `ios: describe and plate-photo model`

### Task 9: iOS — the four action screens

**Files:** Create `ios/ByteSize/Logging/{TrackFoodSheet,PortionSheet,ScanSheet,BarcodeScanner,LabelReviewSheet,PhotoSheet,DescribeSheet,EstimateItemsView,CameraPicker}.swift`;
modify `Shell/MainTabView.swift` (the action sheets open these with `today.days`), `project.yml` (`NSCameraUsageDescription`).

- [ ] **Step 1:** Build the views over Tasks 5–8 (no new logic):
  - **Track Food:** search field focused; meal picker chip; sections Recent · Frequent (when the query is empty) or result groups with their labels; rows: icon, name, brand, "≈ N cal / serving";
    tap → `PortionSheet` → Log → sheet closes and a short "Logged" haptic; Culury rows show "Track Culury recipes in the web app".
  - **Portion sheet:** name, servings picker, quantity field, fraction chips, meal picker, "≈ N cal", **Log** button (disabled when `!canLog`).
  - **Scan Food:** `DataScannerViewController` (EAN-13, EAN-8, UPC-E; `isHighlightingEnabled`), haptic on read; when `DataScannerViewController.isSupported && isAvailable` is false → the
    message "Camera isn't available — type the barcode instead" (Review Focus 1); always a "Type a barcode" field. Not found → "We don't know this barcode yet" + **Scan the label** (camera) →
    `LabelReviewSheet` (editable name, brand, serving label, calories, protein, fiber, carbs, fat; "AI" marks) → **Save food** → `PortionSheet`.
  - **Photo:** "Take photo" (camera) and `PhotosPicker`; result: found food → `PortionSheet`; label draft → `LabelReviewSheet`; plate → `EstimateItemsView`.
  - **Describe Food:** multi-line text field ("e.g. 2 eggs, toast and coffee"), **Estimate**, then `EstimateItemsView` (rows with quantity steppers and delete, total ≈ calories, meal picker, **Log all**).
  - JPEGs are resized to ≤ 1600 px before upload.
- [ ] **Step 2: Verify** — Mac build + all tests green. **Step 3: Commit** — `ios: track, scan, photo and describe screens`

### Task 10: Stub data, UI tests, screenshots

**Files:** Modify `ios/ByteSize/Testing/StubServer.swift`, `ios/ByteSizeUITests/SmokeUITests.swift`.

- [ ] **Step 1: Failing UI tests** — `testTrackFoodSearchAndLog`: + → Track Food → type "banana" → row "Banana" → Log → Food Log tab shows "Banana";
  `testTypedBarcodeNotFoundOffersLabel`: + → Scan Food → (simulator: camera unavailable message) → type "0099999999999" → "We don't know this barcode yet" and "Scan the label";
  `testDescribeLogsItems`: + → Describe Food → "2 eggs and toast" → Estimate → rows "Egg" (2) and "Toast" → Log all → Food Log shows both with the "AI" chip.
- [ ] **Step 2: Run** → FAIL. **Step 3:** stub routes: search ("banana" → one cache food), barcode (known `0012345678905`, else `food: null`), recent/frequent, `POST /api/log` with a food,
  `/api/ai/estimate-items` (eggs + toast), `/api/log/estimates`, `/api/photos/analyze` (plate → two items), `POST /api/my-foods`.
- [ ] **Step 4: Run** the full suite (`swift test`, `xcodebuild test`, backend, frontend) → all PASS; screenshots of each sheet saved and looked at.
- [ ] **Step 5: Commit** — `ios: UI tests for logging`; push `ios-i3`.
