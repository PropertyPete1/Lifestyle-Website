import { describe, expect, it } from "vitest";
import { extractCriteriaFallback, matchListings } from "./aiSearch";
import { PLACEHOLDER_LISTINGS, tupleToListing } from "../shared/placeholderListings.mjs";
import type { Listing } from "../drizzle/schema";

/**
 * Guards the placeholder dataset against the "0 results on common queries"
 * regression found in the audit. Uses the deterministic regex parser (no LLM)
 * against the REAL seed data, so trimming or skewing the dataset such that a
 * common natural-language search dead-ends will fail CI.
 */

const listings = PLACEHOLDER_LISTINGS.map((t, i) => tupleToListing(t, i)) as unknown as Listing[];

function countFor(query: string): number {
  return matchListings(listings, extractCriteriaFallback(query)).length;
}

describe("AI search coverage against the seed dataset", () => {
  it("has a healthy, varied dataset", () => {
    expect(listings.length).toBeGreaterThanOrEqual(45);
    const cities = new Set(listings.map((l) => l.city));
    expect(cities.size).toBeGreaterThanOrEqual(6);
    expect(listings.some((l) => l.hasPool)).toBe(true);
  });

  // The exact placeholder the search box suggests to users must not return 0.
  it("the site's own example query returns 5+ results", () => {
    expect(countFor("3 bedroom home under $400K with a pool in San Antonio")).toBeGreaterThanOrEqual(5);
  });

  it.each([
    ["homes with a pool in Austin under 700k", 5],
    ["single story home under 400k", 5],
    ["new construction under 500k", 5],
    ["4 bedroom home in Houston", 5],
    ["pool home in San Antonio", 5],
  ])("query %j returns at least %i results", (query, min) => {
    expect(countFor(query)).toBeGreaterThanOrEqual(min);
  });
});
