import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dealCommunities, dealHomes, dealIncentives, dealPhotos } from "../drizzle/schema";
import { FakeDealsDb } from "./dealsSync.fakeDb";

/**
 * The landing page laid out like a home search (October 24, 2026): photo cards beside one map of the market.
 * What reaches a visitor: an opaque key per community, a cover served by that key only while the latest landing read
 * names it, and a map marker at the coarse public grid cell (never the community or its ZIP).
 */
const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: (...args: unknown[]) => mocks.getDb(...args) }));

import { publicDealsCatalog } from "./dealsService";
import { publicPhotoIdForKey, resetPublicPhotos } from "./dealsPublicPhotos";
import { regionPin, SAN_ANTONIO_REGION } from "./dealsRegionMap";

(globalThis as { React?: typeof React }).React = React;
const { CommunityCard, groupMarkers, rateBadge } = await import("../client/src/components/deals/LandingBrowse");

describe("the region map", () => {
  it("places a point by the map's own projection and leaves off anything outside the picture", () => {
    expect(regionPin(SAN_ANTONIO_REGION.center)).toEqual({ x: 0.5, y: 0.5 });
    const newBraunfels = regionPin({ lat: 29.703, lng: -98.124 })!;
    expect(newBraunfels.x).toBeGreaterThan(0.5);
    expect(newBraunfels.y).toBeLessThan(0.5);
    const lackland = regionPin({ lat: 29.384, lng: -98.613 })!;
    expect(lackland.x).toBeLessThan(0.5);
    expect(lackland.y).toBeGreaterThan(0.5);
    // Austin and Houston are off the San Antonio picture.
    expect(regionPin({ lat: 30.267, lng: -97.743 })).toBeNull();
    expect(regionPin({ lat: 29.76, lng: -95.37 })).toBeNull();
    expect(regionPin({ lat: Number.NaN, lng: -98.4 })).toBeNull();
  });

  it("groups markers that overlap into one numbered bubble; a lone marker shows its price band", () => {
    const markers = groupMarkers([
      { key: "a", pin: { x: 0.5, y: 0.5 }, fromPriceLabel: "From the $300s" },
      { key: "b", pin: { x: 0.501, y: 0.502 }, fromPriceLabel: "From the $400s" },
      { key: "c", pin: { x: 0.8, y: 0.2 }, fromPriceLabel: "From the $250s" },
      { key: "d", pin: null },
    ]);
    expect(markers.map((marker) => [marker.keys, marker.label])).toEqual([[["a", "b"], "2"], [["c"], "$250s"]]);
  });
});

describe("the community card", () => {
  it("shows the cover, the price band, the builder rate only with its APR, and how many homes are ready", () => {
    const incentive = { text: "x", headlineRate: "4.99%", apr: "5.6%", followOnRate: null, followOnPeriod: null } as never;
    expect(rateBadge(incentive)).toEqual({ rate: "4.99%", apr: "5.6%" });
    expect(rateBadge({ ...(incentive as object), apr: null } as never)).toBeNull();
    expect(rateBadge({ text: "x", pending: true } as never)).toBeNull();
    const html = renderToStaticMarkup(React.createElement(CommunityCard, { community: { key: "abcdefabcdef", label: "Southeast San Antonio | Lakes", area: "Southeast San Antonio", fromPriceLabel: "From the $300s", reelUrl: "https://www.instagram.com/reel/x/", homesAvailable: 3, incentive, cover: "/deals/pub/img/abcdefabcdef" }, active: true, onHover: () => undefined, onOpen: () => undefined }));
    expect(html).toContain('src="/deals/pub/img/abcdefabcdef"');
    // The rate never prints without its APR.
    expect(html).toContain("4.99% rate · 5.6% APR");
    expect(html).toContain("From the $300s");
    expect(html).toContain("3 move-in ready homes");
    expect(html).toContain("Video tour");
    expect(html).toContain('data-active="true"');
    const bare = renderToStaticMarkup(React.createElement(CommunityCard, { community: { label: "North | New", area: "North", reelUrl: null, homesAvailable: 0 }, active: false, onHover: () => undefined, onOpen: () => undefined }));
    expect(bare).toContain("Photos coming soon");
    expect(bare).toContain("Build new: pick your plan");
    expect(bare).not.toContain("<img");
  });
});

describe("the landing catalog", () => {
  let db: FakeDealsDb;
  beforeEach(() => {
    db = new FakeDealsDb();
    mocks.getDb.mockResolvedValue(db);
    resetPublicPhotos();
  });
  const community = (over: Partial<typeof dealCommunities.$inferInsert>) => db.seed(dealCommunities, {
    builder: "Chesmar", privateName: "Fixture Lakes", sourceUrl: "https://www.chesmar.com/x/", privateAddress: "100 Fixture Blvd", publicLabel: "Southeast San Antonio | Lakes", areaLabel: "Southeast San Antonio",
    amenities: "[]", reelCode: "fl1", scrubList: "{}", active: true, paused: false, manualMode: false, zipCentroidLat: "29.355424", zipCentroidLng: "-98.319795", ...over,
  });
  const home = (communityId: number, price: number, kind: "quick_move_in" | "to_be_built" = "quick_move_in") => db.seed(dealHomes, { communityId, sourceKey: `k-${Math.random()}`, sourceUrl: "https://www.chesmar.com/x/h/", kind, status: "available", origin: "official", price });
  const photo = (homeId: number, sortOrder: number, over: Partial<typeof dealPhotos.$inferInsert> = {}) => db.seed(dealPhotos, { homeId, sourceUrl: `https://www.chesmar.com/p${Math.random()}.jpg`, sourceHash: `h${Math.random()}`, sortOrder, processingState: "processed", automaticHidden: false, adminHidden: false, nextProcessingAttemptAt: new Date(), ...over });

  it("gives each community an opaque key, its cheapest home's first shown photo as the cover, and a coarse map marker", async () => {
    const lakes = community({});
    const cheap = home(lakes, 300_000);
    home(lakes, 350_000);
    photo(cheap, 0, { automaticHidden: true });
    const cover = photo(cheap, 1);
    photo(cheap, 2);
    const plain = community({ privateName: "Fixture Hills", publicLabel: "North San Antonio | Hills", areaLabel: "North San Antonio", reelCode: "fh1", zipCentroidLat: null, zipCentroidLng: null });
    home(plain, 410_000);
    db.seed(dealIncentives, { communityId: plain, normalizedText: "x", publicText: "x", headlineRate: "4.99%", apr: "5.6%", confirmedAt: new Date(), active: true, held: false, manual: false });
    const entries = await publicDealsCatalog() as Array<{ key: string; label: string; cover: string | null; pin: { x: number; y: number } | null }>;
    const withCover = entries.find((entry) => entry.label === "Southeast San Antonio | Lakes")!;
    expect(withCover.key).toMatch(/^[a-f0-9]{12}$/);
    expect(withCover.cover).toBe(`/deals/pub/img/${withCover.key}`);
    expect(await publicPhotoIdForKey(withCover.key)).toBe(cover);
    // The marker is the coarse public cell's point, never the ZIP centroid itself.
    expect(withCover.pin).not.toBeNull();
    expect(withCover.pin).not.toEqual(regionPin({ lat: 29.355424, lng: -98.319795 }));
    const without = entries.find((entry) => entry.label === "North San Antonio | Hills")!;
    expect(without.cover).toBeNull();
    expect(without.pin).toBeNull();
    expect(await publicPhotoIdForKey(without.key)).toBeNull();
    const json = JSON.stringify(entries);
    for (const secret of ["Fixture Lakes", "Fixture Hills", "100 Fixture", "chesmar", "29.355424", "-98.319795", `"id"`]) expect(json).not.toContain(secret);
    // A cover the next read no longer names stops serving.
    db.rows(dealPhotos).forEach((row) => { row.adminHidden = true; });
    const again = await publicDealsCatalog() as Array<{ key: string; cover: string | null }>;
    expect(again.find((entry) => entry.key === withCover.key)?.cover).toBeNull();
    expect(await publicPhotoIdForKey(withCover.key)).toBeNull();
  });

  it("answers a made-up key with nothing, and only re-reads the catalog once a minute for unknown keys", async () => {
    community({});
    expect(await publicPhotoIdForKey("not-a-key")).toBeNull();
    const select = vi.spyOn(db, "select");
    expect(await publicPhotoIdForKey("0123456789ab")).toBeNull();
    const firstReads = select.mock.calls.length;
    // The first unknown key re-read the landing page (its readers); the next one within the minute does not.
    expect(firstReads).toBeGreaterThan(0);
    expect(await publicPhotoIdForKey("ba9876543210")).toBeNull();
    expect(select.mock.calls.length).toBe(firstReads);
  });
});
