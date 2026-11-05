import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Nov 4, 2026 (Peter: his own page on the Homes tab showed no featured deals). The row heads the Homes tab too. */
describe("featured deals head the Homes tab of the unlocked list", () => {
  const source = readFileSync(new URL("../client/src/components/deals/GatedCatalog.tsx", import.meta.url), "utf8");
  it("passes the featured row as the list's top slot regardless of the Homes/Communities toggle", () => {
    const line = source.split("\n").find((l) => l.includes("top={") && l.includes("<FeaturedDeals"))!;
    expect(line).toBeTruthy();
    expect(line).not.toContain('listView === "homes" ? undefined');
  });
});
