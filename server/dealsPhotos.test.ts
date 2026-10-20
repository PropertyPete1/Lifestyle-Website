import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import {
  closeDealPhotoOcrWorker,
  createLimiter,
  dealPhotoHouseNumber,
  dealPhotoRenderCacheVersion,
  findDealPhotoHideMatches,
  findExactOcrMatches,
  makeDealPhotoMaster,
  normalizeDealPhotoOriginal,
  normalizedOcrTokens,
  outerBandForMatches,
  photoRegionToPixels,
  recognizeDealPhotoWords,
  regionCropPlan,
  safeDealImageUrl,
  tiledWatermarkSvg,
  type OcrWord,
} from "./dealsPhotos";
import { isSafeStorageObjectUrl, normalizeStorageKey, storageDelete } from "./storage";

vi.mock("./_core/env", () => ({ ENV: { forgeApiUrl: "https://forge.test", forgeApiKey: "forge-key", isProduction: false } }));

const word = (text: string, confidence = 95, lineId?: string, bbox?: OcrWord["bbox"]): OcrWord => ({ text, confidence, ...(lineId ? { lineId } : {}), ...(bbox ? { bbox } : {}) });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Builder Deals private photo primitives", () => {
  it("accepts only explicitly approved HTTPS image origins", () => {
    expect(safeDealImageUrl("https://dam.mihomes.com/path/house.jpg").hostname).toBe("dam.mihomes.com");
    expect(() => safeDealImageUrl("http://dam.mihomes.com/path/house.jpg")).toThrow("unapproved_source");
    expect(() => safeDealImageUrl("https://dam.mihomes.com.evil.test/path/house.jpg")).toThrow("unapproved_source");
    expect(() => safeDealImageUrl("https://user@dam.mihomes.com/path/house.jpg")).toThrow("unapproved_source");
    expect(() => safeDealImageUrl("not a URL")).toThrow("unapproved_source");
    expect(() => safeDealImageUrl("upload:abc")).toThrow("unapproved_source");
    // The newer builders' photo hosts, and a shared CDN only under the builder's own account.
    expect(safeDealImageUrl("https://res.cloudinary.com/perryhomes/image/upload/v1/x.jpg").hostname).toBe("res.cloudinary.com");
    expect(() => safeDealImageUrl("https://res.cloudinary.com/someone-else/image/upload/v1/x.jpg")).toThrow("unapproved_source");
    expect(safeDealImageUrl("https://www.drhorton.com/-/media/drhorton/productcatalog/x/y.jpg").hostname).toBe("www.drhorton.com");
    expect(safeDealImageUrl("https://pultegroup.cdn.picturepark.com/v/47GVJF5O/").hostname).toBe("pultegroup.cdn.picturepark.com");
  });

  it("matches only consecutive complete OCR words above the confidence floor", () => {
    const words = [
      { text: "Welcome", confidence: 99 },
      { text: "to", confidence: 99 },
      { text: "Sienna", confidence: 88 },
      { text: "Lakes", confidence: 76 },
      { text: "by", confidence: 99 },
      { text: "Chesmar", confidence: 74 },
      { text: "chester", confidence: 99 },
    ];

    expect(findExactOcrMatches(words, ["Sienna Lakes", "Chesmar", "Ches"])).toEqual([
      { term: "Sienna Lakes", confidence: 76, words: ["sienna", "lakes"] },
      { term: "Chesmar", confidence: 74, words: ["chesmar"] },
    ]);
    expect(normalizedOcrTokens("M/I Homes — #42")).toEqual(["m", "i", "homes", "42"]);
  });

  it("allows a phrase across two adjacent lines of one paragraph (stacked monument sign) but not further apart", () => {
    expect(findExactOcrMatches([word("Sienna", 95, "0:0:0"), word("Lakes", 95, "0:0:1")], ["Sienna Lakes"])).toHaveLength(1);
    expect(findExactOcrMatches([word("Sienna", 95, "0:0:0"), word("Lakes", 95, "0:0:0")], ["Sienna Lakes"])).toHaveLength(1);
    expect(findExactOcrMatches([word("Sienna", 95, "0:0:0"), word("Lakes", 95, "0:0:2")], ["Sienna Lakes"])).toHaveLength(0);
    expect(findExactOcrMatches([word("Sienna", 95, "0:0:0"), word("Lakes", 95, "0:1:0")], ["Sienna Lakes"])).toHaveLength(0);
    expect(findExactOcrMatches([word("Sienna", 95, "0:0:0"), word("Lakes", 95, "1:0:0")], ["Sienna Lakes"])).toHaveLength(0);
    expect(findExactOcrMatches([word("Sienna", 95, "0:0:1"), word("Lakes", 95, "0:0:0")], ["Sienna Lakes"])).toHaveLength(0);
    expect(findExactOcrMatches([word("Sienna", 95), word("Lakes", 95, "0:0:3")], ["Sienna Lakes"])).toHaveLength(1);
  });

  it("hides on the home's own house number as an exact term, exempt from the four-character rule", () => {
    expect(findDealPhotoHideMatches([word("8310")], ["8310 Whiskey River Dr"])).toEqual([]);
    expect(findDealPhotoHideMatches([word("8310")], ["8310 Whiskey River Dr"], undefined, ["8310"])).toEqual([{ term: "8310", confidence: 95, words: ["8310"] }]);
    expect(dealPhotoHouseNumber("42 Oak Ln")).toBe("42");
    expect(findDealPhotoHideMatches([word("42")], ["42 Oak Ln"], undefined, ["42"])).toEqual([{ term: "42", confidence: 95, words: ["42"] }]);
    expect(findDealPhotoHideMatches([word("42")], ["42"], undefined, [])).toEqual([]);
    expect(findDealPhotoHideMatches([word("8310", 60)], [], undefined, ["8310"])).toEqual([]);
    expect(findDealPhotoHideMatches([word("M/I"), word("Financial")], ["M/I", "M/I Financial"]).map((m) => m.term)).toEqual(["M/I Financial"]);
  });

  it("gates the step 5 band crop on every match lying inside one outer twenty percent band", () => {
    const bottom = { x0: 10, y0: 1000, x1: 300, y1: 1150 };
    const top = { x0: 10, y0: 20, x1: 300, y1: 200 };
    const mid = { x0: 10, y0: 500, x1: 300, y1: 600 };
    const straddling = { x0: 10, y0: 900, x1: 300, y1: 1000 };
    expect(outerBandForMatches([{ term: "a", confidence: 90, words: ["a"], bbox: bottom }], 1200)).toBe("bottom");
    expect(outerBandForMatches([{ term: "a", confidence: 90, words: ["a"], bbox: top }], 1200)).toBe("top");
    expect(outerBandForMatches([{ term: "a", confidence: 90, words: ["a"], bbox: bottom }, { term: "b", confidence: 90, words: ["b"], bbox: mid }], 1200)).toBeNull();
    expect(outerBandForMatches([{ term: "a", confidence: 90, words: ["a"], bbox: straddling }], 1200)).toBeNull();
    expect(outerBandForMatches([{ term: "a", confidence: 90, words: ["a"], bbox: bottom }, { term: "b", confidence: 90, words: ["b"], bbox: top }], 1200)).toBeNull();
    expect(outerBandForMatches([{ term: "a", confidence: 90, words: ["a"] }], 1200)).toBeNull();
    expect(outerBandForMatches([], 1200)).toBeNull();
  });

  it("normalizes a metadata-bearing photo deterministically, strips metadata, and bounds its dimensions", async () => {
    const source = await sharp({
      create: { width: 3_200, height: 1_600, channels: 3, background: { r: 20, g: 30, b: 40 } },
    })
      .withMetadata({ exif: { IFD0: { Artist: "Private builder" } } })
      .jpeg({ quality: 92 })
      .toBuffer();

    const first = await normalizeDealPhotoOriginal(source);
    const second = await normalizeDealPhotoOriginal(source);
    const metadata = await sharp(first).metadata();

    expect(first.equals(second)).toBe(true);
    expect(metadata.format).toBe("webp");
    expect(Math.max(metadata.width ?? 0, metadata.height ?? 0)).toBeLessThanOrEqual(1_600);
    expect(metadata.exif).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
  });

  it("isolates cache versions by lead identity", () => {
    const base = dealPhotoRenderCacheVersion("photo-v1", 42, "Ada");
    expect(dealPhotoRenderCacheVersion("photo-v1", 42, "Ada")).toBe(base);
    expect(dealPhotoRenderCacheVersion("photo-v1", 43, "Ada")).not.toBe(base);
    expect(dealPhotoRenderCacheVersion("photo-v1", 42, "Bea")).not.toBe(base);
    expect(dealPhotoRenderCacheVersion("photo-v2", 42, "Ada")).not.toBe(base);
  });

  it("rejects traversal keys and permits only HTTPS S3 or CloudFront object URLs", () => {
    expect(normalizeStorageKey("builder-deals-private/renders/1/a.webp")).toBe("builder-deals-private/renders/1/a.webp");
    expect(() => normalizeStorageKey("builder-deals-private/../public/a.webp")).toThrow("Invalid storage key");
    expect(() => normalizeStorageKey("builder-deals-private\\a.webp")).toThrow("Invalid storage key");

    expect(isSafeStorageObjectUrl("https://bucket.s3.us-east-1.amazonaws.com/path?X-Amz-Signature=x")).toBe(true);
    expect(isSafeStorageObjectUrl("https://d123.cloudfront.net/path?Signature=x")).toBe(true);
    expect(isSafeStorageObjectUrl("http://bucket.s3.us-east-1.amazonaws.com/path")).toBe(false);
    expect(isSafeStorageObjectUrl("https://amazonaws.com.evil.test/path")).toBe(false);
    expect(isSafeStorageObjectUrl("https://user@bucket.s3.amazonaws.com/path")).toBe(false);
  });

  it("runs at most the configured number of jobs at once and hands released slots to waiters", async () => {
    const limiter = createLimiter(2);
    let active = 0;
    let peak = 0;
    const results = await Promise.all([1, 2, 3, 4, 5].map((n) => limiter(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return n * 2;
    })));
    expect(results).toEqual([2, 4, 6, 8, 10]);
    expect(peak).toBe(2);
    expect(limiter.inFlight()).toBe(0);
    expect(limiter.waiting()).toBe(0);
    await expect(limiter(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(limiter.inFlight()).toBe(0);
  });
});

describe("watermark tiling coverage", () => {
  async function cellCoverage(text: string, width: number, height: number) {
    const svg = tiledWatermarkSvg(text, width, height);
    const { data, info } = await sharp({ create: { width, height, channels: 3, background: { r: 0, g: 0, b: 0 } } })
      .composite([{ input: svg, gravity: "center" }])
      .raw()
      .toBuffer({ resolveWithObject: true });
    const cells = 4;
    const lit = Array.from({ length: cells }, () => Array(cells).fill(0) as number[]);
    const counts = Array.from({ length: cells }, () => Array(cells).fill(0) as number[]);
    let total = 0;
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const cy = Math.min(cells - 1, Math.floor((y / info.height) * cells));
        const cx = Math.min(cells - 1, Math.floor((x / info.width) * cells));
        counts[cy][cx]++;
        if (data[(y * info.width + x) * info.channels] > 24) { lit[cy][cx]++; total++; }
      }
    }
    const fractions = lit.flatMap((row, r) => row.map((n, c) => n / counts[r][c]));
    return { min: Math.min(...fractions), max: Math.max(...fractions), total: total / (info.width * info.height), labels: (svg.toString("utf8").match(/<text /g) || []).length };
  }

  it("lights every 4x4 cell to at least two percent at landscape, small and portrait sizes with no blank diagonal", async () => {
    for (const [width, height] of [[1600, 1200], [800, 600], [1200, 1600]] as const) {
      for (const text of ["Prepared for @propertypete | Lifestyle Design Realty", "Prepared for ••••1477 | Lifestyle Design Realty"]) {
        const coverage = await cellCoverage(text, width, height);
        expect(coverage.labels, `${width}x${height}`).toBeGreaterThan(12);
        expect(coverage.min, `${width}x${height} "${text}" min cell`).toBeGreaterThanOrEqual(0.02);
        expect(coverage.total, `${width}x${height} total`).toBeGreaterThan(0.03);
        expect(coverage.total, `${width}x${height} total`).toBeLessThan(0.12);
      }
    }
    expect(tiledWatermarkSvg("Prepared for <Ada> & \"Bea\"", 800, 500).toString("utf8")).not.toMatch(/<Ada>|&amp;|"Bea"/);
  }, 30_000);
});

describe("processed master: region cover, band crop and admin bottom crop", () => {
  const W = 1600;
  const H = 1200;
  async function original(options: { topBand?: boolean } = {}) {
    const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${W}" height="${H}" fill="#d9e4ec"/>
      ${options.topBand ? `<rect x="0" y="0" width="${W}" height="${H * 0.1}" fill="#ffffff"/>` : ""}
      <rect x="${W * 0.86}" y="${H * 0.91}" width="${W * 0.12}" height="${H * 0.08}" fill="#000000"/>
    </svg>`;
    return normalizeDealPhotoOriginal(await sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer());
  }
  const pixelAt = async (bytes: Buffer, x: number, y: number) => {
    const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
    const i = (y * info.width + x) * info.channels;
    return [data[i], data[i + 1], data[i + 2]];
  };

  it("maps percent regions to pixels and crops full-width edge strips only", () => {
    expect(photoRegionToPixels({ x: 0, y: 88, width: 100, height: 12 }, W, H)).toEqual({ left: 0, top: 1056, width: W, height: 144 });
    expect(photoRegionToPixels({ x: 84, y: 90, width: 16, height: 10 }, W, H)).toEqual({ left: 1344, top: 1080, width: 256, height: 120 });
    expect(regionCropPlan({ x: 0, y: 88, width: 100, height: 12 }, W, H)).toEqual({ left: 0, top: 0, width: W, height: 1056 });
    expect(regionCropPlan({ x: 0, y: 0, width: 100, height: 10 }, W, H)).toEqual({ left: 0, top: 120, width: W, height: 1080 });
    expect(regionCropPlan({ x: 0, y: 40, width: 100, height: 10 }, W, H)).toBeNull();
    expect(regionCropPlan({ x: 5, y: 90, width: 95, height: 10 }, W, H)).toBeNull();
    expect(regionCropPlan({ x: 0, y: 30, width: 100, height: 70 }, W, H)).toBeNull();
  });

  it("crops a full-width bottom or top region, covers a corner region with a sampled fill, and never guts the frame", async () => {
    const source = await original();
    const cropped = await makeDealPhotoMaster(source, { region: { x: 0, y: 88, width: 100, height: 12 } });
    expect(cropped).toMatchObject({ width: W, height: 1056, regionAction: "cropped" });
    expect((await sharp(cropped.data).metadata()).height).toBe(1056);

    const topCropped = await makeDealPhotoMaster(await original({ topBand: true }), { region: { x: 0, y: 0, width: 100, height: 10 } });
    expect(topCropped).toMatchObject({ width: W, height: 1080, regionAction: "cropped" });
    const [r] = await pixelAt(topCropped.data, 10, 2);
    expect(r).toBeLessThan(240); // the white top band is gone; the first row is the grey background

    const covered = await makeDealPhotoMaster(source, { region: { x: 84, y: 90, width: 16, height: 10 } });
    expect(covered).toMatchObject({ width: W, height: H, regionAction: "covered" });
    const region = await sharp(covered.data).extract({ left: 1344, top: 1080, width: 256, height: 120 }).stats();
    expect(Math.max(...region.channels.map((channel) => channel.stdev))).toBeLessThan(2);
    expect(region.channels[0].mean).toBeGreaterThan(180); // filled from the pale surroundings, not the black logo
    const [outsideR] = await pixelAt(covered.data, 100, 100);
    expect(outsideR).toBeGreaterThan(180);

    const tall = await makeDealPhotoMaster(source, { region: { x: 0, y: 30, width: 100, height: 70 } });
    expect(tall).toMatchObject({ width: W, height: H, regionAction: "covered" });
  });

  it("applies the admin bottom crop unconditionally after the region step and rejects an impossible crop", async () => {
    const source = await original();
    const plain = await makeDealPhotoMaster(source, { bottomCrop: 100 });
    expect(plain).toMatchObject({ width: W, height: H - 100, regionAction: "none" });
    const both = await makeDealPhotoMaster(source, { region: { x: 0, y: 88, width: 100, height: 12 }, bottomCrop: 56 });
    expect(both).toMatchObject({ height: 1000, regionAction: "cropped" });
    await expect(makeDealPhotoMaster(source, { bottomCrop: H })).rejects.toThrow("invalid_crop");
    await expect(makeDealPhotoMaster(source, { bottomCrop: 10.5 })).rejects.toThrow("invalid_crop");
  });
});

describe("storageDelete", () => {
  const signed = "https://bucket.s3.us-east-1.amazonaws.com/builder-deals-private/renders/1/a.webp?X-Amz-Signature=x";

  it("presigns a delete and issues it, reporting true only when the backend accepted it", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: URL | string, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      if (calls.length === 1) return new Response(JSON.stringify({ url: signed }), { status: 200 });
      return new Response(null, { status: 204 });
    }));
    expect(await storageDelete("builder-deals-private/renders/1/a.webp")).toBe(true);
    expect(calls[0].url).toBe("https://forge.test/v1/storage/presign/delete?path=builder-deals-private%2Frenders%2F1%2Fa.webp");
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe("Bearer forge-key");
    expect(calls[1]).toMatchObject({ url: signed, init: { method: "DELETE" } });

    vi.stubGlobal("fetch", vi.fn(async (_input: URL | string, init?: RequestInit) => init?.method === "DELETE" ? new Response(null, { status: 403 }) : new Response(JSON.stringify({ url: signed }), { status: 200 })));
    expect(await storageDelete("builder-deals-private/renders/1/a.webp")).toBe(false);

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ url: "https://evil.example/x" }), { status: 200 })));
    expect(await storageDelete("builder-deals-private/renders/1/a.webp")).toBe(false);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);

    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await storageDelete("builder-deals-private/renders/1/a.webp")).toBe(false);
    expect(await storageDelete("../escape")).toBe(false);
  });

  it("remembers a missing delete endpoint instead of probing it for every key", async () => {
    const fetchMock = vi.fn(async () => new Response("not found", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await storageDelete("builder-deals-private/renders/1/a.webp")).toBe(false);
    expect(await storageDelete("builder-deals-private/renders/1/b.webp")).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("offline OCR with the bundled English data", () => {
  const trainedData = path.join(process.cwd(), "server", "ocr", "eng.traineddata");

  it.skipIf(!fs.existsSync(trainedData))("recognizes a bottom-band builder label from the repo-shipped data with positions in the outer band", async () => {
    const W = 1600;
    const H = 1200;
    const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${W}" height="${H}" fill="#d9e4ec"/>
      <rect x="200" y="400" width="1200" height="600" fill="#b08968"/>
      <rect x="0" y="${H - 120}" width="${W}" height="120" fill="#ffffff"/>
      <text x="60" y="${H - 40}" font-family="Arial" font-size="72" font-weight="700" fill="#102a43">Chesmar Homes</text>
    </svg>`;
    const normalized = await normalizeDealPhotoOriginal(await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer());
    try {
      const words = await recognizeDealPhotoWords(normalized);
      const matches = findDealPhotoHideMatches(words, ["Chesmar"]);
      expect(matches.map((match) => match.term)).toContain("Chesmar");
      expect(outerBandForMatches(matches, H)).toBe("bottom");
      expect(words.every((w) => typeof w.lineId === "string" && /^\d+:\d+:\d+$/.test(w.lineId))).toBe(true);
    } finally {
      await closeDealPhotoOcrWorker();
    }
  }, 60_000);
});
