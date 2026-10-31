import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { ProtectedGallery, WHOLE_PHOTO_BACKDROP } from "../client/src/components/deals/GatedCatalog";

(globalThis as { React?: typeof React }).React = React;

/** Oct 31, 2026 (Peter: "the picture is zoomed in a bunch, every photo needs to show the entire house, not zoomed in so much"). */
describe("whole photos", () => {
  it("the home gallery shows each photo whole (contained) over a blur of itself", () => {
    const html = renderToStaticMarkup(React.createElement(ProtectedGallery, { photos: ["/deals/pub/img/a", "/deals/pub/img/b"] }));
    expect(html.match(/data-deals-whole-photo="true"/g)?.length).toBe(2);
    expect(html).toContain("object-contain");
    expect(html).not.toMatch(/alt="Home photo 1 of 2"[^>]*object-cover/);
    expect(WHOLE_PHOTO_BACKDROP).toContain("blur");
  });

  it("the opened home's big photo is contained, in a 3:2 frame on a phone", () => {
    const src = readFileSync(join(__dirname, "..", "client/src/components/deals/GatedCatalog.tsx"), "utf-8");
    expect(src).toContain('${index === 0 ? "object-contain" : "object-cover"}');
    expect(src).toContain("relative grid aspect-[3/2] gap-1.5 overflow-hidden rounded-xl sm:aspect-auto sm:h-[42vh]");
    expect(src).not.toContain("h-[38vh] min-h-[220px]");
  });
});
