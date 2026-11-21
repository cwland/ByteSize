# I5 Apple Health, reading (iPhone + server) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Weight from Cory's scale, steps and workouts from his Watch reach ByteSize through Apple Health, without
typing, and never twice or over what he typed or deleted.

**Architecture:** The server learns "Health weigh-ins only fill empty, never-deleted days" and "Health workouts are
insert-only and stay deleted" (two skip tables). The kit gets a `HealthStore` protocol and a `HealthSync` model that
reads windows from it and sends to existing routes; the app gets the real HealthKit store, the Profile switches, and
background delivery.

**Tech Stack:** Fastify, Drizzle (Postgres), Vitest; SwiftUI (iOS 17+), Swift 6, HealthKit, XcodeGen, XCTest/XCUITest.

**Spec:** `docs/superpowers/specs/2026-11-20-bytesize-i5-apple-health-design.md`

## Global Constraints

- Read only: nothing is written to Health. Types: weight (body mass), steps, workouts.
- A weigh-in already on a day always wins; a deleted weigh-in day is never refilled from Health; a typed weigh-in clears the mark.
- A Health workout already in ByteSize is never changed by Health; a deleted one never comes back. Typed workouts unchanged.
- Weight: the first reading of the day, in kg. Steps: Health's daily sum (iPhone + Watch once); 0-step days not sent.
- Workouts: `externalId` = Health UUID; `day` = start day in the account's time zone; `minutes` = duration rounded, at least 1;
  `calories` = active energy rounded or null; type map: walking → walk, running → run, cycling → cycling,
  traditional/functional strength → strength, swimming → swim, hiking → hike, yoga → yoga, HIIT → hiit,
  team and racket sports → sport, else other.
- Windows: a type's first sync = the last 30 days (today and 29 before); later = from 2 days before its last successful
  sync's day to today; steps after the first = the last 7 days. Never a day after today.
- Samples written by ByteSize are skipped.
- A failed send keeps that type's last-synced time; the message names what failed.
- Copy: usage text "ByteSize reads your weight, steps and workouts from Apple Health."; refused hint
  "Allow ByteSize in the Health app: Sharing › Apps › ByteSize"; result like "1 weigh-in, steps for 7 days, 2 workouts",
  nothing new → "Up to date".
- Version 0.8.0 with a What's new entry.

## Review Focus

1. **Two phones / a reinstall resend the same 30 days**: nothing doubles, nothing overwrites. Pinned in Tasks 1–2 (server) and Task 3 (resend is harmless).
2. **A weigh-in typed for the same day after Health filled it**: the typed one replaces it (manual always saves). Pinned in Task 1.
3. **A workout crossing midnight / a time-zone change**: it lands on its start day in the account's zone. Pinned in Task 3.
4. **Health refused or the phone locked during a background wake**: nothing is sent, last-synced stays, no crash. Pinned in Task 3 (store throws).
5. **Turning a switch off mid-sync or signing out**: no further sends for that type; another account's switches aren't reused. Pinned in Task 3 (switches keyed per account).

---

### Task 1: Server — Health weigh-ins fill only empty, never-deleted days

**Files:**
- Modify: `backend/src/db/schema.ts` (table `weighInSkips`), `backend/src/routes/weight.ts`
- Create: migration via `npm run db:generate` (→ `backend/drizzle/0027_*.sql`)
- Test: `backend/tests/weight.test.ts`

**Interfaces:**
- `weighInSkips = pgTable("weigh_in_skips", { id serial, userId userRef(), day date string notNull, createdAt timestamptz default now })`, unique index `weigh_in_skips_user_day_idx` on (userId, day).
- `PUT /api/weigh-ins/:day` body gains `source: z.enum(["manual","health"]).default("manual")`; answer `{ weighIn: {day, weightKg, note} | null, skipped: boolean }`.
- `DELETE /api/weigh-ins/:day` inserts the skip (on conflict do nothing) in the same transaction.

- [ ] **Step 1: Failing tests** (describe "weigh-ins from Health"):
  - `saves a Health weigh-in on an empty day` → 200, `skipped: false`, GET /api/weight lists it.
  - `skips a Health weigh-in when the day has one` — PUT manual 80 then health 79 → `skipped: true`, `weighIn.weightKg` 80, still 80.
  - `skips a Health weigh-in on a deleted day` — PUT 80, DELETE, PUT health 79 → `skipped: true`, `weighIn: null`, no weigh-in that day.
  - `a typed weigh-in clears the deleted mark` — PUT 80, DELETE, PUT manual 78 (saved), DELETE → PUT health 77 is skipped (marked again); and PUT 80, DELETE, PUT manual 78 → the skip row for that day is gone.
  - `a typed weigh-in replaces a Health one` — PUT health 79 then manual 78 → 78.
  - `Health weigh-ins in the future are refused` → 400 "Choose today or an earlier day".
  - `one person's deleted day doesn't block another's`.
- [ ] **Step 2:** `cd backend && npx vitest run tests/weight.test.ts` → FAIL.
- [ ] **Step 3:** implement; `npm run db:generate` for the migration.
- [ ] **Step 4:** `npx vitest run tests/weight.test.ts tests/weight-import.test.ts tests/export.test.ts` → PASS; `npx tsc --noEmit` clean.
- [ ] **Step 5:** commit `feat(server): Health weigh-ins only fill empty, never-deleted days`.

### Task 2: Server — Health workouts are insert-only and stay deleted

**Files:** Modify `backend/src/db/schema.ts` (table `workoutSkips`), `backend/src/routes/activity.ts`; migration `0028_*`; Test `backend/tests/activity.test.ts`

**Interfaces:**
- `workoutSkips = pgTable("workout_skips", { id serial, userId userRef(), externalId text notNull, createdAt })`, unique (userId, externalId).
- `POST /api/workouts` with `source: "health"`: existing externalId → `{ workout: <existing>, skipped: true }` unchanged; skipped externalId → `{ workout: null, skipped: true }`; else insert → `{ workout, skipped: false }`. Manual posts answer `skipped: false` too.
- `DELETE /api/workouts/:id` of a row with `externalId` inserts the skip in the same transaction.

- [ ] **Step 1: Failing tests:** `a Health workout sent again keeps his edits` (POST health, PATCH type/minutes/note, POST same again → `skipped: true`, row still has his type, minutes, note); `a deleted Health workout isn't brought back` (POST, DELETE, POST → `skipped: true`, `workout: null`, no row); `a typed workout is unaffected` (deleting it records no skip; two typed posts make two rows); `skips are per person`. Replace any existing test that expected the Health upsert to overwrite.
- [ ] **Step 2:** `npx vitest run tests/activity.test.ts` → FAIL.
- [ ] **Step 3:** implement (insert … on conflict do nothing returning; on nothing returned select the existing row).
- [ ] **Step 4:** `npx vitest run tests/activity.test.ts tests/activity-unit.test.ts` → PASS; `npx tsc --noEmit` clean.
- [ ] **Step 5:** commit `feat(server): Health workouts are insert-only and stay deleted`.

### Task 3: Kit — HealthStore and HealthSync

**Files:**
- Create: `ios/ByteSizeKit/Sources/ByteSizeKit/Health/HealthStore.swift`, `.../Health/HealthSync.swift`, `.../API/ActivityAPI.swift`
- Modify: `.../API/BodyAPI.swift` (`saveWeight` gains `source`)
- Test: `ios/ByteSizeKit/Tests/ByteSizeKitTests/HealthSyncTests.swift` (with a `FakeHealthStore`)

**Interfaces:**
- `public enum HealthKind: String, CaseIterable, Sendable { case weight, steps, workouts }` with `title` ("Weight", "Steps", "Workouts").
- `public enum HealthActivity: Sendable { case walking, running, cycling, strength, swimming, hiking, yoga, hiit, sport, other }` and `var serverType: String` (the map in Global Constraints).
- `public struct HealthWeight: Sendable { date: Date; kg: Double; fromByteSize: Bool }`
- `public struct HealthWorkout: Sendable { id: String; start: Date; seconds: Double; activeCalories: Double?; activity: HealthActivity; fromByteSize: Bool }`
- `public protocol HealthStore: Sendable { func requestAccess(_ kind: HealthKind) async throws; func weights(from: Date, to: Date) async throws -> [HealthWeight]; func dailySteps(from: Date, to: Date, zone: TimeZone) async throws -> [String: Int]; func workouts(from: Date, to: Date) async throws -> [HealthWorkout] }` (dailySteps keyed by `yyyy-MM-dd` in `zone`).
- `BodyAPI.saveWeight(day:kg:source: String? = nil) -> Endpoint<WeighInResult>`, `public struct WeighInResult: Codable { skipped: Bool? }` (Dashboard/Goals callers unchanged in behaviour).
- `ActivityAPI.healthSteps(day: String, steps: Int) -> Endpoint<Empty>` (PUT /api/steps/:day, source health); `ActivityAPI.healthWorkout(_ w: HealthWorkout, day: String) -> Endpoint<HealthWorkoutResult>` with `skipped: Bool?`.
- `HealthSync` (`@MainActor @Observable`): `init(api:dayStore:store:defaults:account: String, now: @escaping () -> Date = Date.init)`; `isOn(_:) -> Bool`; `setOn(_:_:) async` (on → `requestAccess`, then `syncNow()`; a throw → stays off, `message` = the refused hint); `lastSynced: Date?` (latest of the types'); `result: String?`; `syncing: Bool`; `message: String?`; `syncNow() async`. Per-type last-synced and switches stored in `defaults` under keys prefixed `health.<account>.`.

- [ ] **Step 1: Failing tests** (today 2026-11-19 noon Boise; HTTPStub records):
  - `testSwitchesAreOffAndReadNothing` — new sync, `syncNow()` → no store calls, no requests.
  - `testFirstWeightSyncReadsThirtyDaysAndSendsTheFirstReadingOfEachDay` — two readings on 11-18 (7:10 82.4, 19:00 83.0) → one PUT `/api/weigh-ins/2026-11-18` with `weightKg` 82.4 and `source` "health"; store asked from 2026-10-21 00:00 Boise.
  - `testLaterSyncsStartTwoDaysBeforeTheLast` — lastSynced 11-15 → from 11-13.
  - `testStepsAfterTheFirstSyncAreTheLastSevenDays`, `testZeroStepDaysAreNotSent`.
  - `testWorkoutMapping` — running 1,799.6 s, 312.4 cal → `type` "run", `minutes` 30, `calories` 312, `externalId`; 20 s → minutes 1; no energy → calories null; `.sport` → "sport"; `.other` → "other".
  - `testAWorkoutLandsOnItsStartDayInTheAccountZone` — start 2026-11-19T06:30Z (11-18 23:30 Boise) → day "2026-11-18".
  - `testNothingAfterTodayIsSent`, `testByteSizeSamplesAreSkipped`.
  - `testResultCountsOnlyWhatWasAdded` — server answers skipped for one of two weigh-ins → "1 weigh-in…"; all skipped → "Up to date".
  - `testAFailedSendKeepsLastSynced` — 500 on a weigh-in → weight's last-synced unchanged, `message` contains "weight"; steps still synced.
  - `testAStoreErrorSendsNothing` — store throws (locked) → no requests, last-synced unchanged.
  - `testARefusedSwitchStaysOff` — requestAccess throws → `isOn(.weight) == false`, message is the refused hint.
  - `testSwitchesBelongToTheAccount` — on for account "h|1", a new sync for "h|2" sees it off.
- [ ] **Step 2:** Mac `swift test --filter HealthSyncTests` → FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** Mac `swift test` → all pass.
- [ ] **Step 5:** commit `feat(kit): Health sync — weight, steps and workouts`.

### Task 4: App — HealthKit store, Profile switches, sync on open (with UI test)

**Files:**
- Create: `ios/ByteSize/Health/HealthKitStore.swift`, `ios/ByteSize/Testing/FakeHealthStore.swift` (DEBUG, launch argument `-UITestFakeHealth`: one weight 2 days ago, 7 days of steps, one run)
- Modify: `ios/project.yml` (HealthKit + background-delivery entitlements in `ByteSize/ByteSize.entitlements`, `INFOPLIST_KEY_NSHealthShareUsageDescription`), `ios/ByteSize/Shell/TodayModels.swift` (`health: HealthSync`, account key `"\(server)|\(user.id)"`), `ios/ByteSize/Shell/MainTabView.swift` (sync when active, refresh Dashboard weight after), `ios/ByteSize/Profile/ProfileSheet.swift` (section), `ios/ByteSize/Testing/StubServer.swift` (health weigh-in skip rule, steps PUT, workouts POST)
- Test: `ios/ByteSizeUITests/SmokeUITests.swift`

**Interfaces:** Consumes Task 3. ids `health-weight|steps|workouts` (toggles), `healthSyncNow`, `healthStatus`.
`HealthKitStore` maps `HKWorkoutActivityType` to `HealthActivity` (team/racket sports: soccer, basketball, tennis, pickleball, golf, …) and sets `fromByteSize` from the sample's source bundle id.

- [ ] **Step 1: Failing UI test** `testHealthSwitchSyncsAWeighIn` (launch with fake Health; Profile → `health-weight` on → `healthStatus` contains "1 weigh-in"; close; Dashboard weight card shows the fake weight).
- [ ] **Step 2:** Mac UI run → FAIL.
- [ ] **Step 3:** implement (HKStatisticsCollectionQuery for steps; HKSampleQuery sorted by start for weight; workouts with `statistics(for: activeEnergyBurned)`).
- [ ] **Step 4:** UI run → PASS; screenshot `41-health`.
- [ ] **Step 5:** commit `feat(ios): Apple Health switches and sync on open`.

### Task 5: App — background delivery

**Files:** Create `ios/ByteSize/Health/HealthBackground.swift`; Modify `ios/ByteSize/ByteSizeApp.swift` (`@UIApplicationDelegateAdaptor`; at launch, for the last signed-in account's switches that are on, register `HKObserverQuery` + `enableBackgroundDelivery` — weight `.immediate`, steps `.hourly`; on fire: build the API client from the Keychain session and run `HealthSync.syncNow()` for that account, then call the completion handler)

- [ ] **Step 1:** kit test `testABackgroundSyncUsesTheSavedSwitches` (a `HealthSync` built cold from defaults for an account with weight on syncs weight only).
- [ ] **Step 2:** Mac `swift test --filter HealthSyncTests` → FAIL. **Step 3:** implement. **Step 4:** `swift test` → PASS; build the app.
- [ ] **Step 5:** commit `feat(ios): sync Health in the background`. Manual check on Cory's iPhone at round end.

### Task 6: Version and round end

- [ ] **Step 1:** `npm version 0.8.0 --no-git-tag-version` (backend, frontend); changelog 0.8.0 "Apple Health": weight from your scale fills days with no weigh-in (deleted days stay empty); steps and Watch workouts come in once (your edits stay); switches in the iPhone Profile.
- [ ] **Step 2:** backend vitest + tsc; frontend vitest, tsc, build; Mac kit + full UI suite (three parts).
- [ ] **Step 3:** final review (fresh reviewer); fix pass; PR, CI (incl. image), merge, deploy; Cory's on-device check (switch on, real scale weight and Watch steps arrive, a background weigh-in reaches the web).

## Rulings in this plan
- Export unchanged: the skip tables are bookkeeping, not the person's data; backups carry them from the schema (the spec said export lists them; the CSV export shows readable data only).
