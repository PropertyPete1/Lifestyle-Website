import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Nov 4, 2026 (Peter: "make sure every photo is not zoomed in"). No home, community or featured-deal photo in Builder
 * Deals is cropped: every one is object-contain inside its frame over a blur of itself. The only object-cover left is
 * that blurred backdrop (and the static area map, which is not a photo).
 */
const read = (file: string) => readFileSync(new URL(`../client/src/components/deals/${file}`, import.meta.url), "utf8");

describe("no cropped photos in Builder Deals", () => {
  it.each(["BuyerHomeCard.tsx", "LandingBrowse.tsx", "FeaturedDeals.tsx", "GatedCatalog.tsx", "shared.tsx", "PublicHomeList.tsx", "PublicDealsPage.tsx"])("%s has object-cover only on blurred backdrops", (file) => {
    for (const line of read(file).split("\n")) {
      if (!line.includes("object-cover")) continue;
      expect(line, line.trim().slice(0, 160)).toMatch(/blur-xl/);
    }
  });

  it("every photo frame has a backdrop and a contained photo", () => {
    const featured = read("FeaturedDeals.tsx");
    expect((featured.match(/<PhotoBackdrop /g) ?? []).length).toBe(3);
    expect((featured.match(/className=\{WHOLE_PHOTO_IMG\}/g) ?? []).length).toBe(3);
    expect(read("BuyerHomeCard.tsx")).toContain("<PhotoBackdrop src={photo} />");
    expect(read("LandingBrowse.tsx")).toContain("<PhotoBackdrop src={cover} />");
  });
});
