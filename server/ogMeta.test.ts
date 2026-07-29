import { describe, expect, it } from "vitest";
import { buildTags, escapeHtml } from "./ogMeta";
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
});
