/**
 * ADVERSARIAL COMPLIANCE SWEEP.
 *
 * The AI narrative pages (/convince, /city-finder) are the only customer-facing
 * copy on the site that nobody proofreads before a visitor reads it. Everywhere
 * a human wrote a rate claim it carries the attorney-reviewed disclosure
 * adjacent to it (see the homepage financing banner). The guard is what keeps
 * that invariant true for the generated copy.
 *
 * The original guard matched only the SYMBOLS `%` and `$`, so every spelled-out
 * form of the same claim passed: "3.99 percent", "300,000 dollars", "310K",
 * "mortgage rate", "APR of 4.25". These are the exact phrasings an LLM reaches
 * for when a quiz answer nudges it toward money talk, which is why they are
 * pinned here rather than left to the system prompt alone.
 */
import { describe, expect, it } from "vitest";
import { violatesCompliance, fallbackPitch, pickStats } from "./partnerPitch";
import { fallbackNarrative, CITY_DATA } from "./cityNarrative";

describe("compliance guard — figures written as words, not symbols", () => {
  const mustBlock: [string, string][] = [
    ["percent spelled out", "We've secured rates as low as 3.99 percent for clients."],
    ["percent, integer", "Buyers are seeing 5 percent buydowns this quarter."],
    ["percent, British spelling", "Roughly 4 per cent is realistic right now."],
    ["percent, fully spelled", "Mortgage rates near five and a half percent are common."],
    ["mortgage rate (not 'interest rate')", "We can get your mortgage rate down to a great number."],
    ["financing rate", "The financing rate you'd qualify for is excellent."],
    ["rate + 'as low as'", "Rates as low as anything you've seen lately."],
    ["dollars as a word", "Homes there start around 300,000 dollars."],
    ["dollars fully spelled", "You could be looking at three hundred thousand dollars."],
    ["K abbreviation", "Median is right around 310K in that area."],
    ["APR", "An APR of 4.25 is achievable with the right builder."],
    ["basis points", "That's a 75 basis point improvement."],
    ["point buydown", "A two point buydown is on the table."],
  ];

  it.each(mustBlock)("blocks %s", (_label, text) => {
    expect(violatesCompliance(text)).toBe(true);
  });

  // The symbol forms that were already covered must stay covered.
  const stillBlocked: [string, string][] = [
    ["percent symbol", "Rates as low as 3.99% are possible."],
    ["dollar symbol", "Homes start at $310,000."],
    ["interest rate", "With interest rates where they are."],
    ["mortgage payment", "Your mortgage payment would drop."],
    ["half the price", "A home that costs half what you'd pay elsewhere."],
    ["fraction of the price", "Living here for a fraction of the price."],
    ["save thousands", "We can save you thousands on your move."],
  ];
  it.each(stillBlocked)("still blocks %s", (_label, text) => {
    expect(violatesCompliance(text)).toBe(true);
  });
});

describe("compliance guard — does NOT over-block", () => {
  /**
   * Over-blocking is a real cost: each rejection burns a retry and then drops
   * the visitor to templated copy. These are phrasings the system prompt
   * explicitly invites, plus ordinary numbers that carry no financial claim.
   */
  const mustPass: [string, string][] = [
    ["the conceptual buydown language the prompt allows", "Our builder relationships and negotiated rate buydowns work in your favor."],
    ["builder incentives", "We negotiate builder incentives on your behalf, every time."],
    ["soft value, unquantified", "Your money goes further here than it did back home."],
    ["the 30-minute promise", "Reach out and we'll respond within 30 minutes."],
    ["counting markets", "We serve five Texas markets with the same tech-forward approach."],
    ["comparing markets, no price", "Austin's live-music scene is nationally ranked."],
    ["bedrooms", "Three bedrooms, a yard for the dog, and a porch that catches the evening."],
    ["no state income tax", "Texas has no state income tax — your paycheck goes further from day one."],
    ["a plain sensory scene", "Your remote desk faces the Guadalupe River."],
    ["square footage, no dollars", "Dramatically more square footage and lot size than coastal markets."],
    ["an address-like number", "You're ten minutes from I-35 and twenty from downtown."],
  ];

  it.each(mustPass)("allows %s", (_label, text) => {
    expect(violatesCompliance(text)).toBe(false);
  });
});

describe("every shipped fallback stays compliant", () => {
  it("partner-pitch fallbacks for all five markets", () => {
    for (const city of ["San Antonio", "New Braunfels", "Austin", "DFW", "Houston"]) {
      const text = fallbackPitch({ selections: ["Lake/Water Life", "Top-Rated Schools"], city });
      expect(violatesCompliance(text), `fallbackPitch(${city}) must be compliant`).toBe(false);
    }
  });

  it("city-narrative fallbacks for all five markets", () => {
    for (const city of Object.keys(CITY_DATA)) {
      const fb = fallbackNarrative(city);
      expect(violatesCompliance(fb.cityPitch), `${city} cityPitch`).toBe(false);
      expect(violatesCompliance(fb.ldrPitch), `${city} ldrPitch`).toBe(false);
    }
  });

  it("every selection-tied stat line", () => {
    const options = [
      "Lake/Water Life",
      "Nightlife & Food Scene",
      "Space & Land",
      "Top-Rated Schools",
      "Short Commute",
      "Low Taxes & Cost of Living",
      "Outdoor/Hill Country Living",
      "Family-Friendly Community",
    ];
    for (const city of Object.keys(CITY_DATA)) {
      for (const opt of options) {
        for (const line of pickStats([opt], city)) {
          expect(violatesCompliance(line), `stat "${line}"`).toBe(false);
        }
      }
      // and the no-selection default
      for (const line of pickStats([], city)) {
        expect(violatesCompliance(line), `default stat "${line}"`).toBe(false);
      }
    }
  });
});
