// Test photos made on the spot (no downloads): a barcode drawn with zxing-wasm's writer, a "label"
// and plain pictures drawn with sharp, and a multipart body builder for uploads.
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { prepareZXingModule, writeBarcode } from "zxing-wasm/writer";
import { wasmBinary } from "../src/lib/photos.js";

let ready = false;

/** A photo of an EAN-13 barcode (white margin around it), as a JPEG. */
export async function barcodePhoto(code: string): Promise<Buffer> {
  if (!ready) {
    prepareZXingModule({ overrides: { wasmBinary: wasmBinary("writer") } });
    ready = true;
  }
  const w = await writeBarcode(code, { format: "EAN13", scale: 4 });
  if (w.error) throw new Error(w.error);
  return sharp(Buffer.from(w.svg)).flatten({ background: "#fff" }).extend({ top: 80, bottom: 80, left: 80, right: 80, background: "#fff" }).jpeg().toBuffer();
}

/** A nutrition label (text only: the fake AI does the reading), as a JPEG. */
export async function labelPhoto(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#fff"/>
    <text x="20" y="50" font-size="32" font-family="sans-serif">Nutrition Facts</text>
    <text x="20" y="110" font-size="22" font-family="sans-serif">Serving size 2 crackers (30g)</text>
    <text x="20" y="160" font-size="22" font-family="sans-serif">Calories 140</text></svg>`;
  return sharp(Buffer.from(svg)).jpeg().toBuffer();
}

/** A plain picture of the given size (noise, so it isn't trivially small). orientation = EXIF rotation tag. */
export async function plainPhoto(width: number, height: number, opts: { format?: "jpeg" | "png"; orientation?: number } = {}): Promise<Buffer> {
  let img = sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } } });
  if (opts.format === "png") return img.png().toBuffer();
  img = img.jpeg();
  if (opts.orientation) img = img.withMetadata({ orientation: opts.orientation });
  return img.toBuffer();
}

/** Random bytes of the given size (not an image). */
export const junk = (bytes: number) => randomBytes(bytes);

type Part = { name: string; value: string } | { name: string; filename: string; type: string; data: Buffer };

/** A multipart/form-data body and its content-type header. */
export function multipart(parts: Part[]): { payload: Buffer; headers: Record<string, string> } {
  const boundary = "----bytesize" + randomBytes(8).toString("hex");
  const chunks: Buffer[] = [];
  for (const p of parts) {
    if ("value" in p) {
      chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"\r\n\r\n${p.value}\r\n`));
    } else {
      chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"; filename="${p.filename}"\r\nContent-Type: ${p.type}\r\n\r\n`), p.data, Buffer.from("\r\n"));
    }
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

/** The analyze upload: images (JPEG unless named) and an optional mode. */
export function photoUpload(images: (Buffer | { data: Buffer; type: string; filename?: string })[], mode?: string) {
  const parts: Part[] = images.map((img, i) => (Buffer.isBuffer(img) ? { name: "images", filename: `photo${i}.jpg`, type: "image/jpeg", data: img } : { name: "images", filename: img.filename ?? `photo${i}`, type: img.type, data: img.data }));
  if (mode) parts.push({ name: "mode", value: mode });
  return multipart(parts);
}
