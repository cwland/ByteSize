import { describe, expect, it } from "vitest";
import { iconFor } from "../src/lib/foodIcons.js";

describe("iconFor", () => {
  it("picks an icon from the category", () => {
    expect(iconFor("en:cheeses")).toBe("🧀");
  });
  it("falls back to the name", () => {
    expect(iconFor(null, "Hard salami 6 slices")).toBe("🥓");
  });
  it("uses the default when nothing matches", () => {
    expect(iconFor("en:unknown-stuff", "Mystery")).toBe("🍽️");
    expect(iconFor(undefined)).toBe("🍽️");
  });
  it("prefers specific keywords over general ones", () => {
    expect(iconFor("en:ice-creams")).toBe("🍨");
    expect(iconFor("en:wines")).toBe("🍷");
    expect(iconFor("en:orange-juices")).toBe("🧃");
    expect(iconFor("en:shrimps")).toBe("🦐");
    expect(iconFor("en:peanut-butters")).toBe("🥜");
  });
  it("the name wins over a broad category (a banana filed under plant-based foods and beverages is 🍌, not 🥤)", () => {
    expect(iconFor("Plant-based foods and beverages, Plant-based foods, Fruits based foods, Fruits, Bananas", "Banana")).toBe("🍌");
    expect(iconFor("en:plant-based-foods-and-beverages", "Organic bananas")).toBe("🍌");
  });
  it("the category still decides when the name says nothing", () => {
    expect(iconFor("en:cheeses", "Original")).toBe("🧀");
  });
});
