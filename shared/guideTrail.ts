/**
 * Geometry + timing for the /links guide trail: the thin gold pulse that draws
 * itself down the page gutter from the promise chip to the quick-capture form
 * when the chip is tapped.
 *
 * It lives here (not in the component) because every decision that can be wrong
 * is arithmetic: how long the guide is on screen, and — the one that actually
 * matters — that the line is drawn in the margin BESIDE the button column and
 * never across it. Both are tested rather than eyeballed.
 *
 * All coordinates are viewport-relative CSS pixels. The component re-measures
 * every frame, so the trail tracks the smooth scroll instead of being baked in
 * at tap time.
 */

/** Time the head takes to travel from the chip to the form. */
export const GUIDE_DRAW_MS = 850;
/** Fade-out once the head has arrived. */
export const GUIDE_FADE_MS = 450;
/** Total on-screen life of the trail — a guide moment, not a page element. */
export const GUIDE_TOTAL_MS = GUIDE_DRAW_MS + GUIDE_FADE_MS;

/** Length of the bright comet tail behind the head. */
export const GUIDE_TAIL_PX = 72;
/** Distance the line sits outside the content column when there is room. */
export const GUIDE_GUTTER_PX = 12;
/** Below this span the chip and the form are already adjacent — skip the line. */
export const GUIDE_MIN_SPAN_PX = 24;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Scroll-like acceleration curve, so the head reads as tied to the scroll. */
export function easeInOutCubic(t: number): number {
  const p = clamp(t, 0, 1);
  return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
}

/** 0..1 draw progress for a given elapsed time. */
export function guideProgress(elapsed: number): number {
  return clamp(elapsed / GUIDE_DRAW_MS, 0, 1);
}

/** Full opacity while drawing, then a linear fade to nothing. */
export function guideOpacity(elapsed: number): number {
  if (elapsed < 0) return 0;
  if (elapsed <= GUIDE_DRAW_MS) return 1;
  const f = (elapsed - GUIDE_DRAW_MS) / GUIDE_FADE_MS;
  return f >= 1 ? 0 : 1 - f;
}

/**
 * X position of the trail: centred in a tight mobile gutter, or a fixed offset
 * outside a wide desktop one. The result is always <= contentLeft, which is the
 * guarantee that matters — the line can never be drawn over the buttons.
 */
export function guideLineX(contentLeft: number, viewportWidth: number): number {
  const gutter = clamp(contentLeft, 0, Math.max(0, viewportWidth));
  return gutter <= GUIDE_GUTTER_PX * 2 ? gutter / 2 : gutter - GUIDE_GUTTER_PX;
}

export type GuideSegment = {
  /** False when there is nothing worth drawing (form not below the chip). */
  visible: boolean;
  /** Top of the trail — the chip's bottom edge, clipped to the viewport. */
  top: number;
  /** Current head position. */
  head: number;
  /** Where the bright tail behind the head starts. */
  tailTop: number;
};

/**
 * Vertical extent of the trail this frame. Both ends are clipped to the
 * viewport, so while the form is still off-screen the line runs to the bottom
 * edge and then shortens onto the form as the scroll brings it into view.
 */
export function guideSegment(
  fromBottom: number,
  toTop: number,
  viewportHeight: number,
  eased: number,
): GuideSegment {
  const top = clamp(fromBottom, 0, viewportHeight);
  const end = clamp(toTop, 0, viewportHeight);
  if (end - top < GUIDE_MIN_SPAN_PX) {
    return { visible: false, top, head: top, tailTop: top };
  }
  const head = top + (end - top) * clamp(eased, 0, 1);
  return { visible: true, top, head, tailTop: Math.max(top, head - GUIDE_TAIL_PX) };
}
