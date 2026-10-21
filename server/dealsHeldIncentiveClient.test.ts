import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HELD_INCENTIVE_PUBLIC_LINE, heldIncentivePublicEntry } from "../shared/dealsHeldIncentive";

/** The buyer card for a held offer: the neutral line only, no rate block and no financing fine print. */
(globalThis as { React?: typeof React }).React = React;
const { Incentive } = await import("../client/src/components/deals/shared");
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
