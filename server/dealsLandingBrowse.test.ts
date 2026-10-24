import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dealCommunities, dealHomes, dealIncentives, dealPhotos } from "../drizzle/schema";
import { FakeDealsDb } from "./dealsSync.fakeDb";

/**
 * The landing page laid out like a home search (October 24, 2026): photo cards beside one map of the market.
 * What reaches a visitor (prices and photos are public from October 24, 2026): an opaque key per community, photos by
 * sealed token, and a map marker at the coarse public grid cell (never the community or its ZIP). Never an address,
 * a plan, a builder or a community name.
 */
const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: (...args: unknown[]) => mocks.getDb(...args) }));

import { publicCommunityHomes, publicDealsCatalog, resetPublicHomesCache } from "./dealsService";
import { photoIdFromToken, publicPhotoAllowed, resetPublicPhotoLimits } from "./dealsPhotoToken";
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
    resetPublicHomesCache();
    resetPublicPhotoLimits();
  });
  const community = (over: Partial<typeof dealCommunities.$inferInsert>) => db.seed(dealCommunities, {
    builder: "Chesmar", privateName: "Fixture Lakes", sourceUrl: "https://www.chesmar.com/x/", privateAddress: "100 Fixture Blvd", publicLabel: "Southeast San Antonio | Lakes", areaLabel: "Southeast San Antonio",
    amenities: "[]", reelCode: "fl1", scrubList: JSON.stringify({ community: ["Fixture Lakes"], street: ["Fixture Blvd"] }), active: true, paused: false, manualMode: false, zipCentroidLat: "29.355424", zipCentroidLng: "-98.319795", fromPrice: 299_990, ...over,
  });
  const home = (communityId: number, price: number, over: Partial<typeof dealHomes.$inferInsert> = {}) => db.seed(dealHomes, { communityId, sourceKey: `k-${Math.random()}`, sourceUrl: "https://www.chesmar.com/x/h/", privateAddress: "118 Fixture Blvd", privatePlanName: "Brandon", kind: "quick_move_in", status: "available", origin: "official", price, beds: "4", baths: "3", sqft: 2_100, ...over });
  const photo = (homeId: number, sortOrder: number, over: Partial<typeof dealPhotos.$inferInsert> = {}) => db.seed(dealPhotos, { homeId, sourceUrl: `https://www.chesmar.com/p${Math.random()}.jpg`, sourceHash: `h${Math.random()}`, sortOrder, processingState: "processed", automaticHidden: false, adminHidden: false, nextProcessingAttemptAt: new Date(), ...over });

  it("gives each community an opaque key, its exact starting price, its cheapest home's first shown photo as the cover, and a coarse map marker", async () => {
    const lakes = community({});
    const cheap = home(lakes, 300_000);
    home(lakes, 350_000);
    photo(cheap, 0, { automaticHidden: true });
    const cover = photo(cheap, 1);
    photo(cheap, 2);
    const plain = community({ privateName: "Fixture Hills", publicLabel: "North San Antonio | Hills", areaLabel: "North San Antonio", reelCode: "fh1", zipCentroidLat: null, zipCentroidLng: null, scrubList: "{}" });
    home(plain, 410_000);
    db.seed(dealIncentives, { communityId: plain, normalizedText: "x", publicText: "x", headlineRate: "4.99%", apr: "5.6%", confirmedAt: new Date(), active: true, held: false, manual: false });
    const entries = await publicDealsCatalog() as Array<{ key: string; label: string; fromPriceLabel: string | null; cover: string | null; pin: { x: number; y: number } | null }>;
    const withCover = entries.find((entry) => entry.label === "Southeast San Antonio | Lakes")!;
    expect(withCover.key).toMatch(/^[a-f0-9]{12}$/);
    expect(withCover.fromPriceLabel).toBe("From $299,990");
    expect(photoIdFromToken(withCover.cover!.replace("/deals/pub/img/", ""))).toBe(cover);
    // The marker is the coarse public cell's point, never the ZIP centroid itself.
    expect(withCover.pin).not.toBeNull();
    expect(withCover.pin).not.toEqual(regionPin({ lat: 29.355424, lng: -98.319795 }));
    const without = entries.find((entry) => entry.label === "North San Antonio | Hills")!;
    expect(without.cover).toBeNull();
    expect(without.pin).toBeNull();
    const json = JSON.stringify(entries);
    for (const secret of ["Fixture Lakes", "Fixture Hills", "100 Fixture", "chesmar", "29.355424", "-98.319795", `"id"`]) expect(json).not.toContain(secret);
  });

  it("shows a community's homes with prices, specs and photos, never an address, a plan or a name", async () => {
    const lakes = community({});
    const ready = home(lakes, 300_000, { previousPrice: 320_000, moveInDate: "Nov 2026" });
    photo(ready, 0);
    const second = photo(ready, 1);
    home(lakes, 350_000);
    home(lakes, 280_000, { status: "sold" });
    const [entry] = await publicDealsCatalog() as Array<{ key: string }>;
    const homes = await publicCommunityHomes(entry!.key) as Array<{ card: string; price: number; previousPrice: number; beds: string; photos: string[]; moveInDate: string }>;
    expect(homes.map((item) => item.price)).toEqual([300_000, 350_000]);
    expect(homes[0]).toMatchObject({ previousPrice: 320_000, beds: "4", moveInDate: "Nov 2026" });
    expect(homes[0]!.photos).toHaveLength(2);
    expect(photoIdFromToken(homes[0]!.photos[1]!.replace("/deals/pub/img/", ""))).toBe(second);
    expect(homes[1]!.photos).toEqual([]);
    const json = JSON.stringify(homes);
    for (const secret of ["118 Fixture", "Brandon", "Fixture Lakes", "chesmar", "sourceKey", `"id"`]) expect(json).not.toContain(secret);
    // A key that is not a live community's opens nothing, and made-up keys never re-read the communities.
    const select = vi.spyOn(db, "select");
    expect(await publicCommunityHomes("0123456789ab")).toBeNull();
    expect(await publicCommunityHomes("ba9876543210")).toBeNull();
    expect(select).not.toHaveBeenCalled();
    expect(await publicCommunityHomes("nope")).toBeNull();
    // Photo tokens are one unbroken hex word, so the privacy check can never read a builder name inside one.
    for (const url of homes[0]!.photos) expect(url).toMatch(/^\/deals\/pub\/img\/[a-f0-9]{32}$/);
  });

  it("drops a community's homes when a private name slips into them", async () => {
    const lakes = community({});
    home(lakes, 300_000, { lotSize: "Corner lot on Fixture Blvd" });
    const [entry] = await publicDealsCatalog() as Array<{ key: string }>;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await publicCommunityHomes(entry!.key)).toBeNull();
    consoleError.mockRestore();
  });

  it("lets one visitor load a gallery's worth of photos a minute, not a scrape", () => {
    const now = Date.now();
    for (let index = 0; index < 300; index += 1) expect(publicPhotoAllowed("203.0.113.9", now)).toBe(true);
    expect(publicPhotoAllowed("203.0.113.9", now)).toBe(false);
    expect(publicPhotoAllowed("203.0.113.10", now)).toBe(true);
    expect(publicPhotoAllowed("203.0.113.9", now + 61_000)).toBe(true);
  });
});
