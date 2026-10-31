import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { LightHero } from "../client/src/components/LightHero";

(globalThis as { React?: typeof React }).React = React;
const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf-8");

/** Oct 31, 2026 (Peter: "can you fix the black part, I found another spot with it"). */
describe("no black page heroes", () => {
  it("the light hero has no dark theme or overlay", () => {
    const html = renderToStaticMarkup(React.createElement(LightHero, { eyebrow: "Sellers", title: "Get Your Instant Home Valuation", intro: "Enter your details.", image: "/brand/valuation.webp", alt: "Bright kitchen" }));
    expect(html).toContain("Get Your Instant Home Valuation");
    expect(html).toContain('src="/brand/valuation.webp"');
    expect(html).not.toMatch(/class="dark |bg-black\/|from-background/);
  });

  it("drops the photo column when a city has no photo", () => {
    const html = renderToStaticMarkup(React.createElement(LightHero, { eyebrow: "Texas", title: "Kyle", image: null, alt: "Kyle" }));
    expect(html).not.toContain("<img");
    expect(html).not.toContain("lg:grid-cols");
  });

  it("/valuation, /sell and the city pages use it, and no page keeps a dark photo band", () => {
    for (const page of ["Valuation", "Sell", "NeighborhoodDetail"]) {
      const src = read(`client/src/pages/${page}.tsx`);
      expect(src).toContain("<LightHero");
      expect(src).not.toMatch(/className="dark relative min-h/);
      expect(src).not.toContain("from-background to-transparent");
    }
    expect(read("client/src/pages/Valuation.tsx")).toContain("BRAND_IMG.valuation");
  });
});
