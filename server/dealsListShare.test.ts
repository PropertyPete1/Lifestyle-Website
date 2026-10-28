import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EMPTY_FILTERS } from "../client/src/lib/dealsBrowse";
import { SHARED_FILTERS_STORAGE_KEY, decodeSharedFilters, encodeSharedFilters, keepSharedFilters, sharedFiltersOn, sharedFiltersSummary, takeSharedFilters } from "../client/src/lib/dealsListShare";

(globalThis as { React?: typeof React }).React = React;
const { createElement } = React;
const { AgentTools } = await import("../client/src/components/deals/AgentTools");
const decode = (html: string) => html.replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, "\"");

describe("sending the filtered list (Oct 28, Peter: New Home Buddy sends the whole list when no home is picked)", () => {
  const filters = { ...EMPTY_FILTERS, area: "New Braunfels", maxPrice: 400_000, minBeds: 3, redHot: true, sort: "price_asc" as const, savedOnly: true };

  it("rides in the link and comes back exactly, without the agent's saved-only view", () => {
    const query = encodeSharedFilters(filters);
    expect(query).toMatch(/^f=[A-Za-z0-9_-]+$/);
    const back = decodeSharedFilters(query.slice(2));
    expect(back).toEqual({ ...EMPTY_FILTERS, area: "New Braunfels", maxPrice: 400_000, minBeds: 3, redHot: true, sort: "price_asc" });
    expect(encodeSharedFilters({ ...EMPTY_FILTERS, sort: "price_desc" })).toBe("");
    expect(sharedFiltersOn(EMPTY_FILTERS)).toBe(false);
  });

  it("drops anything malformed rather than trusting it", () => {
    expect(decodeSharedFilters("not-base64!!")).toBeNull();
    const evil = Buffer.from(JSON.stringify({ v: 1, maxPrice: "1; drop", minBeds: -2, area: "x".repeat(500), stories: 7, sort: "evil", redHot: "yes", builder: "Chesmar" })).toString("base64url");
    expect(decodeSharedFilters(evil)).toEqual({ ...EMPTY_FILTERS, builder: "Chesmar" });
    expect(decodeSharedFilters(Buffer.from(JSON.stringify({ v: 2, area: "Kyle" })).toString("base64url"))).toBeNull();
  });

  it("names the list in a few words for the text", () => {
    expect(sharedFiltersSummary(filters)).toBe("New Braunfels, under $400K, 3+ beds, price drops");
  });

  it("is kept by the landing page through the code check and taken once by the list, while fresh", () => {
    const store = new Map<string, string>();
    const fake = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); }, removeItem: (key: string) => { store.delete(key); } };
    keepSharedFilters(`?c=abc&${encodeSharedFilters(filters)}`, fake, 1_000);
    expect(store.has(SHARED_FILTERS_STORAGE_KEY)).toBe(true);
    expect(takeSharedFilters(fake, 2_000)).toMatchObject({ area: "New Braunfels", maxPrice: 400_000 });
    expect(takeSharedFilters(fake, 3_000)).toBeNull();
    keepSharedFilters(`?c=abc&${encodeSharedFilters(filters)}`, fake, 1_000);
    expect(takeSharedFilters(fake, 1_000 + 8 * 86_400_000)).toBeNull();
  });

  it("the agent tools offer it when nothing is picked, and say what the link opens on", () => {
    const workspace = { agent: { name: "Tiffany Agent", email: "tiffany@lifestyledesignrealty.com", fubLinked: true }, clients: [] };
    const noop = () => undefined;
    const html = decode(renderToStaticMarkup(createElement(AgentTools, { workspace, onCreate: noop, onRevoke: noop, onCopy: noop, origin: "https://lifestyledesignrealty.com", listShare: { filters, count: 23 } })));
    expect(html).toContain("Create link with these 23 homes");
    expect(html).toContain("No homes picked: the link opens on the 23 homes your filters show (New Braunfels, under $400K, 3+ beds, price drops).");
    // Picks win over the filters.
    const picked = decode(renderToStaticMarkup(createElement(AgentTools, { workspace, onCreate: noop, onRevoke: noop, onCopy: noop, origin: "https://lifestyledesignrealty.com", listShare: { filters, count: 23 }, picked: ["a".repeat(20)] })));
    expect(picked).toContain("Create link with 1 pick");
    expect(picked).not.toContain("these 23 homes");
  });
});
