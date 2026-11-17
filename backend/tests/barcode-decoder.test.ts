// The barcode decoder (zxing-wasm) failing to load or to read: "No barcode found" must have a visible
// cause in Settings › Logs, logged once, and a failed load is tried again next time.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";
import { appLog } from "../src/db/schema.js";

const zxing = vi.hoisted(() => ({ prepareZXingModule: vi.fn(), readBarcodes: vi.fn() }));
vi.mock("zxing-wasm/reader", () => zxing);

let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
beforeEach(async () => {
  await t.reset();
  vi.resetModules(); // a fresh decoder (not loaded, nothing logged yet) for each test
  zxing.prepareZXingModule.mockReset();
  zxing.readBarcodes.mockReset();
});
afterAll(async () => t.close());

const decoderLogs = () => t.db.select().from(appLog).where(eq(appLog.source, "Barcode reader"));
const photo = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

describe("barcode decoder", () => {
  it("a decoder that fails to load is logged once, finds no barcode, and is loaded again next time", async () => {
    const { decodeBarcode } = await import("../src/lib/photos.js");
    zxing.prepareZXingModule.mockRejectedValue(new Error("wasm compile failed"));
    expect(await decodeBarcode(photo, { db: t.db, userId: null })).toBeNull();
    expect(await decodeBarcode(photo, { db: t.db, userId: null })).toBeNull();
    expect(zxing.prepareZXingModule).toHaveBeenCalledTimes(2); // not marked ready after a failed load
    expect(zxing.readBarcodes).not.toHaveBeenCalled();
    const logs = await decoderLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ category: "food", level: "error", event: "The barcode reader couldn't start" });
    expect(logs[0].detail).toContain("wasm compile failed");

    // Once it loads, it's loaded for good
    zxing.prepareZXingModule.mockResolvedValue({});
    zxing.readBarcodes.mockResolvedValue([{ isValid: true, format: "EAN13", text: "4006381333931" }]);
    expect(await decodeBarcode(photo, { db: t.db, userId: null })).toBe("4006381333931");
    expect(await decodeBarcode(photo, { db: t.db, userId: null })).toBe("4006381333931");
    expect(zxing.prepareZXingModule).toHaveBeenCalledTimes(3);
  });

  it("a decoder that fails while reading is logged once", async () => {
    const { decodeBarcode } = await import("../src/lib/photos.js");
    zxing.prepareZXingModule.mockResolvedValue({});
    zxing.readBarcodes.mockRejectedValue(new Error("memory access out of bounds"));
    expect(await decodeBarcode(photo, { db: t.db, userId: null })).toBeNull();
    expect(await decodeBarcode(photo, { db: t.db, userId: null })).toBeNull();
    const logs = await decoderLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ category: "food", level: "warning", event: "The barcode reader couldn't read a photo" });
    expect(logs[0].detail).toContain("memory access out of bounds");
  });
});
