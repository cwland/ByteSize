# ByteSize M2c — Culury link and restaurant menus — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Log Culury meal-plan recipes and big-chain restaurant items (Spoonacular, FatSecret fallback) from Add Food.

**Architecture:** Two independent backends in parallel — A (Culury client, no migration) and B (restaurant adapters, owns migration 0009) — then two UIs in parallel, C on A and D on B. All outside calls are made by the server through the injectable `app.foodFetch`-style fetch so tests use fakes; keys are encrypted and never sent to the browser.

**Tech Stack:** Fastify 5, Drizzle + Postgres 16, zod, Vitest; React 18, Vite 6, Tailwind 4. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-16-bytesize-m1-m2-design.md` §14 (with its update) and 6.5.

## Global Constraints

- Per-user isolation: Culury settings and favourites are per user (`requireUser`); restaurant keys are admin settings (`requireAdmin`), like the USDA key. New user-owned data is covered in `isolation.test.ts`.
- Secrets (Culury key, Spoonacular key, FatSecret client secret) are encrypted at rest with the existing `encryptSecret`, never returned by any GET (only `hasKey: true`), never logged.
- Outside calls: 3 s timeout for Culury; Spoonacular at most 1 request/second (server-side queue) and never more than needed; a failed source never breaks logging — it returns a plain message in `errors` like OFF/USDA do.
- Culury address: http(s) only, no credentials in the URL, trailing slash trimmed; requests go only to `{culury}/api/plan` and `{culury}/api/recipes…`.
- Storage: Spoonacular search results kept 24 h; an item's nutrition kept once fetched; FatSecret data kept only for items the person logs or stars; nothing bulk-copied.
- Unknown stays unknown (absent), never 0. Log entries snapshot nutrients as today.
- Copy: "Meal plan", "Culury", "Test connection", "Restaurants", "N lookups left today", "Today's restaurant lookups are used up. They reset at midnight UTC — or use Describe it.", "Restaurant data from spoonacular.com", "Powered by FatSecret", "Estimate with AI", "may be out of date".
- Tests RED→GREEN; stage files explicitly; nothing under `.superpowers` is committed.

## Review Focus

1. A Culury key or restaurant key can never be read back, logged, or sent to the browser; one person's Culury link is never used for another's requests.
2. A hostile or wrong Culury address (file:, internal metadata hosts, a URL with embedded credentials, redirects) can't make the server fetch something unintended beyond a plain http(s) GET to that host's /api paths; errors don't echo response bodies.
3. Running out of Spoonacular points (402), a slow or down source, or malformed JSON gives a clear message and falls back (FatSecret, then nothing) — never a 500, never a retry loop that burns points.
4. A Culury recipe with no nutrition, partial nutrition, or a serving note without grams logs correctly (unknown stays unknown; servings-only when no grams).
5. The same restaurant search twice within 24 h makes one outside call; an item opened twice makes one; quota shown matches the API's headers.

---

### Task A: Culury backend

**Files:** create `backend/src/lib/culury.ts`, `backend/src/routes/culury.ts`, `backend/tests/culury.test.ts`, `backend/tests/culuryFakes.ts`; modify `app.ts` (register), `lib/foods.ts` (search adds a "Culury" group; `loadFood` accepts kind `culury`), `routes/log.ts` (source `culury`, source_ref `culury:<id>`; recents resolve culury refs from the snapshot), `isolation.test.ts`. No migration (`user_settings.culury_url`, `culury_key_enc` exist).

**Interfaces (produces):**
- `GET /api/settings/culury` → `{ url: string|null, hasKey: boolean }`; `PUT` `{ url, apiKey? }`; `DELETE`; `POST /api/settings/culury/test` → `{ ok: true, message }` or 400 with a plain reason.
- `GET /api/culury/plan?day=YYYY-MM-DD&meal=` → `{ linked: boolean, days: { day, items: { slot, title, recipeId|null, servings|null, note|null }[] }[], errors }` (day−3…day+4; the selected day first, its matching slot first).
- `GET /api/culury/recipes/:id` → `{ food: FoodResult (kind "culury", foodKind "recipe", source "culury") , hasNutrition: boolean, outdated: boolean }`.
- `/api/foods/search` gains group `{ source: "culury", label: "Culury" }` when linked.
- `POST /api/log` accepts `food: { kind: "culury", id }`; optional `nutrients` override only when the recipe has no nutrition and the client sends an AI estimate (flagged aiEstimated).
- Culury shapes (from its source): `GET /api/plan?from&to` → days with entries `{ date, slot, recipeId, title, servings, note }`; `GET /api/recipes?q=` list; `GET /api/recipes/:id` with `nutrition { calories, fat, saturatedFat, carbs, fiber, sugar, addedSugar?, protein, sodium (mg), servings?, servingSize?, outdated? }` per serving — the builder confirms exact shapes by reading `/home/claude/ref/Culury/backend/src/routes/plan.ts`, `recipes.ts`, `lib/recipes.ts`, `db/schema.ts` (read-only reference; never modify that repo).

- [ ] Step 1: tests (fake Culury via the injectable fetch) — settings save/readback never returns the key; bad URLs rejected (file:, credentials, non-http); test connection ok / wrong key / unreachable; plan window and ordering; notes not loggable; recipe → food mapping incl. "(340 g)" grams and no-grams; missing/partial nutrition; search group present when linked, absent otherwise, errors plain when Culury is down; logging snapshots with source culury and shows in recents; AI-estimate override flagged; another user's link never used (isolation); X-API-Key sent, never echoed.
- [ ] Step 2: FAIL. Step 3: implement. Step 4: backend suite + typecheck PASS. Step 5: commit `feat: Culury link — meal plan and recipes`.

### Task B: Restaurants backend

**Files:** create `backend/src/lib/restaurants/types.ts` (adapter interface), `spoonacular.ts`, `fatsecret.ts`, `index.ts` (order, fallback, queue, cache), `backend/src/routes/restaurants.ts`, tests `restaurants.test.ts`, `spoonacular.test.ts`, `fatsecret.test.ts`, `restaurantFakes.ts`; modify `schema.ts` (`restaurant_favourites`: id, user_id, cache_id → food_cache, chain text, created_at, unique (user_id, cache_id); `restaurant_searches`: source, query, results jsonb, fetched_at, unique (source, query) — shared cache, not user data), `routes/food-sources.ts` (Spoonacular key; FatSecret client id + secret; Test for each), `lib/foods.ts` (food_cache rows with source `spoonacular` / `fatsecret`, `brand` = chain), `app.ts`, `isolation.test.ts`; migration `npx drizzle-kit generate --name restaurants` (0009).

**Interfaces (produces):**
- `GET /api/restaurants/status` → `{ sources: ("spoonacular"|"fatsecret")[], lookupsLeft: number|null }`.
- `GET /api/restaurants/search?q=` (≥ 3 letters) → `{ items: { source, sourceId, chain, name, calories|null, cacheId|null, imageUrl|null }[], lookupsLeft, errors }`.
- `POST /api/restaurants/item` `{ source, sourceId }` → `{ food: FoodResult (kind "cache") , lookupsLeft }` (fetches nutrition once, upserts food_cache).
- `GET /api/restaurants/recent-chains` → `{ chains: string[] }` (from the person's log entries of restaurant foods); `GET/POST/DELETE /api/restaurants/favourites` (`{ cacheId }`), list grouped by chain.
- Adapter: `search(q): Promise<{ items, quota? }>`, `item(id): Promise<{ food, quota? }>`; errors typed `SourceError` with `kind: "quota"|"down"|"bad_key"|"bad_data"`.
- The builder FIRST reads the providers' docs with WebFetch (Spoonacular: https://spoonacular.com/food-api/docs — Menu Items: search, information; quota headers; FatSecret: https://platform.fatsecret.com/docs — OAuth 2.0 token + foods.search / food.get, brand type "Restaurant") and records in the report the exact endpoints, parameters, point costs and response fields used; if a page can't be read, build to the best documented knowledge and list every assumption as a concern.

- [ ] Step 1: tests (fake providers) — Spoonacular search maps chain/name/calories; item maps nutrients + serving (grams when given); quota headers → lookupsLeft; 402 → quota error and fallback to FatSecret; down/malformed → plain error, fallback, no retry; 1 request/second queue (with the test clock); same query within 24 h → one call; item fetched once; FatSecret token fetched and reused until expiry, search filtered to restaurant brands, item mapping; FatSecret search results not stored, logged/starred item stored; keys never returned; favourites add/list/remove and isolation; recent chains per user; no keys → status sources [] and search 400 "Add a restaurant data key in Settings › Food sources".
- [ ] Step 2: FAIL. Step 3: implement. Step 4: PASS. Step 5: commit `feat: restaurant menus from Spoonacular with FatSecret fallback`.

### Task C: Culury UI (after A)

**Files:** create `frontend/src/components/settings/IntegrationsSettings.tsx` (+ test), `frontend/src/components/log/MealPlanView.tsx` (+ test); modify `settings/SettingsPage.tsx` (Integrations row), `log/AddFoodSheet.tsx` (Meal plan button when linked; Culury group rows with a "Culury" tag; no-nutrition path → "Estimate with AI" then Track), `types.ts`.

- [ ] Step 1: tests — settings form saves url+key, shows "A key is saved", Test connection result, Remove; Meal plan button only when linked; plan grouped by day with the selected day's meal first; notes shown but not tappable; picking a recipe opens Track food at 1 serving; grams offered only when the serving has grams; a recipe without nutrition offers "Estimate with AI" and logs flagged; "may be out of date" note; Culury down → message, the rest of the sheet works.
- [ ] Step 2: FAIL. Step 3: implement. Step 4: web suite PASS; screenshots. Step 5: commit `feat: Culury meal plan in Add Food`.

### Task D: Restaurants UI (after B)

**Files:** create `frontend/src/components/log/RestaurantsView.tsx` (+ test); modify `settings/FoodSourcesSettings.tsx` (Spoonacular key; FatSecret id + secret; Test each), `log/AddFoodSheet.tsx` (Restaurants tab/button), `types.ts`.

- [ ] Step 1: tests — tab hidden line when no source ("Add a restaurant data key…"); search fires on Enter or after 800 ms and ≥ 3 letters (not per keystroke); results grouped by chain with calories and a source label; tapping fetches the item once and opens Track food; star/unstar favourites, favourites grouped by chain; recent chains chips fill the search; "N lookups left today"; used-up message with Describe it; credits shown per configured source; settings save keys without ever showing them.
- [ ] Step 2: FAIL. Step 3: implement. Step 4: PASS; screenshots. Step 5: commit `feat: Restaurants tab in Add Food`.

### Finish

- [ ] Merge; full `npm test`, typechecks, build; fresh whole-branch review (most capable model); one fix pass; merge `m2c` → main, push, CI green.
