// Makes the web app's icons from logo.jpg: the large avocado, cropped and centered on the
// logo's dark background. Run from the repo root: node scripts/make-icons.mjs
// (sharp comes from the backend's dependencies)
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "backend", "package.json"));
const sharp = require("sharp");

const SOURCE = path.join(root, "logo.jpg");
const OUT = path.join(root, "frontend", "public");
const CROP = { left: 292, top: 23, width: 210, height: 210 }; // the large avocado
const BACKGROUND = "#3c424e";
const SIZES = { "favicon-32.png": 32, "apple-touch-icon.png": 180, "icon-192.png": 192, "icon-512.png": 512 };

const avocado = await sharp(SOURCE).extract(CROP).flatten({ background: BACKGROUND }).png().toBuffer();
for (const [name, size] of Object.entries(SIZES)) {
  // nearest-neighbor keeps the pixel-art edges crisp
  await sharp(avocado).resize(size, size, { kernel: "nearest", fit: "contain", background: BACKGROUND }).flatten({ background: BACKGROUND }).png().toFile(path.join(OUT, name));
  console.log(`frontend/public/${name} (${size}×${size})`);
}
