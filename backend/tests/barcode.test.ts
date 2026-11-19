import { describe, expect, it } from "vitest";
import { normalizeBarcode } from "../src/lib/barcode.js";

describe("normalizeBarcode", () => {
  it("maps UPC-A, EAN-13 and typed variants to the same EAN-13", () => {
    expect(normalizeBarcode("012345678905")).toBe("0012345678905");
    expect(normalizeBarcode("0012345678905")).toBe("0012345678905");
    expect(normalizeBarcode("0-12345 67890 5")).toBe("0012345678905");
  });
  it("drops the leading 0 of a GTIN-14", () => {
    expect(normalizeBarcode("00012345678905")).toBe("0012345678905");
  });
  it("keeps EAN-8 as is", () => {
    expect(normalizeBarcode("96385074")).toBe("96385074");
  });
  it("rejects other lengths", () => {
    expect(normalizeBarcode("123")).toBeNull();
    expect(normalizeBarcode("")).toBeNull();
    expect(normalizeBarcode("12345678901")).toBeNull();
  });
  it("does not validate the check digit", () => {
    expect(normalizeBarcode("012345678900")).toBe("0012345678900");
  });
});
