import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

/** Nov 3, 2026 (Peter: "81 homes closed is bad, just say over 100" — deals closed before FUB aren't in the sync). */
describe("trust line says 100+ homes closed", () => {
  it("is static, not the FUB-synced count", () => {
    const src = readFileSync(join(__dirname, "../client/src/components/TrustSignals.tsx"), "utf-8");
    expect(src).toContain('<span className="text-gold">100+ homes closed</span>');
    expect(src).not.toContain("trpc.stats.list");
  });
});
