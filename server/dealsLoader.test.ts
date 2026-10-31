import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

(globalThis as { React?: typeof React }).React = React;
const { DealsLoader, DEALS_LOADER_COPY } = await import("../client/src/components/deals/DealsLoader");
const { ListSkeleton } = await import("../client/src/components/deals/GatedCatalog");
const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf-8");

/**
 * Oct 31, 2026 (Peter: "when clicking new home search it takes a second to load, should we make a cute loading page"):
 * a branded loader that shows only while the homes load (never a wait of its own), and the list fetched ahead from /links.
 */
describe("the deals loading screen", () => {
  it("draws the ring, the house, the heading and the first step, as a polite status", () => {
    const html = renderToStaticMarkup(React.createElement(DealsLoader));
    expect(html).toContain('data-deals-loader="true"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(DEALS_LOADER_COPY.heading).toBe("Finding this week's best builder deals");
    expect(html).toContain("best builder deals");
    expect(html).toContain(DEALS_LOADER_COPY.steps[0]);
    expect(html).toContain("prefers-reduced-motion: reduce");
  });

  it("opens the team and private lists with the loader, headed by what is loading", () => {
    const html = renderToStaticMarkup(React.createElement(ListSkeleton, { label: "Preparing the team list…" }));
    expect(html).toContain('data-deals-list-skeleton="true"');
    expect(html).toContain('data-deals-loader="true"');
    expect(html).toContain(">Preparing the team list<");
  });

  it("stands in for the public list only while it loads, and never on a timer", () => {
    const page = read("client/src/components/deals/PublicDealsPage.tsx");
    expect(page).toContain('{loading && all.length === 0 ? <DealsLoader minHeight="55vh" /> : <LandingBrowse');
    expect(read("client/src/pages/Deals.tsx")).toContain("<PublicDealsPage loading={catalog.isLoading}");
    const loader = read("client/src/components/deals/DealsLoader.tsx");
    expect(loader).not.toMatch(/setTimeout/);
  });

  it("fetches the deals list ahead on /links, after the page has painted", () => {
    const links = read("client/src/pages/Links.tsx");
    expect(links).toContain("void utils.deals.publicCatalog.prefetch(undefined);");
    expect(links).toContain("void utils.deals.featured.prefetch();");
  });
});
