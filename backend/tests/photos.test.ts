import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";
import { asUser } from "./isolation.js";
import { aiAnswers, aiSettings, offKnows, offProduct } from "./foodFakes.js";
import { barcodePhoto, junk, labelPhoto, plainPhoto, photoUpload } from "./photoFakes.js";
import { appLog, uploads } from "../src/db/schema.js";
import { cleanupUploads } from "../src/lib/photos.js";

let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
beforeEach(async () => {
  await t.reset();
  await t.login(); // admin "cory"
});
afterAll(async () => t.close());

const CODE = "4006381333931";
const label = {
  name: "Wheat crackers",
  brand: "Acme",
  category: "crackers",
  servings: [{ label: "2 crackers", grams: 30 }],
  nutrients: { calories: 140, protein_g: 3, carbs_g: 20, fat_g: 5, sodium_mg: 210 },
};
const photoAi = { ...aiSettings, services: [{ ...aiSettings.services[0], photos: true }] };

async function analyze(images: Parameters<typeof photoUpload>[0], mode?: string, token?: string) {
  const { payload, headers } = photoUpload(images, mode);
  if (token) {
    const res = await t.app.inject({ method: "POST", url: "/api/photos/analyze", payload, headers: { ...headers, authorization: `Bearer ${token}` } });
    return { status: res.statusCode, body: res.json() };
  }
  return t.api("POST", "/api/photos/analyze", payload, headers);
}

/** How many pictures the last AI call carried. */
const aiImages = () => (JSON.stringify(t.ai.calls[t.ai.calls.length - 1]?.body).match(/data:image\/jpeg;base64,/g) ?? []).length;

describe("photo analyze", () => {
  it("a barcode photo is decoded and looked up like a typed barcode", async () => {
    offKnows(t, { [CODE]: offProduct(CODE, "Crunchy bar", 400) });
    const r = await analyze([await barcodePhoto(CODE)]);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ barcode: CODE, food: { kind: "cache", name: "Crunchy bar", barcode: CODE }, errors: [], labelReading: false });
    expect(r.body.photoIds).toEqual([expect.stringMatching(/^[0-9a-f-]{36}$/)]);
    expect(r.body.draft).toBeUndefined();
    expect(t.ai.calls).toHaveLength(0);
  });

  it("a label photo is read by the photo AI into a draft, every value marked AI-estimated", async () => {
    await t.api("PUT", "/api/settings/ai", photoAi);
    aiAnswers(t, label);
    const r = await analyze([await labelPhoto()]);
    expect(r.status).toBe(200);
    const id = r.body.photoIds[0];
    expect(r.body).toMatchObject({ labelReading: true, errors: [] });
    expect(r.body.barcode).toBeUndefined();
    expect(r.body.food).toBeUndefined();
    expect(r.body.draft).toEqual({
      name: "Wheat crackers",
      brand: "Acme",
      category: "crackers",
      icon: expect.any(String),
      barcode: null,
      servings: [{ label: "2 crackers", grams: 30 }],
      nutrients: label.nutrients,
      aiFields: ["calories", "protein_g", "carbs_g", "fat_g", "sodium_mg"],
      imageUrl: `/api/photos/${id}`,
      override: false,
      source: "ai",
      photoId: id,
    });
    expect(aiImages()).toBe(1);
    expect(JSON.stringify(t.ai.calls[0].body)).toMatch(/nutrition facts label/i);
  });

  it("a barcode found nowhere: the draft carries the barcode and the AI reads the other photo", async () => {
    await t.api("PUT", "/api/settings/ai", photoAi);
    aiAnswers(t, label);
    const r = await analyze([await labelPhoto(), await barcodePhoto(CODE)]);
    expect(r.status).toBe(200);
    expect(r.body.photoIds).toHaveLength(2);
    expect(r.body).toMatchObject({ barcode: CODE, labelReading: true, draft: { barcode: CODE, name: "Wheat crackers", photoId: r.body.photoIds[0] } });
    expect(r.body.food).toBeUndefined();
    expect(aiImages()).toBe(1); // only the label

    // Only one photo: the AI reads that same one
    t.ai.calls.length = 0;
    const one = await analyze([await barcodePhoto(CODE)]);
    expect(one.body).toMatchObject({ barcode: CODE, draft: { barcode: CODE, photoId: one.body.photoIds[0] } });
    expect(aiImages()).toBe(1);
  });

  it("a barcode whose food is found wins; the label photo isn't sent to the AI", async () => {
    await t.api("PUT", "/api/settings/ai", photoAi);
    offKnows(t, { [CODE]: offProduct(CODE, "Crunchy bar", 400) });
    const r = await analyze([await labelPhoto(), await barcodePhoto(CODE)]);
    expect(r.body).toMatchObject({ barcode: CODE, food: { name: "Crunchy bar" }, labelReading: true });
    expect(r.body.draft).toBeUndefined();
    expect(t.ai.calls).toHaveLength(0);
  });

  it("mode barcode never asks the AI; mode label never decodes", async () => {
    await t.api("PUT", "/api/settings/ai", photoAi);
    aiAnswers(t, label);
    const b = await analyze([await barcodePhoto(CODE)], "barcode");
    expect(b.status).toBe(200);
    expect(b.body).toMatchObject({ barcode: CODE, labelReading: true });
    expect(b.body.draft).toBeUndefined();
    expect(t.ai.calls).toHaveLength(0);

    t.foodWeb.calls.length = 0;
    const l = await analyze([await barcodePhoto(CODE)], "label");
    expect(l.body.barcode).toBeUndefined();
    expect(l.body.draft).toMatchObject({ name: "Wheat crackers", barcode: null });
    expect(t.foodWeb.calls).toHaveLength(0);

    expect((await analyze([await labelPhoto()], "selfie")).status).toBe(400);
  });

  it("without an AI service that reads photos: labelReading false and no AI call; barcodes still work", async () => {
    await t.api("PUT", "/api/settings/ai", aiSettings); // AI on, but it can't see pictures
    const r = await analyze([await labelPhoto()]);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ labelReading: false, errors: [] });
    expect(r.body.draft).toBeUndefined();
    expect(t.ai.calls).toHaveLength(0);
    expect((await t.api("GET", "/api/ai/status")).body.photos).toBe(false);
  });

  it("an AI that can't read the label: no draft, a plain error, the photos are still kept", async () => {
    await t.api("PUT", "/api/settings/ai", photoAi);
    aiAnswers(t, { nothing: "here" });
    const r = await analyze([await labelPhoto()]);
    expect(r.status).toBe(200);
    expect(r.body.draft).toBeUndefined();
    expect(r.body.photoIds).toHaveLength(1);
    expect(r.body.errors).toEqual([{ source: "ai", message: expect.stringMatching(/couldn't read/i) }]);
  });

  it("refuses non-images, too-big files, too many photos and none at all", async () => {
    const notImage = await analyze([{ data: Buffer.from("hello, not a picture"), type: "text/plain", filename: "a.txt" }]);
    expect([notImage.status, notImage.body.error]).toEqual([400, "Use a JPEG or PNG photo"]);
    const fakeJpeg = await analyze([junk(5000)]); // says JPEG, isn't one
    expect([fakeJpeg.status, fakeJpeg.body.error]).toEqual([400, "Use a JPEG or PNG photo"]);
    // An iPhone HEIC photo (sharp's build can't decode HEVC): told plainly, never a crash
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic"), Buffer.from([0, 0, 0, 0]), Buffer.from("mif1heic"), junk(4000)]);
    const iphone = await analyze([{ data: heic, type: "image/heic", filename: "IMG_0001.HEIC" }]);
    expect([iphone.status, iphone.body.error]).toEqual([400, "Use a JPEG or PNG photo"]);
    const big = await analyze([junk(12 * 1024 * 1024 + 1)]);
    expect([big.status, big.body.error]).toEqual([413, "Each photo must be 12 MB or less"]);
    const huge = await analyze([junk(9 * 1024 * 1024), junk(9 * 1024 * 1024), junk(9 * 1024 * 1024)]); // 27 MB in all
    expect([huge.status, huge.body.error]).toEqual([413, "Send at most 25 MB of photos at a time"]);
    const img = await labelPhoto();
    const three = await analyze([img, img, img]);
    expect([three.status, three.body.error]).toEqual([400, "Send at most 2 photos"]);
    const none = await analyze([], "auto");
    expect([none.status, none.body.error]).toEqual([400, "Add a photo"]);
    const json = await t.api("POST", "/api/photos/analyze", { images: [] });
    expect(json.status).toBe(400);
    // Nothing was kept from any refused upload
    expect(await t.db.select().from(uploads)).toEqual([]);
  });

  it("normalises photos: turned upright, at most 1600 px, JPEG, kept under the person's own folder", async () => {
    const me = (await t.api("GET", "/api/auth/me")).body.user;
    // A sideways phone photo: stored 3200×1600 with "rotate 90°" in EXIF
    const r = await analyze([await plainPhoto(3200, 1600, { orientation: 6 }), { data: await plainPhoto(500, 300, { format: "png" }), type: "image/png", filename: "x.png" }]);
    expect(r.status).toBe(200);
    const [a, b] = r.body.photoIds;
    const got = await t.app.inject({ method: "GET", url: `/api/photos/${a}`, headers: { authorization: `Bearer ${t.getToken()}` } });
    expect(got.statusCode).toBe(200);
    expect(got.headers["content-type"]).toBe("image/jpeg");
    const meta = await sharp(got.rawPayload).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 800, 1600]);
    expect(meta.orientation ?? 1).toBe(1);
    const small = await sharp((await t.app.inject({ method: "GET", url: `/api/photos/${b}`, headers: { authorization: `Bearer ${t.getToken()}` } })).rawPayload).metadata();
    expect([small.format, small.width, small.height]).toEqual(["jpeg", 500, 300]); // never enlarged
    expect(readdirSync(path.join(t.app.dataDir, "uploads", String(me.id))).sort()).toEqual([`${a}.jpg`, `${b}.jpg`].sort());
  });
});

describe("photo serving and linking", () => {
  it("only the owner gets a photo; anyone else, or a made-up id, gets 404", async () => {
    const id = (await analyze([await labelPhoto()])).body.photoIds[0];
    expect((await t.api("GET", `/api/photos/${id}`)).status).toBe(200);
    const sam = await t.createUser("sam");
    const as = asUser(t, sam.token);
    expect((await as("GET", `/api/photos/${id}`)).status).toBe(404);
    expect((await t.api("GET", `/api/photos/00000000-0000-4000-8000-000000000000`)).status).toBe(404);
    expect((await t.api("GET", `/api/photos/not-a-uuid`)).status).toBe(404);
    expect((await t.api("GET", `/api/photos/..%2F..%2Fetc%2Fpasswd`)).status).toBe(404);
    t.setToken("");
    expect((await t.api("GET", `/api/photos/${id}`)).status).toBe(401);
  });

  it("saving a food with photoId links the photo; search and the food show it", async () => {
    const [id, id2] = (await analyze([await labelPhoto(), await labelPhoto()])).body.photoIds;
    const saved = await t.api("POST", "/api/my-foods", { ...label, photoId: id });
    expect(saved.status).toBe(200);
    expect(saved.body.food.imageUrl).toBe(`/api/photos/${id}`);
    const s = await t.api("GET", "/api/foods/search?q=wheat crackers");
    expect(s.body.groups[0].foods[0]).toMatchObject({ id: saved.body.food.id, imageUrl: `/api/photos/${id}` });
    const [row] = await t.db.select().from(uploads).where(eq(uploads.id, id));
    expect(row.linkedAt).toBeInstanceOf(Date);

    // A photo already linked to one food can't be used for another; the same food may keep it
    const other = await t.api("POST", "/api/my-foods", { ...label, name: "Other", photoId: id });
    expect([other.status, other.body.error]).toEqual([400, "That photo isn't available"]);
    const same = await t.api("PATCH", `/api/my-foods/${saved.body.food.id}`, { name: "Wheat crackers (box)", photoId: id });
    expect(same.status).toBe(200);
    expect(same.body.food.imageUrl).toBe(`/api/photos/${id}`);
    const swapped = await t.api("PATCH", `/api/my-foods/${saved.body.food.id}`, { photoId: id2 });
    expect(swapped.body.food.imageUrl).toBe(`/api/photos/${id2}`);
    // A food that was logged keeps its photo link, so the old photo stays available
    expect((await t.api("GET", `/api/photos/${id}`)).status).toBe(200);

    const bad = await t.api("POST", "/api/my-foods", { ...label, name: "Ghost", photoId: "00000000-0000-4000-8000-000000000000" });
    expect([bad.status, bad.body.error]).toEqual([400, "That photo isn't available"]);
    expect((await t.api("POST", "/api/my-foods", { ...label, name: "Junk", photoId: "nope" })).status).toBe(400);
  });

  it("another person's photoId is refused on save", async () => {
    const sam = await t.createUser("sam");
    const theirs = (await analyze([await labelPhoto()], undefined, sam.token)).body.photoIds[0];
    const r = await t.api("POST", "/api/my-foods", { ...label, photoId: theirs });
    expect([r.status, r.body.error]).toEqual([400, "That photo isn't available"]);
    const mine = await t.api("POST", "/api/my-foods", label);
    const p = await t.api("PATCH", `/api/my-foods/${mine.body.food.id}`, { photoId: theirs });
    expect([p.status, p.body.error]).toEqual([400, "That photo isn't available"]);
  });
});

describe("photo cleanup", () => {
  it("deletes unlinked photos older than 24 hours (file and row) and keeps linked and recent ones", async () => {
    const me = (await t.api("GET", "/api/auth/me")).body.user;
    const dir = path.join(t.app.dataDir, "uploads", String(me.id));
    t.clock.date = new Date("2026-11-10T08:00:00Z");
    const [oldUnused, oldLinked] = (await analyze([await labelPhoto(), await labelPhoto()])).body.photoIds;
    await t.api("POST", "/api/my-foods", { ...label, photoId: oldLinked });
    t.clock.date = new Date("2026-11-11T07:30:00Z");
    const [recent] = (await analyze([await labelPhoto()])).body.photoIds;

    t.clock.date = new Date("2026-11-11T08:30:00Z"); // 24.5 h after the first two
    expect(await cleanupUploads(t.app)).toBe(1);
    expect(existsSync(path.join(dir, `${oldUnused}.jpg`))).toBe(false);
    expect(existsSync(path.join(dir, `${oldLinked}.jpg`))).toBe(true);
    expect(existsSync(path.join(dir, `${recent}.jpg`))).toBe(true);
    const left = (await t.db.select().from(uploads)).map((u) => u.id).sort();
    expect(left).toEqual([oldLinked, recent].sort());
    expect((await t.api("GET", `/api/photos/${oldUnused}`)).status).toBe(404);
    const logs = await t.db.select().from(appLog).where(eq(appLog.category, "schedule"));
    expect(logs).toEqual([expect.objectContaining({ level: "info", event: expect.stringMatching(/1 unused photo/) })]);

    // Nothing to do: nothing deleted, nothing logged
    expect(await cleanupUploads(t.app)).toBe(0);
    expect(await t.db.select().from(appLog).where(eq(appLog.category, "schedule"))).toHaveLength(1);
  });

  it("a missing file doesn't stop the cleanup", async () => {
    t.clock.date = new Date("2026-11-10T08:00:00Z");
    const [id] = (await analyze([await labelPhoto()])).body.photoIds;
    const me = (await t.api("GET", "/api/auth/me")).body.user;
    const { unlinkSync } = await import("node:fs");
    unlinkSync(path.join(t.app.dataDir, "uploads", String(me.id), `${id}.jpg`));
    t.clock.date = new Date("2026-11-12T08:00:00Z");
    expect(await cleanupUploads(t.app)).toBe(1);
    expect(await t.db.select().from(uploads)).toEqual([]);
  });
});
