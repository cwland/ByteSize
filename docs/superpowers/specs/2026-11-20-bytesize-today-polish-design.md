# ByteSize Today polish (iPhone) — design

Round "Today polish", iPhone only. Specs: SPEC-02, 03, 04, 05, 06, 11, 12 in
`docs/backlog/2026-11-19-ui-feedback-specs.md`. SPEC-13 (iPad) is parked by Cory for a later round.

## Intent

The Dashboard and Food Log are what Cory looks at most. They should show what matters at a glance (calories left,
protein, fiber), move between days quickly and without flicker, and logging a GLP-1 shot should capture the dose, the
day and a note, not just the site.

## Goals

1. **SPEC-02 — Overview, collapsed and expanded.** Collapsed (default): the calorie bar and the Protein / Fiber / Water
   rings — no Carbs / Fat row. A chevron on the card (chevron.right → chevron.down, animated) expands it to the full
   Daily Totals, in the web's order: Calories, Protein, Carbs, Fat, Fiber, Sugar, Sodium, Water — eaten, and the target
   range where there is one ("—" where not). The expanded state is remembered on the device.
   With no targets (no plan), the card keeps today's fallback (calories, notice) and the chevron still offers the totals.
2. **SPEC-03 — Day strip.** On both the Dashboard and the Food Log, one shared strip replaces the week row's arrows
   (Dashboard) and the ‹ › day arrows (Food Log): a horizontal row of day chips (weekday letter, day number, a dot on
   logged days) that scrolls and snaps one day at a time, the selected day centred. Range: 365 days back to 7 ahead;
   days after today are dimmed and can't be chosen. Tapping a chip selects that day. Above it, the date header
   ("Today" / "Fri, Nov 20") opens a sheet with a graphical month calendar (`DatePicker(.graphical)`), limited to the same
   range; picking a date selects it and scrolls the strip there.
3. **SPEC-04 — No flicker.** `DayStore` keeps the days it has loaded (in memory, this session). Selecting a day shows
   its cached copy at once (or keeps the previous day's content on screen until the new one arrives — never an empty or
   loading state between days) and refreshes it from the server quietly. Numbers animate between days
   (`.contentTransition(.numericText())`, `.animation(.easeInOut(duration: 0.2), value: selected)`); no `.id(selected)` on
   containers. Any write (log, edit, delete, copy) still reloads that day from the server and updates the cache.
4. **SPEC-05 — Calorie bar colours.** Under the range: light green; within: dark green, with the range band visible;
   over: red. Applies to the calorie bar only (Cory agreed): protein / fiber / water rings keep their colours, since
   going over those isn't bad.
5. **SPEC-06 — Food Log summary bar.** Directly under the strip, a compact bar: calories eaten, calories remaining (to
   the range's maximum; "over by N" when past it), protein eaten / target minimum, fiber eaten / target minimum. With no
   targets: just calories eaten.
6. **SPEC-11 — Log shot.** The shot sheet gains:
   - **Dose:** a picker of the current medication's standard doses (from the server's `medications` list), defaulting to
     the dose in the GLP-1 settings, plus **Custom…** (a number field and the unit — mg, units, ml). A compounded
     medication (not in the list) shows only the custom field, prefilled from the settings.
   - **Date:** a date picker (the server stores one shot per day, no time — so date only), default today, not in the
     future; picking a day that already has a shot replaces it (as the server does) — the sheet says so.
   - **Notes:** a multi-line field (site comments, side effects).
   - Site stays, defaulting to the suggested site.
   Sends `PUT /api/glp1/shots/:day` with `site`, `doseMg`, `doseUnit`, `note`.
7. **SPEC-12 — Settings divider.** The divider between Theme and Appearance in Profile/Settings spans the full row (use
   the List's own separators consistently).

## Non-goals

- iPad layout (SPEC-13) — later.
- Any server change.
- Editing or deleting past shots, a shot history list, side-effect logging on iPhone.
- Changing the GLP-1 settings (medication, schedule) from the iPhone.

## Anti-goals

- A flash of "loading" or an empty Food Log when changing days.
- The strip and the calendar disagreeing about the selected day, or selecting a future day.
- A shot logged with a different dose than the one shown.

## Approaches considered

1. **Scrolling strip of single days + day cache (chosen).** One shared component; snapping horizontal scroll; the cache
   removes the flicker.
2. **Swipe the whole page to change day.** Rejected: clashes with the Food Log's row swipe actions (copy/move/delete).
3. **Week row paged by week.** Rejected: SPEC-03 asks for day by day.

## How it fits the existing code

- `DayStore` (ByteSizeKit) holds `selected`, `day`, `week(containing:)`, `shiftWeek`, `select`. It gains the cache
  (`[String: DayView]`) and the strip's range helpers; `shiftWeek` goes when nothing uses it.
- `CalendarStrip` (Dashboard) and `FoodLogView.header` (the ‹ › arrows and `DayPickerSheet`) are replaced by one
  `DayStrip` view used by both.
- `OverviewCard` gets the chevron and the totals list; the colour logic lives in a small testable function in the kit
  (e.g. `budgetColor(calories:range:)` → under / within / over) so the thresholds are tested without UI.
- `ShotSheet` (SmallCards.swift) and `DashboardModel.logShot(site:)` / `BodyAPI.logShot` grow dose, unit, date and note;
  `Glp1View` decodes the server's `medications` and the settings' `doseUnit` (both sent since 0.2.0).
- `ProfileSheet` for the divider.

### Sketch — Food Log top

```
 [ T  F  S  S  M  T (W) T  F ]   ← swipe, snaps per day; (W) = selected
        Wed, Nov 19  ▾           ← tap: month calendar
 ┌──────────────────────────────┐
 │ 1,138 eaten · 362 left       │
 │ Protein 97 / 110 g  Fiber 18 / 25 g │
 └──────────────────────────────┘
```

### Sketch — Overview expanded

```
 Today's overview                    ⌄
 [ calorie bar ]
 (Protein) (Fiber) (Water)
 Calories 1,138   1,500–2,000
 Protein  97 g    110–130 g
 Carbs    80 g    —
 …
```

## Calls made after the builder check (Cory to confirm while reading)

1. **A different dose on today's shot becomes your current dose** — the server already does this for the latest shot
   (as the web does): moving up a step is logged once and the next shot defaults to it. When the picked dose differs
   from the settings and the date is the latest shot, the sheet says "This becomes your current dose". A backdated
   shot never changes it (the server's rule).
2. **A date that already has a shot opens with that shot's dose, site and note filled in** (from the GLP-1 view's
   recent shots, which the iPhone will now decode), so saving it unchanged changes nothing and a blank note is a
   deliberate choice. A new date starts from the settings' dose and the suggested site.
3. **The medication is matched to the standard list by brand name**, as the web does ("Zepbound" → its doses); anything
   else is treated as compounded (custom dose only). The stub and test fixtures move to brand names.
4. **Logged-day dots load in windows** of up to 62 days (the server's limit) around what the strip shows, as it scrolls.
5. **A copy or move to another day drops that day from the cache** too, so it's fresh when visited — not just the day
   on screen.

## Constraints

- iOS 17+, SwiftUI, Swift 6; logic in ByteSizeKit with XCTest; UI covered by XCUITest against the in-app stub server.
- TDD: each behaviour gets a failing test first.
- Version 0.6.0 with a What's new entry.

## Left to the builder

- Chip size and spacing; how many chips are visible (about 7 on a phone).
- Exact shades for light green / dark green / red, from the theme's palette (add tokens if the palette lacks them,
  matching light and dark mode).
- Where the chevron sits on the card; the expand animation.
- The custom-dose field's validation copy (the server's limits: mg ≤ 100, units ≤ 1000, ml ≤ 100).
