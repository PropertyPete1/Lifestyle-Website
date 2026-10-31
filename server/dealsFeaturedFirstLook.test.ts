import * as React from "react";
import sharp from "sharp";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FIRST_LOOK_PRICE, firstLookFirst, inFirstLookRange, rankFeaturedFirstLook, type FeaturedCandidate } from "../shared/dealsFeatured";

/**
 * Oct 30, 2026 (Peter): the homes people see first are $300K-$400K homes, every Best Deals home shows its outside,
 * and the compact row's photo is landscape so a wide home is not cut off at the sides.
 */
const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: (...args: unknown[]) => mocks.getDb(...args) }));

import { EXTERIOR_MIN_SCORE, exteriorFirst, exteriorScore, exteriorScoreFromPixels, firstExteriorPhoto, resetExteriorScores } from "./dealsPhotoExterior";
import { withOutsideCovers } from "./dealsFeatured";

(globalThis as { React?: typeof React }).React = React;
const { FeaturedStrip, featuredEyebrow } = await import("../client/src/components/deals/FeaturedDeals");
const { publicHomeEntries } = await import("../client/src/components/deals/PublicHomeList");
const { EMPTY_FILTERS } = await import("../client/src/lib/dealsBrowse");

const NO_COSTS = { taxRatePercent: 0, insuranceRatePercent: 0, hoaMonthly: 0, mortgageInsuranceRatePercent: 0 };
const settings = { marketRatePercent: 7.4, defaultDownPercent: 5, costs: NO_COSTS };
const offer = (ratePercent: number) => ({ ratePercent, firstYearRatePercent: null, loanType: null, downPercent: null, aprPercent: ratePercent + 0.2 });
const candidate = (over: Partial<FeaturedCandidate>): FeaturedCandidate => ({ communityKey: "1", label: "Area | Label", area: "Area", price: 350_000, kind: "quick_move_in", offer: offer(6), acres: null, excluded: false, garage: "2", ...over });

/** A picture as raw RGB rows: `rows(y)` gives the colour of row y. */
function picture(width: number, height: number, rows: (y: number) => [number, number, number]): Uint8Array {
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(rows(y), (y * width + x) * 3);
  return data;
}
const SKY: [number, number, number] = [110, 160, 225];
const GRASS: [number, number, number] = [70, 140, 50];
const SIDING: [number, number, number] = [200, 196, 188];
const WALL: [number, number, number] = [214, 212, 208];
const FLOOR: [number, number, number] = [110, 84, 60];
const outside = (y: number, h: number): [number, number, number] => (y < h * 0.35 ? SKY : y >= h * 0.65 ? GRASS : SIDING);
const inside = (y: number, h: number): [number, number, number] => (y < h * 0.7 ? WALL : FLOOR);

async function png(rows: (y: number, h: number) => [number, number, number], width = 120, height = 80): Promise<Buffer> {
  return sharp(Buffer.from(picture(width, height, (y) => rows(y, height))), { raw: { width, height, channels: 3 } }).png().toBuffer();
}

describe("telling the outside of a house from the inside", () => {
  beforeEach(() => resetExteriorScores());

  it("scores sky across the top and grass along the bottom; a room scores nothing", () => {
    expect(exteriorScoreFromPixels(picture(48, 32, (y) => outside(y, 32)), 48, 32, 3)).toBeGreaterThan(1.5);
    expect(exteriorScoreFromPixels(picture(48, 32, (y) => inside(y, 32)), 48, 32, 3)).toBe(0);
    // A front elevation on a bare lot (sky, no lawn) still counts; a room with a little blue near the top does not.
    expect(exteriorScoreFromPixels(picture(48, 32, (y) => (y < 11 ? SKY : SIDING)), 48, 32, 3)).toBeGreaterThanOrEqual(EXTERIOR_MIN_SCORE);
    expect(exteriorScoreFromPixels(picture(48, 32, (y) => (y === 2 ? SKY : WALL)), 48, 32, 3)).toBeLessThan(EXTERIOR_MIN_SCORE);
  });

  it("reads an image file the same way", async () => {
    expect(await exteriorScore(await png(outside))).toBeGreaterThan(1.5);
    expect(await exteriorScore(await png(inside))).toBeLessThan(EXTERIOR_MIN_SCORE);
  });

  it("picks the first outside shot in gallery order, null when every photo is inside, unknown when nothing could be read", async () => {
    const files = new Map([["kitchen", await png(inside)], ["front", await png(outside)], ["bath", await png(inside)]]);
    const read = async (key: string) => { const file = files.get(key); if (!file) throw new Error("missing"); return file; };
    const row = (id: number, key: string) => ({ id, homeId: 1, processedStorageKey: key, processedVersion: `v-${key}` });
    // Peter's Seguin home: the kitchen leads the gallery and the front is second.
    expect(await firstExteriorPhoto([row(1, "kitchen"), row(2, "front"), row(3, "bath")], read)).toBe(2);
    // Peter's Marion home: every photo is inside.
    expect(await firstExteriorPhoto([row(4, "kitchen"), row(5, "bath")], read)).toBeNull();
    // No photo at all: no front photo, so not featured (Peter's rule).
    expect(await firstExteriorPhoto([], read)).toBeNull();
    // Storage down: unknown, so the row is never emptied by a hiccup.
    expect(await firstExteriorPhoto([row(6, "gone")], read)).toBeUndefined();
  });

  it("leads a home's gallery with its known front photo, without reading anything (Oct 30: the bathroom-sink sheet)", async () => {
    const files = new Map([["sink", await png(inside)], ["porch", await png(outside)], ["den", await png(inside)]]);
    const read = async (key: string) => { const file = files.get(key); if (!file) throw new Error("missing"); return file; };
    const row = (id: number, key: string) => ({ id, homeId: 2, processedStorageKey: key, processedVersion: `v2-${key}` });
    const gallery = [row(11, "sink"), row(12, "porch"), row(13, "den")];
    // Never measured: gallery order unchanged.
    expect(exteriorFirst(gallery).map((photo) => photo.id)).toEqual([11, 12, 13]);
    // Once the featured row has measured it, the front photo leads and the rest keep their order.
    expect(await firstExteriorPhoto(gallery, read)).toBe(12);
    expect(exteriorFirst(gallery).map((photo) => photo.id)).toEqual([12, 11, 13]);
    expect(exteriorFirst([]).length).toBe(0);
  });
});

describe("the Best Deals row: $300K-$400K and outside covers", () => {
  it("draws every part of the row from the first-look range and names it", () => {
    const ranked = rankFeaturedFirstLook([
      candidate({ communityKey: "cheap", key: "cheap", label: "Cheap | Starter", price: 240_000, offer: offer(4.5) }),
      candidate({ communityKey: "mid", key: "mid", label: "Mid | Range", price: 345_000, offer: offer(5.5) }),
      candidate({ communityKey: "lot", key: "lot", label: "Lot | Half acre", price: 395_000, offer: offer(6.5), acres: 0.5 }),
      candidate({ communityKey: "big", key: "big", label: "Big | Price", price: 480_000, offer: offer(3.99), acres: 1 }),
    ], settings);
    expect(ranked.priceRange).toEqual({ min: 300_000, max: 400_000 });
    expect(ranked.lowestPayment.map((deal) => deal.key)).toEqual(["mid", "lot"]);
    // "Best builder rate" is the best rate among the range's homes, so the tag stays true of what the row shows.
    expect(ranked.bestRate?.key).toBe("mid");
    expect(ranked.bigLots.map((deal) => deal.key)).toEqual(["lot"]);
  });

  it("falls back to every price only when nothing in the range can be ranked", () => {
    const ranked = rankFeaturedFirstLook([candidate({ communityKey: "cheap", key: "cheap", price: 240_000 }), candidate({ communityKey: "big", key: "big", price: 480_000 })], settings);
    expect(ranked.priceRange).toBeUndefined();
    expect(ranked.lowestPayment.map((deal) => deal.key)).toEqual(["cheap", "big"]);
  });

  it("drops a home whose photos are all inside, lets the next home in, and covers each with its outside shot", async () => {
    const candidates = [
      candidate({ communityKey: "a", key: "seguin", price: 310_000 }),
      candidate({ communityKey: "b", key: "marion", price: 320_000 }),
      candidate({ communityKey: "c", key: "converse", price: 330_000 }),
      candidate({ communityKey: "d", key: "wildwood", price: 340_000 }),
    ];
    const homeByKey = new Map([["seguin", 1], ["marion", 2], ["converse", 3], ["wildwood", 4]]);
    const looked: number[][] = [];
    const findCovers = async (ids: readonly number[]) => {
      looked.push([...ids]);
      const known: Record<number, number | null | undefined> = { 1: 12, 2: null, 3: undefined, 4: 41 };
      return new Map(ids.map((id) => [id, known[id]]));
    };
    const { ranked, covers } = await withOutsideCovers(candidates, (list) => rankFeaturedFirstLook(list, settings), homeByKey, findCovers);
    expect(ranked.lowestPayment.map((deal) => deal.key)).toEqual(["seguin", "converse", "wildwood"]);
    expect(covers.get("seguin")).toBe(12);
    expect(covers.get("wildwood")).toBe(41);
    // Photos unreadable just now (storage down): the home stays, with its first photo as before.
    expect(covers.has("converse")).toBe(false);
    // Only the new winner is looked at the second time round.
    expect(looked).toEqual([[1, 2, 3], [4]]);
  });
});

describe("what the visitor sees first", () => {
  it("puts $300K-$400K homes first in the Recommended order, each group in its own order", () => {
    expect(FIRST_LOOK_PRICE).toEqual({ min: 300_000, max: 400_000 });
    expect(inFirstLookRange(300_000) && inFirstLookRange(400_000) && !inFirstLookRange(299_999) && !inFirstLookRange(null)).toBe(true);
    expect(firstLookFirst([{ p: 499_990 }, { p: 240_000 }, { p: 389_000 }, { p: null }, { p: 310_000 }], (item) => item.p).map((item) => item.p)).toEqual([389_000, 310_000, 499_990, 240_000, null]);
    // [price, beds, baths, sqft, garage, kind, …] facts, as the landing catalog sends them.
    const community = { key: "c1", area: "Area", homeFacts: [[499_990, 4, 3, 2400, 2, 0], [349_990, 3, 2, 1800, 2, 0], [259_990, 3, 2, 1400, 2, 0]] };
    const entries = publicHomeEntries([community as never], EMPTY_FILTERS);
    expect(entries.map((entry) => entry.home.price)).toEqual([349_990, 499_990, 259_990]);
    // Sorting by price still sorts by price.
    expect(publicHomeEntries([community as never], { ...EMPTY_FILTERS, sort: "price_asc" }).map((entry) => entry.home.price)).toEqual([259_990, 349_990, 499_990]);
  });

  it("shows the compact row's photo landscape and names the price range in its heading", () => {
    const deal = { reason: "payment" as const, label: "Wildwood | Big Lots", area: "South San Antonio", price: 395_000, estMonthly: 2600, kind: "quick_move_in", beds: 4, sqft: 2200, rate: { ratePercent: 5.99, firstYearRatePercent: null, loanType: null, builderOffer: true, aprPercent: 6.2 }, downPercent: 5, acres: 0.5, photo: "/deals/pub/img/x", key: "w" };
    const featured = { lowestPayment: [deal], bestRate: null, bigLots: [deal], assumptions: { marketRatePercent: 7.4, defaultDownPercent: 5, termYears: 30, costs: NO_COSTS }, priceRange: { min: 300_000, max: 400_000 } };
    const html = renderToStaticMarkup(React.createElement(FeaturedStrip, { featured: featured as never, compact: true, opens: true }));
    expect(html).toContain("aspect-[3/2] w-28");
    expect(html).not.toContain("aspect-square w-24");
    expect(html).toContain("Best deals · $300K to $400K");
    expect(featuredEyebrow({})).toBe("Best deals right now");
  });
});
