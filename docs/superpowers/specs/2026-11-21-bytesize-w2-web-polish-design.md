# W2 — Web polish (SPEC-18, 19, 20, 22, 23, 24) and Describe clear (SPEC-21)

Short design (small changes), written overnight at Cory's request ("work on all of these… overnight"; no mockups
needed). Specs: `docs/backlog/2026-11-19-ui-feedback-specs.md`. Ships as 0.9.0.

## Why
Cory's notes from using the web app on a wide screen, plus one iPhone nit: the version floats mid-page; What's new is a
long list; the plan picker slides under the rail; Users is far down Settings; Sign out lives in Settings rather than an
account menu (as in Culury); Settings is parked at the bottom of the rail; Describe Food has no clear button.

## Approaches (one sensible way each; Cory asked for no mockups)
- Rail items (18, 23, 24) change together in `Rail.tsx`: list = Dashboard, Goals, Insights, (GLP-1), My foods,
  **Settings**; bottom = **avatar (account menu)** then the **version**. Phones keep the version at the end of the page
  and Sign out in Settings' list (the spec leaves the phone to the builder; nothing there is broken).
- What's new (19): the changelog moves from one `changes` list to `added` / `changed` / `fixed` lists per release
  (existing entries sorted by hand). The window shows the unseen versions (or just the current one) as full cards and
  every other version as a folded row (› version · title · "N changes · date") that opens in place.
- Plan picker (20): one carousel at every width inside the page column (the wide-screen break-out that slid under the
  rail goes). Cards size by the strip's own width (container queries): 1 below 576 px, 2 to 896, 3 to 1152, 4 to
  1280, 5 beyond — always whole. ‹ Previous plan and › Next plan step one card; greyed at the ends. Dots and arrow keys
  stay. Opens with the recommended plan in view.
- Settings (22): Users second, after Profile.
- Describe (21, iPhone): an ⓧ inside the field ("Clear description") that empties the text and the last estimate,
  keeping the keyboard up.

## Calls I made (for Cory to check)
- Account menu: name + email (username when no email), Profile & security, Sign out, Sign out everywhere (confirm
  first; signs this browser out too). No "Getting started" (no such page).
- Change kinds for old entries sorted by me: new features → Added, "no longer / never / fixed" lines → Fixed, behaviour
  tweaks → Changed.
- Carousel breakpoints above; phone shows one whole card (no peeking neighbours — "only show what will fit").

## Tests
Vitest for each web change (rail order and menu, What's new folding, picker arrows, Settings order); the iOS clear
button gets a UI test. Full web, server and iOS suites at the end of the round.
