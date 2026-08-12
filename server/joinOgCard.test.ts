import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  JOIN_OG_DESCRIPTION,
  JOIN_OG_IMAGE,
  JOIN_OG_TITLE,
  buildTags,
} from "./ogMeta";

const SRC = readFileSync(join(__dirname, "ogMeta.ts"), "utf-8");

/**
 * The /join share card must sell the recruiting opportunity, not the general
 * homepage. These tests pin the copy, the dedicated image, the canonical URL
 * behaviour, and the fact that the new branch is scoped to /join only.
 */
describe("join OG card", () => {
  it("uses the approved recruiting title", () => {
    expect(JOIN_OG_TITLE).toBe("Now Hiring: Licensed Agents — Lifestyle Design Realty");
  });

  it("describes the offer with the lease commission figure and all four markets", () => {
    expect(JOIN_OG_DESCRIPTION).toContain("Real leads. Real support.");
    expect(JOIN_OG_DESCRIPTION).toContain("$6,000 per deal");
    expect(JOIN_OG_DESCRIPTION).toContain("Veteran-owned");
    for (const market of ["Austin", "San Antonio", "Dallas", "Houston"]) {
      expect(JOIN_OG_DESCRIPTION).toContain(market);
    }
  });

  it("points at a recruiting-specific card, not the Convince letter card", () => {
    expect(JOIN_OG_IMAGE).toContain("join-og-card");
    expect(JOIN_OG_IMAGE).not.toContain("convince-og-card");
    // must be a project-lifecycle storage URL, not a local/dev path
    expect(JOIN_OG_IMAGE.startsWith("/manus-storage/")).toBe(true);
  });

  it("emits full OG + Twitter summary_large_image tags for /join", () => {
    const tags = buildTags({
      title: JOIN_OG_TITLE,
      description: JOIN_OG_DESCRIPTION,
      url: "https://lifestyledesignrealty.com/join",
      image: JOIN_OG_IMAGE,
    });
    expect(tags).toContain(
      `<meta property="og:title" content="Now Hiring: Licensed Agents — Lifestyle Design Realty" />`
    );
    expect(tags).toContain(
      `<meta property="og:url" content="https://lifestyledesignrealty.com/join" />`
    );
    expect(tags).toContain(
      `<meta property="og:image" content="https://lifestyledesignrealty.com${JOIN_OG_IMAGE}" />`
    );
    expect(tags).toContain(`<meta name="twitter:card" content="summary_large_image" />`);
    expect(tags).toContain(
      `<meta name="twitter:image" content="https://lifestyledesignrealty.com${JOIN_OG_IMAGE}" />`
    );
    expect(tags).toContain(`<meta property="og:image:width" content="1200" />`);
    expect(tags).toContain(`<meta property="og:image:height" content="630" />`);
    // the recruiting card must never fall through to the letter card
    expect(tags).not.toContain("convince-og-card");
  });

  it("escapes the em dash safely and leaves the ampersand entity-encoded", () => {
    const tags = buildTags({
      title: JOIN_OG_TITLE,
      description: JOIN_OG_DESCRIPTION,
      url: "https://lifestyledesignrealty.com/join",
      image: JOIN_OG_IMAGE,
    });
    // "Dallas & Houston" must not emit a raw & that breaks the attribute
    expect(tags).toContain("Dallas &amp; Houston");
    expect(tags).not.toMatch(/content="[^"]*Dallas & /);
  });

  it("matches /join exactly, so it cannot capture an unrelated future route", () => {
    // guards against a startsWith("/join") style match catching /joinus etc.
    expect(SRC).toMatch(/req\.path === "\/join"/);
    expect(SRC).not.toMatch(/startsWith\("\/join"\)/);
  });

  it("canonicalises the trailing-slash variant onto /join", () => {
    expect(SRC).toMatch(/req\.path === "\/join\/"/);
    expect(SRC).toMatch(/\$\{proto\}:\/\/\$\{host\}\/join/);
  });

  it("keeps the existing convince and city-finder branches intact", () => {
    expect(SRC).toContain('req.path.startsWith("/convince")');
    expect(SRC).toContain('req.path.startsWith("/city-finder")');
  });
});
