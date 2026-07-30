/**
 * LIVING LOGO — pure geometry + performance-tiering logic.
 *
 * Kept free of DOM/canvas access so the perf-critical decisions (how many
 * particles a device gets, when to degrade, when to give up and show the static
 * mark) are unit-testable. The rendering half lives in
 * client/src/components/LivingLogo.tsx.
 */

/** Render tiers, richest → cheapest. "static" means: don't animate at all. */
export type PerfTier = "high" | "medium" | "low" | "static";

export const TIER_ORDER: PerfTier[] = ["high", "medium", "low", "static"];

/** Particle budget per tier. Tuned for 60fps via sprite blitting, not gradients. */
export const PARTICLES_BY_TIER: Record<Exclude<PerfTier, "static">, number> = {
  high: 420,
  medium: 260,
  low: 140,
};

export interface DeviceHints {
  /** window.devicePixelRatio */
  dpr: number;
  /** CSS-pixel width of the viewport */
  viewportWidth: number;
  /** navigator.hardwareConcurrency, when exposed */
  cores?: number;
  /** navigator.deviceMemory (GB), when exposed */
  memoryGb?: number;
  /** prefers-reduced-motion: reduce */
  reducedMotion: boolean;
  /** A 2D canvas context could be created */
  canvasSupported: boolean;
}

/**
 * Initial tier from device hints.
 *
 * Deliberately conservative: a device that looks mid-range starts at "medium"
 * and can never be promoted upward, because frame-time sampling only ever
 * steps down. Better to run smoothly at 260 particles than to stutter at 420.
 */
export function selectTier(h: DeviceHints): PerfTier {
  // Hard opt-outs first — these are correctness, not performance.
  if (h.reducedMotion || !h.canvasSupported) return "static";

  const cores = h.cores ?? 4; // unknown → assume mid-range, not best-case
  const memory = h.memoryGb ?? 4;

  let tier: PerfTier;
  if (cores <= 4 || memory <= 2) tier = "low";
  else if (cores >= 8 && memory >= 8) tier = "high";
  else tier = "medium";

  // Desktops have thermal headroom phones don't — let a capable one up a tier.
  if (h.viewportWidth >= 1024 && tier === "medium" && cores >= 8) tier = "high";

  // Fill cost scales with dpr²: a 3x-DPR screen paints ~2.25x the pixels of a
  // 2x one at the same CSS size. Applied last so it always has the final say.
  // Never demotes to "static" — that is reserved for opt-outs and *measured*
  // slowness, not a guess from a hardware hint.
  if (h.dpr >= 3 && tier !== "low") tier = nextTierDown(tier);

  return tier;
}

/** One step cheaper. "low" degrades to "static" (give up and show the mark). */
export function nextTierDown(tier: PerfTier): PerfTier {
  const i = TIER_ORDER.indexOf(tier);
  if (i < 0 || i >= TIER_ORDER.length - 1) return "static";
  return TIER_ORDER[i + 1];
}

export function particleCount(tier: PerfTier): number {
  return tier === "static" ? 0 : PARTICLES_BY_TIER[tier];
}

/**
 * Whether sustained frame times justify dropping a tier.
 *
 * Requires a full sample window so a single GC pause or scroll hitch can't
 * trigger a downgrade — only genuinely sustained slowness does.
 *
 * @param frameTimesMs recent frame deltas, newest last
 * @param budgetMs     per-frame budget; default ~48fps (16.7ms is 60fps, so
 *                     21ms leaves headroom before we react)
 * @param minSamples   how many frames must be observed first
 */
export function shouldDegrade(
  frameTimesMs: number[],
  budgetMs = 21,
  minSamples = 45
): boolean {
  if (frameTimesMs.length < minSamples) return false;
  const window = frameTimesMs.slice(-minSamples);
  const avg = window.reduce((a, b) => a + b, 0) / window.length;
  return avg > budgetMs;
}

export interface SpherePoint {
  x: number;
  y: number;
  z: number;
}

/**
 * Evenly distributed points on a unit sphere via the golden-angle (Fibonacci)
 * spiral — no clustering at the poles, which a naive lat/long grid produces.
 * Deterministic, so the form looks identical on every load.
 */
export function fibonacciSphere(count: number): SpherePoint[] {
  const pts: SpherePoint[] = [];
  if (count <= 0) return pts;
  const golden = Math.PI * (3 - Math.sqrt(5)); // ≈2.399963
  for (let i = 0; i < count; i++) {
    // y from +1 down to -1
    const y = count === 1 ? 0 : 1 - (i / (count - 1)) * 2;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    pts.push({ x: Math.cos(theta) * radius, y, z: Math.sin(theta) * radius });
  }
  return pts;
}

/**
 * Breathing scale factor at time `t` (seconds). Slow, organic — a long inhale
 * with a subtle secondary swell so it never feels like a metronome.
 */
export function breathe(t: number, period = 7): number {
  const primary = Math.sin((t / period) * Math.PI * 2);
  const secondary = Math.sin((t / (period * 0.37)) * Math.PI * 2) * 0.18;
  return 1 + (primary + secondary) * 0.055; // ≈ ±6.5% radius
}
