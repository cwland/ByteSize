import type { LogEntry, Meal, Portion } from "./types";

// §28: the server grows an entry when the same food is added to its meal again, and answers with what it did
// (POST /api/log: combined; /api/log/meal and /api/log/move: combined[]). Whoever logs passes the answer to
// announceCombined; the note (CombinedNote, in the app shell) says so and offers Undo, which sends only the
// combine's id (POST /api/log/combines/:id/undo): the server splits back what it recorded when combining.
export type Combined = { id: number; entry: LogEntry; before: Portion; added: Portion; splitTo: { day: string; meal: Meal } };

const EVENT = "bytesize:combined";
export function announceCombined(out: { combined?: Combined | Combined[] } | null | undefined) {
  const c = out?.combined;
  const list = !c ? [] : Array.isArray(c) ? c : [c];
  if (list.length) window.dispatchEvent(new CustomEvent<Combined[]>(EVENT, { detail: list }));
}
export const onCombined = (on: (list: Combined[]) => void) => {
  const handler = (e: Event) => on((e as CustomEvent<Combined[]>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
};
