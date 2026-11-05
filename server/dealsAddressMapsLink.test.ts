import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Nov 5, 2026 (Peter: addresses on homes sent by agents must be clickable Google Maps links). */
describe("unlocked addresses open Google Maps", () => {
  const source = readFileSync(new URL("../client/src/components/deals/GatedCatalog.tsx", import.meta.url), "utf8");

  it("builds a Google Maps search URL from the full address", async () => {
    const { mapsUrl } = await import("../client/src/components/deals/GatedCatalog");
    expect(mapsUrl("8310 Onion Patch, San Antonio, TX 78223")).toBe("https://www.google.com/maps/search/?api=1&query=8310%20Onion%20Patch%2C%20San%20Antonio%2C%20TX%2078223");
  });

  it("links the opened home's street, the full-list card's address and the community's address, in a new tab", () => {
    const links = source.split("\n").filter((line) => line.includes("<MapsLink address="));
    expect(links.length).toBeGreaterThanOrEqual(4);
    expect(source).toContain('data-deals-maps-link="true"');
    expect(source).toMatch(/<a href=\{mapsUrl\(address\)\} target="_blank" rel="noreferrer"/);
    expect(source).toContain("Open in Google Maps");
  });
});
