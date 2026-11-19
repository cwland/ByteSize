# ByteSize backlog

Ideas and requests not yet scheduled. Newest at the bottom of each list. When something is picked up it gets a spec
section and moves out of here.

## Widgets (Cory's ideas)

_(add as they come in)_

## Features

- **iPhone app (M5)** — live barcode scanning, Apple Health (steps, workouts, weight) via the API, scan a nutrition
  label when a barcode isn't found.
- More widget library items: weekly trend chart, protein ring on its own.

## Deferred minors (from reviews)

- Security: with the default TRUST_PROXY (private ranges trusted), a client on the LAN can fake X-Forwarded-For to dodge
  the sign-in and wrong-key limits. Set TRUST_PROXY to the proxy's address to close it.
- Goals: results freeze on the next read after the end date, not by a daily job; ongoing goals compute every period;
  two same-type goals made at once in two tabs can both survive; goals.csv export has no week start.
- Insights: an answer still in flight from another tab can appear after Clear chat; if the database is down at the
  moment an email is marked sent, a second email is possible; when questions are used up, focus can't return to the
  chat box.
- Seed-demo: --replace clears all of the account's badges (real ones on a test account too).

## From Insights planning (Cory, 2026-11-18)

