import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { BRAND_IMG, LINKS_FRONT_SIZES, LINKS_FRONT_SRCSET } from "../client/src/lib/assets";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf-8");

/** Nov 1, 2026 (Peter: the /links photo "populates after like 5 seconds"). */
describe("the /links photo loads with the page", () => {
  it("serves phone sizes, each file present and smaller than the original", () => {
    const original = statSync(join(root, "client/public", BRAND_IMG.linksFront)).size;
    for (const entry of LINKS_FRONT_SRCSET.split(", ")) {
      const [path, width] = entry.split(" ");
      expect(existsSync(join(root, "client/public", path!))).toBe(true);
      expect(width).toMatch(/^\d+w$/);
      if (path !== BRAND_IMG.linksFront) expect(statSync(join(root, "client/public", path!)).size).toBeLessThan(original / 2);
    }
    expect(read("client/src/pages/Links.tsx")).toContain("srcSet={LINKS_FRONT_SRCSET} sizes={LINKS_FRONT_SIZES}");
  });

  it("index.html preloads the same set on /links, and the home hero on /", () => {
    const html = read("client/index.html");
    expect(html).toContain(`link.setAttribute("imagesrcset", "${LINKS_FRONT_SRCSET}")`);
    expect(html).toContain(`link.setAttribute("imagesizes", "${LINKS_FRONT_SIZES}")`);
    expect(html).toContain(BRAND_IMG.heroMobile);
    expect(html).toContain(BRAND_IMG.heroDesktop);
  });
});
