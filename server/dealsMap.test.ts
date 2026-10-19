import type { Request, Response } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dealCommunities, dealHomes, dealLeads } from "../drizzle/schema";
import { FakeDealsDb } from "./dealsSync.fakeDb";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  makeRequest: vi.fn(),
  isLiveDealSession: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("./db", () => ({ getDb: (...args: unknown[]) => mocks.getDb(...args) }));
vi.mock("./_core/map", () => ({ makeRequest: (...args: unknown[]) => mocks.makeRequest(...args) }));
vi.mock("./_core/env", () => ({ ENV: { forgeApiUrl: "https://forge.example", forgeApiKey: "forge-key", isProduction: false, appId: "", cookieSecret: "", databaseUrl: "", oAuthServerUrl: "", ownerOpenId: "" } }));
vi.mock("./dealsService", async (importOriginal) => ({ ...(await importOriginal<typeof import("./dealsService")>()), isLiveDealSession: (...args: unknown[]) => mocks.isLiveDealSession(...args) }));

import { communityAreaMap, dealsMapImageHandler, driveTimeChips, mapCommunityIdFromPath, refreshCommunityGeography, resetAreaMapCache, roundToFiveMinutes, zipFromAddress } from "./dealsMap";
import { gatedDealsCatalog } from "./dealsService";

/** Synthetic points: a ZIP centroid and a home about 1.6 miles away from it. */
const CENTROID = { lat: 29.3005, lng: -98.3205 };
const HOME_POINT = { lat: 29.3237, lng: -98.3205 };
const geocoded: Record<string, { lat: number; lng: number }> = { "postal_code:78263|country:US": CENTROID, "8106 Fixture Street, San Antonio, TX 78263": HOME_POINT };

function milesBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const toRad = (value: number) => value * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

let db: FakeDealsDb;
let communityId: number;

function responseRecorder() {
  const headers: Record<string, string> = {};
  const response = {
    statusCode: 200,
    body: null as unknown,
    status: vi.fn(function (this: { statusCode: number }, code: number) { this.statusCode = code; return response; }),
    end: vi.fn(() => response),
    setHeader: vi.fn((name: string, value: string) => { headers[name.toLowerCase()] = value; return response; }),
    type: vi.fn((value: string) => { headers["content-type"] = value; return response; }),
    send: vi.fn((body: unknown) => { response.body = body; return response; }),
  };
  return { response: response as unknown as Response, headers, raw: response };
}

beforeEach(() => {
  db = new FakeDealsDb();
  mocks.getDb.mockResolvedValue(db);
  resetAreaMapCache();
  mocks.makeRequest.mockImplementation(async (endpoint: string, params: Record<string, string>) => {
    if (endpoint === "/maps/api/geocode/json") {
      const key = params.components ?? params.address;
      const location = geocoded[key];
      return { status: location ? "OK" : "ZERO_RESULTS", results: location ? [{ types: [params.components ? "postal_code" : "street_address"], geometry: { location }, formatted_address: key, address_components: [], place_id: "x" }] : [] };
    }
    if (endpoint === "/maps/api/distancematrix/json") {
      expect(params.origins).toBe(`${CENTROID.lat},${CENTROID.lng}`);
      const destinations = String(params.destinations).split("|");
      return { status: "OK", origin_addresses: [params.origins], destination_addresses: destinations, rows: [{ elements: destinations.map((destination) => destination.startsWith("Nowhere") ? { status: "ZERO_RESULTS" } : { status: "OK", distance: { text: "x", value: 1 }, duration: { text: "x", value: destination.startsWith("downtown") ? 1_480 : destination.startsWith("Randolph") ? 1_130 : destination.startsWith("Lackland") ? 2_210 : 1_700 } }) }] };
    }
    throw new Error(`unexpected endpoint ${endpoint}`);
  });
  communityId = db.seed(dealCommunities, {
    builder: "M/I Homes", privateName: "Fixture Gardens", sourceUrl: "https://www.mihomes.com/new-homes/texas/fixture-gardens", privateAddress: "8106 Fixture Street, San Antonio, TX 78263",
    publicLabel: "Southeast San Antonio | New Phase Now Selling", areaLabel: "Southeast San Antonio", reelCode: "vg1", scrubList: JSON.stringify({ street: ["Fixture Street"] }), active: true, paused: false, manualMode: false, amenities: "[]",
  });
  db.seed(dealHomes, { communityId, sourceKey: "k1", sourceUrl: "https://www.mihomes.com/new-homes/texas/fixture-gardens/a-plan/8106-fixture-street", privateAddress: "8106 Fixture Street, San Antonio, TX 78263", kind: "quick_move_in", status: "available", origin: "official", price: 400_000, beds: "4", baths: "3", sqft: 2_300 });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("area map geography", () => {
  it("geocodes the ZIP centroid on save and stores five-minute drive-time chips", async () => {
    expect(zipFromAddress("8106 Fixture Street, San Antonio, TX 78263")).toBe("78263");
    expect(zipFromAddress("no zip here")).toBeNull();
    expect(roundToFiveMinutes(1_480)).toBe(25);
    expect(roundToFiveMinutes(1_130)).toBe(20);
    expect(roundToFiveMinutes(90)).toBe(5);
    const result = await refreshCommunityGeography(communityId);
    expect(result).toMatchObject({ ok: true, chips: ["about 25 min to downtown San Antonio", "about 20 min to Randolph AFB", "about 35 min to Lackland AFB", "about 30 min to The Pearl"] });
    const community = db.rows(dealCommunities)[0];
    expect(community).toMatchObject({ zipCentroidLat: "29.300500", zipCentroidLng: "-98.320500" });
    expect(JSON.parse(String(community.driveTimeChips))).toHaveLength(4);
    expect(mocks.makeRequest.mock.calls[0]).toEqual(["/maps/api/geocode/json", { components: "postal_code:78263|country:US" }]);
    expect(await driveTimeChips(CENTROID, ["Nowhere Special", "downtown San Antonio"])).toEqual(["about 25 min to downtown San Antonio"]);
  });

  it("returns only the ZIP centroid in the gated JSON, more than half a mile from the home's geocoded address", async () => {
    await refreshCommunityGeography(communityId);
    const leadId = db.seed(dealLeads, { phoneE164: "+12105550123", status: "verified", expiresAt: new Date(Date.now() + 3_600_000), deviceHash: "d".repeat(64), consentText: "c", flags: "[]", sourceCode: "vg1" });
    const data = await gatedDealsCatalog(leadId) as Array<{ areaMap: unknown; homes: unknown[] }>;
    expect(data).toHaveLength(1);
    expect(data[0].areaMap).toEqual({ lat: CENTROID.lat, lng: CENTROID.lng, radiusMiles: 2, zoom: 11, imageUrl: `/deals/mine/maps/${communityId}.png`, attribution: expect.any(String) });
    const json = JSON.stringify(data);
    // Any coordinate-shaped decimal in the whole payload (timestamps have at most three decimals).
    const coordinates = Array.from(json.matchAll(/-?\d{2,3}\.\d{4,}/g), (match) => Number(match[0]));
    expect(coordinates.sort()).toEqual([CENTROID.lat, CENTROID.lng].sort());
    expect(json).not.toContain(String(HOME_POINT.lat));
    expect(json).not.toContain("Fixture Street");
    const home = (await mocks.makeRequest("/maps/api/geocode/json", { address: "8106 Fixture Street, San Antonio, TX 78263" })).results[0].geometry.location;
    expect(milesBetween(home, { lat: CENTROID.lat, lng: CENTROID.lng })).toBeGreaterThan(0.5);
    expect(data[0].homes).toHaveLength(1);
  });

  it("reports no map when the community has no centroid", () => {
    expect(communityAreaMap({ id: 7, zipCentroidLat: null, zipCentroidLng: null })).toBeNull();
    expect(communityAreaMap({ id: 7, zipCentroidLat: "29.3", zipCentroidLng: "-98.3" })).toMatchObject({ imageUrl: "/deals/mine/maps/7.png", radiusMiles: 2, zoom: 11 });
    expect(mapCommunityIdFromPath("7.png")).toBe(7);
    expect(mapCommunityIdFromPath("7")).toBe(7);
    expect(mapCommunityIdFromPath("../7")).toBeNull();
  });
});

describe("area map image route", () => {
  it("refuses a request without a live session and never contacts the map provider", async () => {
    mocks.isLiveDealSession.mockResolvedValue(null);
    const { response, raw } = responseRecorder();
    await dealsMapImageHandler({ params: { communityId: `${communityId}.png` }, headers: {} } as unknown as Request, response);
    expect(raw.status).toHaveBeenCalledWith(401);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("proxies a marker-free static map centred on the centroid, 800x400 at zoom 11, served no-store", async () => {
    await refreshCommunityGeography(communityId);
    mocks.isLiveDealSession.mockResolvedValue({ leadId: 1, deviceHash: "d", lead: {} });
    const { default: sharp } = await import("sharp");
    const providerImage = await sharp({ create: { width: 1280, height: 640, channels: 3, background: { r: 200, g: 210, b: 220 } } }).png().toBuffer();
    const fetcher = vi.fn(async (url: string) => {
      const request = new URL(url);
      // The provider's standard plan rejects an 800x400 request; the fallback is zoom 10 at 2x scale, cropped.
      if (request.searchParams.get("size") === "800x400") return new Response("Invalid request", { status: 400, headers: { "content-type": "text/plain" } });
      return new Response(providerImage, { status: 200, headers: { "content-type": "image/png" } });
    });
    vi.stubGlobal("fetch", fetcher);
    try {
      const { response, raw, headers } = responseRecorder();
      await dealsMapImageHandler({ params: { communityId: `${communityId}.png` }, headers: {} } as unknown as Request, response);
      expect(raw.status).not.toHaveBeenCalledWith(401);
      expect(headers["cache-control"]).toBe("private, no-store");
      expect(headers["content-type"]).toBe("image/png");
      const body = raw.body as Buffer;
      const meta = await sharp(body).metadata();
      expect([meta.width, meta.height]).toEqual([800, 400]);
      const requests = fetcher.mock.calls.map(([url]) => new URL(url as string));
      expect(requests).toHaveLength(2);
      for (const request of requests) {
        expect(request.hostname).toBe("forge.example");
        expect(request.searchParams.get("center")).toBe(`${CENTROID.lat},${CENTROID.lng}`);
        expect(request.searchParams.has("markers")).toBe(false);
      }
      expect(requests[1].searchParams.get("zoom")).toBe("10");
      expect(requests[1].searchParams.get("scale")).toBe("2");
      // Cached: a second view makes no provider request.
      const again = responseRecorder();
      await dealsMapImageHandler({ params: { communityId: String(communityId) }, headers: {} } as unknown as Request, again.response);
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(again.raw.send).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
