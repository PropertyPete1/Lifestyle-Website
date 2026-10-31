/**
 * Oct 30, 2026 (Peter: "we need a part where u can draw around the area"; spec from ChatGPT's New Home Buddy
 * comparison): the buyer traces a shape on the deals map and the list narrows to the communities inside it.
 *
 * Privacy: the shape is tested against the same coarse public map points the markers use (a few miles of
 * precision), never a home's real position, so drawing tiny shapes can't reveal where a community is.
 *
 * Points are either screen pixels inside the map box, or "picture" points: 0..1 across the market picture's
 * width and 0..1 down its height, the space the public pins live in.
 */
export type Pt = { x: number; y: number };

export const DRAW_COPY = {
  start: "Draw area",
  redraw: "Redraw",
  clear: "Clear area",
  instruction: "Trace around the area you want to explore.",
  cancel: "Cancel",
  use: "Use this area",
  tooSmall: "Draw a larger area to search.",
  ready: "Search inside your shape?",
  none: "No homes match this area and your filters.",
  searchView: "Search this view instead",
} as const;

/** Freehand traces keep a point only every few pixels, so a slow drag doesn't pile up thousands. */
export const TRACE_MIN_GAP = 4;
/** A usable shape is at least this many pixels across in both directions and encloses this much area. */
export const SHAPE_MIN_SIDE = 36;
export const SHAPE_MIN_AREA = 1500;

/** Drops points closer than `gap` pixels to the last one kept (the last point of the trace is always kept). */
export function simplifyTrace(points: readonly Pt[], gap = TRACE_MIN_GAP): Pt[] {
  const kept: Pt[] = [];
  for (const point of points) {
    const last = kept[kept.length - 1];
    if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= gap) kept.push(point);
  }
  const end = points[points.length - 1];
  if (end && kept[kept.length - 1] !== end && kept.length > 1) kept[kept.length - 1] = end;
  return kept;
}

/** The enclosed area of a closed shape (shoelace), always positive. */
export function polygonArea(points: readonly Pt[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** True when a screen trace, closed on release, makes a real area: not a dot, a line or a scribble too small to use. */
export function usableTrace(points: readonly Pt[]): boolean {
  if (points.length < 6) return false;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  if (Math.max(...xs) - Math.min(...xs) < SHAPE_MIN_SIDE || Math.max(...ys) - Math.min(...ys) < SHAPE_MIN_SIDE) return false;
  return polygonArea(points) >= SHAPE_MIN_AREA;
}

/** Screen pixels inside the map box to picture points, for the map's current view (content width z, offset tx/ty). */
export function traceToPicture(points: readonly Pt[], view: { z: number; tx: number; ty: number }, aspect: number): Pt[] {
  const height = view.z / aspect;
  return points.map((point) => ({ x: (point.x - view.tx) / view.z, y: (point.y - view.ty) / height }));
}

/** Even-odd ray casting: true when the point is inside the closed shape. */
export function pointInPolygon(point: Pt, shape: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = shape.length - 1; i < shape.length; j = i++) {
    const a = shape[i]!;
    const b = shape[j]!;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** The keys of the communities whose public map point is inside the shape (communities without a point never match). */
export function keysInShape(items: ReadonlyArray<{ key: string; pin?: Pt | null }>, shape: readonly Pt[] | null): string[] {
  if (!shape || shape.length < 3) return [];
  return items.filter((item) => item.pin && pointInPolygon(item.pin, shape)).map((item) => item.key);
}

/** The shape as an SVG points list in picture units (the overlay's viewBox is 0 0 1 1). */
export function shapePoints(shape: readonly Pt[]): string {
  return shape.map((point) => `${point.x.toFixed(5)},${point.y.toFixed(5)}`).join(" ");
}
