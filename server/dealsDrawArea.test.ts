import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { DRAW_COPY, keysInShape, pointInPolygon, polygonArea, shapePoints, simplifyTrace, traceToPicture, usableTrace, type Pt } from "../client/src/lib/dealsDrawArea";

const circle = (cx: number, cy: number, r: number, n = 40): Pt[] => Array.from({ length: n }, (_, i) => ({ x: cx + Math.cos((i / n) * 2 * Math.PI) * r, y: cy + Math.sin((i / n) * 2 * Math.PI) * r }));

/**
 * Oct 30, 2026 (Peter: "we need a part where u can draw around the area"): the deals map's Draw area tool.
 */
describe("draw an area on the deals map", () => {
  it("tests points against the closed shape (even-odd), including concave shapes", () => {
    const square: Pt[] = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    expect(pointInPolygon({ x: 0.5, y: 0.5 }, square)).toBe(true);
    expect(pointInPolygon({ x: 1.5, y: 0.5 }, square)).toBe(false);
    // a "C" shape: the notch is outside
    const c: Pt[] = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 3, y: 2 }, { x: 3, y: 3 }, { x: 0, y: 3 }];
    expect(pointInPolygon({ x: 2, y: 1.5 }, c)).toBe(false);
    expect(pointInPolygon({ x: 0.5, y: 1.5 }, c)).toBe(true);
  });

  it("matches communities by their public map point only; no point never matches", () => {
    const shape = circle(0.5, 0.5, 0.1);
    const items = [
      { key: "in", pin: { x: 0.52, y: 0.48 } },
      { key: "out", pin: { x: 0.8, y: 0.8 } },
      { key: "nopin", pin: null },
      { key: "missing" },
    ];
    expect(keysInShape(items, shape)).toEqual(["in"]);
    expect(keysInShape(items, null)).toEqual([]);
    expect(keysInShape(items, [{ x: 0, y: 0 }, { x: 1, y: 1 }])).toEqual([]);
  });

  it("rejects dots, lines and tiny scribbles; accepts a real loop", () => {
    expect(usableTrace(circle(100, 100, 8))).toBe(false);
    expect(usableTrace(Array.from({ length: 30 }, (_, i) => ({ x: i * 10, y: 50 })))).toBe(false);
    expect(usableTrace(circle(200, 200, 60))).toBe(true);
    expect(polygonArea([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }])).toBe(100);
  });

  it("thins a slow trace and keeps its last point", () => {
    const slow = Array.from({ length: 101 }, (_, i) => ({ x: i, y: 0 }));
    const thin = simplifyTrace(slow, 4);
    expect(thin.length).toBeLessThan(30);
    expect(thin[0]).toEqual({ x: 0, y: 0 });
    expect(thin[thin.length - 1]).toEqual({ x: 100, y: 0 });
  });

  it("turns screen pixels into picture points for the map's view", () => {
    const aspect = 1920 / 1840;
    const view = { z: 1000, tx: -200, ty: -100 };
    const [p] = traceToPicture([{ x: 300, y: 383.333 }], view, aspect);
    expect(p!.x).toBeCloseTo(0.5, 5);
    expect(p!.y).toBeCloseTo((383.333 + 100) / (1000 / aspect), 5);
    expect(shapePoints([{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }])).toBe("0.10000,0.20000 0.30000,0.40000");
  });

  it("follows the agreed flow and labels", () => {
    expect(DRAW_COPY).toMatchObject({
      start: "Draw area",
      instruction: "Trace around the area you want to explore.",
      use: "Use this area",
      redraw: "Redraw",
      cancel: "Cancel",
      clear: "Clear area",
      tooSmall: "Draw a larger area to search.",
      none: "No homes match this area and your filters.",
      searchView: "Search this view instead",
    });
    const src = readFileSync(join(__dirname, "../client/src/components/deals/LandingBrowse.tsx"), "utf-8");
    // results change only on "Use this area"; the drawn shape is kept and re-tested when the filters change
    expect(src).toContain("onClick={applyDrawnArea}");
    expect(src).toContain("const drawnKeys = useMemo(() => shape ? keysInShape(keyed, shape) : null, [shape, keyed]);");
    // drawing has its own surface so one finger never scrolls the page; the search-this-area button waits
    expect(src).toContain('data-deals-draw-surface="true" className="absolute inset-0 z-40 cursor-crosshair touch-none');
    expect(src).toContain('{onSearchArea && areaMoved && drawMode === "off" &&');
    // a marker group or "Search this area" replaces the drawing; Clear area clears both
    expect(src).toMatch(/const searchThisArea = \(keys: string\[\]\) => \{\n\s+setShape\(null\);/);
    expect(src).toContain("const clearArea = () => { setSelected(null); setShape(null); };");
    // offered wherever the map offers "Search this area" (the public page and the team's list)
    expect(src).toContain("onShape: searchArea ? applyShape : undefined");
  });
});
