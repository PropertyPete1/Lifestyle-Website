/**
 * NANITE SWARM — pure motion, population and event logic for the homepage hero.
 *
 * DOM/canvas free so the constraints that matter (upward bias, tier budgets,
 * surge falloff, text-safety dimming) are unit-testable. Rendering lives in
 * client/src/components/NaniteSwarm.tsx.
 *
 * Performance tiering and the degrade/fallback decisions are deliberately NOT
 * duplicated here — they are reused from shared/livingLogo.ts (selectTier,
 * nextTierDown, shouldDegrade, FIRST_CHECK_SAMPLES, STEADY_CHECK_SAMPLES), so
 * both animations share one tested implementation.
 */
import type { PerfTier } from "./livingLogo";

/**
 * Swarm population per tier. ~280 at the top tier per the approved prototype;
 * each nanite also carries a trail polyline, so the real per-frame cost is
 * population × average trail segments, not population alone.
 */
export const SWARM_BY_TIER: Record<Exclude<PerfTier, "static">, number> = {
  high: 280,
  medium: 165,
  low: 85,
};

export function swarmCount(tier: PerfTier): number {
  return tier === "static" ? 0 : SWARM_BY_TIER[tier];
}

/* ------------------------------------------------------------------------- *
 * MOTION — upward-biased curl flow
 * ------------------------------------------------------------------------- */

/**
 * Hard cap on horizontal drift, as a fraction of vertical speed.
 *
 * This is the constraint that keeps the swarm from reading as horizontal lines
 * streaking across the hero: every velocity is routed through
 * clampHorizontal(), so |vx| can never exceed 0.4 × |vy|.
 */
export const HORIZONTAL_RATIO_MAX = 0.4;

/**
 * Clamp horizontal velocity so motion stays upward-biased.
 * Preserves direction, only ever reduces magnitude.
 */
export function clampHorizontal(
  vx: number,
  vy: number,
  ratio: number = HORIZONTAL_RATIO_MAX
): number {
  const limit = Math.abs(vy) * ratio;
  if (vx > limit) return limit;
  if (vx < -limit) return -limit;
  return vx;
}

export interface Flow {
  vx: number;
  vy: number;
}

/**
 * Divergence-free ("curl") flow so the swarm moves like one organism rather
 * than independent dots.
 *
 * Built from the curl of a scalar potential made of sines:
 *   ψ(x,y,t) = sin(a)·cos(b),  a = x·k1 + t·w1,  b = y·k2 − t·w2
 *   curl = ( ∂ψ/∂y , −∂ψ/∂x ) = ( −k2·sin a·sin b , −k1·cos a·cos b )
 * Taking the curl guarantees the field has no sources or sinks, which is why it
 * reads as coherent currents instead of particles piling up. A second harmonic
 * breaks up any visible repetition.
 *
 * `speed` scales the whole field (per-particle depth). The returned vy is always
 * negative (canvas y grows downward, so up is negative) and vx is clamped to
 * HORIZONTAL_RATIO_MAX — the caller cannot forget to clamp.
 */
export function flowAt(x: number, y: number, t: number, speed = 1): Flow {
  const k1 = 0.0062;
  const k2 = 0.0049;
  const a = x * k1 + t * 0.22;
  const b = y * k2 - t * 0.16;
  // curl of the primary potential
  let cx = -Math.sin(a) * Math.sin(b);
  let cy = -Math.cos(a) * Math.cos(b);
  // secondary harmonic, rotated, to break repetition
  const c = (x + y * 0.6) * 0.0035 + t * 0.13;
  cx += Math.sin(c) * 0.45;
  cy += Math.cos(c) * 0.3;

  // Upward bias dominates: the swirl only bends the path, never reverses it.
  const UP_BASE = 46; // px/s at speed 1
  const vy = -(UP_BASE + Math.abs(cy) * 16) * speed;
  const vx = clampHorizontal(cx * 26 * speed, vy);
  return { vx, vy };
}

/* ------------------------------------------------------------------------- *
 * POPULATION — three visual classes + palette
 * ------------------------------------------------------------------------- */

export type NaniteKind = "point" | "comet" | "hero";

/** ~5–7% hero, ~30% comet, remainder small points. */
export function classifyNanite(r: number): NaniteKind {
  if (r < 0.06) return "hero";
  if (r < 0.36) return "comet";
  return "point";
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Gold, a rare blue accent, and warm white for heroes. No other hues. */
export const NANITE_GOLD: Rgb = { r: 201, g: 169, b: 97 };
export const NANITE_BLUE: Rgb = { r: 143, g: 196, b: 233 };
export const NANITE_WARM_WHITE: Rgb = { r: 255, g: 246, b: 220 };

/**
 * Colour for a nanite. Heroes are always warm white; of the rest, ~7% take the
 * blue accent and everything else is gold.
 */
export function naniteColor(kind: NaniteKind, r: number): Rgb {
  if (kind === "hero") return NANITE_WARM_WHITE;
  if (r < 0.07) return NANITE_BLUE;
  return NANITE_GOLD;
}

/**
 * Trail length in history samples. Depth (`z`, 0 = far, 1 = near) extends the
 * trail, so near particles streak and far ones are short motes.
 */
export function trailLength(kind: NaniteKind, z: number): number {
  const d = Math.min(Math.max(z, 0), 1);
  if (kind === "hero") return Math.round(22 + d * 12); // 22–34
  if (kind === "comet") return Math.round(16 + d * 14); // 16–30
  return Math.round(6 + d * 10); // 6–16
}

/* ------------------------------------------------------------------------- *
 * SURGE — an upward brightness wave every 6–12s
 * ------------------------------------------------------------------------- */

export const SURGE_MIN_GAP = 6;
export const SURGE_MAX_GAP = 12;
/** Vertical reach of the flare, in CSS px. */
export const SURGE_FALLOFF_PX = 140;
/** Peak additive alpha boost at the wave centre. */
export const SURGE_MAX_BOOST = 0.8;

/** Seconds until the next surge, from a 0..1 random sample. */
export function nextSurgeDelay(rand: number): number {
  const r = Math.min(Math.max(rand, 0), 1);
  return SURGE_MIN_GAP + r * (SURGE_MAX_GAP - SURGE_MIN_GAP);
}

/**
 * Alpha boost a particle at `y` receives from a surge wave centred at `waveY`.
 * Linear falloff to zero at SURGE_FALLOFF_PX, so the common case (far from the
 * wave) returns 0 immediately.
 */
export function surgeBoost(
  y: number,
  waveY: number,
  falloff: number = SURGE_FALLOFF_PX,
  maxBoost: number = SURGE_MAX_BOOST
): number {
  const d = Math.abs(y - waveY);
  if (d >= falloff) return 0;
  return (1 - d / falloff) * maxBoost;
}

/** Per-particle alpha flicker, ±20%, offset by the particle's own phase. */
export function flicker(t: number, phase: number): number {
  return 1 + Math.sin(t * 2.1 + phase) * 0.2;
}

/* ------------------------------------------------------------------------- *
 * TEXT SAFETY
 * ------------------------------------------------------------------------- */

/** Alpha multiplier applied inside the headline/CTA zone. */
export const TEXT_SAFE_ALPHA = 0.22;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Alpha multiplier for a point: dimmed hard inside any protected text rect so
 * the headline and CTAs stay legible, full brightness elsewhere. Rects are
 * measured from the live DOM rather than hardcoded, so this follows the copy
 * when it reflows (mobile stacking, wrapped CTA rows).
 */
export function textSafetyFactor(
  x: number,
  y: number,
  rects: Rect[],
  safeAlpha: number = TEXT_SAFE_ALPHA
): number {
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return safeAlpha;
  }
  return 1;
}
