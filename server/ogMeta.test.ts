import { describe, expect, it } from "vitest";
import { buildTags, DEALS_OG_DESCRIPTION, DEALS_OG_IMAGE, DEALS_OG_TITLE, dealsCommunityShareCard, escapeHtml } from "./ogMeta";
import { selectCityImage } from "../shared/cityImagery";

describe("ogMeta", () => {
  it("escapes HTML-sensitive characters", () => {
    expect(escapeHtml(`Tom & "Jo" <3`)).toBe("Tom &amp; &quot;Jo&quot; &lt;3");
  });

  it("builds OG and Twitter tags with title, description, image, and url", () => {
    const tags = buildTags({
      title: "A letter written for Taylor about life in San Antonio, Texas",
      description: "Taylor, picture Saturday mornings…",
      url: "https://example.com/convince/abc123",
    });
    expect(tags).toContain(
      `<meta property="og:title" content="A letter written for Taylor about life in San Antonio, Texas" />`
    );
    expect(tags).toContain(`<meta property="og:url" content="https://example.com/convince/abc123" />`);
    expect(tags).toContain(`<meta property="og:image" content="https://example.com/manus-storage/convince-og-card_a3d08b2e.png" />`);
    expect(tags).toContain(`<meta name="twitter:card" content="summary_large_image" />`);
  });

  it("uses a supplied city image for the City Finder share card", () => {
    const image = selectCityImage("Austin", { lifestyle: "nightlife" }).src;
    const tags = buildTags({
      title: "My Texas city match: Austin",
      description: "Austin came out on top…",
      url: "https://example.com/city-finder/abc123",
      image,
    });
    expect(tags).toContain(`<meta property="og:image" content="https://example.com${image}" />`);
    expect(tags).toContain(`<meta name="twitter:image" content="https://example.com${image}" />`);
    // must not fall back to the Convince letter card
    expect(tags).not.toContain("convince-og-card");
    expect(tags).toContain(`<meta property="og:title" content="My Texas city match: Austin" />`);
  });

  it("still defaults to the Convince card when no image is supplied", () => {
    const tags = buildTags({
      title: "t",
      description: "d",
      url: "https://example.com/convince/xyz",
    });
    expect(tags).toContain(
      `<meta property="og:image" content="https://example.com/manus-storage/convince-og-card_a3d08b2e.png" />`
    );
  });

  it("does not emit a malformed image URL for a non-absolute url", () => {
    const tags = buildTags({ title: "t", description: "d", url: "not-a-url" });
    // origin resolves to "" rather than throwing; path stays relative
    expect(tags).toContain(`<meta property="og:image" content="/manus-storage/convince-og-card_a3d08b2e.png" />`);
  });

  it("escapes injected quotes in dynamic titles", () => {
    const tags = buildTags({
      title: `A "letter" for <script>`,
      description: "safe",
      url: "https://example.com/convince/x",
    });
    expect(tags).not.toContain("<script>");
    expect(tags).toContain("&lt;script&gt;");
  });

  it("has a generic branded Builder Deals card without private inventory metadata", () => {
    const tags = buildTags({ title: DEALS_OG_TITLE, description: DEALS_OG_DESCRIPTION, image: DEALS_OG_IMAGE, url: "https://example.com/deals" });
    expect(tags).toContain("This week's best new-build deals in San Antonio");
    expect(tags).toContain("builder-deals-og-card");
    expect(tags).not.toMatch(/Sienna|Vista|Chesmar|M\/I|Rio Grande|Hanging Basket/i);
  });

  it("builds a shared community's card from public fields only, with the cover photo and no declared size (Oct 26)", () => {
    const card = dealsCommunityShareCard({ label: "Northeast San Antonio | From the $400s and Move-In Ready Homes", area: "Northeast San Antonio", fromPriceLabel: "From $499,990", homesAvailable: 4, schoolDistrict: "Schertz-Cibolo-Universal City ISD", redHotDeals: 1 });
    expect(card.title).toBe("Northeast San Antonio | From the $400s and Move-In Ready Homes");
    expect(card.description).toBe("4 move-in ready homes from $499,990 · Schertz-Cibolo-Universal City ISD · 1 Red Hot Deal. Photos, prices and this week's builder incentive, before you pick an agent.");
    expect(dealsCommunityShareCard({ label: "Kyle | From the $300s", area: "Kyle", fromPriceLabel: null, homesAvailable: 0 }).description).toMatch(/^New homes to build\. /);
    const tags = buildTags({ title: card.title, description: card.description, url: "https://example.com/deals?k=41023f496be9", image: "/deals/pub/img/abc", imageSize: null });
    expect(tags).toContain('content="https://example.com/deals/pub/img/abc"');
    expect(tags).not.toContain("og:image:width");
    expect(tags).toContain('content="https://example.com/deals?k=41023f496be9"');
    // The static cards still declare their 1200x630.
    expect(buildTags({ title: "x", description: "y", url: "https://example.com/deals", image: DEALS_OG_IMAGE })).toContain('og:image:width" content="1200"');
  });
});
