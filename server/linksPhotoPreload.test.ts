import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { BRAND_IMG, LINKS_MAP_HEIGHT, LINKS_MAP_SIZES, LINKS_MAP_SRCSET, LINKS_MAP_WIDTH } from "../client/src/lib/assets";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf-8");

/** Nov 1, 2026 (Peter: the /links photo "populates after like 5 seconds"). Nov 7: the banner is now the service-area map. */
describe("the /links banner loads with the page", () => {
  it("serves phone sizes, each file present and smaller than the original", () => {
    const original = statSync(join(root, "client/public", BRAND_IMG.linksMap)).size;
    for (const entry of LINKS_MAP_SRCSET.split(", ")) {
      const [path, width] = entry.split(" ");
      expect(existsSync(join(root, "client/public", path!))).toBe(true);
      expect(width).toMatch(/^\d+w$/);
      if (path !== BRAND_IMG.linksMap) expect(statSync(join(root, "client/public", path!)).size).toBeLessThan(original / 2);
    }
    expect(read("client/src/pages/Links.tsx")).toContain("srcSet={LINKS_MAP_SRCSET} sizes={LINKS_MAP_SIZES}");
  });

  it("index.html preloads the same set on /links, and the home hero on /", () => {
    const html = read("client/index.html");
    expect(html).toContain(`link.setAttribute("imagesrcset", "${LINKS_MAP_SRCSET}")`);
    expect(html).toContain(`link.setAttribute("imagesizes", "${LINKS_MAP_SIZES}")`);
    expect(html).toContain(BRAND_IMG.heroMobile);
    expect(html).toContain(BRAND_IMG.heroDesktop);
  });
});

/** Nov 7, 2026 (Peter): replace only the house photo with the approved map, shown whole on every screen. */
describe("the /links service-area map", () => {
  const LINKS = read("client/src/pages/Links.tsx");
  const img = LINKS.slice(LINKS.indexOf("<img src={BRAND_IMG.linksMap}"), LINKS.indexOf("/>", LINKS.indexOf("<img src={BRAND_IMG.linksMap}")));

  it("carries Peter's exact alt text", () => {
    expect(img).toContain(
      'alt="Our Texas service areas along I-35: San Antonio, New Braunfels, San Marcos, Austin, Waco, Dallas and Fort Worth."',
    );
  });

  it("keeps the map's own proportions, so no landmark or city name is cropped", () => {
    expect(LINKS_MAP_WIDTH / LINKS_MAP_HEIGHT).toBeCloseTo(3, 1);
    expect(img).toContain("width={LINKS_MAP_WIDTH} height={LINKS_MAP_HEIGHT}");
    expect(img).toContain(`aspect-[${LINKS_MAP_WIDTH}/${LINKS_MAP_HEIGHT}]`);
    expect(img).toContain("object-contain");
    expect(img).not.toContain("object-cover");
  });

  it("keeps the old strip's place, width, corners and spacing", () => {
    for (const cls of ["mt-5", "w-full", "rounded-[10px]"]) expect(img).toContain(cls);
    expect(LINKS).not.toContain("Limestone Hill Country home");
  });

  it("each encoded size is the map's shape", () => {
    // WebP VP8 (lossy) header: width/height are little-endian 14-bit values at byte 26/28.
    for (const entry of LINKS_MAP_SRCSET.split(", ")) {
      const [path, width] = entry.split(" ");
      const buf = readFileSync(join(root, "client/public", path!));
      expect(buf.toString("ascii", 0, 4)).toBe("RIFF");
      expect(buf.toString("ascii", 12, 16)).toBe("VP8 ");
      const w = buf.readUInt16LE(26) & 0x3fff;
      const h = buf.readUInt16LE(28) & 0x3fff;
      expect(`${w}w`).toBe(width);
      expect(Math.abs(w / h - LINKS_MAP_WIDTH / LINKS_MAP_HEIGHT)).toBeLessThan(0.01);
    }
  });
});
