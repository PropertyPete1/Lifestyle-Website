import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

/** Nov 3, 2026 (Peter, Instagram in-app browser): the loader's house must have a size of its own, or Safari draws it at 300×150 outside the ring. */
describe("DealsLoader house stays inside the ring on Safari", () => {
  it("the house SVG has an explicit width and height, not insets alone", () => {
    const src = readFileSync(join(__dirname, "../client/src/components/deals/DealsLoader.tsx"), "utf-8");
    expect(src).toContain('className="absolute left-[24%] top-[24%] h-[52%] w-[52%] text-gold"');
    expect(src).not.toContain("inset-[24%]");
  });
});
