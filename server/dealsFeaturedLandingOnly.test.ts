import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

/** Nov 4, 2026 (Peter: "the 3 deals pop up on every page — it should just be the beginning"). */
describe("the featured row shows on the first screen only", () => {
  it("LandingBrowse drops the top slot once a map bubble or drawn area narrows the list", () => {
    const src = readFileSync(join(__dirname, "../client/src/components/deals/LandingBrowse.tsx"), "utf-8");
    expect(src).toContain('{top && !area && <div className="mb-6 min-w-0" data-deals-top-slot="landing">');
    expect(src).not.toMatch(/\{top && <div className="mb-6 min-w-0">/);
  });
});
