import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import { describe, expect, it } from "vitest";
import { HELD_INCENTIVE_PUBLIC_LINE, heldIncentivePublicEntry } from "../shared/dealsHeldIncentive";
import type { GatedCommunity } from "../client/src/components/deals/GatedCatalog";

/** The buyer card for a held offer: the neutral line only, no rate block and no financing fine print. */
(globalThis as { React?: typeof React }).React = React;
const { Incentive } = await import("../client/src/components/deals/shared");
const { GatedCatalog } = await import("../client/src/components/deals/GatedCatalog");
const decode = (value: string) => value.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

describe("the held-offer card", () => {
  it("shows the neutral line alone, compact or full", () => {
    for (const compact of [true, false]) {
      const html = decode(renderToStaticMarkup(React.createElement(Incentive, { incentive: heldIncentivePublicEntry(), compact })));
      expect(html).toContain(HELD_INCENTIVE_PUBLIC_LINE);
      expect(html).toContain('data-deals-incentive-pending="true"');
      expect(html).not.toContain("data-deals-rates");
      // The visible text is the line and nothing else.
      expect(html.replace(/<[^>]+>/g, "")).toBe(HELD_INCENTIVE_PUBLIC_LINE);
    }
  });
});

describe("the gated list's collapsed summary row (Reg Z)", () => {
  it("never prints a builder rate without its APR: it names the offer and leaves the figures to the card", () => {
    const NOW = Date.UTC(2026, 9, 19, 12, 0, 0);
    const community = (n: number, incentive: GatedCommunity["incentive"]): GatedCommunity => ({
      label: `Demo area ${n} | Homes`, area: "Demo area", reelUrl: null, areaMap: null, driveTimes: [], updatedAt: "2026-10-18T12:00:00.000Z", incentive,
      homes: [{ card: String(n).repeat(20), kind: "quick_move_in", beds: "3", baths: "2", sqft: 1800, price: 389000 + n, previousPrice: null, photos: [] }],
    } as GatedCommunity);
    const rated = { text: "Demo wording.", headlineRate: "4.25%", followOnRate: "6.25%", followOnPeriod: "Years 2 to 30", apr: "6.051%", loanType: "FHA", downPayment: null, repaymentTerms: null, contractBy: null, closeBy: null };
    // More communities than open at once, so each one renders as a collapsed summary row.
    const communities = [community(1, rated), community(2, heldIncentivePublicEntry()), community(3, null), community(4, null), community(5, null)];
    const html = decode(renderToStaticMarkup(React.createElement(Router, { ssrPath: "/deals/mine" }, React.createElement(GatedCatalog, { lead: { display: "@demo", expiresAt: new Date(NOW + 3_600_000).toISOString(), name: null, timeline: null, teamPreview: false }, communities, now: NOW }))));
    // Oct 27: a long list is cards; a card prints the rate only beside its APR, and a held offer prints no figure.
    expect(html).toContain("4.25% rate · 6.051% APR");
    expect(html).not.toMatch(/4\.25%(?! rate · 6\.051% APR)/);
  });
});
