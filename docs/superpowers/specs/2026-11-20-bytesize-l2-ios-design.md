# ByteSize L2 (iPhone): Adding food — design

Round L2, iPhone part. Specs: SPEC-07, SPEC-08, SPEC-10 in `docs/backlog/2026-11-19-ui-feedback-specs.md`.
The server side (favorites table and routes, same-as-yesterday, last portions) shipped in 0.3.0 (PR #5) and is unchanged
here.

## Intent

Cory logs several foods per meal, often the same ones day to day. Adding food should take as few taps as possible, and
the meal he means should never get lost along the way. L1 already made Scan and Track Food stay open for the next food
(SPEC-16); L2 makes every way of adding food start in the right meal and puts the foods he repeats one tap away.

## Goals

1. **SPEC-07 — meals always there, each with Add.** The Food Log always shows Breakfast, Lunch, Dinner and Snacks,
   empty or not. The "Nothing logged yet — tap + to track food" text goes. Each of the four meals ends with an
   **Add** row ("Add to Breakfast") that opens Track Food set to that meal. Supplements & water stays as today: shown
   only when it has entries, no Add row.
2. **SPEC-08 — Track Food is the hub.** Under the search field, three buttons: **Photo**, **Scan**, **Describe**. Each
   opens that flow *inside* the Track Food sheet (pushed, with Back to the search), in the meal currently chosen.
   Close (top left) leaves the whole sheet from anywhere. The (+) menu keeps its four buttons (Track Food, Scan Food,
   Photo, Describe Food), spaced so no button or label overlaps another.
3. **SPEC-10 — quick foods.** With the search field empty, Track Food shows, in this order:
   1. **Same as yesterday** — what was logged in this meal the day before the day being looked at. Header has a
      **Log all** button.
   2. **Favorites** — bookmarked foods, newest first.
   3. **Recently tracked** — as today's "Recent" for the meal.
   "Frequent" is dropped. Sections with nothing in them are hidden; if all three are empty, the existing
   "Foods you log show up here." line shows.
4. **Option B (Cory's choice): one-tap logging.** Each quick row has a **+** button on its right that logs the food
   right away at its last amount (the server's `last` portion), into the chosen meal on the day being looked at. Tapping
   the row itself opens the amount wheels (as search results do), starting at that last amount. After a + log the
   "Logged X" line shows and the row stays (it can be + again).
5. **Log all** copies every one of yesterday's entries for this meal into this day and meal, the way the web's "Same as
   yesterday?" does (`POST /api/log/move` with `copy: true`), then shows "Logged N foods".
6. **Bookmark.** The amount screen (`FoodPortionView`, wherever it shows a database food or one of the person's own)
   gets a bookmark button in its toolbar: `bookmark` when not a favorite, `bookmark.fill` when it is. Tapping toggles it
   on the server (`PUT /api/foods/favorites` / `DELETE /api/foods/favorites/:kind/:id`). The Favorites section updates
   at once; if the server says no, the button goes back and the message shows.

## Non-goals

- A Favorites button on the web (later round).
- Reordering or managing Favorites beyond the toggle.
- Logging Culury recipes or quick meals on the iPhone (still "track in the web app"); they get no + and no bookmark.
- Changing Scan / Photo / Describe themselves beyond where they live and what happens after a log.
- Any server change, except one additive field found while planning: food results carry `baseCacheId` (which
  database food a correction corrects), needed for call 2 below.

## Anti-goals (would make this a failure even if it works)

- A food landing in a meal Cory didn't choose (every entry point must carry the meal through).
- A + that logs something other than what the row shows (the row's amount text must be the amount + logs).
- Losing L1's behaviour: after logging, Track Food and Scan stay open for the next food; Close leaves.

## Approaches considered

1. **Track Food as the hub (chosen).** Photo/Scan/Describe pushed inside Track Food's navigation stack, meal carried,
   Back to search, Close leaves. Reuses the existing Scan/Photo/Describe screens; costs rewiring how they finish.
2. **Hand off.** The icon closes Track Food and opens the separate sheet. Least work, but a visible close/reopen, the
   chosen meal is lost, and logging several in a row breaks. Rejected.
3. **One Add Food sheet with tabs.** Tidy, but a rewrite of screens L1 just finished testing, and the (+) menu becomes
   four doors to one sheet. Rejected.

Quick rows: Cory chose **B** (+ logs at the last amount; tap opens the wheel; Log all for Same as yesterday) over A
(always open the wheel).

## How it fits the existing code

- `ShellModel.choose(_ action:)` opens a quick action sheet; it gains a meal: `open(_ action: QuickAction, meal: Meal?)`.
  The Food Log's Add rows call it with `.track` and their meal; the (+) menu passes nil (the time-of-day meal, as now).
  `MainTabView`'s sheet seeds `TrackFoodModel.meal` from it.
- `TrackFoodModel` (ByteSizeKit) loads `sameAsYesterday`, `favorites` and `recent` instead of `recent` and `frequent`,
  and gains `quickLog(_ food:)`, `logAllYesterday()`, `isFavorite(_:)` and `toggleFavorite(_:)`. Reloads on meal change
  and after any log (Recent changes).
- `Food` (ByteSizeKit) decodes the server's optional `last` portion (`servingIndex`, `unit`, `quantity`, `fraction`).
  `PortionModel(food:meal:)` starts at `last` when present.
- `FoodAPI` gains `sameAsYesterday(day:meal:)`, `favorites()`, `addFavorite(_:)`, `removeFavorite(_:)`.
  Same as yesterday: see call 1 below (rows are yesterday's entries; + and Log all copy them with
  `LogAPI.move(ids:day:meal:copy: true)`).
- Scan / Photo / Describe inside the hub use the Track Food meal. Scan keeps L1's back-to-camera after a log. Photo and
  Describe, after their log (single food or Log all of the estimate), pop back to the search with the "Logged …" line
  instead of closing the sheet.
- The same three screens opened from the (+) menu keep behaving as in 0.4.0.
- `FoodLogModel.sections` always yields the four meals (empty ones with no entries and no total).

### Sketch — Track Food, search empty

```
 Close            Track Food
 [🔍 Search foods or type a barcode ]
 [📷 Photo] [▥ Scan] [💬 Describe]
 ✓ Logged Banana
 Meal                      Lunch ⇕
 SAME AS YESTERDAY           Log all
  🍌 Banana  1 medium · 105      (+)
  🥣 Oatmeal 1 cup · 150         (+)
 FAVORITES
  🍇 Prunes  6 prunes · 180      (+)
 RECENTLY TRACKED
  …
```

### Sketch — Food Log, an empty meal

```
 LUNCH
  + Add to Lunch
```

## Calls made after the builder check (Cory to confirm while reading)

1. **Same as yesterday shows yesterday's entries, exactly as logged.** Its rows come from `GET /api/day/<yesterday>`
   (this meal's entries), not from the same-as-yesterday foods route, so AI estimates and corrected foods show as they
   were logged. A row's **+** copies that one entry (`/api/log/move`, `copy: true`, its id); **Log all** copies all of
   them. So + and Log all always log exactly what the rows show. Tapping a row opens the wheels for its food at
   yesterday's amount when the entry has a loggable food behind it (matched via `sourceRef` to the same-as-yesterday
   foods); an entry without one (an AI estimate) has only the +.
2. **Bookmark on a corrected database food.** The favorites list can show a database favorite as Cory's own correction.
   The bookmark must reflect and remove the favorite that is really stored: `isFavorite` matches the food's own ref or
   the database original it corrects, and un-bookmarking deletes whichever is stored. A test pins "bookmark, then
   un-bookmark a corrected food → it is gone from Favorites".
3. **Logging a food already in the meal.** The server grows the existing entry (as it does today on the iPhone); the
   line still says "Logged X". No undo in L2 (the Food Log's swipe-to-delete covers mistakes).
4. **One meal for the whole hub.** Photo, Scan and Describe pushed inside Track Food use Track Food's meal, not their
   own: changing it on any of their screens changes it for the search too, and it stays after Back.

## Constraints

- iOS 17+, SwiftUI, Swift 6; logic in ByteSizeKit with XCTest; UI covered by XCUITest against the in-app stub server
  (which must learn the new routes).
- TDD as in L1: each behaviour gets a failing test first.
- Version bump with a What's new entry (0.5.0) since the server image is rebuilt and deployed with each round.

## Left to the builder

- Exact spacing of the (+) menu (radius/spread) — must not overlap at the largest Dynamic Type the menu supports;
  a UI test checks the four buttons' frames don't intersect.
- How the + button confirms (e.g. briefly a checkmark) — beyond the "Logged X" line.
- Whether "Logged N foods" or "Logged Banana, Oatmeal" for Log all.
- Accessibility labels ("Log Banana", "Log all of yesterday's Lunch", "Add to Favorites").
