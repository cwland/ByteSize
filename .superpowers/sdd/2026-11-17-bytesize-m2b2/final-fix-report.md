# Final-review fixes, M2b-2

1. Settings cache (frontend/src/day.ts, src/test/setup.ts). Module-level `lastKnown` seeds useSettingsMe; updated on every answer (incl. the save event, which refetches); `resetSettingsCache` exported and called in test setup afterEach.
   Test: WeekStrip.test.tsx "remembers a Monday-start week...". RED: after remount, no "Week of Nov 16" group on first render (Sunday-first weeks shown). GREEN: 8/8 in file.
2. Did-you-mean (backend/src/lib/foods.ts). The literal rule (similarity >= 0.5) would drop sandwhich/sandwiches (word_similarity 0.5, similarity 0.4), so used an equivalent verified rule: word_similarity >= 0.5, and searches shorter than 5 chars must also have similarity >= 0.5.
   pg_trgm (ws/sim): bananna/banana .75/.75, bluebery/blueberry .78/.73, sandwhich/sandwiches .5/.4 (len 9, kept), beef/beer .6/.43 (rejected), pear/peas .6/.43 (rejected).
   Test: foods.test.ts "a real word that was never saved isn't 'fixed' into a near miss". RED: suggestion present. GREEN: 22/22.
3. Size tags (aiModels.ts). `\d+b` tokens ignored in versions; `sized` flag ranks below plain sibling. Test: ai-models.test.ts "a size tag (-8b) isn't a version...". RED: gemini-1.5-flash-8b picked. GREEN.
4. `exp\w*` excluded. Test: "experimental models ... never suggested". RED: learnlm-2.0-flash-experimental picked. GREEN: ai-models 10/10.

Full suites: backend 30 files / 243 tests pass; frontend 22 files / 99 tests pass. Backend tsc -p tsconfig.test.json ok; frontend tsc --noEmit ok; npm run build ok.
