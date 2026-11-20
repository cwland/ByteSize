# ByteSize L1 — Amounts (design)

Date: 2026-11-19 · Status: for Cory's approval · Sources: backlog `docs/backlog/2026-11-19-ui-feedback-specs.md`
(SPEC-01, SPEC-09), I3's final review (deferred minors), Cory's answers on 2026-11-19.

## 1. Intent

Logging an amount should match how people count food. You ate 6 prunes, a large apple or 200 g of rice: you shouldn't
have to work out "1.2 servings". The server works out which units a food can be measured in. The iPhone gets the
three-wheel picker from Cory's screenshot, and the web's picker gets the same units. Both apps ask before logging
an unusually big amount.

## 2. Goals, non-goals, anti-goals

**Goals**
- **SPEC-01 (both apps):** a food can be logged by count ("6 prunes" from a "5 prunes" serving), by size (Small /
  Medium / Large) or by weight/volume (g, oz, ml, fl oz, cup, tbsp, tsp), with correct calories and macros.
- **SPEC-09 (iPhone):** a three-wheel picker (whole number | fraction | unit) for picking and editing a portion, with
  calories updating as the wheels move. It replaces the typed amount and the ¼ ⅓ ½ ¾ All chips.
- **Big amounts (both apps):** over 20 servings, or over 2,000 calories, in one entry asks
  "That's a lot — log 2,340 cal of Banana?" with **Log it** / **Change**. (Cory chose a confirm over a block.)
- **Leftover I3 review minors:**
  - The Describe/plate amount steppers move to the wheel.
  - Values the person corrected on a label are no longer marked AI.
  - The AI's servings are clamped to the server's limits.
  - A failed re-estimate clears the old list.
  - The denied-camera message shows.
  - A duplicate delete action is removed.
  - The Photo screen says so when a found food can't be logged.
  - An AI timeout says "The AI took too long" instead of "Can't reach".

**Non-goals**
- Per-meal Add buttons, the new search screen and Favorites. These are SPEC-07, -08 and -10, next round (L2).
- Editing a food's units by hand in My Foods.
- Any change to how nutrients are stored per food.

**Anti-goals**
- A logged entry's numbers changing later because the unit list changed.
- The phone and the web disagreeing on a portion's calories.

## 3. Approaches (Cory picked 1)

| | Approach | Trade-off |
|---|---|---|
| **1** | **Units worked out on the server when a food is looked up.** One function adds counted and sized servings to a food's list. | No migration or backfill; already-cached foods get it; both apps use one list. A little work per lookup (cheap string parsing). **Chosen.** |
| 2 | Parsed when a food is first fetched, saved in a new table | Needs a migration and a backfill, and must be re-run whenever the parsing improves. |
| 3 | Each app parses for itself | The same parsing written twice, which would drift; breaks "the server does the nutrition math". |

## 4. Design

### 4.1 Server: `withMeasures(food)` (lib/measures.ts)
- **Input:** a food's `servings` (servings[0] is what the nutrients are per) and its `name`.
- **Output:** the same servings, unchanged and in the same order, **followed by** derived ones. Derived servings
  are only ever appended, so every stored `servingIndex` (logged entries, quick meals, recipes) still points at
  the same serving.

**Derived servings:**
- **Count:** servings[0] or another serving label like "5 prunes", "4 slices (56g)" or "12 crackers (30 g)", with a count
  above 1 and a countable noun, gives "1 prune", "1 slice" and so on.
  - Its size: grams (or ml) = that serving's weight ÷ count. With no weight, it carries `per` = 1/count of that
    serving, expressed relative to servings[0].
  - Measuring words are not countable nouns: g, oz, cup, tbsp, tsp, ml, serving, container, package, bottle, can.
  - Plurals become singular by simple rules: prunes→prune, berries→berry, pieces→piece.
- **Size:** when the food has grams and doesn't already list small/medium/large servings, a built-in table keyed by
  name gives "1 small", "1 medium", "1 large" with grams. The table covers apple, banana, orange, pear, peach,
  potato, sweet potato, egg, avocado and chicken breast. USDA foods usually list these sizes already, and those
  are used as they are.
- **Duplicates:** a label already in the list isn't added again.

**`Serving` change:** gets an optional `per?: number`. `amountFactor` uses `per` for a serving with no grams or ml.
Existing rows aren't affected.

**Where it's applied:** every food the API returns (search, barcode, recent, frequent, My Foods, a food by id),
through the shared `toResult`. Logging snapshots the extended list, as it already snapshots servings, so an entry
keeps its units forever.

**Weight and volume:** g/oz and ml/fl oz/cup/tbsp/tsp keep working through the existing `unit` field when
servings[0] has grams or ml. Nothing changes there.

### 4.2 Web (AmountPicker)
- **Units:** the unit column lists the new servings automatically (it already lists every serving, then g/oz, then
  volume units).
- **Fractions:** the column grows from — ¼ ⅓ ½ ⅔ ¾ to the SPEC-09 list: — ⅛ ¼ ⅓ ⅜ ½ ⅝ ⅔ ¾ ⅞. That's one list in
  `amounts.ts`, and the iPhone copies it.
- **Big amounts:** the confirm opens before Log or Save when the amount is over 20 × servings[0] or over 2,000 kcal.

### 4.3 iPhone
- **`AmountWheel`:** a SwiftUI view with three `.wheel` pickers, matching Cory's screenshot.
  - Whole numbers: 0–20; for g and ml, also the web's bigger steps up to 1,000.
  - Fractions: the list above.
  - Units: servings (including derived ones), then g/oz when grams are known, then volume when ml is known.
  - It replaces the amount field and fraction chips in the portion sheet and the Food Log edit sheet. The Describe
    and plate item rows open the same wheel instead of a stepper.
- **`PortionModel`:** works in units, matching the web.
  - It holds `servingIndex`, `unit` and `quantity`, with fraction always 1, as the web sends it.
  - The calorie preview uses a Swift copy of the server's `amountFactor`, including `per`. It's checked against
    the server with shared test cases: one JSON file of {servings, servingIndex, unit, quantity → factor}, run by
    both Vitest and XCTest. A copy check fails if the two files ever differ.
- **Logging:** `POST /api/log` and `PATCH /api/log/:id` send the chosen `unit` (no longer always "serving").
- **Big amounts:** the same confirm, as an alert.

### 4.4 Errors
- **Can't measure:** a unit the food can't be measured in is never offered. If one gets through anyway, the
  server's 400 "Can't measure this food in cup" is shown.
- **Bad amounts:** a zero amount (0 and —) disables Log.

## 5. Testing
- **Vitest:** `withMeasures` parsing cases:
  - prunes: 5 prunes, then 6 → 1.2×
  - "4 slices (56g)", giving 1 slice = 14 g
  - "1 cup (240 g)", with no count unit added
  - "2 servings", where serving is a measuring word
  - an apple with no sizes, which gets the table sizes
  - USDA sizes already present, which are kept and not duplicated
  - index stability: existing indices are unchanged
  - logging 6 prunes gives 1.2× nutrients
  - `per` used in `amountFactor`
- **Shared amount-vector file:** run by both Vitest and XCTest.
- **Web:** Vitest for the picker's fraction list, the new units appearing, and the big-amount confirm.
- **iPhone:**
  - `PortionModel` and wheel-state tests.
  - UI tests: track Prunes and log 6 (the stub has a "5 prunes" food), and edit an entry with the wheel.
  - The big-amount confirm.
- **End of round:** the full server, web and iOS suites, plus the web production build and a Docker image build
  (added after I3's build miss).

## 6. Left to the builder
- The exact count-label regex and singular rules (they must pass the cases above).
- The size-table gram values (USDA-standard weights).
- Wheel styling within the theme tokens.
- Where the confirm text sits.
