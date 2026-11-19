# ByteSize backlog

Ideas and requests not yet scheduled. Newest at the bottom of each list. When something is picked up it gets a spec
section and moves out of here.

## Widgets (Cory's ideas)

_(add as they come in)_

## Features

- **Insights** — AI looks at logging and trends: weekly recap, patterns (weekends, dinners out, days before a shot),
  shot-day effects, protein help, food swaps, plateau check, ask a question about your data. (Cory, 2026-11-18)
- **iPhone app (M5)** — live barcode scanning, Apple Health (steps, workouts, weight) via the API, scan a nutrition
  label when a barcode isn't found.
- **Culury meal planning** — ByteSize foods/recipes in Culury's planner.
- More widget library items: weekly trend chart, protein ring on its own, Culury meal-plan widget.

## Deferred minors (from reviews)

- Dashboard: a pending refocus from a no-op move could fire on a later layout change.
- App info count-up test failed once under load (not reproduced).
- Remembered date look: an in-flight settings fetch can re-save it just after sign-out; session expiry doesn't clear it.
- Calendar: Escape listener is window-wide; the calendar dialog renders inside the page <h1>.
- Invites: link breaks under a sub-path deployment; spent token stays in browser history; expired invites never cleaned.
- API keys: last-used UPDATE on every request; wrong-key 401s not rate-limited.
- Seed-demo: earned badges are left as they were after --replace.

## From Insights planning (Cory, 2026-11-18)

- **Email the weekly recap** (and maybe other insights) as a notification, using the email setup.
- **Insights: patterns + shot-day effects** — weekend/dinner-out patterns, appetite and calories by days since shot.
- **Insights: plateau check** — when the trend flattens, what changed.
