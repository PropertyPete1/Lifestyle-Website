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
import { regionHomeView, regionPin, spreadStackedPins, SAN_ANTONIO_REGION } from "./dealsRegionMap";

(globalThis as { React?: typeof React }).React = React;
const { CommunityCard, groupMarkers, rateBadge, REGION_VIEW, clusterView, stillStacked, fanOffsets, isFocusHome, communityShareUrl } = await import("../client/src/components/deals/LandingBrowse");

describe("the region map", () => {
  it("places a point by the map's own projection and leaves off anything outside the picture", () => {
    expect(regionPin(SAN_ANTONIO_REGION.center)).toEqual({ x: 0.5, y: 0.5 });
    const downtown = regionPin({ lat: 29.4241, lng: -98.4936 })!;
    const newBraunfels = regionPin({ lat: 29.703, lng: -98.124 })!;
    expect(newBraunfels.x).toBeGreaterThan(downtown.x);
    expect(newBraunfels.y).toBeLessThan(downtown.y);
    const lackland = regionPin({ lat: 29.384, lng: -98.613 })!;
    expect(lackland.x).toBeLessThan(downtown.x);
    expect(lackland.y).toBeGreaterThan(downtown.y);
    // Oct 24, 2026: the picture reaches Austin and Georgetown (north and east of San Antonio); Houston is off it.
    const austin = regionPin({ lat: 30.267, lng: -97.743 })!;
    expect(austin.x).toBeGreaterThan(newBraunfels.x);
    expect(austin.y).toBeLessThan(newBraunfels.y);
    expect(regionPin({ lat: 30.633, lng: -97.677 })).not.toBeNull();
    expect(regionPin({ lat: 29.35, lng: -99.14 })).not.toBeNull();
    expect(regionPin({ lat: 29.76, lng: -95.37 })).toBeNull();
    expect(regionPin({ lat: Number.NaN, lng: -98.4 })).toBeNull();
  });

  it("opens the page's map on San Antonio with the server's own picture shape, and its quick jumps land on their towns", () => {
    const home = regionHomeView();
    expect(REGION_VIEW.aspect).toBeCloseTo(home.aspect, 6);
    expect(REGION_VIEW.home.x).toBeCloseTo(home.x, 3);
    expect(REGION_VIEW.home.y).toBeCloseTo(home.y, 3);
    expect(REGION_VIEW.home.span).toBeCloseTo(home.span, 3);
    const jump = (label: string) => REGION_VIEW.jumps.find((spot) => spot.label === label)!;
    expect(jump("New Braunfels")).toMatchObject(regionPin({ lat: 29.703, lng: -98.124 })!);
    expect(jump("Austin")).toMatchObject(regionPin({ lat: 30.32, lng: -97.76 })!);
  });

  it("groups markers that overlap into one numbered bubble; a lone marker shows its price band", () => {
    const markers = groupMarkers([
      { key: "a", pin: { x: 0.5, y: 0.5 }, fromPriceLabel: "From the $300s" },
      { key: "b", pin: { x: 0.501, y: 0.502 }, fromPriceLabel: "From the $400s" },
      { key: "c", pin: { x: 0.8, y: 0.2 }, fromPriceLabel: "From the $250s" },
      { key: "d", pin: null },
      // Oct 26: no price and nothing move-in ready (plans only) reads "Build new"; no price with homes reads "View", never "1".
      { key: "e", pin: { x: 0.2, y: 0.9 }, fromPriceLabel: null, homesAvailable: 0 },
      { key: "f", pin: { x: 0.9, y: 0.9 }, fromPriceLabel: null, homesAvailable: 3 },
    ]);
    expect(markers.map((marker) => [marker.keys, marker.label])).toEqual([[["a", "b"], "2"], [["c"], "$250s"], [["e"], "Build new"], [["f"], "View"]]);
  });
});

describe("a featured home opens its community (Peter, Oct 25: make the featured homes clickable)", () => {
  it("finds the featured home among the community's homes by kind, price and size", () => {
    const home = (price: number, sqft: number, kind = "quick_move_in") => ({ card: `c${price}`, kind, price, sqft });
    const focus = { price: 225_105, sqft: 1_276, kind: "quick_move_in" };
    expect(isFocusHome(home(225_105, 1_276), focus)).toBe(true);
    expect(isFocusHome(home(225_105, 1_400), focus)).toBe(false);
    expect(isFocusHome(home(225_105, 1_276, "to_be_built"), focus)).toBe(false);
    expect(isFocusHome(home(225_105, 1_276), undefined)).toBe(false);
  });
});

describe("communities that share a grid cell (Peter, Oct 25: 430 communities stood on 52 points)", () => {
  it("spreads a stack around its cell, within a cell of its centre, the same way every time, and leaves a lone community where it is", () => {
    const centre = regionPin({ lat: 29.55, lng: -98.6 })!;
    const lone = regionPin({ lat: 29.3, lng: -98.2 })!;
    const items = [...Array.from({ length: 30 }, (_, index) => ({ key: `k${String(index).padStart(2, "0")}`, pin: centre })), { key: "solo", pin: lone }, { key: "none", pin: null }];
    const spread = spreadStackedPins(items, 4);
    expect(spread.find((item) => item.key === "solo")!.pin).toEqual(lone);
    expect(spread.find((item) => item.key === "none")!.pin).toBeNull();
    const stacked = spread.filter((item) => item.key.startsWith("k")).map((item) => item.pin!);
    expect(new Set(stacked.map((pin) => `${pin.x}:${pin.y}`)).size).toBe(30);
    // A 4-mile cell on this picture, east-west and north-south.
    const cellX = regionPin({ lat: 29.4241, lng: -98.4936 + 4 / (69.172 * Math.cos(29.4241 * Math.PI / 180)) })!.x - regionPin({ lat: 29.4241, lng: -98.4936 })!.x;
    for (const pin of stacked) expect(Math.abs(pin.x - centre.x)).toBeLessThan(cellX);
    expect(spreadStackedPins([...items].reverse(), 4).find((item) => item.key === "k07")!.pin).toEqual(spread.find((item) => item.key === "k07")!.pin);
  });
});

describe("clicking a numbered bubble (Peter, Oct 25: it zooms into the neighborhoods, then each one opens)", () => {
  it("zooms to fit the group's communities in the middle of the map", () => {
    const pins = [{ x: 0.40, y: 0.50 }, { x: 0.46, y: 0.56 }];
    const view = clusterView(pins, 800, 600);
    const screen = (pin: { x: number; y: number }) => ({ x: pin.x * view.z + view.tx, y: pin.y * (view.z / REGION_VIEW.aspect) + view.ty });
    for (const pin of pins) {
      const point = screen(pin);
      expect(point.x).toBeGreaterThan(0); expect(point.x).toBeLessThan(800);
      expect(point.y).toBeGreaterThan(0); expect(point.y).toBeLessThan(600);
    }
    const middle = screen({ x: 0.43, y: 0.53 });
    expect(Math.round(middle.x)).toBe(400);
    expect(Math.round(middle.y)).toBe(300);
    // Much closer in than the opening view of the whole market.
    expect(view.z).toBeGreaterThan(800 / REGION_VIEW.home.span * 3);
  });

  it("fans out communities that still share one point after the zoom, each on its own spot", () => {
    const same = [{ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.5001, y: 0.5 }];
    expect(stillStacked(same, 4000)).toBe(true);
    expect(stillStacked([{ x: 0.40, y: 0.5 }, { x: 0.46, y: 0.5 }], 4000)).toBe(false);
    const ring = fanOffsets(7);
    expect(ring).toHaveLength(7);
    const spots = new Set(ring.map((offset) => `${offset.dx}:${offset.dy}`));
    expect(spots.size).toBe(7);
    // Far enough apart to tap one (each bubble is about 30 pixels wide).
    for (let i = 0; i < ring.length; i++) for (let j = i + 1; j < ring.length; j++) expect(Math.hypot(ring[i]!.dx - ring[j]!.dx, ring[i]!.dy - ring[j]!.dy)).toBeGreaterThanOrEqual(56);
  });
});

describe("a shared community link (Oct 26: a buyer sends one community to a spouse)", () => {
  it("is the landing page plus the community's opaque key, and nothing without a key", () => {
    const location = globalThis.window?.location;
    (globalThis as { window?: unknown }).window = { location: { origin: "https://lifestyledesignrealty.com" } };
    try {
      expect(communityShareUrl("41023f496be9")).toBe("https://lifestyledesignrealty.com/deals?k=41023f496be9");
      expect(communityShareUrl(undefined)).toBeNull();
    } finally {
      if (location) (globalThis.window as { location: unknown }).location = location; else delete (globalThis as { window?: unknown }).window;
    }
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
    amenities: "[]", reelCode: "fl1", scrubList: JSON.stringify({ community: ["Fixture Lakes"], street: ["Fixture Blvd"] }), active: true, paused: false, manualMode: false, zipCentroidLat: "29.355424", zipCentroidLng: "-98.319795", fromPrice: 299_990, schoolDistrict: "East Central ISD", ...over,
  });
  const home = (communityId: number, price: number, over: Partial<typeof dealHomes.$inferInsert> = {}) => db.seed(dealHomes, { communityId, sourceKey: `k-${Math.random()}`, sourceUrl: "https://www.chesmar.com/x/h/", privateAddress: "118 Fixture Blvd", privatePlanName: "Brandon", kind: "quick_move_in", status: "available", origin: "official", price, beds: "4", baths: "3", sqft: 2_100, ...over });
  const photo = (homeId: number, sortOrder: number, over: Partial<typeof dealPhotos.$inferInsert> = {}) => db.seed(dealPhotos, { homeId, sourceUrl: `https://www.chesmar.com/p${Math.random()}.jpg`, sourceHash: `h${Math.random()}`, sortOrder, processingState: "processed", automaticHidden: false, adminHidden: false, nextProcessingAttemptAt: new Date(), ...over });

  it("gives each community an opaque key, its exact starting price, its cheapest home's first shown photo as the cover, and a coarse map marker", async () => {
    const lakes = community({});
    const cheap = home(lakes, 300_000);
    home(lakes, 350_000, { garage: "2", stories: 2, moveInDate: "Nov 2026" });
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
    // The school district is public on the landing page (Oct 26, 2026), as its canonical name.
    expect((withCover as unknown as { schoolDistrict: string | null }).schoolDistrict).toBe("East Central ISD");
    expect(photoIdFromToken(withCover.cover!.replace("/deals/pub/img/", ""))).toBe(cover);
    // The marker is the coarse public cell's point, never the ZIP centroid itself.
    expect(withCover.pin).not.toBeNull();
    expect(withCover.pin).not.toEqual(regionPin({ lat: 29.355424, lng: -98.319795 }));
    // The filters read each shown home's public figures: [price, beds, baths, sqft, garage, kind, stories, previous price].
    expect((withCover as unknown as { homeFacts: unknown[] }).homeFacts).toEqual([[300_000, 4, 3, 2_100, null, 0, null, null, null], [350_000, 4, 3, 2_100, 2, 0, 2, null, "Nov 2026"]]);
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
