import type { FastifyInstance, FastifyRequest } from "fastify";
import multipart from "@fastify/multipart";
import { z } from "zod";
import { requireUser } from "../lib/guards.js";
import { AiError, LABEL_ASK, LABEL_SYSTEM, PLATE_ASK, PLATE_SYSTEM } from "../lib/ai.js";
import { logEvent } from "../lib/appLog.js";
import { HttpError, badRequest } from "../lib/errors.js";
import { countUsage } from "../lib/usage.js";
import { aiDraft, estimateItems, MAX_PHOTO_SERVINGS, lookupBarcode, type AiDraft, type EstimateItem, type FoodResult, type SearchResult } from "../lib/foods.js";
import { MAX_PHOTOS, MAX_PHOTO_BYTES, MAX_REQUEST_BYTES, decodeBarcode, normalisePhoto, photoUrl, readPhoto, signImageUrl, storePhoto } from "../lib/photos.js";

export type PhotoDraft = AiDraft & { photoId: string };
export type AnalyzeResult = {
  photoIds: string[];
  barcode?: string;
  food?: FoodResult;
  draft?: PhotoDraft;
  errors: SearchResult["errors"];
  labelReading: boolean; // false: no AI service reads photos, so labels aren't read
  plate?: { items: EstimateItem[] }; // mode "plate": the foods the photo AI saw, to adjust before logging
};

const TOO_BIG = "Each photo must be 12 MB or less";
const TOO_MANY = "Send at most 2 photos";
const UNREADABLE = "That upload couldn't be read";
const NO_LABEL = "The AI couldn't read a nutrition label in that photo. Try a clearer photo, or enter the food yourself.";
const modeField = z.enum(["auto", "barcode", "label", "plate"]);
const NO_PLATE = "Couldn't make out the food in that photo";

/** The uploaded images (as sent) and the mode. Too big, too many or not a form upload → 4xx. */
async function readUpload(req: FastifyRequest): Promise<{ images: Buffer[]; mode: z.infer<typeof modeField> }> {
  if (!req.isMultipart()) throw badRequest("Send the photos as a form upload");
  const images: Buffer[] = [];
  let mode = "auto";
  let parts = 0;
  try {
    for await (const part of req.parts()) {
      parts++;
      if (part.type === "file") {
        if (part.fieldname !== "images") {
          part.file.resume(); // not ours: skipped
          continue;
        }
        images.push(await part.toBuffer());
      } else if (part.fieldname === "mode") {
        mode = String(part.value);
      }
    }
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "FST_REQ_FILE_TOO_LARGE") throw new HttpError(413, TOO_BIG);
    if (code === "FST_FILES_LIMIT") throw badRequest(TOO_MANY);
    if (code === "FST_PARTS_LIMIT" || code === "FST_FIELDS_LIMIT") throw badRequest("That upload has too many parts");
    // Anything else while reading the form (cut short, a boundary that doesn't match...) is the upload's fault
    throw badRequest(UNREADABLE);
  }
  if (!parts) throw badRequest(UNREADABLE); // nothing in it could be read (e.g. a boundary that doesn't match)
  if (!images.length) throw badRequest("Add a photo");
  return { images, mode: modeField.parse(mode) };
}

// Photo upload: a barcode is decoded on the server and looked up; a nutrition label is read by the
// first AI service that can see pictures, as a draft (nothing is saved until the person taps Save).
export default async function photoRoutes(app: FastifyInstance) {
  await app.register(multipart, {
    limits: { fileSize: MAX_PHOTO_BYTES, files: MAX_PHOTOS, fields: 4, fieldSize: 100, parts: MAX_PHOTOS + 4, headerPairs: 50 },
  });

  app.post("/api/photos/analyze", async (req): Promise<AnalyzeResult> => {
    const userId = requireUser(req);
    if (Number(req.headers["content-length"] ?? 0) > MAX_REQUEST_BYTES) throw new HttpError(413, "Send at most 25 MB of photos at a time");
    const { images, mode } = await readUpload(req);

    // Every photo upright, ≤1600 px, JPEG, before anything else (one that isn't a picture stops it all)
    const normalised: Buffer[] = [];
    for (const img of images) normalised.push(await normalisePhoto(img, { db: app.db, userId }));
    countUsage(app, userId, "photos_read", normalised.length);
    const stored: { id: string; path: string }[] = [];
    for (const jpeg of normalised) stored.push(await storePhoto(app, userId, jpeg));
    const photoIds = stored.map((s) => s.id);
    const labelReading = !!(await app.ai.active("photo"));
    const errors: SearchResult["errors"] = [];

    // A plate of food (iPhone app): the photo AI lists what it sees, with amounts; nothing is saved
    if (mode === "plate") {
      if (!labelReading) return { photoIds, errors, labelReading };
      let items: EstimateItem[] = [];
      try {
        const { json } = await app.ai.ask("photo", PLATE_SYSTEM, PLATE_ASK, {
          userId,
          maxTokens: 4000,
          reasoning: "low",
          images: [{ mime: "image/jpeg", base64: normalised[0].toString("base64") }],
        });
        items = estimateItems(json, { maxQuantity: MAX_PHOTO_SERVINGS });
        if (!items.length) {
          await logEvent(app.db, { category: "ai", level: "warning", source: "Plate photo", event: "The AI's plate reading couldn't be used", detail: JSON.stringify(json).slice(0, 600), userId });
        }
      } catch (err) {
        if (!(err instanceof AiError)) throw err;
        errors.push({ source: "ai", message: err.message });
      }
      if (!items.length && !errors.length) errors.push({ source: "ai", message: NO_PLATE });
      return { photoIds, plate: { items }, errors, labelReading };
    }

    // Barcode: every photo is tried; the first barcode wins and is looked up like a typed one
    let barcode: string | undefined;
    let barcodeAt = -1;
    if (mode !== "label") {
      for (const [i, jpeg] of normalised.entries()) {
        const code = await decodeBarcode(jpeg, { db: app.db, userId });
        if (code) {
          [barcode, barcodeAt] = [code, i];
          break;
        }
      }
    }
    if (barcode) {
      const hit = await lookupBarcode(app, userId, barcode);
      errors.push(...hit.errors);
      if (hit.food) return { photoIds, barcode, food: hit.food, errors, labelReading };
    }
    if (mode === "barcode" || !labelReading) return { photoIds, ...(barcode ? { barcode } : {}), errors, labelReading };

    // Label: the photos without the barcode (or the barcode photo itself when it's the only one)
    let labelAt = normalised.map((_, i) => i).filter((i) => i !== barcodeAt);
    if (!labelAt.length) labelAt = [barcodeAt];
    let draft: AiDraft | null = null;
    try {
      const { json } = await app.ai.ask("photo", LABEL_SYSTEM, LABEL_ASK, {
        userId,
        maxTokens: 4000, // room for models that think first, asked to think only a little
        reasoning: "low",
        images: labelAt.map((i) => ({ mime: "image/jpeg", base64: normalised[i].toString("base64") })),
      });
      draft = aiDraft(json);
      if (!draft) {
        await logEvent(app.db, { category: "ai", level: "warning", source: "Label reading", event: "The AI's label reading couldn't be used", detail: JSON.stringify(json).slice(0, 600), userId });
        errors.push({ source: "ai", message: NO_LABEL });
      }
    } catch (err) {
      if (!(err instanceof AiError)) throw err;
      errors.push({ source: "ai", message: err.message });
    }
    const photo = stored[labelAt[0]];
    return {
      photoIds,
      ...(barcode ? { barcode } : {}),
      ...(draft ? { draft: { ...draft, barcode: barcode ?? null, imageUrl: signImageUrl(photoUrl(photo.path)), photoId: photo.id } } : {}),
      errors,
      labelReading,
    };
  });

  app.get("/api/photos/:id", async (req, reply) => {
    // Public route: the owner's login, or the signature in the URL (an <img>)
    const jpeg = await readPhoto(app, { userId: req.auth?.userId ?? null, sig: (req.query as { sig?: unknown }).sig }, String((req.params as { id: string }).id));
    if (!jpeg) throw new HttpError(404, "Photo not found");
    return reply.type("image/jpeg").header("cache-control", "private, max-age=31536000, immutable").send(jpeg);
  });
}
