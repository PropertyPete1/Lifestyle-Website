import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { featuredPreview } from "../client/src/components/deals/FeaturedDeals";
import { isFocusHome, leadWithPreviewPhoto, type PublicHome } from "../client/src/components/deals/LandingBrowse";
import { BuyerHomeCard } from "../client/src/components/deals/BuyerHomeCard";

(globalThis as { React?: typeof React }).React = React;

const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf-8");

/**
 * Nov 1, 2026 (Peter: "the ones that are featured I click it and then it's a zoomed in house and then a couple seconds after
 * it goes to the zoomed out house"). The sheet opened on the community's tall reel cover while the community's homes loaded,
 * then the home's whole photo appeared. Now the featured card itself leads the sheet from the first frame.
 */
describe("a featured home opens on the whole home, never the community's cover", () => {
  const deal = { key: "d1", card: undefined, label: "Seguin", price: 341_990, kind: "quick_move_in", beds: 4, sqft: 2_310, photo: "/deals/pub/img/aaaa", previousPrice: 346_990 };

  it("the featured card becomes the home it stands for: its figures and the photo it already loaded", () => {
    const preview = featuredPreview(deal);
    expect(preview).toMatchObject({ kind: "quick_move_in", price: 341_990, previousPrice: 346_990, beds: 4, sqft: 2_310, photos: ["/deals/pub/img/aaaa"] });
    expect(preview.card).toMatch(/^featured:/);
    expect(featuredPreview({ ...deal, photo: undefined }).photos).toEqual([]);
  });

  it("once the homes arrive, the opened home leads with the photo the card showed", () => {
    const preview = featuredPreview(deal);
    const home: PublicHome = { card: "h1", kind: "quick_move_in", price: 341_990, sqft: 2_310, photos: ["/deals/pub/img/bbbb", "/deals/pub/img/aaaa", "/deals/pub/img/cccc"] };
    expect(isFocusHome(home, { price: deal.price, sqft: deal.sqft, kind: deal.kind, preview })).toBe(true);
    expect(leadWithPreviewPhoto(home, preview).photos).toEqual(["/deals/pub/img/aaaa", "/deals/pub/img/bbbb", "/deals/pub/img/cccc"]);
    expect(leadWithPreviewPhoto({ ...home, photos: ["/deals/pub/img/bbbb"] }, preview).photos).toEqual(["/deals/pub/img/bbbb"]); // not one of its photos: unchanged
    expect(leadWithPreviewPhoto(home, undefined)).toBe(home);
  });

  it("the sheet leads with the preview while the homes load, and the featured strip passes it", () => {
    const sheet = read("client/src/components/deals/LandingBrowse.tsx");
    expect(sheet).toContain("const pendingHome = !found && homes.isLoading && focus?.preview ? focus.preview : undefined;");
    expect(sheet).toContain('data-deals-focus-hero={featuredHome ? "true" : "pending"}');
    expect(read("client/src/components/deals/PublicDealsPage.tsx")).toContain("preview: featuredPreview(deal)");
  });

  it("the unlocked list's opened home keeps its card copy whole under the full photo while it loads", () => {
    const src = read("client/src/components/deals/GatedCatalog.tsx");
    expect(src).toContain('data-deals-hero-card-copy="true" className="pointer-events-none absolute inset-0 h-full w-full select-none object-contain"');
  });
});

describe("list photos fade in over their grey frame", () => {
  it("a card's photo starts hidden over a pulsing frame until it has loaded", () => {
    const html = renderToStaticMarkup(React.createElement(BuyerHomeCard, { home: { card: "c", kind: "quick_move_in", price: 300_000, photos: ["/deals/pub/img/aaaa"] } as never, area: "Seguin", incentive: null, onOpen: () => undefined }));
    expect(html).toContain('data-deals-photo-loading="true"');
    expect(html).toMatch(/<img [^>]*class="[^"]*object-cover[^"]*opacity-0"[^>]*src="\/deals\/pub\/img\/aaaa"/);
  });
});
