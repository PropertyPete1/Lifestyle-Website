/**
 * LIVING LOGO — pure geometry, motion and performance-tiering logic.
 *
 * Kept free of DOM/canvas access so the perf-critical decisions (how many
 * particles a device gets, when to degrade, when to give up and show the static
 * mark) are unit-testable. The rendering half lives in
 * client/src/components/LivingLogo.tsx.
 */

/** Render tiers, richest → cheapest. "static" means: don't animate at all. */
export type PerfTier = "high" | "medium" | "low" | "static";

export const TIER_ORDER: PerfTier[] = ["high", "medium", "low", "static"];

/**
 * Main-sphere particle budget per tier.
 *
 * v2 roughly doubles v1 (was 420/260/140). The orb is only ~170px, so each
 * additive sprite covers few pixels and density is what makes the form read as
 * a volume rather than a scatter. Every particle is one cached drawImage — no
 * per-particle gradient — so the ceiling is high, and the adaptive step-down is
 * the safety net if a given device disagrees.
 */
export const PARTICLES_BY_TIER: Record<Exclude<PerfTier, "static">, number> = {
  high: 880,
  medium: 480,
  low: 220,
};

/**
 * Outer "atmosphere" halo particles drifting beyond the sphere surface. Sparse
 * and very faint, so they cost little but give the orb an energy field.
 */
export const HALO_BY_TIER: Record<Exclude<PerfTier, "static">, number> = {
  high: 130,
  medium: 70,
  low: 30,
};

/** Pre-rendered sprite variants: front = warm/bright, back = dim/desaturated. */
export const DEPTH_BUCKETS = 5;

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
 * steps down. Better to run smoothly at 480 particles than to stutter at 880.
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

export function haloCount(tier: PerfTier): number {
  return tier === "static" ? 0 : HALO_BY_TIER[tier];
}

/**
 * Frames to observe before the FIRST degrade decision. Shorter than the
 * steady-state window so a device that can't carry the denser v2 form drops a
 * tier quickly instead of stuttering through a long sample period.
 */
export const FIRST_CHECK_SAMPLES = 28;
/** Steady-state window — long enough that transient jank is ignored. */
export const STEADY_CHECK_SAMPLES = 45;

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
  minSamples: number = STEADY_CHECK_SAMPLES
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

/* ------------------------------------------------------------------------- *
 * FLOW STRUCTURE
 *
 * The swarm should read as energy circulating through a form, not dust
 * floating. Each particle holds a fixed latitude and orbits at a speed that
 * varies BY latitude (differential rotation, like a gas giant), which shears
 * the surface into visible bands and currents.
 * ------------------------------------------------------------------------- */

/**
 * Angular velocity (rad/s) at polar angle `phi` (0 = north pole, π = south).
 * Fastest near the equator, slowest at the poles, plus a harmonic so the
 * banding doesn't read as one smooth gradient.
 *
 * Depends only on `phi` — constant per particle — so a particle's longitude is
 * exactly `theta0 + omega * t`. No per-frame integration means no accumulation
 * drift and no per-particle state to update.
 */
export function bandAngularVelocity(phi: number): number {
  const equatorial = Math.sin(phi); // 0 at poles, 1 at equator
  return 0.085 + equatorial * 0.2 + Math.sin(phi * 3) * 0.045;
}

/**
 * Coordinated brightness swell in 0..1 — travelling waves across the surface,
 * so the breathing is visible as regions lighting and relaxing rather than only
 * the whole orb scaling. A latitude wave crossed with a slower longitudinal one.
 */
export function swell(phi: number, theta: number, t: number): number {
  const latWave = Math.sin(phi * 2.6 - t * 0.75);
  const lonWave = Math.sin(theta * 1.4 + t * 0.32);
  return 0.5 + 0.25 * latWave + 0.25 * lonWave; // bounded to 0..1
}

/* ------------------------------------------------------------------------- *
 * MICRO-EVENTS
 *
 * Rare shimmer arcs sweeping the surface, so watching for a few seconds is
 * rewarded. Implemented as a moving highlight window over the EXISTING
 * particles rather than spawning new ones, so it costs a few multiplies per
 * particle only while active.
 * ------------------------------------------------------------------------- */

export const MICRO_EVENT_MIN_GAP = 6;
export const MICRO_EVENT_MAX_GAP = 12;
/** How long one shimmer takes to sweep the sphere. */
export const MICRO_EVENT_DURATION = 2.4;

/** Seconds until the next shimmer, from a 0..1 random sample. */
export function nextMicroEventDelay(rand: number): number {
  const r = Math.min(Math.max(rand, 0), 1);
  return MICRO_EVENT_MIN_GAP + r * (MICRO_EVENT_MAX_GAP - MICRO_EVENT_MIN_GAP);
}

/** Latitude band width the shimmer illuminates (radians, each side). */
const SHIMMER_LAT_REACH = 0.55;
/** Longitudinal half-width of the travelling highlight (radians). */
const SHIMMER_LON_WIDTH = 0.5;

/**
 * Brightness boost (0..1) a particle receives from an in-progress shimmer.
 * Zero outside the arc, so the common case is an early return.
 *
 * @param phi      particle latitude
 * @param theta    particle longitude (any range; wrapped internally)
 * @param progress 0..1 through the event
 * @param eventPhi latitude the shimmer runs along
 */
export function shimmerBoost(
  phi: number,
  theta: number,
  progress: number,
  eventPhi: number
): number {
  if (progress <= 0 || progress >= 1) return 0;

  // Latitude falloff — only a band around eventPhi participates.
  const dPhi = Math.abs(phi - eventPhi);
  if (dPhi > SHIMMER_LAT_REACH) return 0;
  const latFall = 1 - dPhi / SHIMMER_LAT_REACH;

  // The highlight head travels a full turn over the event.
  const head = -Math.PI + progress * Math.PI * 2;
  // Wrap the particle's longitude into [-π, π), then measure to the head.
  let dTheta = (((theta + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  dTheta -= head;
  if (dTheta > Math.PI) dTheta -= Math.PI * 2;
  if (dTheta < -Math.PI) dTheta += Math.PI * 2;
  if (Math.abs(dTheta) > SHIMMER_LON_WIDTH) return 0;
  const lonFall = 1 - Math.abs(dTheta) / SHIMMER_LON_WIDTH;

  // Ease the event in and out so it never pops.
  const envelope = Math.sin(progress * Math.PI);
  return latFall * lonFall * envelope;
}
