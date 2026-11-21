# ByteSize I5 — Apple Health, reading (design)

Date: 2026-11-20 · Status: for Cory's approval (approach A chosen 2026-11-20; builder-check answers 1A, 2A) · Sources: the iOS design
`2026-11-19-bytesize-ios-design.md` §6.5 and §6.7 change 8, Cory's answers on 2026-11-20.

## 1. Intent

Cory's smart scale writes to Apple Health and his Apple Watch counts his steps and workouts. Today Weight Watchers
picks those up from Health; ByteSize should do the same, so his weight, steps and workouts appear in ByteSize (phone
and web, goals and badges included) without typing anything. This round only **reads** from Health.

## 2. Goals, non-goals, anti-goals

**Goals**
- **Weight** from Health becomes a ByteSize weigh-in for any day that has none. An existing ByteSize weigh-in always
  wins (Cory's rule). A day whose weigh-in he deleted in ByteSize is never refilled from Health.
- **Steps**: each day's total from Health (iPhone + Watch, counted once) as that day's Health steps.
- **Workouts** from Health become ByteSize workouts, each imported once (by its Health id). **ByteSize wins** (Cory,
  1A): once a Health workout is in ByteSize, Health never changes it (his edits and notes stay), and one he deleted
  stays deleted.
- Three switches in the Profile sheet's Apple Health section — **Weight · Steps · Workouts** — each off until turned
  on, each asking Health only for its own type. A "Last synced …" line and a **Sync now** button.
- Syncs when the app opens or comes back to the front, and in the background when Health gets new weight or steps
  (so a morning weigh-in shows on the web even if the phone app wasn't opened).

**Non-goals (this round)**
- Writing anything to Health (weight, water, calories, macros) — a later round if wanted.
- Water logged in other apps.
- Health's active energy, heart rate, sleep or anything else.
- Removing ByteSize data when it's deleted in Health (the import is one way).

**Anti-goals**
- A weigh-in, workout or day's steps counted twice (a re-sync, a reinstall, a second phone, iPhone + Watch both
  counting steps).
- Health overwriting a weigh-in typed in ByteSize, or bringing back one he deleted; the same for workouts.
- Any network call except to his ByteSize server (unchanged rule).

## 3. Approaches (Cory picked A)

| | Approach | Trade-off |
|---|---|---|
| **A** | **Read weight, steps and workouts; app open + background** | Covers what he uses (scale, Watch); one small server change. **Chosen.** |
| B | The whole §6.5 design (also external water, and writing weight, water, calories and macros) | About twice the work; most of it writing back, which he doesn't use. |
| C | Weight and steps only | Barely smaller; leaves Watch workouts out though the server already takes them. |

## 4. Design

### 4.1 Server (weigh-ins and workouts from Health)
- `PUT /api/weigh-ins/:day` accepts `source: "manual" | "health"` (default `"manual"`, so the web and the
  Dashboard are unchanged).
  - **health**: if that day already has a weigh-in, or is a *skipped day*, nothing changes and the answer is
    `{ weighIn: <existing or null>, skipped: true }` (200). Otherwise it's saved like any weigh-in
    (`{ weighIn, skipped: false }`). The "only empty days" rule lives on the server, so a slow phone or a second
    phone can't race it.
  - **manual**: as today, and it also clears that day's skip mark (he weighed in by hand, so the day is his again).
- **Skipped days**: deleting a weigh-in (`DELETE /api/weigh-ins/:day`) records the day in a new table
  `weigh_in_skips (user_id, day, created_at)`, unique per user and day. The weight import (CSV) is unchanged and
  ignores skips.
- **One weigh-in per day, first to arrive** (Cory, 2A): a Health weigh-in never replaces another weigh-in, Health's or
  his. If a later reading of the day reached Health first, it stays; he fixes it by typing the right weight
  (a typed weigh-in always wins). No source column on `weigh_ins`.
- **Workouts from Health** (`POST /api/workouts` with `source: "health"` and `externalId`):
  - Insert only: when that `externalId` already exists for him, nothing changes and the answer is the existing
    workout with `skipped: true` (today the route overwrites every field, which would undo his edits and erase notes).
  - Deleting a workout that has an `externalId` records it in a new table `workout_skips (user_id, external_id,
    created_at)`, unique per user and id; a Health workout whose id is there is refused quietly
    (`{ workout: null, skipped: true }`, 200), so a deleted one never comes back.
  - Typed workouts and `PATCH` are unchanged.
- Steps (`PUT /api/steps/:day` with `source: "health"`) already exist and already upsert the day's Health total
  (that total is Health's to keep up to date); no change. Future days are refused by all three routes.
- Export (`lib/exportData.ts`) lists both new tables; backups pick them up from the schema.

### 4.2 iPhone
- **ByteSizeKit**
  - `HealthStore` protocol (what the app needs from HealthKit: ask permission for a type, daily weight samples,
    daily step totals, workouts since a date, background observers). A real HealthKit implementation lives in the
    app target; tests use a fake.
  - `HealthSync` (`@MainActor @Observable`): the three switches (saved per device, per account), `lastSynced`,
    `syncing`, `message`, a short result ("1 weigh-in, steps for 7 days, 2 workouts"), `syncNow()`.
  - **Weight**: for each day in the window, the **first reading of the day** (Claude's call: the morning weigh-in,
    before eating, is what people usually go by) → `PUT /api/weigh-ins/:day` with `source: "health"`, in kg as
    Health stores it.
  - **Steps**: Health's per-day sum (its statistics query counts iPhone and Watch once) → `PUT /api/steps/:day`
    with `source: "health"`. Days with 0 steps are not sent.
  - **Workouts**: `POST /api/workouts` with `source: "health"`, `externalId` = the Health workout's UUID,
    `day` = its start day in the account's time zone, `minutes` = duration rounded (at least 1), `calories` = its
    active energy rounded (null if none), `type` mapped from Health's activity type (walking → walk, running → run,
    cycling → cycling, traditional/functional strength → strength, swimming → swim, hiking → hike, yoga → yoga,
    HIIT → hiit, team and racket sports → sport, everything else → other).
  - **Window** *(Claude's call)*: the first sync after a switch is turned on reads the last 30 days (his earlier
    history came in by CSV); later syncs read from 2 days before the last successful sync (a scale or watch can
    sync late) up to today. Steps always re-send the last 7 days (today's total keeps growing).
  - Days are in the account's time zone (as the rest of the app); nothing in the future is sent.
  - Samples written by ByteSize itself are skipped (none yet, but the rule keeps a later write round from looping).
  - Errors: a failed send leaves `lastSynced` unchanged so the next sync retries the same window; the message says
    what failed. Health data can't be read while the phone is locked: a background wake-up that finds it locked
    does nothing and the next open catches up.
- **App**
  - `HealthKitStore` (the real `HealthStore`), the HealthKit capability with background delivery in `project.yml`,
    and `NSHealthShareUsageDescription` ("ByteSize reads your weight, steps and workouts from Apple Health.").
  - Background: observer queries with background delivery for weight (immediate) and steps (hourly), started at
    launch for the switches that are on.
  - Profile sheet, Apple Health section (replacing "coming soon"):
    ```
    Apple Health
      Weight            [on ]
      Steps             [on ]
      Workouts          [off]
      Last synced 7:42 AM · 1 weigh-in, steps for 7 days
      Sync now
    ```
    Turning a switch on asks Health for that type, then syncs. If Health says no (or it was refused before), the
    line says "Allow ByteSize in the Health app: Sharing › Apps › ByteSize".
  - UI tests run with a fake Health store (launch argument, like the stub server).

### 4.3 Testing
- Server (Vitest): health weigh-in on an empty day saves; on a day with a weigh-in or a skipped day is skipped and
  changes nothing; deleting a weigh-in marks the day; a manual weigh-in clears the mark; a Health workout sent again
  after he edited it (type, minutes, note) is skipped and his edits stay; a deleted Health workout sent again is
  skipped; a typed workout is unaffected; future days refused; export includes both skip tables.
- Kit: first-of-day pick; windows (first sync 30 days, later from last sync − 2 days, steps 7 days); workout type
  mapping and rounding; nothing in the future; a failed send keeps `lastSynced`; switches off → nothing read.
- UI: Profile → turn Weight on → Sync now → "1 weigh-in" and the Dashboard weight card shows the Health weight.
- Manual on Cory's iPhone (the simulator's Health is limited): permission prompts, real scale and Watch data,
  a background weigh-in reaching the web.
- End of round: full server, web and iOS suites, web build, CI image build.

## 5. Left to the builder
- Exact HealthKit query types and observer frequencies within the above.
- Where the switches are stored (UserDefaults keyed by server + user is the expected place).
- Wording of the result line beyond the examples.
