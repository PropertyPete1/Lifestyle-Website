import { describe, expect, it } from "vitest";
// The registry module is the first of the reader modules the server loads; every reader module imports it back.
// A reader that reads a registry constant at module level (not lazily) would throw here, as it would in production.
import { DEAL_ADAPTERS, OFFICIAL_BUILDER_HOSTS, type BuilderId } from "./dealsAdapters";
import { DISCOVERY_READERS } from "./dealsDiscovery";

describe("reader modules load with the registry first", () => {
  it("builds every adapter and every discovery reader after the registry has loaded", () => {
    for (const builder of Object.keys(DEAL_ADAPTERS) as BuilderId[]) expect(DEAL_ADAPTERS[builder].builder).toBe(builder);
    for (const reader of DISCOVERY_READERS) {
      expect(reader.host).toBe(OFFICIAL_BUILDER_HOSTS[reader.builder]);
      if (reader.index.kind !== "reader") expect(reader.index.url).toMatch(/^https:\/\//);
    }
  });
});
