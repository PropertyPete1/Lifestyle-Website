/**
 * THE CROWN BRANCH — path geometry and timing for the homepage hero.
 *
 * Two gold line heads are born at the top centre of the hero and race in
 * opposite directions around the screen frame. At the exact moment they pass
 * the headline's top edge, a second pair is born at the top centre of a "crown"
 * frame around LIFESTYLE DESIGN REALTY and races around that. Everything moves
 * at ONE shared speed, so the whole system reads as a single mechanism rather
 * than four independent animations.
 *
 * All of it is distance-based, never duration-based: a head advances
 * `HEAD_SPEED × elapsed` pixels along its polyline. That is the property that
 * makes the lockstep hold at every viewport size — a duration-based version
 * would have the short mobile paths finish while the long desktop ones crawl.
 *
 * DOM-free on purpose. The crown rectangle is derived from a measured headline
 * rect (never hardcoded), and that derivation, the branch birth point, and the
 * racer wrap-around are the parts that can silently be wrong, so they live here
 * where they are unit-testable. Rendering lives in
 * client/src/components/CrownBranch.tsx.
 */

export type Pt = { x: number; y: number };
export type Rect = { left: number; top: number; right: number; bottom: number };

/* ---- one speed for the whole system -------------------------------------- */

/**
 * Entrance head speed, px per ms. Every head in the system uses this.
 *
 * Tuned so the FULL entrance (border + crown, whichever finishes later) lands
 * in ~1.1-1.3s on the long desktop/laptop paths: 1146ms at 1280x839 and 1282ms
 * at 1440x900. Shorter paths finish sooner by design — that is what keeping the
 * timing distance-based buys us, and a 375px head still takes ~250ms to reach
 * the crown, so it reads as a drawn line rather than a flash.
 */
export const HEAD_SPEED = 1.8;
/** Settled racers glide rather than sprint — a different job, a slower pace. */
export const RACER_SPEED = 0.14;

/* ---- geometry constants -------------------------------------------------- */

/** Screen frame inset from the hero bounds. */
export const EDGE_INSET = 14;
/** Crown frame padding around the measured headline block. */
export const CROWN_PAD = 2;
/** Comet tail behind a racer head. */
export const RACER_TAIL_PX = 90;
/** Samples used to fade a racer tail — enough to read as smooth, few to draw. */
export const RACER_TAIL_SAMPLES = 14;

/* ---- alphas -------------------------------------------------------------- */

export const BORDER_ALPHA_DRAW = 0.55;
export const CROWN_ALPHA_DRAW = 0.7;
export const BORDER_ALPHA_SETTLED = 0.16;
export const CROWN_ALPHA_SETTLED = 0.3;

/**
 * Hero content starts its fade once the border entrance is this far along.
 *
 * Kept as a distance fraction (not a duration) so it scales with path length,
 * but clamped by CONTENT_REVEAL_MAX_MS below so the content is never gated on
 * the animation. The line should draw around already-visible content, reading
 * as polish rather than a loading screen.
 */
export const CONTENT_REVEAL_FRACTION = 0.4;

/**
 * Hard ceiling on when the hero content starts fading in, in ms.
 *
 * The visitor must never feel like they are waiting on the line work to see the
 * page. Whatever the viewport, the fade begins by this point — on the long
 * laptop path the distance fraction alone would not start until ~508ms, so this
 * is what actually governs there.
 */
export const CONTENT_REVEAL_MAX_MS = 200;

/** How long the hero content fade itself takes, in ms. Completes well under 0.6s. */
export const CONTENT_FADE_MS = 420;

/** Entrance plays once per session; returning visitors get the settled state. */
export const SESSION_KEY = "ldr_crown_seen";

const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);

/* ---- polyline primitives ------------------------------------------------- */

export function polylineLength(pts: Pt[]): number {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1], pts[i]);
  return total;
}

/** Point at `d` along the polyline. Clamped at both ends, never NaN. */
export function pointAt(pts: Pt[], d: number): Pt {
  if (pts.length === 0) return { x: 0, y: 0 };
  if (pts.length === 1 || !(d > 0)) return { ...pts[0] };
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const seg = dist(a, b);
    if (seg > 0 && acc + seg >= d) {
      const t = (d - acc) / seg;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    acc += seg;
  }
  return { ...pts[pts.length - 1] };
}

/**
 * The polyline revealed so far — the trail drawn behind a head. Ends exactly at
 * the head, so the stroke and the head point can never disagree.
 */
export function sliceUpTo(pts: Pt[], d: number): Pt[] {
  if (pts.length === 0) return [];
  if (!(d > 0)) return [{ ...pts[0] }];
  const out: Pt[] = [{ ...pts[0] }];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const seg = dist(a, b);
    if (acc + seg >= d) {
      out.push(pointAt(pts, d));
      return out;
    }
    out.push({ ...b });
    acc += seg;
  }
  return out;
}

/** Point at `d` along a CLOSED loop, wrapping in both directions. */
export function pointAtLooped(loop: Pt[], d: number): Pt {
  const len = polylineLength(loop);
  if (len <= 0) return loop[0] ? { ...loop[0] } : { x: 0, y: 0 };
  return pointAt(loop, ((d % len) + len) % len);
}

/* ---- the screen frame ---------------------------------------------------- */

export function borderRect(w: number, h: number, inset = EDGE_INSET): Rect {
  // A hero smaller than twice the inset would invert; collapse to a point
  // rather than drawing a frame inside out.
  const ix = Math.min(inset, w / 2);
  const iy = Math.min(inset, h / 2);
  return { left: ix, top: iy, right: w - ix, bottom: h - iy };
}

/**
 * The two entrance paths, both starting at top centre and both ending at bottom
 * centre. Mirror images, so they are the same length and — at one shared speed —
 * arrive together without any timing correction.
 */
export function borderHeadPaths(w: number, h: number, inset = EDGE_INSET): { left: Pt[]; right: Pt[] } {
  const r = borderRect(w, h, inset);
  const cx = (r.left + r.right) / 2;
  return {
    left: [
      { x: cx, y: r.top },
      { x: r.left, y: r.top },
      { x: r.left, y: r.bottom },
      { x: cx, y: r.bottom },
    ],
    right: [
      { x: cx, y: r.top },
      { x: r.right, y: r.top },
      { x: r.right, y: r.bottom },
      { x: cx, y: r.bottom },
    ],
  };
}

/** Closed clockwise loop for the settled racers. */
export function borderLoop(w: number, h: number, inset = EDGE_INSET): Pt[] {
  const r = borderRect(w, h, inset);
  const cx = (r.left + r.right) / 2;
  return [
    { x: cx, y: r.top },
    { x: r.right, y: r.top },
    { x: r.right, y: r.bottom },
    { x: r.left, y: r.bottom },
    { x: r.left, y: r.top },
    { x: cx, y: r.top },
  ];
}

/* ---- the crown ----------------------------------------------------------- */

/**
 * Crown rectangle in hero-local coordinates, from LIVE rects.
 *
 * Both inputs come from getBoundingClientRect, so this is what keeps the frame
 * on the headline at every viewport — including when the headline wraps to two
 * lines on mobile, when the custom serif finishes loading and reflows it, or
 * when the Now Hiring banner changes height and pushes the hero content down.
 */
export function crownRectFromHeadline(headline: Rect, hero: Rect, pad = CROWN_PAD): Rect {
  return {
    left: headline.left - hero.left - pad,
    top: headline.top - hero.top - pad,
    right: headline.right - hero.left + pad,
    bottom: headline.bottom - hero.top + pad,
  };
}

/** Whether a measured rect is worth drawing (headline not yet laid out → not). */
export function isUsableRect(r: Rect | null | undefined): r is Rect {
  return (
    !!r &&
    Number.isFinite(r.left) &&
    Number.isFinite(r.top) &&
    Number.isFinite(r.right) &&
    Number.isFinite(r.bottom) &&
    r.right - r.left > 1 &&
    r.bottom - r.top > 1
  );
}

/** Mirror-image crown paths, born at the crown's top centre. */
export function crownHeadPaths(r: Rect): { left: Pt[]; right: Pt[] } {
  const cx = (r.left + r.right) / 2;
  return {
    left: [
      { x: cx, y: r.top },
      { x: r.left, y: r.top },
      { x: r.left, y: r.bottom },
      { x: cx, y: r.bottom },
    ],
    right: [
      { x: cx, y: r.top },
      { x: r.right, y: r.top },
      { x: r.right, y: r.bottom },
      { x: cx, y: r.bottom },
    ],
  };
}

export function crownLoop(r: Rect): Pt[] {
  const cx = (r.left + r.right) / 2;
  return [
    { x: cx, y: r.top },
    { x: r.right, y: r.top },
    { x: r.right, y: r.bottom },
    { x: r.left, y: r.bottom },
    { x: r.left, y: r.top },
    { x: cx, y: r.top },
  ];
}

/* ---- the branch ---------------------------------------------------------- */

/**
 * Distance along `path` at which the head first reaches depth `y`.
 *
 * This is what "born at the exact moment the border heads pass the headline"
 * means in code: the crown is not scheduled on a guessed delay, it is scheduled
 * at the distance where the border head's y equals the crown's top edge, so the
 * branch stays synchronised with the headline wherever the headline happens to
 * sit. Returns the full length if the path never gets that deep.
 */
export function distanceAtDepth(path: Pt[], y: number): number {
  if (path.length === 0) return 0;
  if (path[0].y >= y) return 0;
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const seg = dist(a, b);
    if (b.y >= y && b.y !== a.y) {
      const t = (y - a.y) / (b.y - a.y);
      if (t >= 0 && t <= 1) return acc + seg * t;
    }
    acc += seg;
  }
  return acc;
}

/** Wall-clock ms at which the crown pair is born. */
export function branchBirthMs(borderPath: Pt[], crownTopY: number, speed = HEAD_SPEED): number {
  return speed > 0 ? distanceAtDepth(borderPath, crownTopY) / speed : 0;
}

/** Total entrance length — the later of the two pairs finishing. */
export function entranceDurationMs(
  borderLen: number,
  branchBirth: number,
  crownLen: number,
  speed = HEAD_SPEED
): number {
  if (speed <= 0) return 0;
  return Math.max(borderLen / speed, branchBirth + crownLen / speed);
}

/** When the hero content starts its fade in. */
export function contentRevealMs(
  borderLen: number,
  speed = HEAD_SPEED,
  fraction = CONTENT_REVEAL_FRACTION,
  maxMs = CONTENT_REVEAL_MAX_MS
): number {
  if (speed <= 0) return 0;
  // Whichever comes first: the distance milestone, or the hard ceiling. Content
  // first, always — the animation is never allowed to become a gate.
  return Math.min((borderLen * fraction) / speed, maxMs);
}

/* ---- settled racers ------------------------------------------------------ */

/** Where a racer sits on its loop, wrapped. `phase01` offsets it round the lap. */
export function racerDistance(
  elapsedMs: number,
  loopLen: number,
  phase01 = 0,
  speed = RACER_SPEED
): number {
  if (!(loopLen > 0)) return 0;
  const d = elapsedMs * speed + phase01 * loopLen;
  return ((d % loopLen) + loopLen) % loopLen;
}

/**
 * Comet tail behind a racer, head first. Wraps the loop seam, so a racer
 * crossing the start point keeps its tail instead of losing it for a frame.
 */
export function tailPoints(
  loop: Pt[],
  headDist: number,
  tailLen = RACER_TAIL_PX,
  samples = RACER_TAIL_SAMPLES
): Pt[] {
  const n = Math.max(2, Math.floor(samples));
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    out.push(pointAtLooped(loop, headDist - (tailLen * i) / (n - 1)));
  }
  return out;
}

/* ---- session flag -------------------------------------------------------- */

type StorageLike = { getItem(k: string): string | null; setItem(k: string, v: string): void };

/**
 * Whether the entrance has already played this session.
 *
 * Storage access throws outright in some privacy modes, so both helpers swallow
 * it: the worst case is the entrance replaying, never a crashed hero.
 */
export function hasSeenEntrance(store: StorageLike | null | undefined): boolean {
  try {
    return store?.getItem(SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

export function markEntranceSeen(store: StorageLike | null | undefined): void {
  try {
    store?.setItem(SESSION_KEY, "1");
  } catch {
    /* private mode — the entrance simply plays again next load */
  }
}

/** Whether this visit should play the entrance at all. */
export function shouldPlayEntrance(
  store: StorageLike | null | undefined,
  reducedMotion: boolean
): boolean {
  return !reducedMotion && !hasSeenEntrance(store);
}
