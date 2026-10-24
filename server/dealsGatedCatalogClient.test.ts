import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import { describe, expect, it } from "vitest";
import { areaMapRadiusPixels, driveTimeChipLabels, mercatorMetresPerPixel, radiusPhrase, validDealsAreaMap } from "../client/src/lib/dealsAreaMap";
import { IDENTITY_PATTERN_OPACITY, escapeXml, identityPatternDataUri, identityPatternStyle, identityPatternSvg, identityPatternText } from "../client/src/lib/dealsIdentityPattern";
import { MINE_COPY, PROFILE_NAME_MAX, countdownExpired, countdownSeconds, isUnauthorizedDealsError, profileErrorCopy, profileInput } from "../client/src/lib/dealsMine";
import { SITE } from "../shared/site";
import type { GatedCatalogProps, GatedCommunity, GatedLead } from "../client/src/components/deals/GatedCatalog";
import type { DealsIncentive } from "../client/src/components/deals/shared";

/**
 * Gated page markup (A19 containment, D11 copy, D12 identity background, G1
 * area map) rendered to static HTML. The server-side vitest config compiles
 * client JSX with the classic runtime, so React is exposed as a global before
 * the component module loads.
 */
(globalThis as { React?: typeof React }).React = React;
const { GatedCatalog, PHOTOS_ON_REQUEST, ProtectedGallery, countdownLabel } = await import("../client/src/components/deals/GatedCatalog");
const { AreaMap } = await import("../client/src/components/deals/AreaMap");
const { Countdown } = await import("../client/src/components/deals/Countdown");
const { DealsFooter, Incentive, RATE_CLASS, incentiveRateLines } = await import("../client/src/components/deals/shared");
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

function render(overrides: { lead?: Partial<GatedLead>; communities?: GatedCommunity[] } & Partial<Omit<GatedCatalogProps, "lead" | "communities">> = {}) {
  const { lead: leadOverrides, communities: communityOverrides, ...rest } = overrides;
  // wouter's Link reads the browser location; the SSR router supplies the gated path instead.
  return renderToStaticMarkup(createElement(Router, { ssrPath: "/deals/mine" }, createElement(GatedCatalog, { lead: { ...lead, ...leadOverrides }, communities: communityOverrides ?? communities, now: NOW, ...rest })));
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
    // Several photos: a "1 / n" count, and arrows that stay readable over a bright exterior.
    expect(html).toContain('data-deals-photo-count="true"');
    expect(html).toMatch(/data-deals-photo-count="true"[^>]*>1(?:<!-- -->)? \/ (?:<!-- -->)?\d+</);
    expect(html).toMatch(/<button[^>]*bg-black\/60[^>]*aria-label="Next home photo"|<button[^>]*aria-label="Next home photo"[^>]*bg-black\/60/);
  });

  it("shows the exact photos-on-request copy for a home without a usable photo (D11)", () => {
    expect(PHOTOS_ON_REQUEST).toBe("Photos on request");
    expect(html).toContain(">Photos on request<");
    expect(html).not.toContain("ask us for the latest gallery");
    expect(renderToStaticMarkup(createElement(ProtectedGallery, { photos: [] }))).toContain(">Photos on request<");
    expect(renderToStaticMarkup(createElement(ProtectedGallery, { photos: undefined }))).toContain(">Photos on request<");
  });

  it("renders the countdown, Red Hot Deal badge and buyer request controls", () => {
    expect(html).toContain("23:14:05");
    expect(countdownLabel(new Date(NOW - 1000).toISOString(), NOW)).toBe("00:00:00");
    // Oct 24 (Peter): a real price drop is a red "Red Hot Deal", the original price crossed out and the savings shown.
    expect(html.match(/Red Hot Deal/g)?.length).toBe(1);
    expect(html).not.toContain("Price drop");
    expect(html).toContain("$519,000");
    expect(html).toContain("Extreme savings · Save $20,000");
    expect(html.match(/Tour this home with us/g)?.length).toBe(2);
    expect(html.match(/Ask about this one/g)?.length).toBe(1);
    expect(html).toContain("Add your name so we know who to text.");
  });

  it("replaces the buyer buttons with a non-clickable Team view label for team sessions and links the agent tools", () => {
    const team = render({ lead: { teamPreview: true, name: "Peter" } });
    expect(team).not.toContain("Tour this home with us");
    expect(team).not.toContain("Ask about this one");
    // Three card labels plus the page eyebrow.
    expect(team.match(/>Team view</g)?.length).toBe(4);
    expect(team).toContain(">Team view</p><h1");
    expect(team).toContain('href="/deals/team"');
    expect(team).not.toContain("Add your name so we know who to text.");
    // A team member who has not given a name is never asked for one either.
    expect(render({ lead: { teamPreview: true, name: null } })).not.toContain("Add your name so we know who to text.");
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

  it("draws the landing card's circle from its pixel size alone, with no ZIP wording and the right article", () => {
    const publicMap = { radiusMiles: 8, radiusPixels: 132.4, imageUrl: "/deals/maps/7.webp", attribution: "Map data and imagery from Google. General area only." };
    expect(validDealsAreaMap(publicMap)).toBe(true);
    expect(validDealsAreaMap({ ...publicMap, radiusPixels: 9_999 })).toBe(false);
    expect(validDealsAreaMap({ radiusMiles: 8, imageUrl: "/deals/maps/7.webp", attribution: "x" })).toBe(false);
    const html = renderToStaticMarkup(createElement(AreaMap, { map: publicMap, variant: "public" }));
    expect(/<circle ([^>]*)>/.exec(html)?.[1]).toContain('r="132.4"');
    expect(html).toContain("General area only: about an 8-mile radius. Unlock the list for a closer look.");
    expect(html).not.toMatch(/ZIP|centroid|a 8-mile/);
    for (const [miles, phrase] of [[5, "a 5-mile"], [11, "an 11-mile"], [18, "an 18-mile"], [1, "a 1-mile"], [12, "a 12-mile"], [8.5, "an 8.5-mile"]] as const) expect(radiusPhrase(miles)).toBe(phrase);
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

const baseIncentive: DealsIncentive = { text: "Demo incentive wording.", headlineRate: "4.25%", followOnRate: "6.25%", followOnPeriod: "Years 2 to 30", apr: "6.051%", loanType: "FHA 30-yr fixed", downPayment: null, repaymentTerms: null, contractBy: null, closeBy: null };
const rateCells = (html: string) => Array.from(html.matchAll(/<p class="([^"]*)">([^<]*)<\/p>/g)).filter((match) => match[1] === RATE_CLASS).map((match) => decode(match[2]));

describe("incentive rates: equal prominence (Reg Z)", () => {
  it("renders the follow-on period and the headline period in the same element, size, weight and colour as the rates", () => {
    const html = renderToStaticMarkup(createElement(Incentive, { incentive: baseIncentive }));
    expect(rateCells(html)).toEqual(["First year: 4.25%", "Years 2 to 30: 6.25%", "APR: 6.051%"]);
    // No smaller caption carries the period or the APR label any more.
    expect(html).not.toMatch(/text-\[10px\][^>]*>(First year|Years 2 to 30|APR|Rate)</);
    expect(html).not.toMatch(/>(First year|Years 2 to 30|APR|Rate)</);
    expect(RATE_CLASS).toContain("text-lg");
    expect(RATE_CLASS).toContain("font-medium");
    expect(RATE_CLASS).toContain("text-gold");
  });

  it("labels a rate with no follow-on period as the rate and still carries the APR", () => {
    expect(incentiveRateLines({ headlineRate: "5.5%", followOnRate: null, followOnPeriod: null, apr: "5.74%" })).toEqual(["Rate: 5.5%", "APR: 5.74%"]);
    expect(incentiveRateLines({ headlineRate: null, followOnRate: null, followOnPeriod: null, apr: "5.74%" })).toEqual(["APR: 5.74%"]);
    // Reg Z: with no APR, no rate is printed at all.
    expect(incentiveRateLines({ headlineRate: "4.99%", followOnRate: "6.5%", followOnPeriod: null, apr: null })).toEqual([]);
  });

  it("hides the rate row for a closing-cost-only promotion instead of showing empty gold cells", () => {
    const closingCosts: DealsIncentive = { ...baseIncentive, text: "Builder pays closing costs.", headlineRate: null, followOnRate: null, followOnPeriod: null, apr: null };
    expect(incentiveRateLines(closingCosts)).toEqual([]);
    const html = renderToStaticMarkup(createElement(Incentive, { incentive: closingCosts }));
    expect(html).toContain("Builder pays closing costs.");
    expect(html).not.toContain("data-deals-rates");
    expect(rateCells(html)).toEqual([]);
    expect(html).not.toMatch(/>APR</);
    expect(html).not.toMatch(/>Rate</);
    const compact = renderToStaticMarkup(createElement(Incentive, { incentive: { ...closingCosts, teaser: "Closing costs covered." }, compact: true }));
    expect(compact).toContain("Closing costs covered.");
    expect(compact).not.toContain("data-deals-rates");
  });

  it("renders the gated page rates with the same equal-prominence cells", () => {
    const html = render();
    expect(rateCells(html)).toEqual(["First year: 4.25%", "Years 2 to 30: 6.25%", "APR: 6.051%"]);
  });
});

describe("name prompt: nothing is saved until the server would accept it", () => {
  it("builds the profile input only from a 2+ character name or a chosen timeline", () => {
    expect(profileInput("", "")).toBeNull();
    expect(profileInput("   ", "")).toBeNull();
    expect(profileInput("P", "")).toBeNull();
    expect(profileInput("P", "0-3 months")).toBeNull();
    expect(profileInput("Pat", "")).toEqual({ name: "Pat", timeline: undefined });
    expect(profileInput("  Pat Example ", "6-12 months")).toEqual({ name: "Pat Example", timeline: "6-12 months" });
    expect(profileInput("", "12+ months")).toEqual({ name: undefined, timeline: "12+ months" });
    expect(profileInput("", "someday")).toBeNull();
    expect(profileInput("x".repeat(400), "")?.name).toHaveLength(PROFILE_NAME_MAX);
    expect(PROFILE_NAME_MAX).toBe(190);
  });

  it("renders Save disabled with nothing entered, caps the name at 190 characters and shows the update error", () => {
    const html = render();
    const prompt = /<section aria-label="Add your name"[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
    expect(prompt).not.toBe("");
    const save = /<button[^>]*>Save<\/button>/.exec(prompt)?.[0] ?? "";
    expect(save).toMatch(/\sdisabled=""/);
    expect(prompt).toMatch(/<input[^>]*maxlength="190"/i);
    expect(prompt).not.toContain('role="alert"');
    const failed = render({ profileError: MINE_COPY.profileInvalid });
    expect(failed).toMatch(new RegExp(`<p role="alert"[^>]*>${MINE_COPY.profileInvalid}</p>`));
    expect(render({ profileSaved: true })).not.toContain("Add your name so we know who to text.");
  });

  it("turns update failures into readable copy and routes only UNAUTHORIZED back to the gate", () => {
    expect(profileErrorCopy(null)).toBeNull();
    expect(profileErrorCopy({ message: "UNAUTHORIZED", data: { code: "UNAUTHORIZED" } })).toBe(MINE_COPY.profileUnauthorized);
    expect(profileErrorCopy({ message: '[{"code":"too_small"}]', data: { code: "BAD_REQUEST" } })).toBe(MINE_COPY.profileInvalid);
    expect(profileErrorCopy({ message: "boom", data: { code: "INTERNAL_SERVER_ERROR" } })).toBe(MINE_COPY.profileFailed);
    expect(profileErrorCopy({ message: "timeout" })).toBe(MINE_COPY.profileFailed);
    expect(isUnauthorizedDealsError({ data: { code: "UNAUTHORIZED" } })).toBe(true);
    expect(isUnauthorizedDealsError({ data: { code: "INTERNAL_SERVER_ERROR" } })).toBe(false);
    expect(isUnauthorizedDealsError({ message: "Request timed out" })).toBe(false);
    expect(isUnauthorizedDealsError(null)).toBe(false);
    for (const copy of Object.values(MINE_COPY)) expect(copy).not.toMatch(/—/);
  });
});

describe("countdown owns the clock", () => {
  it("counts whole seconds down to 00:00:00 and reports expiry exactly there", () => {
    const expiresAt = new Date(NOW + 61_000).toISOString();
    expect(countdownSeconds(expiresAt, NOW)).toBe(61);
    expect(countdownLabel(expiresAt, NOW)).toBe("00:01:01");
    expect(countdownExpired(expiresAt, NOW)).toBe(false);
    expect(countdownLabel(expiresAt, NOW + 60_000)).toBe("00:00:01");
    expect(countdownExpired(expiresAt, NOW + 60_000)).toBe(false);
    // The label reads 00:00:00 as soon as less than a full second is left; expiry fires with it.
    expect(countdownLabel(expiresAt, NOW + 60_999)).toBe("00:00:00");
    expect(countdownExpired(expiresAt, NOW + 60_999)).toBe(true);
    expect(countdownExpired(expiresAt, NOW + 61_000)).toBe(true);
    expect(countdownExpired(expiresAt, NOW + 3_600_000)).toBe(true);
    expect(countdownLabel(expiresAt, NOW + 3_600_000)).toBe("00:00:00");
  });

  it("renders a time element with the pinned clock, and the gated page uses it in both places", () => {
    const expiresAt = new Date(NOW + 2 * 3600_000 + 3 * 60_000 + 4_000).toISOString();
    const html = renderToStaticMarkup(createElement(Countdown, { expiresAt, now: NOW, className: "tabular-nums" }));
    expect(html).toBe(`<time dateTime="${expiresAt}" class="tabular-nums">02:03:04</time>`);
    const page = render();
    expect(page.match(/<time [^>]*>23:14:05<\/time>/g)?.length).toBe(2);
  });
});

describe("deals footer compliance links and logo", () => {
  it("links the shared IABS and Consumer Protection Notice URLs and shows the Equal Housing Opportunity logo", () => {
    const html = renderToStaticMarkup(createElement(Router, { ssrPath: "/deals" }, createElement(DealsFooter)));
    expect(html).toContain(`href="${SITE.iabsUrl}"`);
    expect(html).toContain(`href="${SITE.cpnUrl}"`);
    expect(html).toMatch(/<svg[^>]*aria-label="Equal Housing Opportunity logo"/);
    expect(html).toContain("Equal Housing Opportunity");
    expect(html).toContain('href="/privacy"');
    expect(decode(html)).not.toMatch(/—/);
  });
});
