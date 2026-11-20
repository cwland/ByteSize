# ByteSize W1 — GLP-1 doses and "What's new" (design + plan)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

Date: 2026-11-20 · Sources: backlog SPEC-14 and SPEC-15 (`docs/backlog/2026-11-19-ui-feedback-specs.md`). Cory approved
building these out overnight ("you have my approval to build it out as far as you can") and merging and deploying to
the test Docker server when green.

## Design

**SPEC-14: GLP-1 standard doses and a Compounded option (web; the server owns the list so the iPhone's SPEC-11 uses it too)**
- **Medication list on the server:** `lib/glp1.ts` gets `MEDICATIONS` (brand, ingredient, dose steps in mg), exactly
  as in SPEC-14:
  - Wegovy (semaglutide): 0.25, 0.5, 1, 1.7, 2.4
  - Ozempic (semaglutide): 0.25, 0.5, 1, 2
  - Zepbound (tirzepatide): 2.5, 5, 7.5, 10, 12.5, 15
  - Mounjaro (tirzepatide): 2.5, 5, 7.5, 10, 12.5, 15
  - Saxenda (liraglutide): 0.6, 1.2, 1.8, 2.4, 3
  - Trulicity (dulaglutide): 0.75, 1.5, 3, 4.5

  `GET /api/glp1` returns it as `medications`.
- **Dose units:** a dose now has a unit: `doseUnit: "mg" | "units" | "ml"` (default `"mg"`).
  - Stored on `glp1_settings` and `glp1_shots`, migration `0025`; existing rows become "mg".
  - The API accepts `doseUnit` on settings and shots and returns it everywhere it returns `doseMg`. The field name
    `doseMg` stays, so older iPhone builds keep working.
  - Limits: mg and ml are at most 100; units at most 1000.
- **Setup form:**
  - Medication is a select of the six brands ("Wegovy (semaglutide)") plus **Compounded**.
  - A brand shows a **Dose** select of its steps.
  - Compounded shows **Medication / compound name** (e.g. "Compounded Tirzepatide + B12"), a **Dose** number and
    a **Unit** select (mg / units / ml).
  - A saved medication that isn't one of the six opens as Compounded with that name.
- **Log shot sheet:** for a brand, the dose is a select of its steps; for Compounded, a number plus the unit.
- **Showing a dose:** everywhere a dose is shown, it's "2.5 mg" / "25 units" (`doseText(n, unit)`).

**SPEC-15: "What's new" and the version in the corner (ported from Culury)**
- **Version:** `frontend/package.json` and `backend/package.json` are both **0.2.0**, and a test keeps them and the
  newest changelog entry equal.
- **Changelog:** `frontend/src/changelog.ts` holds `CHANGELOG: Release[]` (version, date, title, changes), newest first,
  with `isNewer(a, b)`. It starts with 0.1.0 (ByteSize's first web release) and 0.2.0 (this release, plus the
  iPhone app's server support).
- **Seen version per user:**
  - Server: `users.seen_version` (migration `0025`).
  - The user JSON gets `seenVersion`.
  - `PUT /api/auth/seen-version {version}` saves it.
- **The popup:** "What's new" opens once after sign-in when `APP_VERSION` is newer than `user.seenVersion`.
  - It lists the versions since the one last dismissed, with "Earlier versions" a click away.
  - **Got it** saves the version.
- **The corner version:** "v0.2.0" sits in the **bottom-left** corner of the signed-in app (rail foot on wide
  screens; above the bottom bar on phones). Clicking it opens every version.

## Tasks

### Task 1: Server — dose units, medication list, seen version
- **Files:** `backend/src/db/schema.ts`, `backend/drizzle/0025_glp1_units_seen_version.sql` (+ meta),
  `backend/src/lib/glp1.ts`, `backend/src/routes/glp1.ts`, `backend/src/lib/users.ts`, `backend/src/routes/auth.ts`.
- **Test:** `backend/tests/w1.test.ts`.
- [ ] **Failing tests:**
  - `GET /api/glp1` has `medications` with Zepbound's six doses.
  - `PUT /api/glp1/settings {medication:"Compounded Tirzepatide + B12", doseMg:25, doseUnit:"units", injectionWeekday:2}`
    → 200, and settings read back with `doseUnit:"units"`.
  - A shot without `doseUnit` gets the settings' unit.
  - `doseMg: 150, doseUnit: "mg"` → 400 "That dose looks too high"; 150 units is fine.
  - Old rows read as `doseUnit:"mg"`.
  - `PUT /api/auth/seen-version {version:"0.2.0"}`, then `GET /api/auth/me` → `user.seenVersion` "0.2.0".
  - The isolation suite: one user's seen version never changes another's.
- [ ] RED → implement → GREEN for this file and the whole backend suite → commit
  "server: GLP-1 dose units and medication list; remembers the What's-new version seen".

### Task 2: Web — GLP-1 setup and shots with standard doses
- **Files:** `frontend/src/components/glp1/{glp1.ts,Glp1Page.tsx,ShotSheet.tsx,Glp1Card.tsx}`, `frontend/src/types.ts`.
- **Tests:** `Glp1Page.test.tsx`.
- [ ] **Failing tests:**
  - Picking Zepbound shows a Dose select with 2.5 … 15 mg; saving sends `{medication:"Zepbound", doseMg:7.5, doseUnit:"mg"}`.
  - Picking Compounded shows name + dose + unit; saving sends the typed name with `doseUnit:"units"`.
  - A saved "Compounded Tirzepatide + B12 25 units" opens as Compounded and reads "… 25 units, Tuesdays".
  - The shot sheet for Zepbound offers its doses.
- [ ] RED → GREEN, plus the frontend suite and `npm run build` → commit "web: GLP-1 standard doses and a Compounded option".

### Task 3: Web — What's new and the corner version
- **Files:**
  - `frontend/src/changelog.ts`
  - `frontend/src/components/WhatsNew.tsx`
  - `frontend/src/version.ts` (`showWhatsNew`)
  - the app shell/rail (bottom-left version)
  - `frontend/src/types.ts` (`User.seenVersion`)
  - `frontend/package.json` + `backend/package.json` → 0.2.0
- **Tests:** `WhatsNew.test.tsx`, plus a version-agreement test.
- [ ] **Failing tests:**
  - Signed in with seenVersion "0.1.0", "What's new" opens showing Version 0.2.0. **Got it** sends
    `PUT /api/auth/seen-version {version:"0.2.0"}` and closes.
  - Signed in with seenVersion "0.2.0", it doesn't open.
  - The corner "v0.2.0" button opens every version.
  - The two package versions and `CHANGELOG[0].version` are equal.
- [ ] RED → GREEN, plus the suite and build → commit "web: What's new popup and the version in the corner".

### Task 4: Ship
- [ ] Full backend + frontend suites and both builds. Push the branch; GitHub Actions green (test + docker).
- [ ] Merge into `main` (approved), wait for the image, and update `bytesize-testing`. Check the API health reports 0.2.0.
