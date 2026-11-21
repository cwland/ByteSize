# ByteSize I4 — Goals & My Foods on iPhone (design)

Date: 2026-11-20 · Status: for Cory's approval (short design approved 2026-11-20; quick meals: option A) · Sources: the iOS design
`2026-11-19-bytesize-ios-design.md` §2 and §6.4 (Goals, My Foods), backlog SPEC-17
(`docs/backlog/2026-11-19-ui-feedback-specs.md`).

## 1. Intent

The last two tabs are still "Coming in the next update". Cory is using ByteSize for weight loss, and the phone is his
main way in. The Goals tab answers "am I on track?": targets, goal progress and the weight trend, with a quick way to
log a weigh-in. The My Foods tab gets his own foods, corrections, recipes and quick meals onto a day in a few taps.
SPEC-17 lets him pick up to 7 days ahead, so food can be planned and pre-logged.

## 2. Goals, non-goals, anti-goals

**Goals**
- **Goals tab**
  - Targets card (read-only): calories, protein, fiber and water ranges for today, and the goal weight, with the line
    "Goals and targets are managed in the ByteSize web app."
  - Active goals from `GET /api/goals`, each with its name and progress (the current period's progress, and hit / needed
    for the whole goal). Goals that haven't started say when they start.
  - Weight chart (Swift Charts): 1W / 1M / 3M / All. Weigh-ins as points, the trend as a line, the goal weight as a
    dashed rule when set. Under it: start weight, current trend, lost so far, and the projected goal date when the
    server has one.
  - Log weight: today by default, an earlier day can be picked (never a future one; the server rejects it). A second
    weigh-in that day replaces the first (server rule; say so on the sheet).
  - History: newest first, each weigh-in with its change from the previous one (green ↓ loss, red ↑ gain, "—" no
    change; the first one has none). Swipe to delete.
  - Weight shown in the person's units (kg or lb), as elsewhere.
- **My Foods tab**
  - Search (server search), filter chips All · Foods · My edits · Recipes · Quick meals, sort Recent · Most used · A–Z.
  - Tapping a food opens the existing amount screen (`FoodPortionView`: nutrition, servings, wheel, bookmark), which
    logs it to the day selected on the Dashboard / Food Log, meal defaulted as Track Food does. *(Changed from the iOS
    design's separate details screen, approved by Cory: the amount screen already shows the nutrition.)*
  - **Quick meals** (Cory chose A): tapping one shows its items (from `GET /api/my-foods/:id`), each with its amount
    and a check mark. Unchecking leaves an item out; tapping one changes its amount with the wheel; the total updates.
    **Log all** sends `POST /api/log/meal` (`foodId`, `day`, `meal`, `items`) to the selected day and meal. The list looks
    and works like the Describe screen's item list (it may share pieces with it, but not EstimateModel).
  - Empty states: no foods yet ("Foods you create, correct or save as recipes on the web show up here"), and no match.
- **SPEC-17**: the day strip and the month calendar let the next 7 days be picked; food can be viewed and logged there.
  "Same as yesterday" means the day before the picked day. Log shot and Log weight stay today-or-earlier.
  - *(Claude's call)* On a future day the Dashboard's logging buttons for water, weight and shots are disabled with
    the hint "That day hasn't happened yet"; the cards show nothing logged. Food is the only thing pre-logged.
  - *(Claude's call)* Logging on any picked day sends that day and keeps today's meal default (from the clock), as
    past days already do; Log all keeps its current behaviour (into the meal you're adding to).

**Non-goals**
- Creating or editing goals, targets, custom foods, recipes or quick meals on the phone (web app).
- Deleting or archiving My Foods from the phone.
- Badges or past goals on the Goals tab (past goals: a later round if wanted).
- iPad layout (SPEC-13, parked).

**Anti-goals**
- The phone showing a different goal progress or trend than the web for the same data (both come from the server).
- A future weigh-in or shot slipping through because the picker allowed it.

## 3. Approaches

| | Approach | Trade-off |
|---|---|---|
| **1** | **Phone screens over the existing server routes** (`/api/goals`, `/api/targets`, `/api/weight`, `/api/weigh-ins/:day`, `/api/my-foods`) | No server change; progress and trend math stays in one place. **Chosen.** |
| 2 | Work out goal progress / trend on the phone | Duplicates server math that would drift (anti-goal 1). |
| 3 | A new combined "goals page" server route | Saves a request or two per visit; not worth a server change and a new contract. |

## 4. Design

### 4.1 Server
No changes. Routes used:
- `GET /api/goals` → `{ active, past }`; each goal has its spec (type, target, period, measure, start, end, name) and
  progress (`state`, `current`, `hit`, `done`, `of`, `needed`, `startKg`, `asOf`). Only `active` is shown.
- `GET /api/targets` → the ranges in force today (null when no plan or hand-set targets).
- `GET /api/weight` → all weigh-ins with `trendKg` and `note`, `start`, `latest`, `trendKg`, `goalKg`, `lostKg`,
  `projection`, `goalDate`. The phone filters by range itself (one request; the list is small).
- `PUT /api/weigh-ins/:day`, `DELETE /api/weigh-ins/:day`.
- `GET /api/my-foods/:id` (a quick meal's items) and `POST /api/log/meal` (new client in the kit).
- `GET /api/my-foods?q&kind&sort` (kind: all, foods, recipes, meals). "My edits" = kind all (or foods) filtered to
  `foodKind == "override"` on the phone, since the server has no override kind; "Foods" excludes overrides.

### 4.2 iPhone
- `ByteSizeKit` models: `GoalsModel` (goals + targets + weight, range, delta list, log/delete weigh-in), `MyFoodsModel`
  (query, filter, sort, results, debounced search) and `QuickMealModel` (items, left out, amounts, total, Log all).
  All unit-tested with the stub HTTP layer.
- Weigh-ins logged or deleted here also refresh the Dashboard's weight card (shared reload, as the Dashboard does).
- `DayStore.canSelect` allows today+7; the calendar's range goes to today+7; logging, quick log and Log all already send the
  selected day. Shot and weight pickers keep `...today`; the Dashboard's water, weight and shot buttons check
  `day > today`.
- StubServer gains goals, targets, a weight series and a my-foods list (each kind, one override) for UI tests.

### 4.3 Testing
- Kit: GoalsModel (deltas, ranges, log/delete reloads, errors), MyFoodsModel (filters incl. My edits, sort, search),
  DayStore (tomorrow selectable, today+8 not).
- UI: open Goals → see a goal and the chart → log a weigh-in → it appears in history; swipe-delete one; open My Foods →
  filter Recipes → tap one → log → it's on the Food Log; open a quick meal → uncheck an item → Log all → the other items
  are on the Food Log; pick tomorrow on the strip → log a food there.
- End of round: full server, web and iOS suites, web build, Docker image build.

## 5. Left to the builder
- Card styling, chart styling and the progress wording per goal type (within the theme tokens and the web's wording).
- Exact range cut-offs (1W = last 7 days ending today, etc.).
- Search debounce timing.
