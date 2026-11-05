import { readFileSync } from "node:fs";
import { join } from "node:path";
import express from "express";
import { describe, expect, it } from "vitest";
import { BRAND_OG_IMAGE, BRAND_OG_TITLE, CITY_FINDER_OG_IMAGE, CONVINCE_OG_IMAGE, DEALS_OG_IMAGE, JOIN_OG_IMAGE, registerOgMeta } from "./ogMeta";

/**
 * Nov 4, 2026 (Peter: the /join link previewed as the old black card; "update all these to make them nice and clean").
 * Every share card is a light 1200x630 PNG shipped with the site, and every public page has one, so the host never
 * fills a missing og:image with an app screenshot.
 */
const pngSize = (file: string) => { const b = readFileSync(file); return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }; };

async function render(path: string): Promise<string> {
  const app = express();
  registerOgMeta(app);
  app.get("*", (_req, res) => { res.type("html").send("<html><head><!--og-meta--></head><body></body></html>"); });
  const server = app.listen(0);
  try {
    const port = (server.address() as { port: number }).port;
    return await (await fetch(`http://127.0.0.1:${port}${path}`, { headers: { accept: "text/html", host: "lifestyledesignrealty.com" } })).text();
  } finally { server.close(); }
}

describe("light share cards", () => {
  it("ships every card at exactly 1200x630", () => {
    for (const image of [BRAND_OG_IMAGE, JOIN_OG_IMAGE, DEALS_OG_IMAGE, CONVINCE_OG_IMAGE, CITY_FINDER_OG_IMAGE]) {
      expect(image.startsWith("/og/")).toBe(true);
      expect(pngSize(join(__dirname, "../client/public", image))).toEqual({ width: 1200, height: 630 });
    }
  });

  it("gives the home page, /links and /get-started the brand card", async () => {
    for (const path of ["/", "/links", "/get-started"]) {
      const html = await render(path);
      expect(html).toMatch(new RegExp(`<meta property="og:image" content="http://[^"]+${BRAND_OG_IMAGE}" />`));
      expect(html).toContain(`<meta property="og:title" content="${BRAND_OG_TITLE}" />`);
    }
  });

  it("keeps each page's own card", async () => {
    expect(await render("/join")).toContain(JOIN_OG_IMAGE);
    expect(await render("/deals")).toContain(DEALS_OG_IMAGE);
    expect(await render("/convince")).toContain(CONVINCE_OG_IMAGE);
    expect(await render("/city-finder")).toContain(CITY_FINDER_OG_IMAGE);
  });

  it("still gives private Deals pages and verification paths no card", async () => {
    for (const path of ["/deals/team", "/deals/mine", "/deals/v/abc", "/deals/auth/x"]) {
      expect(await render(path)).not.toMatch(/og:image/);
    }
  });
});
