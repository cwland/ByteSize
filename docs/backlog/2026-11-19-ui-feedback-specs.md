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

### SPEC-15: Web — daily backups you can see (like Culury's)
Cory: "I don't see a backup in the web, it should back up like Culury daily."

What exists today (Claude checked the code): the server already writes a **daily whole-server backup**
(`scheduleBackups`, after `BACKUP_HOUR`, keeping `backupKeep()` copies in `data/app/backups`), and admins can list,
download, make, delete and restore backups in **Settings → Data** ("Your data and backups"). So the gap is likely
one of these, to confirm with Cory:
- **Discoverability:** it's under "Data", not a "Backups" item, and only admins see it.
- **The running server is older than the backup feature.**
- **Missing pieces compared with Culury:** last backup time and next run on the screen, the schedule (time,
  how many to keep) set in the UI rather than env vars, a copy to somewhere off the server (a NAS share, S3), and
  an alert when a backup fails.

**Acceptance (draft):** an admin can find Backups in Settings at a glance, see when the last daily backup ran and
whether it worked, and change the time and how many are kept.
