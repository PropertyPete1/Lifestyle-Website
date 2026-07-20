import { describe, expect, it } from "vitest";
import { extractCriteriaFallback, matchListings } from "./aiSearch";
import { computeIntent } from "./fub";
import type { Listing } from "../drizzle/schema";

function fakeListing(overrides: Partial<Listing>): Listing {
  return {
    id: 1,
    slug: "test",
    address: "123 Test St",
    city: "San Antonio",
    state: "TX",
    zip: "78201",
    price: 400000,
    beds: 3,
    baths: "2",
    sqft: 2000,
    status: "Active",
    description: null,
    heroImage: null,
    photos: null,
    agentName: null,
    featured: true,
    hasPool: false,
    isNewConstruction: false,
    propertyType: "Residential",
    lat: null,
    lng: null,
    source: "cms",
    brokerAttribution: null,
    mlsDisclaimer: null,
    dataUpdatedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Listing;
}

describe("extractCriteriaFallback", () => {
  it("parses city, price cap, beds, and pool", () => {
    const c = extractCriteriaFallback("3 bedroom home under $400K with a pool in San Antonio");
    expect(c.city).toBe("San Antonio");
    expect(c.maxPrice).toBe(400000);
    expect(c.minBeds).toBe(3);
    expect(c.hasPool).toBe(true);
  });

  it("parses new construction and min price", () => {
    const c = extractCriteriaFallback("new construction over 500k in Austin");
    expect(c.city).toBe("Austin");
    expect(c.minPrice).toBe(500000);
    expect(c.isNewConstruction).toBe(true);
  });

  it("parses townhome type", () => {
    const c = extractCriteriaFallback("condo in Houston");
    expect(c.propertyType).toBe("Townhome/Condo");
    expect(c.city).toBe("Houston");
  });
});

describe("matchListings", () => {
  const listings = [
    fakeListing({ id: 1, city: "San Antonio", price: 350000, beds: 3, hasPool: true }),
    fakeListing({ id: 2, city: "Austin", price: 650000, beds: 4 }),
    fakeListing({ id: 3, city: "Houston", price: 300000, beds: 2, propertyType: "Townhome/Condo" }),
  ];

  it("filters by city + maxPrice + pool", () => {
    const res = matchListings(listings, { city: "San Antonio", maxPrice: 400000, hasPool: true });
    expect(res.map((l) => l.id)).toEqual([1]);
  });

  it("filters by minPrice", () => {
    const res = matchListings(listings, { minPrice: 500000 });
    expect(res.map((l) => l.id)).toEqual([2]);
  });

  it("filters by property type", () => {
    const res = matchListings(listings, { propertyType: "Townhome/Condo" });
    expect(res.map((l) => l.id)).toEqual([3]);
  });
});

describe("recruiting intent (Hot = active license + full-time + closed transactions)", () => {
  it("full-time active agent with closings is Hot", () => {
    expect(
      computeIntent({ licenseStatus: "Licensed active", fullTimeAgent: "Yes", transactionsClosed: "12" })
    ).toBe("Hot");
  });

  it("part-time active agent is Warm", () => {
    expect(
      computeIntent({ licenseStatus: "Licensed active", fullTimeAgent: "No", transactionsClosed: "5" })
    ).toBe("Warm");
  });

  it("full-time active agent with zero closings is Warm", () => {
    expect(
      computeIntent({ licenseStatus: "Licensed active", fullTimeAgent: "Yes", transactionsClosed: "0" })
    ).toBe("Warm");
  });

  it("buyer Get Started ASAP without preapproval field is Hot", () => {
    expect(computeIntent({ goal: "Buy", timeline: "ASAP" })).toBe("Hot");
  });
});
