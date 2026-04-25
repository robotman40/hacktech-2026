/**
 * Rebuilds hacktech-demo.avif and hacktech-demo.webp from public/hacktech-demo.png.
 * Run after replacing the PNG: npm run optimize:demo
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public");
const input = join(publicDir, "hacktech-demo.png");

if (!existsSync(input)) {
  console.error("Missing", input);
  process.exit(1);
}

const buf = readFileSync(input);
const base = sharp(buf).ensureAlpha();
const meta = await sharp(buf).metadata();

const avif = await base
  .clone()
  .avif({ quality: 100, lossless: true, effort: 9 })
  .toBuffer();
const webp = await base
  .clone()
  .webp({ lossless: true, effort: 6 })
  .toBuffer();

writeFileSync(join(publicDir, "hacktech-demo.avif"), avif);
writeFileSync(join(publicDir, "hacktech-demo.webp"), webp);
console.log(
  `Wrote hacktech-demo.avif (${avif.length} B), hacktech-demo.webp (${webp.length} B) from ${meta.width}×${meta.height} PNG.`
);
