# ByteSize Milestone 2a (Plan picker, Food engine, Dashboard, Log) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cory can pick a GLP-1-aware weight-loss plan, then log food fast (search, typed barcode, recents, AI estimate, custom foods, barcode-bound corrections) and see his day on a live Dashboard (calorie gauge + protein/fiber/water rings) and Log (meal cards, move/copy).

**Architecture:** Pure libs first (`nutrients.ts`, `plans.ts`, `foodSources/*`) with exhaustive unit tests; thin Fastify routes over them; every user-owned table has `user_id` and every route gets an isolation case. Web app screens are built against the API contracts below with `fakeServer`, in parallel with the backend.

**Tech Stack:** as Milestone 1 (Fastify 5, Drizzle, Postgres 16, zod, React 18, Vite, Tailwind 4, Vitest). No new runtime dependencies unless a task names one.

**Spec:** `docs/superpowers/specs/2026-11-16-bytesize-m1-m2-design.md` — §6.3–6.4, §6.6 (behavior), §9 addendum (look, plan picker, icons, decisions of 2026-11-16 23:20). §9 wins where they differ.

## Global Constraints

- Metric inside (g, ml, kg, cm, kcal); convert at the UI edge. Imperial is the default display. 1 lb = 0.45359237 kg, 1 in = 2.54 cm, 1 oz = 28.349523125 g, 1 fl oz = 29.5735295625 ml, 1 cup = 236.5882365 ml, 1 tbsp = 14.78676478125 ml, 1 tsp = 4.92892159375 ml.
- Nutrient keys (jsonb, per serving): `calories, protein_g, fiber_g, carbs_g, fat_g, sugar_g, added_sugar_g, sugar_alcohol_g, sodium_mg, potassium_mg, magnesium_mg, water_ml`. **Missing = unknown (key absent), never 0.** Totals treat unknown as 0 but report `unknownCount`.
- Every user-data route takes the user id only from `requireUser(req)`; every new route gets a case in `backend/tests/isolation.test.ts`.
- "Day" = the user's local date in `users.timezone` (`YYYY-MM-DD`).
- Exercise calories are shown but never change the budget. Calories are a range, never a goal to fill.
- Logged entries keep a snapshot (`per_serving`, `servings`, computed `nutrients`); editing an entry never re-reads its source.
- External calls (OFF, USDA, AI, later Culury) have timeouts, never fail the whole request, and log failures to `app_log` (category `food` or `ai`) with the user id.
- Open Food Facts requests send `User-Agent: ByteSize/<version> (self-hosted; https://github.com/cwland/ByteSize)`.
- UI copy: sentence case, no "please"/"successfully". Lose It!-style dark cards, orange action pills (design §9).

## Review Focus

1. **A plan picker with no safe plan** (short, light, older person: every plan under max(1,200, 0.65×TDEE)) → no plan is "Recommended", all four say "Not recommended", and the screen says to set targets with your care team instead of offering a dangerous default. Test in Task 3.
2. **Unknown nutrients** (a cached food with no fiber) → the fiber ring doesn't treat it as 0 g silently: totals carry `unknownCount` and the Log row shows "fiber unknown"; "Fill gaps with AI" is offered. Tests in Tasks 2 and 7.
3. **Day boundaries**: an entry logged at 11:30 pm Boise time lands on that Boise day, not UTC's next day; the Dashboard for "today" uses the user's timezone. Test in Task 8.
4. **Barcode variants**: `012345678905` (UPC-A) and `0012345678905` (EAN-13) and `12345678905`-style user typing with spaces/dashes resolve to the same food and the same override. Test in Task 6.
5. **A slow or down food source** (OFF hangs, USDA 500, no USDA key) → search still returns My foods + cache within ~3 s with an `errors` entry; no 500. Test in Task 7.

---

## API contracts (shared by backend and web tasks)

Types (JSON):
```ts
type Nutrients = Partial<Record<"calories"|"protein_g"|"fiber_g"|"carbs_g"|"fat_g"|"sugar_g"|"added_sugar_g"|"sugar_alcohol_g"|"sodium_mg"|"potassium_mg"|"magnesium_mg"|"water_ml", number>>;
type Serving = { label: string; grams?: number; ml?: number };          // servings[0] is the base the nutrients are for
type FoodResult = { kind: "cache" | "user_food"; id: number; name: string; brand: string | null; icon: string; barcode: string | null;
  servings: Serving[]; nutrients: Nutrients; aiFields: string[]; imageUrl: string | null; override: boolean; source: "off" | "usda" | "mine" | "ai" };
type Meal = "breakfast" | "lunch" | "dinner" | "snacks" | "supplements";
type Unit = "serving" | "g" | "oz" | "ml" | "fl_oz" | "cup" | "tbsp" | "tsp";
type LogEntry = { id: number; day: string; meal: Meal; name: string; brand: string | null; icon: string; servingIndex: number; unit: Unit;
  quantity: number; fraction: number; servings: Serving[]; nutrients: Nutrients; aiEstimated: boolean; source: string; sourceRef: string | null };
type Range = { min: number; max: number };
type Targets = { calories: Range; protein_g: Range; fiber_g: Range; water_ml: Range; plan: PlanId | null; effectiveFrom: string };
type PlanId = "relaxed" | "steady" | "accelerated" | "vigorous";
type Plan = { id: PlanId; name: string; lbsPerWeek: number; calories: number; weeksToGoal: number | null; recommended: boolean; notRecommended: boolean };
type Body = { sex: "male" | "female"; birthYear: number; heightCm: number; weightKg: number; goalWeightKg: number;
  activity: "sedentary" | "light" | "moderate" | "active" | "very"; glp1: boolean };
```
Routes (all need sign-in; errors `{ error }`):
- `GET /api/body` → `{ body: Body | null }`; `PUT /api/body` Body → `{ body }`
- `GET /api/plans` → `{ tdee: number; floor: number; plans: Plan[]; explanation: string; current: PlanId | null }` (409 `{error:"Tell ByteSize about yourself first"}` when no body)
- `POST /api/plans/select { plan: PlanId }` → `{ targets: Targets }`
- `GET /api/targets?day=YYYY-MM-DD` → `{ targets: Targets | null }`; `PUT /api/targets { calories, protein_g, fiber_g, water_ml }` (Ranges; plan becomes null) → `{ targets }`
- `GET /api/settings/me` → `{ mealWindows: { breakfast: "10:30", lunch: "14:30", snacks: "17:00", dinner: "21:00" }, waterButtonsMl: [237, 473] }`; `PUT` same shape
- `GET /api/day/:date` → `{ day; entries: LogEntry[]; totals: Nutrients & { unknownCount: Record<string, number> }; meals: Record<Meal, { calories: number; protein_g: number; carbs_g: number; fat_g: number; fiber_g: number; suggested: number | null }>; targets: Targets | null; exercise: { calories: number }; streak: number }`
- `POST /api/log` `{ day, meal, food: { kind: "cache" | "user_food"; id }, servingIndex?, unit, quantity, fraction? }` or `{ day, meal: "supplements", water_ml }` → `{ entry }`
- `PATCH /api/log/:id { servingIndex?, unit?, quantity?, fraction? }` → `{ entry }`; `DELETE /api/log/:id` → 204
- `POST /api/log/move { ids: number[]; day; meal; copy: boolean }` → `{ entries }`
- `GET /api/foods/search?q=` → `{ groups: { source: "mine" | "cache" | "off" | "usda"; label: string; foods: FoodResult[] }[]; errors: { source: string; message: string }[] }`
- `GET /api/foods/barcode/:code` → `{ code: string; food: FoodResult | null }`
- `GET /api/foods/recent` / `GET /api/foods/frequent` → `{ foods: (FoodResult & { last: { servingIndex, unit, quantity, fraction } })[] }`
- `GET /api/my-foods?q=` → `{ foods: FoodResult[] }`; `POST /api/my-foods { name, brand?, barcode?, servings, nutrients, category?, aiFields? }` → `{ food }`; `PATCH /api/my-foods/:id` (same fields) → `{ food }`; `DELETE /api/my-foods/:id` → 204 (archives)
- `POST /api/my-foods/override { cacheId, name?, brand?, servings?, nutrients? }` → `{ food }` (kind user_food, override true, bound to the cache row's barcode)
- `POST /api/ai/estimate { text }` → `{ food: Omit<FoodResult,"id"|"kind"> & { category: string } }` (draft, not saved; 503 `{error:"Set up an AI service first"}` when AI isn't ready)
- `POST /api/ai/fill-gaps { food: { kind, id } }` → `{ nutrients: Nutrients; aiFields: string[] }` (draft)
- Admin: `GET /api/admin/food-sources` → `{ usda: { hasKey: boolean } }`; `PUT { usdaApiKey: string | null }`

---

## File Structure

```
backend/src/lib/nutrients.ts        units, scaling, totals (pure)
backend/src/lib/plans.ts            BMR/TDEE, plans, recommendation, targets (pure)
backend/src/lib/barcode.ts          normalize codes (pure)
backend/src/lib/foodIcons.ts        category → emoji (pure)
backend/src/lib/foodSources/off.ts  Open Food Facts client + normalizer
backend/src/lib/foodSources/usda.ts USDA FDC client + normalizer
backend/src/lib/foods.ts            lookup waterfall, search, cache, overrides (db)
backend/src/lib/days.ts             local day, meal default, streak, suggested split (pure + db)
backend/src/lib/startup.ts          friendly startup problems (pure)
backend/src/routes/{body-plans.ts,foods.ts,my-foods.ts,log.ts,settings-me.ts,food-sources.ts}
backend/tests/fixtures/{off-*.json,usda-*.json}
frontend/src/units.ts               display conversions
frontend/src/components/plan/{PlanPicker.tsx,BodyForm.tsx}
frontend/src/components/dashboard/{Dashboard.tsx,Gauge.tsx,Ring.tsx}
frontend/src/components/log/{LogPage.tsx,MealCard.tsx,AddFoodSheet.tsx,PortionSheet.tsx,FoodForm.tsx,MoveSheet.tsx}
frontend/src/components/goals/GoalsPage.tsx
```

---

### Task 1: Schema for 2a + housekeeping

**Files:** Modify `backend/src/db/schema.ts`; new migration; Create `backend/src/lib/startup.ts`, `backend/docker-entrypoint.sh`; Modify `backend/src/index.ts`, `Dockerfile`, `backend/src/routes/admin-users.ts`; Tests `backend/tests/schema-m2.test.ts`, `backend/tests/startup.test.ts`, `backend/tests/admin-users.test.ts`, `backend/tests/deploy-config.test.ts`

**Interfaces — Produces tables:**
- `user_body` (user_id PK → users cascade, sex, birth_year int, height_cm real, weight_kg real, goal_weight_kg real, activity text, glp1 bool, updated_at)
- `user_settings` (user_id PK cascade, meal_windows jsonb not null default `{"breakfast":"10:30","lunch":"14:30","snacks":"17:00","dinner":"21:00"}`, water_buttons_ml jsonb default `[237,473]`, culury_url text, culury_key_enc text)
- `targets` (id, user_id cascade, effective_from date, plan text null, calories_min/max int, protein_min/max real, fiber_min/max real, water_min/max real, created_at; index (user_id, effective_from)) — "targets in force on day D" = latest effective_from ≤ D (ties: highest id)
- `food_cache` (id, source text, source_id text, barcode text null, name, brand, category text, servings jsonb, nutrients jsonb, image_url, raw jsonb, fetched_at; unique(source, source_id); index barcode)
- `user_foods` (id, user_id cascade, kind text, name, brand, barcode null, base_cache_id → food_cache set null, category text, servings jsonb, nutrients jsonb, ai_fields text[] default '{}', notes, use_count int 0, last_used_at, archived bool false, created_at, updated_at; partial unique (user_id, barcode) where barcode is not null and archived = false)
- `log_entries` (id, user_id cascade, day date, meal text, name, brand, icon text, source text, source_ref text, serving_index int 0, unit text, quantity real, fraction real 1, per_serving jsonb, servings jsonb, nutrients jsonb, ai_estimated bool, created_at, updated_at; index (user_id, day))
- `pg_trgm` extension created in the migration; trigram index on `lower(user_foods.name || ' ' || coalesce(brand,''))`.
- `startupProblem(err: unknown, databaseUrl: string): string | null` — `3D000` → `Database "<name>" doesn't exist. Create it with: createdb <name>`; `ECONNREFUSED` → `Can't reach PostgreSQL at <host>:<port>. Is it running?`; `28P01`/`28000` → `PostgreSQL refused the sign-in for this DATABASE_URL.`; else null. `index.ts` prints it (one line) and exits 1 instead of the stack.
- Admin create: a unique-violation (`23505`) on insert maps to 409 "That username is taken" (race safe).
- Dockerfile: drop `USER node`; `ENTRYPOINT ["/app/docker-entrypoint.sh"]` which, when run as root, `chown -R node:node /app/data` then `exec setpriv --reuid=node --regid=node --init-groups node dist/index.js` (else just `exec node dist/index.js`); reset-password still works via `docker compose exec -u node`.

- [ ] **Step 1: Failing tests:** `schema-m2.test.ts` "user-owned food tables cascade with their user" (insert body, settings, targets, user_food, log entry; delete user; all gone, food_cache row stays). `startup.test.ts` "explains a missing database / unreachable server / refused sign-in" with the three messages above (construct errors `{code:"3D000"}`, `{code:"ECONNREFUSED"}`, AggregateError containing one with ECONNREFUSED, `{code:"28P01"}`) and "returns null for anything else". `admin-users.test.ts` "a duplicate created by a race is still 409" (insert the row directly with the db, then POST the same username → 409). `deploy-config.test.ts` "image fixes data folder ownership before dropping to node" (Dockerfile has no `USER node` line and has the ENTRYPOINT; entrypoint script contains `chown -R node:node /app/data` and `setpriv`).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement + `npx drizzle-kit generate --name m2a_food` (add `CREATE EXTENSION IF NOT EXISTS pg_trgm;` at the top of the generated SQL). **Step 4:** Run full backend suite → PASS.
- [ ] **Step 5: Commit** `feat: m2a schema and friendly startup errors`

### Task 2: Nutrients, units and barcodes (pure)

**Files:** Create `backend/src/lib/{nutrients.ts,barcode.ts,foodIcons.ts}`; Test `backend/tests/nutrients.test.ts`, `barcode.test.ts`, `food-icons.test.ts`

**Interfaces — Produces:**
- `NUTRIENT_KEYS` (the 12 keys), `type Nutrients`, `type Serving`, `type Unit`.
- `amountFactor(servings: Serving[], servingIndex: number, unit: Unit, quantity: number): number` — how many base servings (servings[0]) this amount is. `unit:"serving"` → quantity × (servings[servingIndex] size ÷ servings[0] size) using grams if both have grams, else ml if both have ml, else index must be 0 (factor = quantity). Mass units need servings[0].grams; volume units need servings[0].ml; mass↔volume only if servings[0] has both (density). Otherwise throw `UnitError("Can't measure this food in <unit>")`.
- `scaleNutrients(per: Nutrients, factor: number): Nutrients` — multiplies known keys only; rounds to 1 decimal (calories to whole).
- `sumNutrients(list: Nutrients[]): Nutrients & { unknownCount: Record<string, number> }` — unknownCount[key] = how many items lacked the key (only keys with ≥1 unknown appear).
- `normalizeBarcode(raw: string): string | null` — strip non-digits; length 8/12/13/14 only (else null); 12 → prefix "0"; 14 with leading "0" → drop it; return 13-digit EAN for 12/13/14, 8 stays 8. Check digit is NOT validated (labels with bad check digits exist).
- `iconFor(category: string | null | undefined, name?: string): string` — emoji by category keyword, falling back to name keywords, then "🍽️". At least these categories: fruit 🍎, berries 🫐, banana 🍌, vegetables 🥦, salad 🥗, bread 🍞, cereal/oats 🥣, pasta 🍝, rice 🍚, cheese 🧀, milk/dairy 🥛, yogurt 🥛, eggs 🥚, chicken/poultry 🍗, beef/meat 🥩, pork/bacon/salami 🥓, fish/seafood 🐟, shrimp 🦐, beans/legumes 🫘, nuts 🥜, snack/chips 🍿, chocolate/candy 🍫, cookies/baked 🍪, cake/dessert 🍰, ice cream 🍨, pizza 🍕, burger 🍔, sandwich 🥪, soup 🍲, drink/beverage 🥤, coffee ☕, tea 🍵, juice 🧃, water 💧, alcohol/beer 🍺, wine 🍷, protein shake/supplement 🥤, sauce/condiment 🫙, oil/butter 🧈, avocado 🥑.

- [ ] **Step 1: Failing tests** (exact values):
  - `amountFactor` base 1 cup (ml 236.6) / 100 g? — use a food with `servings:[{label:"100 g",grams:100},{label:"1 bar",grams:40}]`: `("serving",1,quantity 2)` → 0.8; `("g",0,50)` → 0.5; `("oz",0,1)` → 0.2834952; `("ml",0,10)` throws UnitError. Food `[{label:"1 cup",ml:236.5882365,grams:244}]`: `("fl_oz",0,8)` → ≈1.0 (1e-6); `("g",0,122)` → 0.5; `("tbsp",0,2)` → 0.125.
  - `scaleNutrients({calories:250, protein_g:20, sodium_mg:330}, 0.5)` → `{calories:125, protein_g:10, sodium_mg:165}`; unknown keys stay absent.
  - `sumNutrients([{calories:100, fiber_g:3},{calories:50}])` → calories 150, fiber_g 3, unknownCount `{fiber_g:1, ...}` for every key absent anywhere (protein_g:2 etc.). *(Review Focus 2)*
  - `normalizeBarcode` "012345678905", "0012345678905", "0-12345 67890 5" → all "0012345678905"; "00012345678905" (14) → "0012345678905"; "96385074" → "96385074"; "123" → null. *(Review Focus 4)*
  - `iconFor("en:cheeses")` → "🧀"; `iconFor(null, "Hard salami 6 slices")` → "🥓"; `iconFor("en:unknown-stuff", "Mystery")` → "🍽️".
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS. **Step 5: Commit** `feat: nutrients, units, barcodes and food icons`

### Task 3: Plans and targets (pure)

**Files:** Create `backend/src/lib/plans.ts`; Test `backend/tests/plans.test.ts`

**Interfaces — Produces:**
- `ACTIVITY = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very: 1.9 }`
- `bmr(body: Body, today: Date): number` Mifflin-St Jeor: 10·kg + 6.25·cm − 5·age + (male 5 | female −161); age = today's UTC year − birthYear.
- `tdee(body, today) = Math.round(bmr × ACTIVITY[activity])`
- `PLAN_DEFS = [relaxed ½ lb/wk −250, steady 1 −500, accelerated 1½ −750, vigorous 2 −1000]` with names "Relaxed", "Steady", "Accelerated", "Vigorous".
- `buildPlans(body, today): { tdee; floor; plans: Plan[]; recommended: PlanId | null }` — floor = `Math.round(max(1200, 0.65 × tdee))`; calories = tdee − deficit; weeksToGoal = `ceil((weightKg − goalWeightKg) / 0.45359237 / lbsPerWeek)` or null when goal ≥ current; `notRecommended = calories < floor`; recommended: steady if steady ≥ floor; else relaxed if relaxed ≥ floor; else null. glp1 caps the recommendation at accelerated (never vigorous) — with the rules above vigorous is never picked anyway; keep the cap explicit for future rule changes. If goal ≥ current weight: all plans `notRecommended:false`, `recommended:null` (maintenance is M3).
- `targetsForPlan(body, planCalories): { calories: Range; protein_g: Range; fiber_g: Range; water_ml: Range }` — calories ±150; protein from goal weight lb: min 0.7 g/lb, max 1.0 g/lb (rounded to whole g); fiber 25–38; water min 1893 ml (64 fl oz), max 3785 ml (128 fl oz).
- `planExplanation(result, body): string` — deterministic fallback text (used when AI is off): e.g. "Steady keeps you at 1,960 calories, above your 1,599 floor, and loses about 1 lb a week. On a GLP-1, slower loss helps protect muscle — aim for at least 126 g of protein." / null-recommendation text: "Every plan here would put you under a safe calorie floor of 1,200. Set your targets with your care team, then enter them under Goals."

- [ ] **Step 1: Failing tests** (fixed `today = new Date("2026-11-17T12:00:00Z")`):
  - Body A `{male, birthYear 1986, heightCm 177.8, weightKg 113.3980925, goalWeightKg 81.6466266, sedentary, glp1 true}`: tdee 2460; floor 1599; calories relaxed 2210, steady 1960, accelerated 1710, vigorous 1460; weeksToGoal 140, 70, 47, 35; recommended "steady"; vigorous notRecommended true, others false. targetsForPlan(A, 1960) → calories {1810, 2110}, protein {126, 180}, fiber {25,38}, water {1893, 3785}.
  - Body B (no safe plan) `{female, birthYear 1966, heightCm 152.4, weightKg 63.50293, goalWeightKg 54.43108, sedentary, glp1 true}`: tdee 1352; floor 1200; all four notRecommended; recommended null; explanation mentions "care team". *(Review Focus 1)*
  - Body C (steady below floor, relaxed above) — `{female, birthYear 1976, heightCm 160, weightKg 70, goalWeightKg 60, sedentary, glp1 false}`: bmr = 700+1000−250−161 = 1289 → tdee 1547; floor 1200 (0.65×1547=1005.6); steady 1047 < floor → recommended "relaxed" (1297).
  - Goal ≥ current → recommended null, weeksToGoal null.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS. **Step 5: Commit** `feat: plan calculator and targets`

### Task 4: Body, plans, targets and personal settings API

**Files:** Create `backend/src/routes/body-plans.ts`, `backend/src/routes/settings-me.ts`, `backend/src/lib/days.ts` (only `localDay(timezone, now)` here); Test `backend/tests/body-plans.test.ts`; Modify `backend/tests/isolation.test.ts`

**Interfaces:** Consumes Task 3 libs, Task 1 tables. Produces the `/api/body`, `/api/plans`, `/api/plans/select`, `/api/targets`, `/api/settings/me` routes per contracts. `localDay(timeZone: string, now: Date): string`. `targetsOn(db, userId, day): Promise<Targets | null>`. Explanation: if `app.ai` is ready, ask (task "quick", userId) for a 2-sentence explanation given the numbers, with 8 s timeout; on any failure use `planExplanation`.
- [ ] **Step 1: Failing tests:** "saves the body and lists plans with Steady recommended" (Body A via PUT, GET /api/plans → steady recommended, current null); "no body yet is 409"; "selecting a plan sets today's targets" (select steady → targets match Task 3 values, effectiveFrom = today in America/Boise from `t.app.now`); "manual targets replace plan targets from today on, older days keep theirs" (set clock day 1 select steady; clock day 3 PUT targets calories 1500–2000; GET /api/targets?day=day2 → plan steady numbers; day3 → manual, plan null); "rejects nonsense bodies" (heightCm 20, weightKg 1000, birthYear 1800 → 400); "settings me has meal windows and water buttons, and saves changes" (bad "25:00" → 400). Isolation: "a user can't see another's body, plans or targets".
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement (tests set time via the app's `now` option; add `clock` to `setupTestApp` like Culury's if absent). **Step 4:** PASS (full suite). **Step 5: Commit** `feat: body, plan picker and targets api`

### Task 5: Food sources — Open Food Facts and USDA

**Files:** Create `backend/src/lib/foodSources/{off.ts,usda.ts,types.ts}`, `backend/src/routes/food-sources.ts`; Modify `backend/src/app.ts` (AppOptions `foodFetch?: typeof fetch`, decorate `app.foodFetch`); Tests `backend/tests/off.test.ts`, `usda.test.ts`, `food-sources.test.ts`, fixtures in `backend/tests/fixtures/`

**Interfaces — Produces:**
- `type SourceFood = { source: "off" | "usda"; sourceId: string; barcode: string | null; name: string; brand: string | null; category: string | null; servings: Serving[]; nutrients: Nutrients; imageUrl: string | null; raw: unknown }`
- `offByBarcode(fetch, code: string, timeoutMs): Promise<SourceFood | null>` — `GET https://world.openfoodfacts.org/api/v2/product/<code>.json?fields=code,product_name,brands,categories_tags,nutriments,serving_size,serving_quantity,image_front_small_url`; status 0/404 → null.
- `offSearch(fetch, q, timeoutMs, limit=10): Promise<SourceFood[]>` — `GET https://search.openfoodfacts.org/search?q=<q>&page_size=10&fields=...` (same fields; results in `hits`). Drop items with no name or no energy.
- `normalizeOff(product)`: servings[0] = `{label:"100 g", grams:100}` (or "100 ml"/ml when `nutrition_data_per` is 100ml or product is a beverage with `_100ml` keys); add `{label: serving_size, grams: serving_quantity}` when present; nutrients from `*_100g`: energy-kcal → calories (else energy-kj/4.184), proteins, fiber, carbohydrates, fat, sugars, added-sugars, polyols → sugar_alcohol_g, sodium (g→mg ×1000), potassium (g→mg), magnesium (g→mg); category = first `categories_tags` entry; name falls back to "Unnamed product".
- `usdaSearch(fetch, apiKey, q, timeoutMs)`, `usdaByBarcode(fetch, apiKey, code, timeoutMs)` — `POST https://api.nal.usda.gov/fdc/v1/foods/search?api_key=…` body `{query, pageSize:10, dataType:["Foundation","SR Legacy","Branded"]}`; barcode: query = code, dataType Branded, keep item whose `normalizeBarcode(gtinUpc)` equals code. `normalizeUsda(food)`: nutrients per 100 g from `foodNutrients` by `nutrientNumber` — 208 calories (fallback 957/958 Atwater), 203 protein, 291 fiber, 205 carbs, 204 fat, 269 sugars, 539 added sugar, 307 sodium (mg), 306 potassium, 304 magnesium; servings[0] `{label:"100 g", grams:100}`, plus Branded `servingSize`+`servingSizeUnit` ("g"/"ml") with `householdServingFullText` as label; category = `foodCategory` (string or `.description`); brand = `brandOwner`/`brandName`.
- Admin route `GET|PUT /api/admin/food-sources` (requireAdmin; key stored encrypted in `app_settings` key `food_sources`; GET returns only `hasKey`). Helper `usdaKey(app): Promise<string | null>`.
- [ ] **Step 1: Failing tests** with JSON fixtures (hand-written realistic samples: an OFF product with per-serving data, an OFF beverage per 100 ml, an OFF product missing fiber; a USDA Foundation apple, a USDA Branded item with gtinUpc and servingSize): normalized output equals expected objects exactly (write expectations from the fixture numbers); missing fiber stays absent *(Review Focus 2)*; `offByBarcode` returns null for status 0; timeouts reject with `SourceError` within the timeout (fake fetch that never resolves, timeout 50 ms); admin route hides the key and is admin-only.
- [ ] **Step 2:** FAIL. **Step 3:** Implement (AbortController timeouts; OFF User-Agent header). **Step 4:** PASS. **Step 5: Commit** `feat: open food facts and usda sources`

### Task 6: Food lookup, search, My foods, overrides, AI estimate

**Files:** Create `backend/src/lib/foods.ts`, `backend/src/routes/foods.ts`, `backend/src/routes/my-foods.ts`; Tests `backend/tests/foods.test.ts`, `my-foods.test.ts`; Modify isolation test, `tests/helpers.ts` (fake food web: `t.foodWeb.respond(url, init)`, `t.foodWeb.calls`, reset).

**Interfaces — Consumes:** Tasks 1, 2, 5. **Produces** routes per contracts and:
- `cacheUpsert(db, f: SourceFood): Promise<number>` (on conflict (source, source_id) update fields + fetched_at; returns id)
- `toResult(row, kind)` → FoodResult (icon via `iconFor(category, name)`).
- Barcode waterfall in `lookupBarcode(app, userId, raw)`: normalize (null → 400 "That doesn't look like a barcode"); 1) user's non-archived user_food with that barcode; 2) food_cache by barcode with fetched_at within 30 days; 3) OFF; 4) USDA (only with a key); found externally → upsert cache; else `food: null`.
- `searchFoods(app, userId, q)` (q trimmed, ≥2 chars else 400): groups in order mine (pg_trgm similarity on name+brand, also ILIKE, limit 10), cache (ILIKE name/brand, limit 10), off, usda — off/usda run in parallel with 3 s timeout each; their results upserted to cache; empty groups omitted; failures into `errors` and app_log (category "food", userId). If `q` is all digits/spaces/dashes and normalizes to a barcode, return the barcode lookup result as a single "mine"/"cache"/source group.
- My foods CRUD (user_food kind "custom"); `POST /api/my-foods/override` copies the cache row (name, brand, barcode, category, servings, nutrients) merged with the edits, kind "override", `base_cache_id`; if the user already has an active food with that barcode it is updated instead (409 never). Barcode on custom foods normalized; another active food of the same user with that barcode → 409 "You already have a food with this barcode".
- AI: `estimateFood(app, userId, text)` asks task "food" for JSON `{name, brand|null, category, servings:[{label, grams?|ml?}], nutrients}` (system prompt: nutrition label expert, US servings, all 12 keys when knowable, numbers only); validate with zod; result `aiFields` = all present nutrient keys, `source:"ai"`. `fillGaps` asks only for the missing keys of a stored food and returns them (not saved). Not ready → 503.
- [ ] **Step 1: Failing tests:** "barcode: my override beats the cache, the cache beats the web" (seed cache row via OFF fake, then create override with edited calories → lookup returns override with `override:true`); "barcode variants hit the same food and override" (12/13-digit/spaced) *(Review Focus 4)*; "unknown barcode returns null without errors"; "fresh cache doesn't call the web again" (calls count); "search returns my foods first, then cache, OFF and USDA" (USDA key set via admin route); "a hanging OFF and a failing USDA still return local results with errors" (OFF never resolves, USDA 500; elapsed < 3.8 s; status 200) *(Review Focus 5)*; "no USDA key: no USDA group and no error"; "search needs at least 2 characters"; "custom foods: create, find by a word from the middle of the name, edit, archive" ("Morning protein shake" found by "protein"); "same barcode twice for one user is 409, but two users may each have one"; "AI estimate drafts a food and flags every value"; "AI off → 503 'Set up an AI service first'"; "fill gaps returns only the missing nutrients". Isolation: "a user can't see, edit or archive another user's foods or overrides, and lookups never return them".
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS (full). **Step 5: Commit** `feat: food lookup, search, my foods, overrides and ai estimate`

### Task 7: Log and day API

**Files:** Create `backend/src/routes/log.ts`; extend `backend/src/lib/days.ts`; Tests `backend/tests/log.test.ts`, `days.test.ts`; Modify isolation test.

**Interfaces — Consumes:** Tasks 1, 2, 4, 6. **Produces:** log routes per contracts and in `days.ts`:
- `MEAL_SPLIT = { breakfast: 0.2, lunch: 0.25, dinner: 0.35, snacks: 0.2, supplements: 0 }` — suggested = round(split × plan calories midpoint ((min+max)/2)); null without targets; supplements null.
- `mealFor(timeZone, now, windows): Meal` — local HH:MM < breakfast → "breakfast"; < lunch → "lunch"; < snacks → "snacks"; < dinner → "dinner"; else "snacks". (Exported for the web too — duplicate the tiny function in `frontend/src/meals.ts` with the same tests.)
- `streak(db, userId, today): Promise<number>` — consecutive days with ≥1 non-water entry ending today, or ending yesterday when today has none.
- Logging snapshots: resolve the food (cache row or the caller's user_food; other users' ids → 404), `per_serving` = food nutrients, `servings` = food servings, `nutrients = scaleNutrients(per, amountFactor(...) × fraction)`; `icon` from the food; `source`/`source_ref` = `cache:<id>` / `user_food:<id>`; bumps user_food use_count/last_used_at. Water: name "Water", icon "💧", nutrients `{water_ml}`, unit "ml", quantity water_ml. UnitError → 400 with its message. fraction in (0, 1].
- PATCH recomputes from the snapshot only. Move/copy: all ids must be the caller's (else 404, nothing changes); copy creates new rows with the same snapshot.
- Recent: last 30 distinct source_refs of the user's entries (newest first) resolved to current FoodResult (skip archived/missing), with `last` portion. Frequent: top 20 by count over the last 60 days.
- [ ] **Step 1: Failing tests:** days: `mealFor` at 07:00/12:00/15:30/18:00/22:30 Boise → breakfast/lunch/snacks/dinner/snacks; "an entry at 11:30 pm Boise lands on that Boise day" (clock 2026-11-18T06:30:00Z, POST with day from `GET /api/day/today`-style helper → GET /api/day/2026-11-17 includes it) *(Review Focus 3)*; streak cases (none → 0; today+yesterday → 2; only yesterday and day before → 2; gap → resets; water-only day doesn't count). log: "logs half a bar and snapshots it" (bar food 1 serving fraction 0.5 → calories half); "editing the source food later doesn't change the logged entry"; "PATCH portion rescales from the snapshot"; "move and copy entries to another day and meal"; "can't move someone else's entry (404, nothing moved)"; "day view totals, per-meal totals, suggested calories and unknown counts" (targets steady 1810–2110 → suggested breakfast 392, lunch 490, dinner 686, snacks 392; an entry lacking fiber → unknownCount.fiber_g 1) *(Review Focus 2)*; "exercise is shown as 0 and never changes targets"; "water quick add"; "ml on a mass-only food is 400 with a clear message"; "recent and frequent foods". Isolation: "a user can't read, edit, delete, move or copy another user's entries, or log another user's custom food".
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS (full). **Step 5: Commit** `feat: food log and day api`

### Task 8: Web — plan picker and Goals

**Files:** Create `frontend/src/units.ts` (+test), `frontend/src/components/plan/{BodyForm.tsx,PlanPicker.tsx}`, `frontend/src/components/goals/GoalsPage.tsx`; Modify `App.tsx`/`AppShell.tsx` (first run after setup: if `GET /api/targets` is null → show plan flow full-screen before the tabs; Goals tab shows current plan + targets with "Change plan" and "Edit targets").
**Interfaces — Consumes:** body/plans/targets contracts. `units.ts`: `lbToKg`, `kgToLb`, `inToCm`, `cmToFtIn`, `mlToFlOz`, `flOzToMl`, `formatWeight(kg, units)`, `formatWater(ml, units)` — imperial default.
- BodyForm (imperial: ft + in, lb; metric: cm, kg): sex, birth year, height, current weight, goal weight, activity (5 choices with one-line descriptions), "Are you taking a GLP-1 medicine?" switch.
- PlanPicker: Lose It-style horizontally swipeable cards (CSS scroll-snap, one card per view on phones, arrows on desktop), card = name, one-liner, "Eat N calories per day", "Lose X lb per week", "About N weeks to reach goal", orange "Select" pill; badge "Recommended for you" (orange) or "Not recommended" (red); starts scrolled to the recommended card; the explanation text above the cards; when no plan is recommended, show the care-team message and a "Set my own targets" button that opens the targets editor.
- Targets editor (Goals): min/max for calories, protein (g), fiber (g), water (fl oz or ml) → PUT /api/targets.
- [ ] **Step 1: Failing tests** (fakeServer): `units.test.ts` round trips (5 ft 10 in ↔ 177.8 cm; 250 lb ↔ 113.398 kg ±0.001; 64 fl oz ↔ 1893 ml ±1); "body form sends metric values" (5 ft 10 in, 250 lb, goal 180 → PUT body heightCm 177.8, weightKg≈113.398, goalWeightKg≈81.647); "plan picker opens on the recommended plan and selecting it saves" (fake plans → card "Steady" has "Recommended for you"; Select → POST /api/plans/select {plan:"steady"}); "no safe plan shows the care-team message and own-targets button"; "Goals shows targets and saves edits".
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** `npm test && npm run build` PASS. **Step 5: Commit** `feat: plan picker and goals screens`

### Task 9: Web — live Dashboard

**Files:** Create `frontend/src/components/dashboard/{Dashboard.tsx,Gauge.tsx,Ring.tsx}`, `frontend/src/meals.ts` (+test); replace `DashboardPreview`.
**Interfaces — Consumes:** `GET /api/day/:date` for `useSelectedDay().day`, `POST /api/log` (water), `GET /api/settings/me`.
- Budget card (design §9 option B): "Budget: 1,810–2,110 cals"; Food (total calories) left, Exercise right (0); semicircle gauge: centre number = calories left to the range top (`max − food`) labelled "left" in green while food ≤ max, or "over" amber with `food − max` when above max; while food < min, sub-label "N to reach your range" in muted text; gauge fill = food / max.
- Three rings: protein, fiber, water — full at the range minimum; label "97 / 126 g" (water in fl oz for imperial); past max a small tick (no alarm); when the day's totals have unknown fiber/protein, a small "?" with "N foods missing fiber" on tap.
- Water quick-add pills from `waterButtonsMl` ("+8 oz", "+16 oz") → POST water for the selected day → refresh.
- Streak strip: "N-day streak" with a flame icon (lucide).
- Without targets: card says "Pick a plan to see your budget" with a button to the plan flow.
- [ ] **Step 1: Failing tests:** `meals.test.ts` same `mealFor` cases as backend; "dashboard shows budget, food, left and rings from the day" (fake day: targets 1810–2110, totals calories 1138, protein 97, fiber 29, water 769 ml → texts "1,138", "972" + "left", "97 / 126 g", "29 / 25 g" ring full, "26 / 64 fl oz"); "over the range shows amber over"; "water button logs 8 fl oz (237 ml) for the selected day"; "no targets → pick a plan button".
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS + build. **Step 5: Commit** `feat: live dashboard`

### Task 10: Web — Log, Add food, portions, move/copy, custom foods

**Files:** Create `frontend/src/components/log/{LogPage.tsx,MealCard.tsx,AddFoodSheet.tsx,PortionSheet.tsx,FoodForm.tsx,MoveSheet.tsx}`; replace `LogPreview`; the floating **+** opens AddFoodSheet for `mealFor(now)` on the selected day.
**Interfaces — Consumes:** day, log, foods, my-foods, ai contracts.
- Log page: meal cards Breakfast/Lunch/Dinner/Snacks (+ Supplements & water card): header "Breakfast: 287 cals", sub-line "16g protein · 1g carbs · 24g fat · 5g fiber", "N calories suggested" when empty; rows: icon, name, portion text ("2 slices", "½ × 1 bar"), calories right; tap row → PortionSheet (edit) with "Move", "Copy", "Delete"; "Add Food" pill per meal; select mode (long-press or "Select") for multi move/copy.
- AddFoodSheet: search box focused; when empty shows Recent then Frequent; typing ≥2 chars searches (debounced 250 ms) and shows groups with their labels ("My foods", "Saved foods", "Open Food Facts", "USDA"); a typed barcode shows the lookup result or "Not found — create it"; per-result row: icon (or product thumbnail when `imageUrl`), name, brand, calories per base serving; "Describe it" → AI estimate draft → FoodForm; "Create food" → FoodForm; each result has "Edit" → FoodForm in override mode (cache) or edit mode (mine).
- PortionSheet: serving picker (servings labels + g/oz or ml/fl oz when convertible), quantity input, fraction chips ¼ ⅓ ½ ¾ Full, live calories/protein/fiber preview (client-side same math as `amountFactor`), meal picker defaulting to the sheet's meal, "Log" orange pill. Server 400 message shown inline.
- FoodForm: name, brand, barcode, servings (base serving label + grams/ml, extra servings), nutrient fields (12, blank = unknown), AI-estimated fields marked; Save → POST/PATCH my-foods or POST my-foods/override; "Fill gaps with AI" when unknowns exist (needs saved food).
- MoveSheet: date (‹ › around selected day) + meal → POST /api/log/move.
- [ ] **Step 1: Failing tests:** "meal cards show entries with icons, portions and totals"; "add food: search groups appear in order and logging a result sends the right body" (choose "1 bar", ½ → POST {food:{kind:"cache",id}, servingIndex:1, unit:"serving", quantity:1, fraction:0.5, meal:"snacks"}); "typed barcode not found offers create with the barcode filled in"; "edit on a database food saves an override"; "move an entry to tomorrow's lunch"; "delete asks first and removes the row"; "describe it creates a draft flagged AI-estimated". Use `fakeServer` with the contract shapes.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS + build. **Step 5: Commit** `feat: log screen, add food and portions`

### Task 11: Milestone check

- [ ] **Step 1:** Root `npm test` → all pass; backend typecheck (tests included); frontend build.
- [ ] **Step 2:** Production walk-through against a fresh DB with the fake-free server (OFF reachable only if the workspace allows; otherwise seed `food_cache` via SQL from a fixture): setup → plan flow (Body A) → Steady recommended → select → Dashboard shows 1,810–2,110 → log a food via search/cache, log water → Dashboard numbers move → Log shows the entry with icon → move it to lunch → create a custom food with a barcode → typed barcode finds it → edit a cache food → override wins.
- [ ] **Step 3:** Phone-size screenshots (headless Chrome) of plan picker, Dashboard with data, Log with entries, Add food sheet; fix visual breakage seen.
- [ ] **Step 4:** Update README (what's new) and commit `docs: milestone 2a`.
