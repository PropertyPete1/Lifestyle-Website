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
  high: 1150,
  medium: 620,
  low: 240,
};

/**
 * Outer "atmosphere" halo particles drifting beyond the sphere surface. Sparse
 * and very faint, so they cost little but give the orb an energy field.
 */
export const HALO_BY_TIER: Record<Exclude<PerfTier, "static">, number> = {
  high: 175,
  medium: 95,
  low: 36,
};

/** Pre-rendered sprite variants: front = warm/bright, back = dim/desaturated. */
export const DEPTH_BUCKETS = 5;

/**
 * Fraction of orb particles promoted to ultra-bright warm-white "hero" points
 * with bloom halos — the same accent species the homepage hero swarm uses, so
 * the two animations read as one visual language.
 *
 * Deliberately far below the swarm's ~6%: this is matched on AREAL density, not
 * percentage. The orb packs ~1150 particles into ~170², perhaps a fifteenth of
 * the hero's area, so copying 6% put ~57 blooms in a tiny space and washed the
 * gold identity out into glitter. ~1.5% lands ~17 blooms — the same visual
 * frequency a viewer reads on the hero.
 */
export const ORB_HERO_FRACTION = 0.015;

/** Whether a particle (given a 0..1 sample) is a bloom-halo hero point. */
export function isOrbHero(rand: number): boolean {
  return rand < ORB_HERO_FRACTION;
}

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
 * THIS IS A STARTING POINT, NOT A VERDICT. The measured loop can step down when
 * frames are genuinely expensive and (since the recovery pass) back up when they
 * are not, so the hints only have to avoid gross mistakes rather than predict a
 * device's performance. That is a different job from the one the original,
 * deliberately pessimistic version was doing, and the pessimism cost real
 * fidelity: every iPhone landed on the cheapest tier.
 *
 * WHAT WENT WRONG, MEASURED AGAINST WHAT BROWSERS ACTUALLY REPORT
 *
 * 1. `cores <= 4 → low`. iOS Safari reports hardwareConcurrency 4 on every
 *    iPhone through the 14, and 6 on the 15/16 Pro. Four Apple cores are not a
 *    budget device; that rule put flagship phones on 240 particles while a dev
 *    MacBook rendered 1150. The floor is now 2 cores.
 *
 * 2. `memoryGb ?? 4`. navigator.deviceMemory is Chromium-only — Safari and
 *    Firefox have never shipped it. Defaulting "unknown" to 4GB meant every
 *    Apple device was scored as a mid-range Android. Unknown is now no signal
 *    at all, and only a REPORTED small number counts against a device.
 *
 * 3. The dpr >= 3 demotion charged for pixels that are never painted. Both
 *    renderers clamp their backing store to MAX_DPR = 2, so a 3x screen fills
 *    exactly as many device pixels as a 2x one at the same CSS size. The
 *    penalty is gone; DPR is no longer a tiering input.
 *
 * `viewportWidth` is retained on DeviceHints (it is useful context, and the
 * debug overlay reports it) but no longer decides anything: core count already
 * separates desktops from phones without also punishing a fast phone.
 */
export function selectTier(h: DeviceHints): PerfTier {
  // Hard opt-outs first — these are correctness, not performance.
  if (h.reducedMotion || !h.canvasSupported) return "static";

  const cores = h.cores ?? 4;
  // Unknown memory must not read as "small". Infinity makes every comparison
  // below fall through to the core count, which is the signal we actually have.
  const memoryKnown = typeof h.memoryGb === "number" && h.memoryGb > 0;
  const memory = memoryKnown ? (h.memoryGb as number) : Infinity;

  // The only profiles that START at the floor are genuinely weak ones.
  if (cores <= 2 || memory <= 2) return "low";
  // 8+ cores is a modern phone or any desktop.
  if (cores >= 8) return "high";
  // 4-6 cores with plenty of memory — or with no memory signal at all, which in
  // practice means Safari or Firefox, i.e. Apple hardware and desktops.
  if (cores >= 4 && memory >= 8) return "high";
  return "medium";
}

/** One step cheaper. "low" degrades to "static" (give up and show the mark). */
export function nextTierDown(tier: PerfTier): PerfTier {
  const i = TIER_ORDER.indexOf(tier);
  if (i < 0 || i >= TIER_ORDER.length - 1) return "static";
  return TIER_ORDER[i + 1];
}

/** One step richer. Caps at "high"; never resurrects "static" on its own. */
export function nextTierUp(tier: PerfTier): PerfTier {
  const i = TIER_ORDER.indexOf(tier);
  return i <= 0 ? TIER_ORDER[0] : TIER_ORDER[i - 1];
}

/** Position in TIER_ORDER — LOWER is richer. Handy for "is this cheaper than". */
export function tierRank(tier: PerfTier): number {
  const i = TIER_ORDER.indexOf(tier);
  return i < 0 ? TIER_ORDER.length - 1 : i;
}

export function particleCount(tier: PerfTier): number {
  return tier === "static" ? 0 : PARTICLES_BY_TIER[tier];
}

export function haloCount(tier: PerfTier): number {
  return tier === "static" ? 0 : HALO_BY_TIER[tier];
}

/**
 * Longest frame delta still treated as a MEASUREMENT of render cost.
 *
 * A delta above this means the loop was stalled — a throttled/backgrounded tab,
 * an app switch, a long task elsewhere on the page — not that our render is
 * expensive. Feeding those samples to the degrade detector would make it shed
 * tiers (eventually all the way to static) for reasons that have nothing to do
 * with the animation. Callers clamp motion to a similar ceiling; this is the
 * separate question of whether the frame is worth measuring.
 */
export const TRUSTWORTHY_FRAME_MS = 40;

/** Whether a frame delta reflects real render cost rather than a stall. */
export function isTrustworthyFrame(dtMs: number): boolean {
  return dtMs > 0 && dtMs < TRUSTWORTHY_FRAME_MS;
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
  budgetMs = DEGRADE_BUDGET_MS,
  minSamples: number = STEADY_CHECK_SAMPLES
): boolean {
  if (frameTimesMs.length < minSamples) return false;
  const window = frameTimesMs.slice(-minSamples);
  const avg = window.reduce((a, b) => a + b, 0) / window.length;
  return avg > budgetMs;
}

/* ------------------------------------------------------------------------- *
 * WARM-UP + RECOVERY
 *
 * Two halves of the same problem: a tier decision made from the wrong moment,
 * kept forever.
 *
 * Page load is the jankiest window a visitor will ever see — decoding, layout,
 * hydration, other components starting — and it is exactly when the animation
 * takes its first frame measurements. Sampling through it made one rough load
 * permanently drop a perfectly capable device a tier (or three). The warm-up
 * throws those frames away; recovery makes the decision reversible either way.
 * ------------------------------------------------------------------------- */

/** Per-frame budget above which sustained frames justify dropping a tier. */
export const DEGRADE_BUDGET_MS = 21;

/**
 * Frames within this long of a (re)build are not measured at all. Covers first
 * paint, buffer allocation and whatever else the page is still doing.
 */
export const WARMUP_MS = 2500;
/** Shorter re-warm after a tier change — only the new buffers are settling. */
export const REBUILD_WARMUP_MS = 600;

/** Whether enough time has passed since a (re)build for frames to mean anything. */
export function isWarmedUp(msSinceBuild: number, warmupMs = WARMUP_MS): boolean {
  return msSinceBuild >= warmupMs;
}

/**
 * Sustained healthy time before a tier is handed back.
 *
 * Deliberately long: a step UP costs a rebuild and a visible density change, so
 * it should happen once when a device proves itself, not every time a scroll
 * finishes.
 */
export const RECOVERY_WINDOW_MS = 10_000;
/**
 * Healthy per-frame budget. Stricter than DEGRADE_BUDGET_MS on purpose — the
 * gap between them is the hysteresis band. A device averaging 18.5-21ms sits in
 * it and neither degrades nor recovers, instead of oscillating between tiers.
 *
 * Not tighter than this: a real 60fps device averages ~16.7ms with jitter, and
 * a budget of 17 would have made recovery unreachable in practice for anything
 * that wasn't perfectly vsynced.
 */
export const RECOVERY_BUDGET_MS = 18.5;
/** Trustworthy samples the recovery decision needs before it will fire. */
export const RECOVERY_MIN_SAMPLES = 90;
/** Backoff ceiling: attempts beyond this don't lengthen the window further. */
export const RECOVERY_BACKOFF_MAX = 3;

/**
 * Healthy time required before the Nth step up: 10s, 20s, 40s, 80s, then flat.
 * A device that keeps earning a tier back and losing it again has to prove
 * itself for longer each time, so the two decisions can never ping-pong.
 */
export function recoveryWindowMs(attempts: number, base = RECOVERY_WINDOW_MS): number {
  const n = Math.min(Math.max(Math.floor(attempts), 0), RECOVERY_BACKOFF_MAX);
  return base * Math.pow(2, n);
}

/**
 * Whether a sustained run of healthy frames justifies stepping a tier back UP.
 *
 * @param frameTimesMs  recent trustworthy frame deltas, newest last
 * @param healthyForMs  how long the current unbroken healthy streak has run
 * @param attempts      how many times this session has already stepped up
 */
export function shouldRecover(
  frameTimesMs: number[],
  healthyForMs: number,
  attempts = 0,
  budgetMs = RECOVERY_BUDGET_MS,
  minSamples: number = RECOVERY_MIN_SAMPLES
): boolean {
  if (healthyForMs < recoveryWindowMs(attempts)) return false;
  if (frameTimesMs.length < minSamples) return false;
  const window = frameTimesMs.slice(-minSamples);
  const avg = window.reduce((a, b) => a + b, 0) / window.length;
  return avg < budgetMs;
}

/* ------------------------------------------------------------------------- *
 * DEBUG VIEW (?orbDebug=1)
 * ------------------------------------------------------------------------- */

/**
 * Whether the on-screen tier/fps overlay is requested.
 *
 * Opt-in only, and explicitly off for `?orbDebug=0` so a stale link can't leave
 * the panel on a real visitor's screen.
 */
export function isOrbDebugEnabled(search: string): boolean {
  for (const part of (search ?? "").replace(/^\?/, "").split("&")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    const key = eq < 0 ? part : part.slice(0, eq);
    if (key !== "orbDebug") continue;
    const value = (eq < 0 ? "" : decodeURIComponent(part.slice(eq + 1))).toLowerCase();
    return value === "" || value === "1" || value === "true" || value === "yes";
  }
  return false;
}

/** Rolling framerate from recent deltas, for the debug overlay. */
export function rollingFps(frameTimesMs: number[], sampleCount = 30): number {
  if (frameTimesMs.length === 0) return 0;
  const window = frameTimesMs.slice(-Math.max(1, sampleCount));
  const avg = window.reduce((a, b) => a + b, 0) / window.length;
  return avg > 0 ? Math.round(1000 / avg) : 0;
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
  // v3 widens the equator-to-pole spread (was 0.085 + 0.20·eq + 0.045·h3) so the
  // shear between bands is obvious at a glance rather than merely present.
  return 0.075 + equatorial * 0.36 + Math.sin(phi * 3) * 0.085;
}

/**
 * Coordinated brightness swell in 0..1 — travelling waves across the surface,
 * so the breathing is visible as regions lighting and relaxing rather than only
 * the whole orb scaling. A latitude wave crossed with a slower longitudinal one.
 */
export function swell(phi: number, theta: number, t: number): number {
  const latWave = Math.sin(phi * 2.6 - t * 0.9);
  const lonWave = Math.sin(theta * 1.4 + t * 0.38);
  // Skewed toward the bright end (v3) so lit bands punch while troughs still
  // recede — a symmetric 0.5 mean read as uniformly dim on real screens.
  const w = 0.5 + 0.25 * latWave + 0.25 * lonWave;
  return 0.28 + w * 0.72; // 0.28..1
}

/* ------------------------------------------------------------------------- *
 * MICRO-EVENTS
 *
 * Rare shimmer arcs sweeping the surface, so watching for a few seconds is
 * rewarded. Implemented as a moving highlight window over the EXISTING
 * particles rather than spawning new ones, so it costs a few multiplies per
 * particle only while active.
 * ------------------------------------------------------------------------- */

export const MICRO_EVENT_MIN_GAP = 4;
export const MICRO_EVENT_MAX_GAP = 8;
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
