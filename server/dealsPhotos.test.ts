import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  dealPhotoRenderCacheVersion,
  findExactOcrMatches,
  normalizeDealPhotoOriginal,
  normalizedOcrTokens,
  safeDealImageUrl,
  tiledWatermarkSvg,
} from "./dealsPhotos";
import { isSafeStorageObjectUrl, normalizeStorageKey } from "./storage";

describe("Builder Deals private photo primitives", () => {
  it("accepts only explicitly approved HTTPS image origins", () => {
    expect(safeDealImageUrl("https://dam.mihomes.com/path/house.jpg").hostname).toBe("dam.mihomes.com");
    expect(() => safeDealImageUrl("http://dam.mihomes.com/path/house.jpg")).toThrow("unapproved_source");
    expect(() => safeDealImageUrl("https://dam.mihomes.com.evil.test/path/house.jpg")).toThrow("unapproved_source");
    expect(() => safeDealImageUrl("https://user@dam.mihomes.com/path/house.jpg")).toThrow("unapproved_source");
    expect(() => safeDealImageUrl("not a URL")).toThrow("unapproved_source");
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

  it("creates a complete tiled watermark and isolates cache versions by lead identity", () => {
    const svg = tiledWatermarkSvg("Prepared for Ada | Lifestyle Design Realty", 800, 500).toString("utf8");
    expect((svg.match(/<text /g) || []).length).toBeGreaterThan(12);
    expect(svg).toContain("Prepared for Ada");

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
});
