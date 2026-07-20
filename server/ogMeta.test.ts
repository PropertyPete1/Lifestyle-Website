import { describe, expect, it } from "vitest";
import { buildTags, escapeHtml } from "./ogMeta";

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
