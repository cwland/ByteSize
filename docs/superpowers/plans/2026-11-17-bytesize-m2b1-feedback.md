# ByteSize Feedback Round (M2b-1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply Cory's feedback from using 2a: birthdate + honest activity levels + per-plan ranges in a peeking carousel; a Weight Watchers-style Add Food sheet (meal dropdown title, same-as-yesterday, per-meal recents, quick-add + with ✓, coloured pills, "Track food" detail with whole+fraction+unit picker, liquid measures) and amount-first entry rows.

**Architecture:** Two backend tasks (A plans/body, B foods/units) and two web tasks (C plan screens, D log screens) in parallel, all against the contract changes below. No new runtime dependencies.

**Tech Stack:** as Milestone 2a.

**Spec:** `docs/superpowers/specs/2026-11-16-bytesize-m1-m2-design.md` — §10 (this round) wins over §9 and §6.

## Global Constraints

- Everything in the 2a plan's Global Constraints still holds (metric inside, unknown ≠ 0, isolation, snapshots, user's timezone for "today", sentence case).
- Activity multipliers exactly: `sitting 1.2, some 1.3, most 1.4, physical 1.5`.
- Plan ranges exactly: calories = plan ±50; protein g = goal weight lb × relaxed 0.8–0.9 / steady 0.9–1.0 / accelerated 0.95–1.05 / vigorous 1.0–1.1 (rounded to whole g); fiber g relaxed 30–35, steady 30–35, accelerated 28–32, vigorous 25–30; water 1893–3785 ml.
- Calorie floor clamp (from 2a's review) applies to plans that are *not* "Not recommended": their min never goes below the floor (max ≥ min). A "Not recommended" plan keeps its own range (shown honestly; choosing it is an explicit act).
- Colours: calories pill = `primary` (orange), protein = the protein ring colour, fiber = the fiber ring colour (reuse the Dashboard ring tokens).

## Review Focus

1. **Old saved bodies** (birth_year + old activity values like "moderate") migrate without data loss and the app asks once to review details before showing plans; nobody gets stuck in a loop after saving. Tests in A and C.
2. **Birthdays near today**: age is exact — someone born 1974-11-18 is 51 on 2026-11-17 and 52 on 2026-11-18. Test in A.
3. **Quick-add double taps**: tapping + twice quickly logs two entries (intended), each with its own ✓, and a failed log shows the error instead of a ✓. Test in D.
4. **Liquid measures on a grams-only drink** (Fairlife known only as 100 g): cups/fl oz/ml are offered and marked "≈"; a solid food (cheese) never offers cups. Tests in B and D.
5. **Amount text** never shows "1 × serving" or float noise: 1.5 bars → "1½ bars", 0.333 cup → "⅓ cup", 2 × "1 slice (28 g)" → "2 slices (56 g)". Test in D.

---

## Contract changes (shared)

```ts
type Activity = "sitting" | "some" | "most" | "physical";
type Body = { sex: "male" | "female"; birthDate: string /* YYYY-MM-DD */; heightCm: number; weightKg: number; goalWeightKg: number; activity: Activity; glp1: boolean };
// GET /api/body → { body: (Body & { needsReview: boolean }) | null }   (PUT /api/body Body → same; clears needsReview)
type Plan = { id; name; lbsPerWeek; calories; weeksToGoal; recommended; notRecommended;
  bestFor: string; targets: { calories: Range; protein_g: Range; fiber_g: Range; water_ml: Range } };
// GET /api/plans now 409 { error: "Check your details first" } while body.needsReview
// POST /api/plans/select sets exactly plan.targets (as shown on the card)
type Serving = { label: string; grams?: number; ml?: number; approx?: true };   // approx: ml estimated from grams (1 g ≈ 1 ml)
// Nutrients gain "saturated_fat_g"
// GET /api/foods/recent?meal=breakfast  and  /api/foods/frequent?meal=… : optional meal filter (entries of that meal only)
```
Same-as-yesterday needs no new route: web reads `GET /api/day/<yesterday>` → `entries` of that meal, and copies with `POST /api/log/move { ids, day, meal, copy: true }`. Quick add = `POST /api/log` with the row's portion.

## File Structure (changes)

```
backend/src/lib/plans.ts, routes/body-plans.ts, db/schema.ts (+ migration 0003)     — Task A
backend/src/lib/nutrients.ts, lib/foodSources/{off,usda}.ts, lib/foods.ts, routes/log.ts (recent ?meal) — Task B
frontend/src/components/plan/*, components/goals/GoalsPage.tsx                       — Task C
frontend/src/components/log/{AddFoodSheet,FoodDetail,AmountPicker,FoodRow,Pills,MealCard,LogPage}.tsx, src/nutrition.ts, src/amounts.ts — Task D
```

### Task A: Birthdate, activity levels, per-plan ranges (backend)

**Interfaces:** `age(birthDate: string, today: string): number` (exact, in whole years; `today` = the user's local day); `ACTIVITY = { sitting: 1.2, some: 1.3, most: 1.4, physical: 1.5 }`; `PLAN_DEFS` gain `protein: [lo, hi]` factors, `fiber: Range`, `bestFor`; `buildPlans(body, today: string)` returns plans with `targets` and `bestFor`; `targetsForPlan` replaced by the plan's `targets` (keep a thin wrapper if other code needs it). Migration 0003: add `birth_date date`, `needs_review boolean not null default false`; backfill `birth_date = make_date(birth_year, 1, 1)`, map activity sedentary→sitting, light→some, moderate→most, active→physical, very→physical, set `needs_review = true` for every existing row; drop `birth_year`. PUT /api/body validates birthDate (real date, age 13–110) and sets needs_review false.

- [ ] **Step 1: Failing tests** (plans.test.ts, body-plans.test.ts, schema/migration test):
  - Cory's body `{male, birthDate "1974-06-01", heightCm 182.88, weightKg 102.51187562, goalWeightKg 81.6466266, activity "some", glp1 true}` on "2026-11-17": tdee 2487; floor 1617; plans calories 2237 / 1987 / 1737 / 1487; recommended steady; vigorous notRecommended; targets — relaxed {cal 2187–2287, protein 144–162, fiber 30–35}, steady {1937–2037, 162–180, 30–35}, accelerated {1687–1787, 171–189, 28–32}, vigorous {1437–1537, 180–198, 25–30} (unclamped because not recommended); weeksToGoal 92, 46, 31, 23; bestFor strings present.
  - Exact age: born "1974-11-18" → 51 on "2026-11-17", 52 on "2026-11-18" *(Review Focus 2)*; Feb 29 births on non-leap years count from Mar 1.
  - Clamp: Body C (female, born 1976-06-01, 160 cm, 70 kg, goal 60, "sitting") — relaxed (recommended) min never below floor 1200.
  - Migration: insert a row in the 0002 shape (birth_year 1974, activity "moderate"), run 0003 → birth_date 1974-01-01, activity "most", needs_review true; GET /api/plans → 409 "Check your details first"; PUT body → needsReview false and plans work *(Review Focus 1)*. (Test by applying migrations up to 0002 on a scratch schema, inserting, then applying 0003 — or by running the backfill SQL in a test transaction; record how.)
  - Selecting a plan sets exactly its card targets.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** full backend suite + typecheck PASS. **Step 5: Commit** `feat: birthdate, honest activity levels and per-plan ranges`

### Task B: Saturated fat, liquid measures, per-meal recents (backend)

**Interfaces:** `NUTRIENT_KEYS` + `saturated_fat_g` (OFF `saturated-fat_100g`; USDA nutrientNumber 606); `withLiquidVolumes(servings, category, name): Serving[]` — for liquids (category or name matches milk, juice, drink, beverage, water, coffee, tea, soda, broth, shake, smoothie, kefir, oil, syrup, creamer) where servings[0] has grams but no ml, add `ml = grams` and `approx: true` to every serving that has grams; applied in `toResult` (cache rows and user foods) so every FoodResult carries it; `amountFactor` already handles ml when servings[0].ml exists. Log snapshots store the servings as returned (with approx). `GET /api/foods/recent?meal=` and `/frequent?meal=` filter source entries by meal (validated enum; absent = all).

- [ ] **Step 1: Failing tests:** normalizers map saturated fat (fixtures gain the field); `withLiquidVolumes` — Fairlife `{category:"en:milks", servings:[{label:"100 g",grams:100},{label:"1 cup",grams:240}]}` → ml 100/240 with approx; cheese unchanged *(Review Focus 4)*; a food with real ml unchanged; barcode/search results carry approx servings; logging 1 cup of the Fairlife fixture (unit "cup", quantity 1) → factor ≈ 2.366 of 100 g; recent?meal=breakfast returns only foods logged at breakfast, frequent?meal likewise, bad meal → 400; isolation unaffected.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS (full + typecheck). **Step 5: Commit** `feat: saturated fat, liquid measures and per-meal recents`

### Task C: Plan screens (web)

**Interfaces:** consumes Task A contract. BodyForm: Birthdate (`<input type="date">`), sex, height, weight, goal, activity as four radio cards with the wording from §10, GLP-1 switch. App flow: if `GET /api/body` has `needsReview` → show "We've updated a couple of questions — check your details" + BodyForm before plans (also when targets exist; dashboard stays reachable with "Not now"). PlanPicker: horizontal scroll-snap carousel, card width ≈ 82% on phones so neighbours peek on both sides, centred start on the recommended card, dots under it (buttons, aria-label "Show Steady"), keyboard arrows; ≥ 768 px wide: four columns, no scrolling. Card: name, badge, bestFor, "Eat 1,937–2,037 calories", "Protein 162–180 g", "Fiber 30–35 g", "Lose 1 lb per week", "About 46 weeks to reach your goal", Select pill. Goals: "Edit my details" opens BodyForm then the plan picker.

- [ ] **Step 1: Failing tests:** "body form sends a birthdate and the new activity level"; "plan cards show calorie, protein and fiber ranges and best-for"; "carousel starts on the recommended card and dots move between cards"; "details needing review are asked for before plans, and saving continues to the plans" *(Review Focus 1)*; "Goals has Edit my details".
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** suite + build PASS. **Step 5: Commit** `feat: plan carousel with ranges and birthdate`

### Task D: Add Food sheet, Track food detail, amounts, pills (web)

**Interfaces:** consumes Task B contract (approx servings, saturated_fat_g, recent?meal). New modules:
- `src/amounts.ts`: `formatAmount(servings, servingIndex, unit, quantity, fraction): string` — amount first, mixed fractions with ¼ ⅓ ½ ⅔ ¾ (nearest within 0.02, else one decimal), pluralise the serving label's noun ("1 slice (28 g)" × 2 → "2 slices (56 g)"; "100 g" × 1.5 → "150 g"), units "4 fl oz", "½ cup", "2 tbsp", "≈" prefix for approx volumes; `unitChoices(servings): { value: string; label: string }[]` (serving labels, then g/oz when mass known, then ml/fl oz/cup/tbsp/tsp when volume known or approx); `splitWhole(q): { whole: number; fraction: 0 | 0.25 | 0.333 | 0.5 | 0.667 | 0.75 }`.
- `Pills.tsx`: `<Pills n={nutrients} />` → three rounded pills "160 cal", "13 g protein" (protein colour), "0 g fiber" (fiber colour); unknown → "? cal".
- `FoodRow.tsx`: icon/thumbnail, name, amount text, Pills, trailing quick-add button (aria-label "Quick add <name>") → onQuickAdd(); shows ✓ (aria-label "Added") for 1.2 s then back to +; error → inline message.
- `FoodDetail.tsx` ("Track food" sheet): header "Track food" + close; food name + brand; summary card rows Calories / Protein / Fiber for the chosen amount; "Serving" row showing `formatAmount` — tap opens `AmountPicker` (three columns: whole 0–20, fraction —/¼/⅓/½/⅔/¾, unit from `unitChoices`); "Nutritional insights" chips: High in protein (≥ 15 g and ≥ 25% of calories), Good source of fiber (≥ 3 g; "High in fiber" ≥ 5 g), High in sodium (≥ 600 mg), High in added sugar (≥ 10 g); "Nutrition facts" list for the amount (calories, fat, saturated fat, sodium, carbs, fiber, sugars, added sugars, protein, potassium, magnesium; unknown "—"); "Edit food" link (existing FoodForm); big orange "Track" button. Same component edits an existing entry ("Save" + Move, Copy, Delete) replacing PortionSheet.
- `AddFoodSheet.tsx` redesign: title row = meal dropdown ("Breakfast ▾", listbox of 5 meals; changing it changes the meal for logging and reloads the sections) + close X; date line ("Today, Nov 17" / "Mon, Nov 16"); search box + barcode button (focuses a numeric barcode field); when the query is empty: "Same as yesterday?" card (yesterday's entries of the selected meal: names joined, total Pills, quick-add + → POST /api/log/move copy into selected day+meal, ✓) then "Recently tracked" (GET /api/foods/recent?meal=…, rows with each food's last portion amount and pills, quick-add logs that portion); with a query: grouped results as now, each row with pills for its default portion (last-used if the food is in recents, else servings[1] ?? servings[0], quantity 1) and quick-add; tapping any row opens FoodDetail with that portion.
- `MealCard.tsx`: rows use `formatAmount` and `Pills`.

- [ ] **Step 1: Failing tests:** `amounts.test.ts` (Review Focus 5 cases + "4 fl oz", "≈ 1 cup" for approx, unitChoices for Fairlife includes cup/ml/fl oz marked ≈ and for cheese excludes them *(Review Focus 4)*); "meal dropdown at the top changes the meal and reloads recents for it"; "same as yesterday copies yesterday's breakfast into today with one tap"; "quick add logs the last portion and shows a check, then a plus again; two taps log twice" *(Review Focus 3)*; "a failed quick add shows the error"; "search results have pills and quick add"; "Track food shows summary, insights and nutrition facts, and the amount picker changes the amount (1 ½ cup → POST quantity 1.5 unit cup)"; "editing an entry uses the same sheet with Save"; "meal card rows show amount first and pills".
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** suite + build PASS. **Step 5: Commit** `feat: weight watchers style add food, track food and amounts`

### Task E: Check, review, ship

- [ ] Root `npm test`, backend typecheck, frontend build; migration 0003 applied to a copy of a 2a database with Cory's body row shape.
- [ ] Phone-size screenshots: body form, plan carousel, Add Food (empty state with yesterday + recents), search results, Track food, Log page; fix visual breakage.
- [ ] Fresh final review; fix Critical/Important with RED→GREEN; merge to main; push; watch CI.
