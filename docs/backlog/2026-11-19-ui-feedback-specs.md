# ByteSize — Feature & Bugfix Specification (backlog, 2026-11-19)

Added by Cory on 2026-11-19 during round I3. UI/UX refinements, bug fixes and a portion/unit scaling overhaul across the
iOS app and the web app. Each item can be built and tested on its own. Not yet scheduled into a round.

## How these relate to work already done or under way (Claude's notes)

- **SPEC-01 + SPEC-09** replace I3's portion sheet (servings picker + typed amount + ¼ ⅓ ½ ¾ All chips). The server
  already measures in `g, oz, ml, fl_oz, cup, tbsp, tsp` as well as servings (`amountFactor`); what's new is
  item counts parsed from serving labels ("5 prunes"), size presets (Small/Medium/Large) and the iOS wheel picker.
  Needs server work (parsing at ingest + a per-food unit list) before the iOS wheel.
- **SPEC-07, SPEC-08, SPEC-10** reshape I3's Track Food sheet (per-meal Add, Photo/Scan/Describe icons beside search,
  Same as Yesterday / Favorites / Recently Tracked). Favorites needs a new server table/route.
- **SPEC-02 – SPEC-06** change I2's Dashboard and Food Log (overview card, calendar strip, day switching, bar colors,
  Food Log summary header).
- **SPEC-11, SPEC-14** are GLP-1 shot logging on iOS and web; the dose lists should come from one shared table.
- **SPEC-12, SPEC-13**: Profile/Settings divider and iPad layout.

**Status (2026-11-20):** done — SPEC-01, 09, 16 (L1, 0.3–0.4), SPEC-07, 08, 10 (L2, 0.5), SPEC-02–06, 11, 12
(Today polish, 0.6), SPEC-14, 15 (W1, 0.2), SPEC-17 (I4, 0.7); the Food Log day strip matching the Dashboard (I5, 0.8).
Open — SPEC-13 (iPad, parked by Cory), SPEC-18, SPEC-19, SPEC-20.

---

## Part 1: Shared core architecture (iOS & Web)

### SPEC-01: Decoupled portion & unit scaling engine

**Problem:** serving counts are coupled to the database serving size (if 1 serving = 5 prunes, incrementing servings
gives 2 × 5 = 10; logging 6 or 7 prunes needs decimal math like 1.2 servings).

**Requirement:** decouple how the database stores reference nutrition from how the user logs what they ate. Every
logged entry computes a scale factor against the reference nutrition record:

    scaleFactor = enteredQuantityInBaseUnits / referenceServingInBaseUnits

Supported unit modes:
- **Direct count / item mode** (items, prunes, slices, pieces, wings): when a result defines a multi-item serving
  (e.g. 5 prunes = 150 kcal), default the unit to the item name/count. Entering 6 → 6 / 5 = 1.2× (180 kcal).
- **Size presets** (Small, Medium, Large): for whole produce and standard items (apples, bananas, chicken breasts),
  map presets to known gram weights (e.g. Small apple = 150 g, Medium = 182 g, Large = 223 g) or scale factors
  relative to the default item.
- **Exact weight / volume** (g, oz, ml, cup, tbsp): convert to base grams/millilitres and scale against the item's
  per-100 g or reference serving grams.

Data parsing & edge cases:
- Parse item counts from serving text ("5 prunes", "4 slices (56g)") when ingesting USDA / Open Food Facts /
  FatSecret / Spoonacular results.
- Switch between item count (5 slices) and weight (70 g) on the same food when both exist.
- When switching units in the UI, update the displayed nutrition in real time without losing precision.
- Fall back to g / oz when an item only has per-100 g data.

**Acceptance:** searching "prunes" (5-prune reference) allows entering 6 items and logs 1.2× calories and macros.
Searching "apple" allows Small, Medium, Large, oz or g, and recalculates accurately for each.

## Part 2: iOS app

### SPEC-02: Dashboard — collapsible macro breakdown ("Today's Overview")
- Remove Carbs and Fat from the default (collapsed) Today's Overview.
- Add a disclosure chevron (chevron.right rotating to chevron.down) on the card.
- Expanded: smoothly reveal the full macro & nutrient breakdown matching the web app's "Daily Totals".

**Acceptance:** the default dashboard is cleaner; the chevron expands/collapses the full Daily Totals breakdown.

### SPEC-03: Dashboard & Food Log — day-by-day horizontal strip and month picker
- Remove the < and > week buttons on Dashboard and Food Log. Replace with a horizontally scrollable date strip
  (`ScrollView(.horizontal)` with `.scrollTargetBehavior(.viewAligned)` or paged snapping) that moves one day at a
  time, not a week.
- Tapping the month/date header opens a popover/sheet with a graphical `DatePicker` (`.datePickerStyle(.graphical)`)
  to jump across months or to any date.

**Acceptance:** swipe day by day with no arrows; tapping the header opens a graphical month calendar.

### SPEC-04: Day switching without flicker
- **Problem:** switching days shows a redraw flicker while data reloads.
- **Requirement:**
  - Don't reset the view to empty or loading states between cached or rapid day changes.
  - Use `.animation(.easeInOut(duration: 0.2), value: selectedDate)` with `.contentTransition(.numericText())` on numbers.
  - Keep view ids stable: no `.id(selectedDate)` on the outer container.

**Acceptance:** numbers and lists transition smoothly between days, with no layout flash.

### SPEC-05: Progress bar colors (light green → dark green → red)
- **Problem:** the iOS fill bar is gray, which gives no clear target feedback.
- **Requirement:**
  - Under the target range: light green.
  - Within the range: dark green, with a visible marker/band for the target range.
  - Over the range: red.

**Acceptance:** the bar moves light green → dark green → red as the thresholds are crossed.

### SPEC-06: Food Log — compact daily summary header
Directly under the date strip in Food Log, a compact bar with:
- Calories consumed
- Calories remaining
- Protein (current / target)
- Fiber (current / target)

**Acceptance:** remaining calories, protein and fiber are visible in Food Log without going back to the Dashboard.

### SPEC-07: Food Log — persistent meal sections with inline Add
- **Problem:** empty meals show "Nothing logged yet - tap + to track food."
- **Requirement:**
  - Always show Breakfast, Lunch, Dinner and Snacks, even when empty.
  - Remove the empty-state text.
  - Put an Add button at the bottom of each meal that opens food entry pre-set to that meal.

**Acceptance:** every meal section is always visible with its own Add button that logs into that meal.

### SPEC-08: Food search prompt and + menu icon overlap
- Tapping Add Food (or a meal's Add) opens search with quick-action icons for Photo, Scan and Describe.
- Fix the + menu spacing bug where the Scan icon slightly overlaps the Search icon.

**Acceptance:** Add Food shows Search alongside Photo, Scan and Describe with clean padding and no overlap.

### SPEC-09: Food entry — 3-wheel picker (whole number | fraction | measurement)
- **Problem:** editing or choosing a portion uses a plain text box.
- **Requirement:** replace it with three `.pickerStyle(.wheel)` pickers in an HStack:
  - **Whole number:** 0–99 (or a range that fits the food).
  - **Fraction:** 0 (or –), ⅛, ¼, ⅓, ⅜, ½, ⅝, ⅔, ¾, ⅞ (plus decimal steps if needed).
  - **Unit:** the units that food supports, from SPEC-01 (prunes, Small, Medium, Large, oz, g, cup, tbsp…).
- Whole number + fraction feeds the SPEC-01 scaling engine, and calories/macros update live as the wheels spin.
- Reference layout: [`2026-11-19-spec-09-wheel-picker.jpg`](2026-11-19-spec-09-wheel-picker.jpg). A "Serving 200 gm" row
  below the nutrient rows expands to the three wheels: number (…199, **200**, 201…), fraction (⅛, ¼…) and unit
  (oz, pound(s), **gm**), with the current values highlighted.

**Acceptance:** editing a portion shows the 3-wheel picker, and calories/macros update live as any wheel changes.

### SPEC-10: Favorites — bookmark toggle and per-meal quick-add sections
- A bookmark button (bookmark / bookmark.fill) in the food edit/detail view toggles a food as a Favorite.
- Inside each meal's add/search view, quick-select sections in this order:
  1. Same as Yesterday (logged in that meal yesterday)
  2. Favorites
  3. Recently Tracked

**Acceptance:** bookmarking persists to Favorites; Add Food for a meal shows Same as Yesterday, Favorites, Recently
Tracked, in that order.

### SPEC-11: GLP-1 Log Shot — missing fields
- **Problem:** the Log Shot screen is missing key inputs.
- **Requirement:** add these to the iOS Log Shot form:
  - **Dosage** (the medication's standard doses, or a custom dose)
  - **Date** (a date/time picker, defaulting to now)
  - **Notes** (multi-line, for injection site, side effects and other notes)

**Acceptance:** dosage, date and notes can be set when logging a shot.

### SPEC-12: Settings — half-width divider
- **Problem:** the separator between Theme and Appearance spans only half the grouped container.
- **Requirement:** make it span the full row width, or use native List section dividers consistently.

**Acceptance:** no half-width divider between Theme and Appearance.

### SPEC-13: iPad — phone-style centered container
- **Problem:** on iPad the layout stretches.
- **Requirement:** don't build a separate iPad UI. On iPad (`horizontalSizeClass == .regular`), constrain the root
  layout to a centered, phone-width container (max width about 430–480 pt) with clean background framing.

**Acceptance:** the app runs cleanly on iPad in a centered phone-width layout.

## Part 3: Web app

### SPEC-14: GLP-1 setup — standard dosages and a Compounded option
Selecting a brand medication fills in its standard dose steps:
- Wegovy (semaglutide): 0.25, 0.5, 1.0, 1.7, 2.4 mg
- Ozempic (semaglutide): 0.25, 0.5, 1.0, 2.0 mg
- Zepbound (tirzepatide): 2.5, 5, 7.5, 10, 12.5, 15 mg
- Mounjaro (tirzepatide): 2.5, 5, 7.5, 10, 12.5, 15 mg
- Saxenda (liraglutide): 0.6, 1.2, 1.8, 2.4, 3.0 mg
- Trulicity (dulaglutide): 0.75, 1.5, 3.0, 4.5 mg

Add a **Compounded** option that reveals:
- Medication / compound name (e.g. "Compounded Tirzepatide + B12")
- Custom dose and unit (e.g. 3.5 mg or 25 units)

**Acceptance:** each standard GLP-1 shows its dose tiers; Compounded allows a custom name and dose.

## Part 4: Added later on 2026-11-19

### SPEC-15: Web — "What's new" popup and version in the corner (like Culury)
Cory: "a popup like Culury whenever a new version is loaded … show the most recent changes. Also add the version
number to the left bottom and when users click on the version they can see the changes."

- When someone opens the web app after a new version was deployed, a popup shows the most recent changes (once per
  version per person), the way Culury does it.
- The version number shows in the bottom-left corner; clicking it opens the list of changes (the latest first,
  earlier versions below).
- Needs a real version per build (today `/api/health` reports `0.1.0` for every build) and a changelog kept in the
  repo that the build ships with.

**Acceptance:** after a deploy, the first visit shows what changed; the corner version always opens the change list.

### SPEC-16: iOS — keep scanning and searching after logging (scheduled in L1, Task 6)
Cory: people scan or search several things in a row. After logging a scanned item, go back to the camera, ready for
the next barcode. After logging a searched item, go back to the search. Only the Close button leaves.

**Acceptance:** scan → log → scan again without reopening Scan Food; search → log → search again without reopening Track Food.


## Part 5: Added 2026-11-20

### SPEC-17: iOS — pick days ahead on the day strip and calendar
Cory (after 0.6.0): "I can't select future dates, they are greyed out."

- The day strip and the month calendar let you pick the next 7 days (the days the strip already shows), so food can be
  planned and pre-logged ahead. "Same as yesterday" works there too (the day before the picked day).
- GLP-1 shots stay today or earlier (the server only accepts past and today's shots).
- No server change: the food log already accepts future days.

**Acceptance:** tomorrow's chip and date can be picked; food logged there shows on that day; Log shot still can't
pick a future date.

### SPEC-18: Web — version number pinned to the bottom-left corner
Cory (after 0.8.0, screenshot `2026-11-20-spec-18-version-corner.png`): the version should sit in the bottom-left
corner. Today it is the last thing in the page content (after the Dashboard's cards), so on the wide layout it floats
mid-screen beside the side rail instead of in the corner.

- Wide layout: the version sits at the bottom of the side rail (below Settings and the account avatar), always in the
  bottom-left corner whatever the page's length.
- Phone layout: keep it at the end of the page (no rail there), or fix it bottom-left above the tab bar — builder's
  call, as long as it never covers content.
- Still opens What's new; still says "v0.8.0".

**Acceptance:** on a wide screen the version is in the bottom-left corner on every page, short or long; clicking it
opens What's new.

### SPEC-19: Web — What's new: latest version open, earlier ones folded (like YAHD2)
Cory (screenshot `2026-11-20-spec-19-whats-new.png`): in the What's new popup the newest version is shown in full and
the others are folded below, each opening with a ›.

- Header: "What's new", "ByteSize v0.8.0 · Nov 20, 2026", close ×.
- The current version in its own card: version, a "Current version" chip, the date on the right, its title, then its
  changes grouped under **Added** and **Fixed** (and **Changed** if needed), each with its own icon and colour.
- Below, "EARLIER UPDATES": one row per earlier version — › chevron, version, title, "N changes · date" on the right;
  tapping a row opens it in place to show its changes.
- The changelog entries gain a kind per change (added / fixed / changed) so they can be grouped; existing entries are
  sorted into those kinds.
- The popup after an update still shows the versions you haven't seen open, and the rest folded.

**Acceptance:** opening What's new shows the current version's card in full and every earlier version as a folded
row with its change count and date; a › opens it.

### SPEC-20: Web — plan picker as a carousel with ‹ › arrows, never under the side rail
Cory (screenshot `2026-11-20-spec-20-plan-picker.png`): on "Choose your plan" (Goals › change plan) the five plan
cards run off both sides: Maintenance slides under the left side rail and Vigorous is cut off at the right edge.

- Today (`frontend/src/components/plan/PlanPicker.tsx`) phones get a swipe carousel, but from 768 px the cards sit in a
  3- then 5-column grid that overflows the content area on the wide layout.
- Make it a carousel at every width. Show only as many whole cards as fit in the content area (never a sliver, never
  behind the rail): 1 on a phone, 2–3 on a tablet, up to 5 when they genuinely fit.
- A ‹ arrow on the left and a › arrow on the right step one card at a time; an arrow greys out at the ends. Swipe,
  the dots and the arrow keys keep working.
- It still opens with the recommended plan (or the current one) in view, highlighted as today.

**Acceptance:** at any window width every visible plan card is whole and none sits under the side rail; ‹ and › move
through all five; the recommended plan is in view when the page opens.
