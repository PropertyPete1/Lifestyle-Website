import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import { describe, expect, it } from "vitest";
import { areaMapRadiusPixels, driveTimeChipLabels, mercatorMetresPerPixel, validDealsAreaMap } from "../client/src/lib/dealsAreaMap";
import { IDENTITY_PATTERN_OPACITY, escapeXml, identityPatternDataUri, identityPatternStyle, identityPatternSvg, identityPatternText } from "../client/src/lib/dealsIdentityPattern";
import type { GatedCommunity, GatedLead } from "../client/src/components/deals/GatedCatalog";

/**
 * Gated page markup (A19 containment, D11 copy, D12 identity background, G1
 * area map) rendered to static HTML. The server-side vitest config compiles
 * client JSX with the classic runtime, so React is exposed as a global before
 * the component module loads.
 */
(globalThis as { React?: typeof React }).React = React;
const { GatedCatalog, PHOTOS_ON_REQUEST, ProtectedGallery, countdownLabel } = await import("../client/src/components/deals/GatedCatalog");
const { AreaMap } = await import("../client/src/components/deals/AreaMap");
const { createElement } = React;

const PHONE_VIEWPORT = 375;
const NOW = Date.UTC(2026, 9, 19, 12, 0, 0);
const lead: GatedLead = { display: "@demo_buyer", expiresAt: new Date(NOW + 23 * 3600_000 + 14 * 60_000 + 5_000).toISOString(), name: null, timeline: null, teamPreview: false };
const areaMap = { lat: 29.42, lng: -98.49, radiusMiles: 2, zoom: 11, imageUrl: "/deals/mine/maps/7.png", attribution: "Map data and imagery from Google. Centered on the ZIP code area, not the community." };
const communities: GatedCommunity[] = [
  {
    label: "Southeast demo area | Half-acre lots", area: "Southeast demo area", schoolDistrict: "Demo ISD", lotSizes: "Half-acre lots", amenities: ["Walking trails", "Lakes"],
    driveTimes: ["about 25 min to downtown San Antonio", "about 20 min to Randolph AFB", "not a chip"], areaMap, fromPrice: 499000, reelUrl: null, updatedAt: "2026-10-18T12:00:00.000Z",
    incentive: { text: "Demo incentive wording.", headlineRate: "4.25%", followOnRate: "6.25%", followOnPeriod: "Years 2 to 30", apr: "6.051%", loanType: "FHA 30-yr fixed", downPayment: null, repaymentTerms: null, contractBy: null, closeBy: null },
    homes: [
      { card: "a".repeat(20), kind: "quick_move_in", beds: "4", baths: "3", sqft: 2500, price: 499000, previousPrice: 519000, moveInDate: "Nov 2026", lotSize: "0.5 acre", photos: ["/deals/mine/img/1", "/deals/mine/img/2", "/deals/mine/img/3"] },
      { card: "b".repeat(20), kind: "quick_move_in", beds: "3", baths: "2", sqft: 1800, price: 389000, previousPrice: null, photos: ["/deals/mine/img/4"] },
    ],
  },
  {
    label: "Southeast demo area | New phase", area: "Southeast demo area", reelUrl: null, areaMap: null, driveTimes: [], updatedAt: "2026-10-17T12:00:00.000Z", incentive: null,
    homes: [{ card: "c".repeat(20), kind: "to_be_built", beds: "3", baths: "2", sqft: 2000, price: 354990, photos: [] }],
  },
];

function render(overrides: { lead?: Partial<GatedLead>; communities?: GatedCommunity[] } = {}) {
  // wouter's Link reads the browser location; the SSR router supplies the gated path instead.
  return renderToStaticMarkup(createElement(Router, { ssrPath: "/deals/mine" }, createElement(GatedCatalog, { lead: { ...lead, ...overrides.lead }, communities: overrides.communities ?? communities, now: NOW })));
}

/** Every explicit pixel width in the markup: width="N" attributes and width: Npx inline styles. */
function inlinePixelWidths(html: string): number[] {
  const widths: number[] = [];
  for (const match of html.matchAll(/\swidth="(\d+(?:\.\d+)?)"/g)) widths.push(Number(match[1]));
  for (const match of html.matchAll(/style="([^"]*)"/g)) {
    for (const width of match[1].matchAll(/(?:^|;)\s*(?:min-|max-)?width:\s*(\d+(?:\.\d+)?)px/g)) widths.push(Number(width[1]));
  }
  return widths;
}

const openingTags = (html: string, pattern: RegExp) => Array.from(html.matchAll(/<[a-z][^>]*>/g)).map((match) => match[0]).filter((tag) => pattern.test(tag));
const decode = (value: string) => value.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

describe("gated catalog stays inside a 375 px phone viewport (A19)", () => {
  const html = render();

  it("declares no inline pixel width wider than the phone viewport", () => {
    const wide = inlinePixelWidths(html).filter((width) => width > PHONE_VIEWPORT);
    expect(wide).toEqual([]);
  });

  it("constrains every gallery container and card with min-w-0 and keeps gallery images lazy", () => {
    const carousels = openingTags(html, /aria-roledescription="carousel"/);
    expect(carousels.length).toBe(2);
    for (const tag of carousels) expect(tag).toMatch(/class="[^"]*\bmin-w-0\b/);
    const slides = openingTags(html, /aria-roledescription="slide"/);
    expect(slides.length).toBe(4);
    for (const tag of slides) expect(tag).toMatch(/class="[^"]*\bmin-w-0\b/);
    const cards = openingTags(html, /^<article\b/);
    expect(cards.length).toBe(3);
    for (const tag of cards) expect(tag).toMatch(/class="[^"]*\bmin-w-0\b/);
    const galleryImages = openingTags(html, /^<img\b[^>]*src="\/deals\/mine\/img\//);
    expect(galleryImages.length).toBe(4);
    for (const tag of galleryImages) {
      expect(tag).toContain('loading="lazy"');
      expect(tag).toMatch(/class="[^"]*\bmax-w-full\b/);
    }
    expect(html).toMatch(/<main[^>]*class="[^"]*\boverflow-x-clip\b/);
  });

  it("shows the exact photos-on-request copy for a home without a usable photo (D11)", () => {
    expect(PHOTOS_ON_REQUEST).toBe("Photos on request");
    expect(html).toContain(">Photos on request<");
    expect(html).not.toContain("ask us for the latest gallery");
    expect(renderToStaticMarkup(createElement(ProtectedGallery, { photos: [] }))).toContain(">Photos on request<");
    expect(renderToStaticMarkup(createElement(ProtectedGallery, { photos: undefined }))).toContain(">Photos on request<");
  });

  it("renders the countdown, price drop badge and buyer request controls", () => {
    expect(html).toContain("23:14:05");
    expect(countdownLabel(new Date(NOW - 1000).toISOString(), NOW)).toBe("00:00:00");
    expect(html.match(/Price drop/g)?.length).toBe(1);
    expect(html).toContain("$519,000");
    expect(html.match(/Tour this home with us/g)?.length).toBe(2);
    expect(html.match(/Ask about this one/g)?.length).toBe(1);
    expect(html).toContain("Add your name so we know who to text.");
  });

  it("replaces the buyer buttons with a non-clickable Team preview label for team sessions", () => {
    const team = render({ lead: { teamPreview: true, name: "Peter" } });
    expect(team).not.toContain("Tour this home with us");
    expect(team).not.toContain("Ask about this one");
    expect(team.match(/>Team preview</g)?.length).toBe(3);
    expect(team).toContain("Private buyer list · Team preview");
    expect(team).not.toContain("Add your name so we know who to text.");
  });
});

describe("identity background pattern (D12)", () => {
  it("builds the per-lead text, XML-escapes it and URL-encodes the SVG", () => {
    expect(identityPatternText("@demo_buyer")).toBe("Prepared for @demo_buyer | Lifestyle Design Realty");
    expect(escapeXml(`Tom & "Jerry" <O'Neil>`)).toBe("Tom &amp; &quot;Jerry&quot; &lt;O&apos;Neil&gt;");
    const svg = identityPatternSvg(`Tom & "Jerry" <O'Neil>`);
    expect(svg).toContain("Prepared for Tom &amp; &quot;Jerry&quot; &lt;O&apos;Neil&gt; | Lifestyle Design Realty");
    expect(svg).not.toContain("<O'Neil>");
    expect(svg).toContain(`fill-opacity="${IDENTITY_PATTERN_OPACITY}"`);
    expect(IDENTITY_PATTERN_OPACITY).toBeGreaterThanOrEqual(0.03);
    expect(IDENTITY_PATTERN_OPACITY).toBeLessThanOrEqual(0.05);
    const uri = identityPatternDataUri("@demo_buyer");
    expect(uri.startsWith("data:image/svg+xml,")).toBe(true);
    const payload = uri.slice("data:image/svg+xml,".length);
    expect(payload).not.toMatch(/[<>"#\s]/);
    expect(decodeURIComponent(payload)).toBe(identityPatternSvg("@demo_buyer"));
    expect(identityPatternSvg("@demo_buyer").match(/<text /g)?.length).toBe(3);
  });

  it("falls back to a neutral label for a blank display and bounds a very long one", () => {
    expect(identityPatternText("   ")).toBe("Prepared for you | Lifestyle Design Realty");
    const long = identityPatternText("x".repeat(400));
    expect(long.length).toBeLessThan(120);
  });

  it("sets the repeating identity pattern on the gated main element and removes the static placeholder line", () => {
    const html = render();
    const main = openingTags(html, /^<main\b/)[0];
    expect(main).toBeDefined();
    const style = decode(/style="([^"]*)"/.exec(main)?.[1] ?? "");
    expect(style).toContain("background-image:url(");
    expect(style).toContain("data:image/svg+xml,");
    expect(style).toContain("background-repeat:repeat");
    const encoded = /data:image\/svg\+xml,([^")]+)/.exec(style)?.[1] ?? "";
    expect(decodeURIComponent(encoded)).toContain("Prepared for @demo_buyer | Lifestyle Design Realty");
    expect(html).not.toContain("PREPARED FOR · PREPARED FOR");
    expect(html).toContain("Prepared for @demo_buyer</h1>");
    const named = render({ lead: { display: "Pat Example", name: "Pat Example" } });
    expect(decodeURIComponent(/data:image\/svg\+xml,([^")]+)/.exec(decode(openingTags(named, /^<main\b/)[0]))?.[1] ?? "")).toContain("Prepared for Pat Example | Lifestyle Design Realty");
    expect(identityPatternStyle("@demo_buyer").backgroundRepeat).toBe("repeat");
  });
});

describe("area map (G1)", () => {
  it("computes the Web Mercator circle radius for the server zoom at the ZIP latitude", () => {
    expect(mercatorMetresPerPixel(0, 0)).toBeCloseTo(156543.03392, 3);
    expect(mercatorMetresPerPixel(0, 11)).toBeCloseTo(156543.03392 / 2048, 6);
    const metresPerPixel = 156543.03392 * Math.cos(29.42 * Math.PI / 180) / 2 ** 11;
    expect(areaMapRadiusPixels({ lat: 29.42, zoom: 11, radiusMiles: 2 })).toBeCloseTo(2 * 1609.344 / metresPerPixel, 6);
    expect(areaMapRadiusPixels({ lat: 29.42, zoom: 11, radiusMiles: 2 })).toBeGreaterThan(40);
    expect(areaMapRadiusPixels({ lat: 29.42, zoom: 11, radiusMiles: 2 })).toBeLessThan(60);
    // Further north the same radius covers more pixels; one zoom level out halves it.
    expect(areaMapRadiusPixels({ lat: 45, zoom: 11, radiusMiles: 2 })).toBeGreaterThan(areaMapRadiusPixels({ lat: 29.42, zoom: 11, radiusMiles: 2 }));
    expect(areaMapRadiusPixels({ lat: 29.42, zoom: 10, radiusMiles: 2 })).toBeCloseTo(areaMapRadiusPixels({ lat: 29.42, zoom: 11, radiusMiles: 2 }) / 2, 6);
  });

  it("accepts only the server's same-origin map shape", () => {
    expect(validDealsAreaMap(areaMap)).toBe(true);
    expect(validDealsAreaMap({ ...areaMap, imageUrl: "https://maps.googleapis.com/staticmap?center=1,2" })).toBe(false);
    expect(validDealsAreaMap({ ...areaMap, imageUrl: "/deals/mine/maps/7" })).toBe(false);
    expect(validDealsAreaMap({ ...areaMap, zoom: 11.5 })).toBe(false);
    expect(validDealsAreaMap({ ...areaMap, radiusMiles: 0 })).toBe(false);
    expect(validDealsAreaMap({ ...areaMap, attribution: " " })).toBe(false);
    expect(validDealsAreaMap(null)).toBe(false);
    expect(driveTimeChipLabels(["about 25 min to downtown San Antonio", "20 min to Randolph AFB", "no minutes here", 5])).toEqual(["about 25 min to downtown San Antonio", "About 20 min to Randolph AFB"]);
  });

  it("renders the static image lazily from the same-origin URL with a centred shaded circle, no pin, the attribution and the chips", () => {
    const html = renderToStaticMarkup(createElement(AreaMap, { chips: ["about 25 min to downtown San Antonio", "about 20 min to Randolph AFB"], map: areaMap }));
    const image = openingTags(html, /^<img\b/)[0];
    expect(image).toContain('src="/deals/mine/maps/7.png"');
    expect(image).toContain('loading="lazy"');
    expect(image).toMatch(/referrerpolicy="same-origin"/i);
    expect(image).not.toMatch(/src="https?:/);
    const svg = /<svg[^>]*>([\s\S]*?)<\/svg>/.exec(html);
    expect(svg?.[0]).toContain('viewBox="0 0 800 400"');
    expect(svg?.[1]).toMatch(/^<circle [^>]*\/?>(<\/circle>)?$/);
    const circle = /<circle ([^>]*)>/.exec(html)?.[1] ?? "";
    expect(circle).toContain('cx="400"');
    expect(circle).toContain('cy="200"');
    const radius = Number(/\br="([\d.]+)"/.exec(circle)?.[1]);
    expect(radius).toBeCloseTo(areaMapRadiusPixels(areaMap), 0);
    expect(html).not.toMatch(/<(?:path|marker|image|polygon)\b/);
    expect(html).toContain(areaMap.attribution);
    expect(html).toContain("About 2-mile radius around the ZIP code centroid. Not the community location.");
    expect(html).toContain("about 25 min to downtown San Antonio");
    expect(html).toContain("about 20 min to Randolph AFB");
    expect(html).not.toContain("Approximate area map unavailable");
  });

  it("fails closed without a map: the fallback copy, no image and no circle", () => {
    const html = renderToStaticMarkup(createElement(AreaMap, { chips: ["about 20 min to Randolph AFB"], map: null }));
    expect(html).toContain("Approximate area map unavailable. Ask us for area details. No exact community location is shown.");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<circle");
    expect(html).toContain("about 20 min to Randolph AFB");
    expect(html).not.toMatch(/—/);
  });

  it("renders one area map per community inside the gated page", () => {
    const html = render();
    expect(openingTags(html, /aria-label="Approximate area map"/).length).toBe(2);
    expect(openingTags(html, /^<img\b[^>]*src="\/deals\/mine\/maps\//).length).toBe(1);
    expect(html.match(/Approximate area map unavailable/g)?.length).toBe(1);
  });
});
