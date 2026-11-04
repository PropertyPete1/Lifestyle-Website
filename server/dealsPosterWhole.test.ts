import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Nov 4, 2026 (Peter, opening a community on /deals/team: "it populates with a zoomed in photo... there should be
 * no zoomed in"). The community photo that stands in for a missing video tour was cropped into the video's 4:5
 * portrait frame (object-cover), so a landscape house photo showed as a tall slice of itself. It now shows whole.
 */
describe("community poster shows the whole photo", () => {
  const source = readFileSync(new URL("../client/src/components/deals/shared.tsx", import.meta.url), "utf8");
  const start = source.indexOf("function PosterCard(");
  const end = source.indexOf("\n}\n", start);
  const poster = source.slice(start, end);
  const lines = poster.split("\n");

  it("is not cropped into a portrait frame", () => {
    const box = lines.find((line) => line.includes('data-deals-poster="true"'))!;
    expect(box).toBeTruthy();
    expect(box).not.toMatch(/aspect-\[/);
    expect(box).toContain('data-deals-poster-fit="whole"');
  });

  it("renders the photo contained, at its own height", () => {
    const img = lines.find((line) => line.includes("<RetryImage src={poster}"))!;
    expect(img).toBeTruthy();
    expect(img).toContain("object-contain");
    expect(img).not.toContain("object-cover");
    expect(img).not.toContain("absolute inset-0");
    expect(img).toContain("h-auto");
  });

  it("keeps the video-tour note", () => {
    expect(poster).toContain("Video tour coming soon");
  });
});
