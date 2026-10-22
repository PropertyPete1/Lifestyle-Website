/**
 * Local timing of the Builder Deals photo pipeline's CPU stages on synthetic
 * listing-sized photos (no network, no database, no storage):
 *   pnpm exec tsx scripts/bench-deal-photos.mts [photos]
 * Prints per-stage cost, then whole-photo throughput with 1 to 3 lanes (OCR is
 * one worker and serialized, as in production), and the process's peak RSS.
 * Download and storage latency are not included; on the host they overlap with
 * the other lane's CPU work.
 */
import sharp from "sharp";
import { closeDealPhotoOcrWorker, createLimiter, makeDealPhotoMaster, normalizeDealPhotoOriginal, recognizeDealPhotoWords } from "../server/dealsPhotos";

const count = Number(process.argv[2] ?? 8);

async function syntheticListingPhoto(seed: number, width = 2400, height = 1600) {
  // Photographic-ish content: gradient sky, a house with windows, film-grain noise and a logo strip.
  const noise = Buffer.alloc(width * height * 3);
  let state = seed * 2654435761;
  for (let i = 0; i < noise.length; i++) { state = (state * 1103515245 + 12345) >>> 0; noise[i] = (state >>> 24) & 0x1f; }
  const grain = await sharp(noise, { raw: { width, height, channels: 3 } }).png().toBuffer();
  const windows = Array.from({ length: 12 }, (_, i) => `<rect x="${500 + (i % 6) * 230}" y="${700 + Math.floor(i / 6) * 260}" width="140" height="160" fill="#2b3a4a"/>`).join("");
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7fb3e6"/><stop offset="1" stop-color="#e8f1f8"/></linearGradient></defs>
    <rect width="${width}" height="${height}" fill="url(#g)"/>
    <rect x="400" y="560" width="1600" height="800" fill="#b08968"/>${windows}
    <polygon points="350,580 1200,200 2050,580" fill="#5a4636"/>
    <rect x="0" y="${height - 160}" width="${width}" height="160" fill="#3f6b2f"/>
    <text x="80" y="${height - 50}" font-family="Arial" font-size="72" font-weight="700" fill="#ffffff">Sample Homes ${seed}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).composite([{ input: grain, blend: "overlay" }]).jpeg({ quality: 85 }).toBuffer();
}

const ms = (start: number) => performance.now() - start;
let peakRss = 0;
const sampler = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 10);
const region = { x: 0, y: 88, width: 100, height: 12 };

const inputs: Buffer[] = [];
for (let i = 0; i < count; i++) inputs.push(await syntheticListingPhoto(i + 1));
console.log(`${count} synthetic photos, 2400x1600 JPEG ~${Math.round(inputs[0].byteLength / 1024)} KB`);
let t = performance.now();
await recognizeDealPhotoWords(await sharp({ create: { width: 64, height: 48, channels: 3, background: "#fff" } }).png().toBuffer());
console.log(`OCR worker start ${ms(t).toFixed(0)} ms (once per process)`);

// Stage costs, one photo at a time.
const stage = { normalize: 0, master: 0, ocr: 0, ocrWebpInput: 0 };
for (const input of inputs) {
  t = performance.now(); const original = await normalizeDealPhotoOriginal(input); stage.normalize += ms(t);
  t = performance.now(); const master = await makeDealPhotoMaster(original, { region }); stage.master += ms(t);
  t = performance.now(); await recognizeDealPhotoWords(master.data); stage.ocr += ms(t);
}
for (const [name, total] of Object.entries(stage)) if (total) console.log(`  ${name.padEnd(10)} ${(total / count).toFixed(0)} ms/photo`);

// Whole photos through 1-3 lanes.
for (const lanes of [1, 2, 3]) {
  const limit = createLimiter(lanes);
  const start = performance.now();
  await Promise.all(inputs.map((input) => limit(async () => {
    const original = await normalizeDealPhotoOriginal(input);
    const master = await makeDealPhotoMaster(original, { region });
    await recognizeDealPhotoWords(master.data);
  })));
  const perPhoto = ms(start) / count;
  console.log(`${lanes} lane(s): ${perPhoto.toFixed(0)} ms/photo wall -> ${Math.round(3_600_000 / perPhoto)} photos/hour of busy time, ${Math.round(20_000 / perPhoto)} per 20-second call`);
}
clearInterval(sampler);
console.log(`peak RSS ${(peakRss / 1024 / 1024).toFixed(0)} MB (includes the tsx loader and the OCR worker)`);
await closeDealPhotoOcrWorker();
process.exit(0);
