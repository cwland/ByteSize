# Track Food: reorganized top, source filters, Close from the first frame (iPhone)

Short design (small change). Mockups: https://claude.ai/artifact/D9dgJNvtCLsKh93QYsenXD
(option B, with the collapsible "Show results from" row).

## Why

Cory: Photo, Scan and Describe sit too far from the search. The iPhone has no way to pick which
sources a search shows, though the web app does (§22 source pills). And the Close X shows up a moment
after the screen opens, which shrinks the search bar.

## Approaches

- A: Photo, Scan and Describe as icons on the search line, with one sideways-scrolling row of chips.
- **B (picked):** search full width; under it, one row of labelled Photo · Scan · Describe buttons;
  then a collapsible "› Show results from · 4 of 6" row with the meal picker on its right; open, it
  shows the six source chips (wrapping) with counts.
- C: chips behind a "Sources" button that opens a sheet.

Cory picked B with the collapse.

## What gets built

1. **Our own search field, not `.searchable`.** It sits at the top of the sheet, under the nav bar,
   with the cursor in it when Track Food opens. The nav bar then holds only the title and Close, so
   Close is there from the first frame and the field never changes width. This is the same move
   My Foods made in I4.
2. **The tool row** under the field: Photo, Scan and Describe, each an icon above a label. They open
   inside Track Food as they do today (same `hub-*` ids).
3. **The "Show results from" row:** a chevron and a summary ("· 4 of 6", counting the sources this
   search asked), with the meal picker on the right. This moves the meal out of its own section. The
   row shows with the field empty too, so the meal is always at the top; the chips only appear once
   a search has answered.
4. **Source chips** in the web's order and labels (My foods, FatSecret, Basic, USDA, Open Food Facts,
   Culury) with the web's defaults (Basic and Culury off). There is one chip per source the server
   says it `searched`, each with its count. Tapping a chip just filters the groups already loaded, so
   there is no new search.
   - Groups whose source isn't a chip (saved restaurant foods) always show.
   - A source that failed says so on its chip. A USDA failure marks Basic too, as on the web.
   - If every chip that's on found nothing but one that's off did, the list says so with a tap to turn
     it on ("Nothing in My foods, USDA… — Basic has 4").
5. **Remembered on the phone, per account:** both the chip choice and whether the row is open. The
   row starts collapsed.

## Not changing

The server is unchanged; it already sends `searched` and `errors`. Barcode answers have no chips.
The web app is unchanged.

## Left to the builder

The exact spacing, and the chip and row styling (they follow the app's palette: primary for on,
outlined for off). The filtering logic lives in ByteSizeKit, tested there; the views just bind to it.

## Tests

- Kit: the filtered view (defaults, toggling, non-chip groups, the USDA-marks-Basic failure, the
  "nothing in the ones on" hint, and remembering per account).
- UI: chips filter the list; the collapse remembers its state; Photo, Scan and Describe still open;
  the field's width is the same just after opening and a second later, and Close exists on the first
  check.
