import { describe, expect, it } from "vitest";
import { FEATURES, isLinkVisible, isPropertySearchRoute } from "../shared/site";

/**
 * Guards the pre-IDX link gate. The /links bio buttons come from the DB
 * (admin-managed), so a paused route can reappear in the data at any time —
 * the UI must filter rather than trust it. If SHOW_PROPERTY_SEARCH is flipped
 * on with IDX, every link becomes visible again automatically.
 */

describe("isPropertySearchRoute", () => {
  it.each(["/search", "/portfolio", "/neighborhoods", "/listing"])(
    "matches the paused route %s",
    (url) => expect(isPropertySearchRoute(url)).toBe(true)
  );

  it.each([
    "/search?q=pool+homes+in+San+Antonio",
    "/listing/1521-stone-oak-terrace-san-antonio",
    "/neighborhoods/alamo-ranch",
    "/search/",
    "/portfolio#featured",
  ])("matches nested/query/hash form %s", (url) =>
    expect(isPropertySearchRoute(url)).toBe(true)
  );

  it.each([
    "/",
    "/sell",
    "/valuation",
    "/join",
    "/city-finder",
    "/convince",
    "/contact",
    "/links",
    "/privacy",
  ])("allows the live route %s", (url) => expect(isPropertySearchRoute(url)).toBe(false));

  it("does not match merely similar paths", () => {
    expect(isPropertySearchRoute("/searchable")).toBe(false);
    expect(isPropertySearchRoute("/portfolios")).toBe(false);
    expect(isPropertySearchRoute("/listings-guide")).toBe(false);
  });

  it("never treats external or non-path URLs as property-search routes", () => {
    expect(isPropertySearchRoute("https://a.nhb.app/u/peter-allen")).toBe(false);
    expect(isPropertySearchRoute("tel:+12109813830")).toBe(false);
    expect(isPropertySearchRoute("mailto:team@lifestyledesignrealty.com")).toBe(false);
  });
});

describe("isLinkVisible (pre-IDX gate)", () => {
  it("hides the seeded bio link that points at the paused search", () => {
    // The exact row seeded into bio_links — the leak found in the pre-launch check.
    expect(FEATURES.SHOW_PROPERTY_SEARCH).toBe(false); // pre-IDX state
    expect(isLinkVisible("/search")).toBe(false);
  });

  it("keeps every non-paused bio link visible", () => {
    for (const url of [
      "/valuation",
      "/city-finder",
      "/convince",
      "/contact",
      "/join",
      "https://a.nhb.app/u/peter-allen",
    ]) {
      expect(isLinkVisible(url), url).toBe(true);
    }
  });
});
