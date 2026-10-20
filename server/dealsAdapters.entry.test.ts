import { describe, expect, it } from "vitest";
// The registry module is the first of the reader modules the server loads; every reader module imports it back.
// A reader that reads a registry constant at module level (not lazily) would throw here, as it would in production.
import { DEAL_ADAPTERS, OFFICIAL_BUILDER_HOSTS, loadOfficialDeals, type BuilderId } from "./dealsAdapters";
import { DISCOVERY_READERS } from "./dealsDiscovery";
import { DRB_BRAND } from "./dealsAdapters.drb";
import { LEGEND_BRAND } from "./dealsAdapters.legend";

describe("reader modules load with the registry first", () => {
  it("builds every adapter and every discovery reader after the registry has loaded", () => {
    for (const builder of Object.keys(DEAL_ADAPTERS) as BuilderId[]) expect(DEAL_ADAPTERS[builder].builder).toBe(builder);
    for (const reader of DISCOVERY_READERS) {
      expect(reader.host).toBe(OFFICIAL_BUILDER_HOSTS[reader.builder]);
      if (reader.index.kind !== "reader") expect(reader.index.url).toMatch(/^https:\/\//);
    }
  });

  it("reads each API-backed brand's host lazily, so a load on the official host is never refused as another host's", async () => {
    expect(DRB_BRAND.host).toBe(OFFICIAL_BUILDER_HOSTS["DRB Homes"]);
    expect(LEGEND_BRAND.host).toBe(OFFICIAL_BUILDER_HOSTS["Legend Homes"]);
    const down = async () => new Response("busy", { status: 503, headers: { "content-type": "application/json" } });
    for (const [builder, sourceUrl] of [["DRB Homes", `https://${OFFICIAL_BUILDER_HOSTS["DRB Homes"]}/drbhomes/find-your-home/communities/texas/san-antonio/fixture-ranch`], ["Legend Homes", `https://${OFFICIAL_BUILDER_HOSTS["Legend Homes"]}/communities/san-antonio/schertz-cibolo/bexar/converse/fixture-ranch`]] as const) {
      const result = await loadOfficialDeals({ builder, sourceUrl, privateCommunityName: "Fixture", scrubList: [] }, { fetcher: down });
      expect(result.holdReasons, builder).not.toContain("unsupported_official_host");
    }
  });
});
