import { describe, expect, it } from "vitest";
import { addWidget, defaultLayout, dropIndex, fromSaved, moveSideways, moveTo, moveVertical, readingOrder, removeWidget, type LayoutWidget } from "./layout";

// A small registry, as the real one is shaped: id and default column (newDefault: the layout version it joined everyone's dashboard in)
const reg: LayoutWidget[] = [
  { id: "food", column: 0 },
  { id: "budget", column: 1 },
  { id: "water", column: 1 },
  { id: "totals", column: 2 },
  { id: "streak", column: 2 },
];

describe("dashboard layout", () => {
  it("the default puts each widget in its column, in registry order", () => {
    expect(defaultLayout(reg)).toEqual([["food"], ["budget", "water"], ["totals", "streak"]]);
  });

  it("a saved layout: unknown ids and repeats dropped, always three columns; none saved is the default", () => {
    expect(fromSaved(null, reg)).toEqual(defaultLayout(reg));
    expect(fromSaved({ version: 1, columns: [["streak", "gone", "food"], ["streak"]] }, reg)).toEqual([["streak", "food"], [], []]);
    expect(fromSaved({ version: 1, columns: [[], [], [], ["food"]] }, reg)).toEqual([[], [], []]);
  });

  it("a widget only offered on a page (no default column) isn't in its default, nor forced into a saved layout", () => {
    const offered: LayoutWidget[] = [...reg, { id: "goal-date", column: null }, { id: "later", column: null, newDefault: 2 }];
    expect(defaultLayout(offered)).toEqual(defaultLayout(reg));
    expect(fromSaved({ version: 1, columns: [["goal-date"], [], []] }, offered)).toEqual([["goal-date"], [], []]);
  });

  it("widgets added later wait in the Add widget list, unless marked new default for a newer layout version", () => {
    const later = [...reg, { id: "fasting", column: 1 }, { id: "steps", column: 2, newDefault: 2 }];
    expect(fromSaved({ version: 1, columns: [["food"], [], []] }, later)).toEqual([["food"], [], ["steps"]]);
    // already saved with version 2: the person chose; it isn't forced back
    expect(fromSaved({ version: 2, columns: [["food"], [], []] }, later)).toEqual([["food"], [], []]);
  });

  it("reading order: left column top to bottom, then middle, then right", () => {
    expect(readingOrder([["a", "b"], ["c"], ["d", "e"]])).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("Move up / down: one place in reading order — past the widget before (or after) it, in that widget's column", () => {
    const cols = [["food"], ["budget", "water"], ["totals"]];
    expect(moveVertical(cols, "water", -1)).toEqual([["food"], ["water", "budget"], ["totals"]]);
    expect(moveVertical(cols, "budget", -1)).toEqual([["budget", "food"], ["water"], ["totals"]]);
    expect(moveVertical(cols, "water", 1)).toEqual([["food"], ["budget"], ["totals", "water"]]);
    // first and last stay put
    expect(moveVertical(cols, "food", -1)).toEqual(cols);
    expect(moveVertical(cols, "totals", 1)).toEqual(cols);
    // the reading order moves by one each time, past empty columns too
    expect(readingOrder(moveVertical([["a"], [], ["b"]], "b", -1))).toEqual(["b", "a"]);
  });

  it("Move left / right: to the next column at the same height (or its end)", () => {
    const cols = [["food"], ["budget", "water"], ["totals"]];
    expect(moveSideways(cols, "water", 1)).toEqual([["food"], ["budget"], ["totals", "water"]]);
    expect(moveSideways(cols, "budget", -1)).toEqual([["budget", "food"], ["water"], ["totals"]]);
    expect(moveSideways(cols, "food", -1)).toEqual(cols);
    expect(moveSideways(cols, "totals", 1)).toEqual(cols);
  });

  it("drag and drop: to any column and place, empty columns included", () => {
    const cols = [["food"], ["budget", "water"], []];
    expect(moveTo(cols, "food", 2, 0)).toEqual([[], ["budget", "water"], ["food"]]);
    expect(moveTo(cols, "budget", 1, 2)).toEqual([["food"], ["water", "budget"], []]); // the end of its own column
    expect(moveTo(cols, "water", 0, 0)).toEqual([["water", "food"], ["budget"], []]);
  });

  it("remove, and Add widget puts it at the bottom of the shortest column (leftmost on a tie)", () => {
    const cols = removeWidget([["food"], ["budget", "water"], ["totals", "streak"]], "food");
    expect(cols).toEqual([[], ["budget", "water"], ["totals", "streak"]]);
    expect(addWidget(cols, "food")).toEqual([["food"], ["budget", "water"], ["totals", "streak"]]);
    expect(addWidget([["a"], [], []], "b")).toEqual([["a"], ["b"], []]);
    expect(addWidget([["a"], ["b"], ["c"]], "d")).toEqual([["a", "d"], ["b"], ["c"]]);
  });

  it("where a dragged widget lands: below every card whose middle is above the pointer", () => {
    const cards = [
      { top: 0, height: 100 },
      { top: 116, height: 40 },
    ];
    expect(dropIndex(cards, -5)).toBe(0);
    expect(dropIndex(cards, 49)).toBe(0);
    expect(dropIndex(cards, 51)).toBe(1);
    expect(dropIndex(cards, 200)).toBe(2);
    expect(dropIndex([], 10)).toBe(0);
  });
});
