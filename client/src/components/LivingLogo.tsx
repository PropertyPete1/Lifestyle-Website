import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  bandAngularVelocity,
  breathe,
  DEGRADE_BUDGET_MS,
  DEPTH_BUCKETS,
  FIRST_CHECK_SAMPLES,
  isOrbDebugEnabled,
  isOrbHero,
  isTrustworthyFrame,
  isWarmedUp,
  haloCount,
  MICRO_EVENT_DURATION,
  nextMicroEventDelay,
  nextTierDown,
  nextTierUp,
  particleCount,
  REBUILD_WARMUP_MS,
  rollingFps,
  selectTier,
  shimmerBoost,
  shouldDegrade,
  shouldRecover,
  STEADY_CHECK_SAMPLES,
  swell,
  tierRank,
  WARMUP_MS,
  type PerfTier,
} from "@shared/livingLogo";

/**
 * LIVING LOGO — a dense, breathing particle volume around the LDR monogram.
 *
 * PRIMARY RESKIN: the volume is now the mini "PRIMARY" orb — a glowing
 * green-core sphere on a deep blue field (the look of THE FLOOR at
 * brain.lifestyledesignrealty.com), with drifting green + coral particles
 * (~70/30). Only the palette, the core glow, and the CSS backdrop changed;
 * the animation system, budgets, and tiering below are untouched. The LDR
 * monogram and its ring stay gold so the realty brand carries over.
 *
 * WHY CANVAS 2D AND NOT WEBGL/THREE.JS
 * Three.js is ~150KB gzipped for what is decoratively a field of additive dots —
 * that fails the "keep total added JS lean" requirement. This is a hand-rolled
 * 2D implementation with zero new dependencies. It also widens the fallback net:
 * instead of "static when WebGL is unavailable" we get "static when a 2D context
 * is unavailable", which covers strictly more devices.
 *
 * HOW IT HITS 60fps AT ~1000 PARTICLES
 * - Sprites are pre-rendered ONCE into DEPTH_BUCKETS offscreen canvases (warm +
 *   bright for the front of the volume, dim + desaturated for the back) and then
 *   blitted with drawImage. There is no per-particle gradient and no per-frame
 *   colour string construction — the depth look costs a bucket index.
 * - Particle state lives in flat Float32Arrays, so the hot loop walks
 *   cache-friendly memory and allocates nothing per frame.
 * - A particle's longitude is theta0 + omega(phi) * t evaluated directly, so
 *   there is no per-frame integration, no accumulated drift, and no state to
 *   write back. sin/cos of its FIXED latitude are precomputed.
 * - Additive compositing ("lighter") makes overlap bloom, so density buys glow
 *   for free instead of another draw pass.
 * - devicePixelRatio capped at 2: backing-store cost is quadratic in DPR and a
 *   third pixel is invisible on a ~170px orb.
 * - Budget is tiered from device hints then stepped DOWN from measured frame
 *   times, with a deliberately short FIRST window so a device that cannot carry
 *   the dense form sheds particles fast instead of stuttering.
 *
 * WHAT MAKES IT READ AS A VOLUME RATHER THAN A SCATTER
 * - Depth drives size, brightness AND saturation together, which is what sells
 *   the third dimension; a flat scatter comes from varying only alpha.
 * - Latitude-dependent angular velocity shears the surface into visible bands,
 *   so motion looks like circulation through a form.
 * - Travelling brightness swells make the breath visible as coordinated waves.
 * - A sparse outer halo layer gives the orb an atmosphere.
 * - Rare shimmer arcs sweep the surface as a moving highlight over existing
 *   particles (no extra objects) to reward watching.
 *
 * WHEN IT DOESN'T RUN AT ALL (renders the plain static mark)
 * - prefers-reduced-motion: reduce
 * - no 2D canvas context
 * - sustained low framerate even at the cheapest tier
 * The rAF loop also stops entirely when the tab is hidden or the orb scrolls out
 * of view, so it costs nothing in the background.
 *
 * ACCESSIBILITY: decorative only. The canvas is aria-hidden and conveys no
 * information; the monogram over it is real text.
 */

/** A particle palette: base body, near-side highlight, far-side depth tint. */
type Palette = {
  base: { r: number; g: number; b: number };
  hi: { r: number; g: number; b: number };
  far: { r: number; g: number; b: number };
};

/** PRIMARY green (#4ADE80) — the dominant particle species (~70%). */
const GREEN: Palette = {
  base: { r: 74, g: 222, b: 128 },
  hi: { r: 199, g: 250, b: 216 }, // #7CF5A0-tinted white for the near face
  far: { r: 32, g: 96, b: 60 },
};
/** Soft coral (#F87171) — the accent species (~30%). */
const CORAL: Palette = {
  base: { r: 248, g: 113, b: 113 },
  hi: { r: 253, g: 205, b: 205 },
  far: { r: 110, g: 52, b: 52 },
};
/** Mint-white for the hero-point blooms — the orb's own warm-white analogue. */
const PRIMARY_MINT = { r: 214, g: 255, b: 230 };

const MAX_DPR = 2;
const SPRITE_PX = 32;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * One sprite per depth bucket. `k` runs 0 (far) → 1 (near): colour warms toward
 * the palette highlight and the core hardens, so a near particle looks like a
 * lit point and a far one like a soft mote.
 */
function makeSprites({ base, hi, far }: Palette): HTMLCanvasElement[] | null {
  const out: HTMLCanvasElement[] = [];
  for (let i = 0; i < DEPTH_BUCKETS; i++) {
    const k = i / Math.max(1, DEPTH_BUCKETS - 1);
    const c = document.createElement("canvas");
    c.width = SPRITE_PX;
    c.height = SPRITE_PX;
    const g = c.getContext("2d");
    if (!g) return null;
    const r = SPRITE_PX / 2;

    const cr = Math.round(lerp(far.r, hi.r, k));
    const cg = Math.round(lerp(far.g, hi.g, k));
    const cb = Math.round(lerp(far.b, hi.b, k));
    // Far motes are pure haze; near points get a tight bright core.
    const coreStop = lerp(0.06, 0.3, k);
    const coreAlpha = lerp(0.5, 1, k);

    const grad = g.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, `rgba(${cr},${cg},${cb},${coreAlpha})`);
    grad.addColorStop(coreStop, `rgba(${base.r},${base.g},${base.b},${coreAlpha * 0.5})`);
    grad.addColorStop(1, `rgba(${base.r},${base.g},${base.b},0)`);
    g.fillStyle = grad;
    g.beginPath();
    g.arc(r, r, r, 0, Math.PI * 2);
    g.fill();
    out.push(c);
  }
  return out;
}

/** Soft bloom for hero points — pre-rendered once, blitted per particle. */
function makeBloom(radius: number, peak: number): HTMLCanvasElement | null {
  const d = Math.max(2, Math.ceil(radius * 2));
  const c = document.createElement("canvas");
  c.width = d;
  c.height = d;
  const g = c.getContext("2d");
  if (!g) return null;
  const r = d / 2;
  const { r: cr, g: cg, b: cb } = PRIMARY_MINT;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, `rgba(${cr},${cg},${cb},${peak})`);
  grad.addColorStop(0.45, `rgba(${cr},${cg},${cb},${peak * 0.35})`);
  grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
  g.fillStyle = grad;
  g.beginPath();
  g.arc(r, r, r, 0, Math.PI * 2);
  g.fill();
  return c;
}

/** Snapshot rendered by the ?orbDebug=1 overlay. */
type OrbDebug = {
  tier: PerfTier;
  /** What the hardware hints assigned — the ceiling recovery may return to. */
  assigned: PerfTier;
  particles: number;
  halo: number;
  fps: number;
  /** Tier history, e.g. "↓medium ↑high". */
  steps: string;
  cores: number;
  memoryGb: number | null;
  dpr: number;
};

export default function LivingLogo({
  /** Rendered size in CSS px. The box is reserved up-front, so no layout shift. */
  size = 168,
  className,
}: {
  size?: number;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** Drives the static fallback. Starts true so first paint is never blocked. */
  const [staticOnly, setStaticOnly] = useState(true);
  /** ?orbDebug=1 — what a REAL device is doing, rather than what we assume. */
  const [debug, setDebug] = useState<OrbDebug | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const debugOn =
      typeof window !== "undefined" && isOrbDebugEnabled(window.location.search);
    // Written every frame, read on a 4Hz timer — the hot loop must never
    // trigger a React render.
    const stats: OrbDebug = {
      tier: "static",
      assigned: "static",
      particles: 0,
      halo: 0,
      fps: 0,
      steps: "",
      cores: 0,
      memoryGb: null,
      dpr: 1,
    };
    let debugTimer = 0;

    // ---- capability + tier decision -------------------------------------
    const probe = document.createElement("canvas").getContext("2d");
    const reducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const nav = navigator as Navigator & {
      hardwareConcurrency?: number;
      deviceMemory?: number;
    };
    let tier: PerfTier = selectTier({
      dpr: window.devicePixelRatio || 1,
      viewportWidth: window.innerWidth,
      cores: nav.hardwareConcurrency,
      memoryGb: nav.deviceMemory,
      reducedMotion,
      canvasSupported: !!probe,
    });
    /** Ceiling for recovery: measurement may hand back tiers, never invent them. */
    const assignedTier = tier;

    if (debugOn) {
      stats.assigned = assignedTier;
      stats.tier = tier;
      stats.cores = nav.hardwareConcurrency ?? 0;
      stats.memoryGb = typeof nav.deviceMemory === "number" ? nav.deviceMemory : null;
      stats.dpr = window.devicePixelRatio || 1;
      stats.particles = particleCount(tier);
      stats.halo = haloCount(tier);
      // Publish immediately so the static/opt-out cases are visible too.
      setDebug({ ...stats });
      debugTimer = window.setInterval(() => setDebug({ ...stats }), 250);
    }

    if (tier === "static") {
      // Nothing further to run, but the debug timer (if any) still needs a home.
      return () => window.clearInterval(debugTimer);
    }

    // ---- lazy init: never compete with FCP or button interactivity -------
    let started = false;
    let raf = 0;
    let cleanupRun: (() => void) | null = null;

    const start = () => {
      if (started) return;
      started = true;
      setStaticOnly(false);
      cleanupRun = run();
    };

    // requestIdleCallback yields until the page is settled; the timeout is the
    // guarantee it starts even on a busy main thread. setTimeout is the fallback
    // for Safari, which still lacks rIC.
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
      cancelIdleCallback?: (h: number) => void;
    };
    let cancelSchedule: () => void;
    if (typeof w.requestIdleCallback === "function") {
      const h = w.requestIdleCallback(start, { timeout: 1200 });
      cancelSchedule = () => w.cancelIdleCallback?.(h);
    } else {
      const h = window.setTimeout(start, 350);
      cancelSchedule = () => clearTimeout(h);
    }

    // ---- the render loop -------------------------------------------------
    function run(): () => void {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) {
        setStaticOnly(true);
        return () => undefined;
      }

      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
      ctx.scale(dpr, dpr);

      // Two sprite families, one per species; the per-particle cost of the
      // second colour is a flag-indexed array pick, nothing more.
      const greenSprites = makeSprites(GREEN);
      const coralSprites = makeSprites(CORAL);
      if (!greenSprites || !coralSprites) {
        setStaticOnly(true);
        return () => undefined;
      }
      // Hero-point blooms, sized relative to the orb (the swarm uses 9/20px on a
      // full-screen hero; the same ratio on a ~170px orb is ~6/13px).
      const heroBloomR = size * 0.038;
      const heroHaloR = size * 0.08;
      const bloomInner = makeBloom(heroBloomR, 0.42);
      const bloomOuter = makeBloom(heroHaloR, 0.16);
      if (!bloomInner || !bloomOuter) {
        setStaticOnly(true);
        return () => undefined;
      }

      const cx = size / 2;
      const cy = size / 2;
      const baseR = size * 0.35;

      /* ---- particle buffers (flat, allocated once per tier) ------------- */
      let n = 0;
      let phi = new Float32Array(0);
      let theta0 = new Float32Array(0);
      let omega = new Float32Array(0);
      let sinPhi = new Float32Array(0);
      let cosPhi = new Float32Array(0);
      let jitter = new Float32Array(0); // per-particle radial variation
      let heroFlag = new Uint8Array(0); // 1 = ultra-bright mint-white bloom point
      let coralFlag = new Uint8Array(0); // 1 = coral species (~30%), else green
      let ox = new Float32Array(0); // interaction offset, relaxes to 0
      let oy = new Float32Array(0);

      let hn = 0;
      let hPhi = new Float32Array(0);
      let hTheta0 = new Float32Array(0);
      let hOmega = new Float32Array(0);
      let hRad = new Float32Array(0);

      /**
       * Deterministic PRNG so the form is identical on every load (and so the
       * halo's scatter is reproducible) without shipping a dependency.
       */
      function mulberry(seed: number) {
        let a = seed;
        return () => {
          a |= 0;
          a = (a + 0x6d2b79f5) | 0;
          let x = Math.imul(a ^ (a >>> 15), 1 | a);
          x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
          return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
        };
      }

      function build(t: PerfTier) {
        n = particleCount(t);
        phi = new Float32Array(n);
        theta0 = new Float32Array(n);
        omega = new Float32Array(n);
        sinPhi = new Float32Array(n);
        cosPhi = new Float32Array(n);
        jitter = new Float32Array(n);
        heroFlag = new Uint8Array(n);
        coralFlag = new Uint8Array(n);
        ox = new Float32Array(n);
        oy = new Float32Array(n);

        const rnd = mulberry(0x5eed);
        const golden = Math.PI * (3 - Math.sqrt(5));
        for (let i = 0; i < n; i++) {
          // Even latitude spread via the same golden-spiral distribution.
          const yy = n === 1 ? 0 : 1 - (i / (n - 1)) * 2;
          const p = Math.acos(Math.max(-1, Math.min(1, yy)));
          phi[i] = p;
          sinPhi[i] = Math.sin(p);
          cosPhi[i] = Math.cos(p);
          theta0[i] = golden * i;
          omega[i] = bandAngularVelocity(p);
          // Slight shell thickness so the surface isn't a hard eggshell.
          jitter[i] = 0.9 + rnd() * 0.16;
          heroFlag[i] = isOrbHero(rnd()) ? 1 : 0;
          // ~70/30 green-to-coral, deterministic like everything else here.
          coralFlag[i] = rnd() < 0.3 ? 1 : 0;
        }

        hn = haloCount(t);
        hPhi = new Float32Array(hn);
        hTheta0 = new Float32Array(hn);
        hOmega = new Float32Array(hn);
        hRad = new Float32Array(hn);
        for (let i = 0; i < hn; i++) {
          const p = Math.acos(rnd() * 2 - 1);
          hPhi[i] = p;
          hTheta0[i] = rnd() * Math.PI * 2;
          hOmega[i] = 0.03 + rnd() * 0.05; // much slower than the surface
          hRad[i] = 1.18 + rnd() * 0.5; // 1.18–1.68 × sphere radius
        }
      }
      build(tier);

      /* ---- pointer (soft magnetic attraction) --------------------------- */
      let pointer: { x: number; y: number } | null = null;
      const onMove = (e: PointerEvent) => {
        const rect = canvas.getBoundingClientRect();
        pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      };
      const onLeave = () => {
        pointer = null;
      };
      host!.addEventListener("pointermove", onMove, { passive: true });
      host!.addEventListener("pointerleave", onLeave, { passive: true });
      host!.addEventListener("pointercancel", onLeave, { passive: true });

      /* ---- micro-events ------------------------------------------------- */
      const rndEvent = mulberry(0xa11e);
      let nextEventAt = nextMicroEventDelay(rndEvent());
      let eventStart = -1;
      let eventPhi = Math.PI / 2;

      const t0 = performance.now();
      let last = t0;
      const frameTimes: number[] = [];
      let checkedOnce = false;
      let visible = true;
      let onScreen = true;
      let disposed = false;

      /* ---- adaptive tiering state -------------------------------------- */
      /** When measurement last restarted — frames before the warm-up elapses
       *  are not measured at all. */
      let builtAt = t0;
      /** How long that warm-up lasts. Long on first start (page load), short
       *  after a rebuild or a resume, which settle much faster. */
      let warmupMs = WARMUP_MS;
      /** Start of the current unbroken run of healthy frames. */
      let healthySince = -1;
      /** Step-ups so far, so each further one demands a longer proof. */
      let recoveries = 0;
      /** Human-readable tier history for the debug overlay. */
      const steps: string[] = [];

      /** Restart measurement without changing tier (resume, visibility). */
      const rearm = (now: number, ms: number) => {
        builtAt = now;
        warmupMs = ms;
        frameTimes.length = 0;
        healthySince = -1;
      };

      const rebuild = (next: PerfTier, why: string, now: number) => {
        tier = next;
        build(next);
        rearm(now, REBUILD_WARMUP_MS);
        steps.push(`${why}${next}`);
        if (steps.length > 6) steps.shift();
      };

      const frame = (now: number) => {
        const dtRaw = (now - last) / 1000;
        const dt = Math.min(dtRaw, 0.05); // clamp after a pause/tab switch
        last = now;
        const t = (now - t0) / 1000;

        // --- adaptive tiering ---------------------------------------------
        // Only MEASURE frames that reflect render cost. A stalled frame
        // (throttled tab, app switch, long task elsewhere) would otherwise be
        // read as "we are too slow" and shed tiers for no reason — and a run of
        // them would degrade all the way to static.
        // On top of that, frames inside the warm-up window are discarded
        // outright: page load is the jankiest moment a visitor sees, and it used
        // to be the moment that decided their tier for the rest of the session.
        const dtMs = dtRaw * 1000;
        const warm = isWarmedUp(now - builtAt, warmupMs);
        if (!isTrustworthyFrame(dtMs)) {
          frameTimes.length = 0; // a stall invalidates the sample window
          healthySince = -1; // ...and breaks the healthy streak
        } else if (warm) {
          frameTimes.push(dtMs);
          if (frameTimes.length > 120) frameTimes.shift();
          // The streak is what recovery TIMES, so any frame over the degrade
          // budget has to restart it — otherwise a device running steadily slow
          // accrues a "healthy" streak and claims a tier back on the strength of
          // one brief good patch. Tolerance is the degrade budget, not the
          // recovery budget: 60fps jitter must not keep resetting the clock.
          if (dtMs > DEGRADE_BUDGET_MS) healthySince = -1;
          else if (healthySince < 0) healthySince = now;
        }

        const windowSize = checkedOnce ? STEADY_CHECK_SAMPLES : FIRST_CHECK_SAMPLES;
        if (warm && shouldDegrade(frameTimes, DEGRADE_BUDGET_MS, windowSize)) {
          checkedOnce = true;
          const next = nextTierDown(tier);
          if (next === "static") {
            setStaticOnly(true); // give up; the mark carries the brand
            steps.push("↓static");
            if (debugOn) {
              // This path returns without reaching the publish below, and a
              // debug panel that reports the last animated tier after the
              // animation has given up is worse than no panel at all.
              stats.tier = "static";
              stats.particles = 0;
              stats.halo = 0;
              stats.fps = rollingFps(frameTimes);
              stats.steps = steps.join(" ");
            }
            return;
          }
          rebuild(next, "↓", now);
        } else if (
          // Recovery: a device that has since proved itself gets its tier back,
          // one step at a time and never above what its hardware was assigned.
          warm &&
          tierRank(tier) > tierRank(assignedTier) &&
          healthySince >= 0 &&
          shouldRecover(frameTimes, now - healthySince, recoveries)
        ) {
          recoveries++;
          rebuild(nextTierUp(tier), "↑", now);
        } else if (frameTimes.length >= windowSize) {
          checkedOnce = true;
        }

        if (debugOn) {
          stats.tier = tier;
          stats.particles = n;
          stats.halo = hn;
          stats.fps = rollingFps(frameTimes);
          stats.steps = steps.join(" ");
        }

        // --- micro-event scheduling ---------------------------------------
        if (eventStart < 0 && t >= nextEventAt) {
          eventStart = t;
          // Favour mid-latitudes, where an arc reads best.
          eventPhi = 0.7 + rndEvent() * (Math.PI - 1.4);
        } else if (eventStart >= 0 && t - eventStart > MICRO_EVENT_DURATION) {
          eventStart = -1;
          nextEventAt = t + nextMicroEventDelay(rndEvent());
        }
        const evProgress =
          eventStart >= 0 ? (t - eventStart) / MICRO_EVENT_DURATION : -1;

        ctx.clearRect(0, 0, size, size);

        const scale = breathe(t);
        const r = baseR * scale;
        // Global tilt wobble so the volume never reads as a flat spin.
        const rx = Math.sin(t * 0.11) * 0.4;
        const cosX = Math.cos(rx);
        const sinX = Math.sin(rx);

        /* ---- layer 1: outer atmosphere (behind, very faint) ------------- */
        ctx.globalCompositeOperation = "lighter";
        for (let i = 0; i < hn; i++) {
          const th = hTheta0[i] + hOmega[i] * t;
          const sp = Math.sin(hPhi[i]);
          const hx = sp * Math.cos(th);
          const hz = sp * Math.sin(th);
          const hy0 = Math.cos(hPhi[i]);
          const hy = hy0 * cosX - hz * sinX;
          const hzr = hz * cosX + hy0 * sinX;
          const rr = r * hRad[i];
          const depth = (hzr + 1) / 2;
          const persp = 0.76 + depth * 0.36;
          const sx = cx + hx * rr * persp;
          const sy = cy + hy * rr * persp;
          const dia = 1.6 + depth * 2.2;
          ctx.globalAlpha = 0.035 + depth * 0.075;
          // Atmosphere stays all-green: it reads as the orb's own glow.
          ctx.drawImage(greenSprites[depth > 0.6 ? 2 : 1], sx - dia / 2, sy - dia / 2, dia, dia);
        }

        /* ---- layer 2: core light behind the monogram -------------------- */
        // One gradient per frame (never per particle). Slightly pulsed with the
        // breath so the mark sits in a living light source.
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
        const glowPulse = 0.22 + (scale - 1) * 1.1;
        const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.05);
        core.addColorStop(0, `rgba(${GREEN.hi.r},${GREEN.hi.g},${GREEN.hi.b},${glowPulse})`);
        core.addColorStop(0.45, `rgba(${GREEN.base.r},${GREEN.base.g},${GREEN.base.b},${glowPulse * 0.45})`);
        core.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = core;
        ctx.fillRect(0, 0, size, size);

        /* ---- layer 3: the volume --------------------------------------- */
        ctx.globalCompositeOperation = "lighter";
        const relax = Math.max(0, 1 - dt * 3.5); // interaction decay per frame
        const px = pointer ? pointer.x : 0;
        const py = pointer ? pointer.y : 0;

        for (let i = 0; i < n; i++) {
          const th = theta0[i] + omega[i] * t;
          const ct = Math.cos(th);
          const st = Math.sin(th);
          const sp = sinPhi[i];
          const rj = r * jitter[i];

          // sphere → world, then the global X tilt
          const wx = sp * ct;
          const wz = sp * st;
          const wy0 = cosPhi[i];
          const wy = wy0 * cosX - wz * sinX;
          const wz2 = wz * cosX + wy0 * sinX;

          const depth = (wz2 + 1) / 2; // 0 = far side, 1 = near side
          const persp = 0.72 + depth * 0.44;
          let sx = cx + wx * rj * persp;
          let sy = cy + wy * rj * persp;

          // soft magnetic pull, relaxing back when the pointer leaves
          let o1 = ox[i] * relax;
          let o2 = oy[i] * relax;
          let boost = 0;
          if (pointer) {
            const dx = px - sx;
            const dy = py - sy;
            const d2 = dx * dx + dy * dy;
            const R = 46;
            if (d2 < R * R) {
              const f = 1 - Math.sqrt(d2) / R;
              o1 += dx * f * dt * 2.6;
              o2 += dy * f * dt * 2.6;
              boost = f * 0.55;
            }
          }
          // Clamp so a lingering pointer can't collapse the form.
          const om = Math.abs(o1) + Math.abs(o2);
          if (om > 14) {
            const s = 14 / om;
            o1 *= s;
            o2 *= s;
          }
          ox[i] = o1;
          oy[i] = o2;
          sx += o1;
          sy += o2;

          // coordinated swell + rare shimmer arc
          let bright = 0.55 + 0.45 * swell(phi[i], th, t);
          if (evProgress >= 0) {
            bright += 2.2 * shimmerBoost(phi[i], th, evProgress, eventPhi);
          }
          bright += boost;

          // Depth drives size, alpha AND colour bucket together.
          let bucket = (depth * DEPTH_BUCKETS) | 0;
          if (bucket > DEPTH_BUCKETS - 1) bucket = DEPTH_BUCKETS - 1;
          // Power curve rather than linear: the near face gains size and light
          // faster than the far face loses it, which is what makes the volume
          // punch instead of averaging into haze.
          const d2c = depth * depth;
          const dia = (0.9 + d2c * 3.8) * (1 + boost * 0.7);
          // v3 raises the visual floor through brightness/contrast rather than
          // through raw count, so the frame cost stays close to v2.
          const alpha = (0.06 + d2c * 0.78) * bright;
          ctx.globalAlpha = alpha > 1 ? 1 : alpha;
          const fam = coralFlag[i] ? coralSprites : greenSprites;
          ctx.drawImage(fam[bucket], sx - dia / 2, sy - dia / 2, dia, dia);

          // Ultra-bright mint-white hero points with a double bloom halo — the
          // same accent treatment as the homepage swarm, concentrated on the orb.
          if (heroFlag[i]) {
            const ha = Math.min(1, (0.3 + depth * 0.7) * bright);
            ctx.globalAlpha = ha * 0.5;
            ctx.drawImage(bloomOuter, sx - heroHaloR, sy - heroHaloR, heroHaloR * 2, heroHaloR * 2);
            ctx.globalAlpha = ha * 0.85;
            ctx.drawImage(bloomInner, sx - heroBloomR, sy - heroBloomR, heroBloomR * 2, heroBloomR * 2);
          }
        }

        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
        raf = requestAnimationFrame(frame);
      };

      const resume = () => {
        if (disposed || !visible || !onScreen) return;
        const now = performance.now();
        last = now;
        // Don't judge fps on the resume frames, and don't let time spent hidden
        // count toward a healthy streak that would earn a tier back unearned.
        rearm(now, REBUILD_WARMUP_MS);
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(frame);
      };
      const stop = () => cancelAnimationFrame(raf);

      // Battery: stop entirely when hidden or scrolled away.
      const onVis = () => {
        visible = document.visibilityState !== "hidden";
        visible ? resume() : stop();
      };
      document.addEventListener("visibilitychange", onVis);

      const io = new IntersectionObserver(
        (entries) => {
          onScreen = entries[0]?.isIntersecting ?? true;
          onScreen ? resume() : stop();
        },
        { threshold: 0.01 }
      );
      io.observe(host!);

      raf = requestAnimationFrame(frame);

      return () => {
        disposed = true;
        stop();
        io.disconnect();
        document.removeEventListener("visibilitychange", onVis);
        host!.removeEventListener("pointermove", onMove);
        host!.removeEventListener("pointerleave", onLeave);
        host!.removeEventListener("pointercancel", onLeave);
      };
    }

    return () => {
      window.clearInterval(debugTimer);
      cancelSchedule();
      cleanupRun?.();
    };
  }, [size]);

  return (
    <div
      ref={hostRef}
      className={cn("relative shrink-0", className)}
      style={{ width: size, height: size }}>
      {/* THE FLOOR backdrop: deep blue space with a soft static green core.
          Pure CSS, sized by the reserved box (no layout shift), and always
          present — so the reduced-motion / static fallback still reads as the
          PRIMARY orb, just without the drifting particles. */}
      <div
        aria-hidden
        className="absolute inset-0 rounded-full"
        style={{
          background: [
            "radial-gradient(circle at 50% 50%, rgba(124,245,160,0.32) 0%, rgba(74,222,128,0.18) 18%, rgba(74,222,128,0) 40%)",
            "radial-gradient(circle at 50% 50%, rgba(43,58,140,0.6) 0%, rgba(30,42,94,0.75) 36%, rgba(30,42,94,0.3) 60%, rgba(30,42,94,0) 72%)",
          ].join(", "),
        }}
      />
      {/* Canvas is purely decorative. */}
      <canvas
        ref={canvasRef}
        aria-hidden
        className={cn(
          "absolute inset-0 h-full w-full transition-opacity duration-700",
          staticOnly ? "opacity-0" : "opacity-100"
        )}
        style={{ width: size, height: size }}
      />
      {/* The real mark. Always rendered — it IS the static fallback, and it
          stays visible over the particles so the brand never depends on the
          animation running. */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          className={cn(
            "flex items-center justify-center rounded-full transition-all duration-700",
            // The ring reads as the whole mark in static mode; once the volume
            // is alive it recedes so the particles become the outer form.
            staticOnly ? "border border-gold/60" : "border border-gold/20"
          )}
          style={{ width: size * 0.48, height: size * 0.48 }}>
          <span
            className="font-serif text-gold leading-none"
            style={{ fontSize: Math.round(size * 0.175) }}>
            LDR
          </span>
        </div>
      </div>

      {/* ?orbDebug=1 — what THIS device actually got, so live fidelity can be
          read off a real phone instead of inferred. Opt-in, fixed and
          pointer-events-none, so it costs nothing and shifts nothing when the
          flag is absent (the usual case). */}
      {debug && (
        <div
          data-testid="orb-debug"
          className="pointer-events-none fixed bottom-2 left-2 z-[70] rounded bg-black/85 px-2 py-1.5 text-left font-mono text-[10px] leading-[1.5] text-gold ring-1 ring-gold/30">
          <div>
            tier <b>{debug.tier}</b>
            {debug.tier !== debug.assigned && <span> (assigned {debug.assigned})</span>}
          </div>
          <div>
            particles {debug.particles} · halo {debug.halo}
          </div>
          <div>fps {debug.fps || "—"}</div>
          <div className="text-gold/60">
            {debug.cores || "?"} cores · {debug.memoryGb ?? "?"}GB · {debug.dpr}x
          </div>
          {debug.steps && <div className="text-gold/60">{debug.steps}</div>}
        </div>
      )}
    </div>
  );
}
