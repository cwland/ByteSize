import { useEffect, useRef, useState } from "react";
import { Sparkles, Star } from "lucide-react";
import { api } from "../../api";
import type { FoodResult, MenuHit, MenuSearch, RestaurantFavourites, RestaurantSource, RestaurantStatus } from "../../types";
import FoodPic from "./FoodPic";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { Sheet } from "../ui/Sheet";
import { field, secondaryButton } from "../ui/styles";

// What the Restaurants view keeps while the person opens an item and comes back (owned by Add Food):
// the words, the last answer, and every item already fetched, so nothing is looked up twice.
export type RestaurantsMemo = { q: string; searched: string; found: MenuSearch | null; foods: Record<string, FoodResult>; lookupsLeft?: number | null };
export const newRestaurantsMemo = (): RestaurantsMemo => ({ q: "", searched: "", found: null, foods: {} });

const PAUSE_MS = 800; // search after this pause in typing (or on Enter), never per keystroke
const MIN_LETTERS = 3;
const USED_UP = "Today's restaurant lookups are used up. They reset at midnight UTC — or use Describe it.";
const SOURCE_LABEL: Record<RestaurantSource, string> = { spoonacular: "Spoonacular", fatsecret: "FatSecret" };
// lookupsLeft is Spoonacular points; a search plus opening an item costs about 2.2 of them
export const lookupsText = (points: number) => `About ${Math.floor((points * 10) / 22)} lookups left today`;
const calText = (c: number | null | undefined) => (c === null || c === undefined ? "Calories unknown" : `${Math.round(c)} cal`);
const keyOf = (h: Pick<MenuHit, "source" | "sourceId">) => `${h.source}:${h.sourceId}`;

// Hits in the order they came, grouped by chain (first appearance first)
function byChain(items: MenuHit[]) {
  const groups = new Map<string, MenuHit[]>();
  for (const h of items) groups.set(h.chain, [...(groups.get(h.chain) ?? []), h]);
  return [...groups];
}

const sectionTitle = "px-1 text-xs font-bold tracking-wide text-muted uppercase";

function MenuRow({ name, calories, sourceLabel, imageUrl, starred, onOpen, onStar }: { name: string; calories: number | null | undefined; sourceLabel?: string; imageUrl: string | null; starred: boolean; onOpen: () => void; onStar: () => void }) {
  return (
    <li className="flex items-center gap-2 rounded-2xl bg-pressed p-2">
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-1 py-1 text-left">
        <FoodPic icon="🍽️" imageUrl={imageUrl} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{name}</span>
          <span className="flex items-center gap-1.5 text-sm text-subtle">
            <span className="tabular">{calText(calories)}</span>
            {sourceLabel && <span className="rounded-full bg-active px-1.5 py-px text-[10px] font-bold text-action">{sourceLabel}</span>}
          </span>
        </span>
      </button>
      <button
        type="button"
        aria-label={`${starred ? "Unstar" : "Star"} ${name}`}
        aria-pressed={starred}
        onClick={onStar}
        className={`flex size-10 shrink-0 items-center justify-center rounded-full hover:bg-strong ${starred ? "text-primary" : "text-subtle"}`}
      >
        <Star aria-hidden="true" className="size-5" fill={starred ? "currentColor" : "none"} />
      </button>
    </li>
  );
}

// Restaurants (§14 B): search big chains' menus (Spoonacular, FatSecret as the fallback); tap an item to
// open Track food; star items to keep them under Favourites by chain; recent chains as chips.
// It is the whole sheet: the search box and lookups line stay pinned while the list scrolls.
export default function RestaurantsView({
  label,
  onClose,
  onBack,
  status,
  memo,
  onPick,
  onDescribe,
}: {
  label: string;
  onClose: () => void;
  onBack: () => void;
  status: RestaurantStatus;
  memo: RestaurantsMemo;
  onPick: (food: FoodResult) => void;
  onDescribe: () => void;
}) {
  const [q, setQ] = useState(memo.q);
  const [found, setFound] = useState<MenuSearch | null>(memo.found);
  const [left, setLeft] = useState<number | null>(memo.lookupsLeft ?? status.lookupsLeft);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [favs, setFavs] = useState<RestaurantFavourites["chains"]>([]);
  const [chains, setChains] = useState<string[]>([]);
  const searched = useRef(memo.searched); // the words of the last search sent (no second call for the same words)
  const failed = useRef(false); // the last search failed: only Enter (or a chip) sends it again, never the pause
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const fetching = useRef<Record<string, Promise<FoodResult>>>({}); // items being fetched (a double tap waits on the same one)
  const starring = useRef(new Set<string>()); // stars being changed (a double tap is ignored)

  useEffect(() => {
    api<RestaurantFavourites>("GET", "/api/restaurants/favourites").then((r) => setFavs(r.chains), () => {});
    api<{ chains: string[] }>("GET", "/api/restaurants/recent-chains").then((r) => setChains(r.chains), () => {});
  }, []);

  const noteLeft = (n: number | null) => {
    if (n === null) return;
    setLeft(n);
    memo.lookupsLeft = n;
  };

  // asked: Enter or a chip (cancels the pending pause, and may retry words whose search failed)
  const search = async (text: string, asked = false) => {
    const t = text.trim();
    if (asked) clearTimeout(timer.current);
    if (t.length < MIN_LETTERS || (t === searched.current && !(asked && failed.current))) return;
    searched.current = memo.searched = t;
    failed.current = false;
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<MenuSearch>("GET", `/api/restaurants/search?q=${encodeURIComponent(t)}`);
      if (searched.current !== t) return; // newer words were searched meanwhile
      setFound((memo.found = r));
      noteLeft(r.lookupsLeft);
    } catch (e) {
      if (searched.current !== t) return;
      failed.current = true;
      setMsg(errorMsg(e));
    } finally {
      if (searched.current === t) setBusy(false); // a superseded search doesn't end the newer one's wait
    }
  };

  useEffect(() => {
    memo.q = q;
    if (q.trim().length < MIN_LETTERS) {
      searched.current = memo.searched = "";
      setFound((memo.found = null));
      return;
    }
    timer.current = setTimeout(() => void search(q), PAUSE_MS);
    return () => clearTimeout(timer.current);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  // An item's full nutrition, fetched once (POST /item stores it and gives its cache id)
  const foodOf = (h: MenuHit): Promise<FoodResult> => {
    const k = keyOf(h);
    if (memo.foods[k]) return Promise.resolve(memo.foods[k]);
    return (fetching.current[k] ??= api<{ food: FoodResult; lookupsLeft: number | null }>("POST", "/api/restaurants/item", { source: h.source, sourceId: h.sourceId })
      .then((r) => {
        noteLeft(r.lookupsLeft);
        return (memo.foods[k] = r.food);
      })
      .finally(() => delete fetching.current[k]));
  };
  const run = async (f: () => Promise<void>) => {
    setMsg(null);
    try {
      await f();
    } catch (e) {
      setMsg(errorMsg(e));
    }
  };

  const starredIds = new Set(favs.flatMap((c) => c.foods.map((f) => f.id)));
  const setStar = (cacheId: number, on: boolean) =>
    api<RestaurantFavourites>(on ? "POST" : "DELETE", "/api/restaurants/favourites", { cacheId }).then((r) => setFavs(r.chains));
  // One star change per item at a time; key: the hit's or the favourite's
  const toggle = (key: string, f: () => Promise<void>) => {
    if (starring.current.has(key)) return;
    starring.current.add(key);
    void run(f).finally(() => starring.current.delete(key));
  };
  const cacheIdOf = (h: MenuHit) => h.cacheId ?? memo.foods[keyOf(h)]?.id ?? null;

  const spoonacular = status.sources.includes("spoonacular");
  const usedUp = (spoonacular && left === 0) || !!found?.errors.some((e) => e.message === USED_UP);
  // The full banner only when nothing else can answer: no items came back (or, before any search,
  // Spoonacular is the only source); otherwise a small line, and the other results
  const banner = usedUp && (found ? found.items.length === 0 : !status.sources.includes("fatsecret"));
  const errors = found?.errors.filter((e) => e.message !== USED_UP) ?? [];
  const labelled = status.sources.length > 1; // a source label only when both sources could answer

  return (
    <Sheet
      tall
      label={label}
      heading="Restaurants"
      onClose={onClose}
      onBack={onBack}
      bodyLabel="Restaurant results"
      top={
      <div className="flex flex-col gap-2">
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            void search(q, true);
          }}
        >
          <input
            type="search"
            aria-label="Search restaurants"
            autoFocus
            placeholder="Chain or item, like chipotle bowl"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className={`${field} mt-0 rounded-full`}
          />
        </form>
        {banner ? (
          <div className="flex flex-col items-start gap-2 rounded-2xl bg-pressed px-3 py-2 text-sm">
            <p>{USED_UP}</p>
            <button type="button" onClick={onDescribe} className={`${secondaryButton} inline-flex items-center gap-1.5 px-4 py-1.5 text-sm`}>
              <Sparkles className="size-4" /> Describe it
            </button>
          </div>
        ) : usedUp ? (
          <p className="px-2 text-xs text-muted">{found?.items.length ? "Spoonacular's lookups are used up for today — showing other results" : "Spoonacular's lookups are used up for today"}</p>
        ) : (
          spoonacular && left !== null && <p className="px-2 text-xs text-muted">{lookupsText(left)}</p>
        )}
        <Notice msg={msg} />
      </div>
      }
    >

      {busy && <p className="mt-4 px-2 text-subtle">Searching…</p>}

      {found && !busy && (
        <>
          {byChain(found.items).map(([chain, hits]) => (
            <section key={chain} aria-label={chain} className="mt-4">
              <h3 className={sectionTitle}>{chain}</h3>
              <ul className="mt-2 flex flex-col gap-2">
                {hits.map((h) => {
                  const id = cacheIdOf(h);
                  const starred = id !== null && starredIds.has(id);
                  return (
                    <MenuRow
                      key={keyOf(h)}
                      name={h.name}
                      calories={h.calories}
                      sourceLabel={labelled ? SOURCE_LABEL[h.source] : undefined}
                      imageUrl={h.imageUrl}
                      starred={starred}
                      onOpen={() => void run(async () => onPick(await foodOf(h)))}
                      onStar={() => toggle(keyOf(h), async () => setStar(starred ? id! : (id ?? (await foodOf(h)).id), !starred))}
                    />
                  );
                })}
              </ul>
            </section>
          ))}
          {found.items.length === 0 && !banner && <p className="mt-4 px-2 text-subtle">No menu items found. Try the chain and the item, like “chipotle chicken bowl”.</p>}
          {errors.map((e) => (
            <p key={e.source} className="mt-2 px-2 text-xs text-muted">
              {e.message}
            </p>
          ))}
        </>
      )}

      {!found && !busy && (
        <>
          {chains.length > 0 && (
            <section aria-label="Recent chains" className="mt-4">
              <h3 className={sectionTitle}>Recent chains</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {chains.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => {
                      setQ(c);
                      void search(c, true);
                    }}
                    className="rounded-full border border-line px-3 py-1 text-sm font-semibold hover:bg-pressed"
                  >
                    {c}
                  </button>
                ))}
              </div>
            </section>
          )}
          {favs.length > 0 && (
            <section aria-label="Favourites" className="mt-4">
              <h3 className={sectionTitle}>Favourites</h3>
              {favs.map((c) => (
                <div key={c.chain} className="mt-2">
                  <h4 className="px-1 text-sm font-semibold text-subtle">{c.chain}</h4>
                  <ul className="mt-1 flex flex-col gap-2">
                    {c.foods.map((f) => (
                      <MenuRow
                        key={f.id}
                        name={f.name}
                        calories={f.nutrients.calories}
                        imageUrl={f.imageUrl}
                        starred
                        onOpen={() => onPick(f)}
                        onStar={() => toggle(`cache:${f.id}`, () => setStar(f.id, false))}
                      />
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          )}
          {chains.length === 0 && favs.length === 0 && <p className="mt-4 px-2 text-subtle">Search a chain and/or an item, like “chipotle chicken bowl”. Star items to keep them here.</p>}
        </>
      )}

      <p className="mt-6 mb-2 flex flex-wrap gap-x-3 px-2 text-xs text-muted">
        {spoonacular && (
          <a className="underline" href="https://spoonacular.com/food-api" target="_blank" rel="noreferrer">
            Restaurant data from spoonacular.com
          </a>
        )}
        {status.sources.includes("fatsecret") && (
          <a className="underline" href="https://www.fatsecret.com" target="_blank" rel="noreferrer">
            Powered by FatSecret
          </a>
        )}
      </p>
    </Sheet>
  );
}
