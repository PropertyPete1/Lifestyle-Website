import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { loadOfficialDeals, type CommunitySourceConfig } from "./dealsAdapters";

/**
 * Regression tests on pages the official sites served on October 24, 2026 (the readers' User-Agent), when the sync
 * held these communities. Fixtures in fixtures/deals/live-2026-10-24/ have scripts other than JSON-LD, styles, inline
 * SVG and comments removed, then gzipped; the markup and data the readers parse are as served.
 */
const NOW = new Date("2026-10-24T22:00:00Z");
const live = (name: string) => gunzipSync(readFileSync(new URL(`./fixtures/deals/live-2026-10-24/${name}.html.gz`, import.meta.url))).toString("utf8");

describe("First America Homes: Cordova Crossing (October 24, 2026)", () => {
  const COMMUNITY = "https://www.firstamericahomes.com/new-homes/tx/san-antonio-metro/seguin/cordova-crossing/";
  const config: CommunitySourceConfig = { builder: "First America Homes", sourceUrl: COMMUNITY, privateCommunityName: "Cordova Crossing", scrubList: ["Cordova Crossing", "Sierra Chicas"] };
  it("reads the card-only home under the shorter path the community's own records use (homes at /new-homes/tx/seguin/cordova-crossing/<plan>/<home>/)", async () => {
    const page = live("fah-cordova-crossing");
    const fetcher = vi.fn(async (input: string) => input === COMMUNITY ? new Response(page, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }) : new Response("not found", { status: 404, headers: { "content-type": "text/html" } }));
    const result = await loadOfficialDeals(config, { fetcher: fetcher as never, now: () => NOW });
    expect(result.holdReasons).toEqual([]);
    expect(result.private.homes).toHaveLength(9);
    const cardOnly = result.private.homes.find((home) => home.sourceUrl.includes("/521-cordova-crossing/"))!;
    expect(cardOnly).toBeDefined();
    expect(new URL(cardOnly.sourceUrl).pathname).toBe("/new-homes/tx/seguin/cordova-crossing/avery/521-cordova-crossing/");
    expect(cardOnly.price).toBeGreaterThan(100_000);
  });
});
