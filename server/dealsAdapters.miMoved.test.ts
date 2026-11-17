import { describe, expect, it } from "vitest";
import { miMovedCommunity } from "./dealsAdapters";

/**
 * Nov 17, 2026: M/I moved Sandy Oaks Estates from /south-san-antonio/ to /elmendorf/. The old address kept serving the
 * page, but its homes and plans were linked under the new one, so none matched the community and it was held for a week.
 */
describe("M/I Homes: a community moved under another area", () => {
  const OLD = new URL("https://www.mihomes.com/new-homes/texas/greater-san-antonio/south-san-antonio/fixture-oaks");
  const page = (href: string) => `<html><head><link rel="canonical" href="${href}"></head><body></body></html>`;

  it("reads the page's own address when only the area segment changed", () => {
    expect(miMovedCommunity(page("https://www.mihomes.com/new-homes/texas/greater-san-antonio/elmendorf/fixture-oaks"), OLD)?.toString()).toBe("https://www.mihomes.com/new-homes/texas/greater-san-antonio/elmendorf/fixture-oaks");
    expect(miMovedCommunity(page("/new-homes/texas/greater-san-antonio/elmendorf/fixture-oaks/?x=1#top"), OLD)?.toString()).toBe("https://www.mihomes.com/new-homes/texas/greater-san-antonio/elmendorf/fixture-oaks/");
  });

  it("is not a move when the address is the same, names another community, another market, another depth or another site", () => {
    expect(miMovedCommunity(page(OLD.toString()), OLD)).toBeNull();
    expect(miMovedCommunity(page(`${OLD.toString()}/`), OLD)).toBeNull();
    expect(miMovedCommunity(page("https://www.mihomes.com/new-homes/texas/greater-san-antonio/elmendorf/other-oaks"), OLD)).toBeNull();
    expect(miMovedCommunity(page("https://www.mihomes.com/new-homes/texas/austin/elmendorf/fixture-oaks"), OLD)).toBeNull();
    expect(miMovedCommunity(page("https://www.mihomes.com/new-homes/texas/greater-san-antonio/fixture-oaks"), OLD)).toBeNull();
    expect(miMovedCommunity(page("https://evil.example/new-homes/texas/greater-san-antonio/elmendorf/fixture-oaks"), OLD)).toBeNull();
    expect(miMovedCommunity("<html><body>no canonical</body></html>", OLD)).toBeNull();
  });
});
