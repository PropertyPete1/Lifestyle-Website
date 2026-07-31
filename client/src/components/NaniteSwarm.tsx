import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import {
  DEGRADE_BUDGET_MS,
  FIRST_CHECK_SAMPLES,
  isTrustworthyFrame,
  isWarmedUp,
  nextTierDown,
  nextTierUp,
  REBUILD_WARMUP_MS,
  selectTier,
  shouldDegrade,
  shouldRecover,
  STEADY_CHECK_SAMPLES,
  tierRank,
  WARMUP_MS,
  type PerfTier,
} from "@shared/livingLogo";
import {
  classifyNanite,
  flicker,
  flowAt,
  naniteColor,
  nextSurgeDelay,
  surgeBoost,
  swarmCount,
  textSafetyFactor,
  trailLength,
  type NaniteKind,
  type Rect,
} from "@shared/naniteSwarm";

/**
 * NANITE SWARM — a coordinated field of glowing gold nanites drifting up through
 * the homepage hero, each dragging a fading light trail.
 *
 * ARCHITECTURE NOTES
 * - Canvas 2D, additive compositing, zero new dependencies. Same discipline as
 *   the /links Living Logo, and it REUSES that module's tier selection and
 *   frame-time degradation rather than duplicating them.
 * - Sits between the hero background and the hero content in DOM order, so it
 *   always paints behind the headline/CTAs without needing a z-index fight, and
 *   is pointer-events-none so it can never intercept a CTA tap.
 * - Positioned absolute inset-0 inside the already-sized hero section, so it
 *   introduces no layout and cannot shift anything (CLS 0).
 *
 * MOTION
 * All velocity comes from flowAt(), a divergence-free curl field with a strong
 * upward bias. Horizontal drift is clamped inside that function to ≤0.4× the
 * vertical speed, so the swarm can sway and curve but can never streak sideways.
 * Particles that leave the top respawn at the bottom; there is deliberately no
 * horizontal wrapping, which would read as particles flying in from the edges.
 *
 * PERFORMANCE
 * - Trails are a fixed-capacity ring buffer per particle inside one flat
 *   Float32Array — no per-frame allocation, no array shifting.
 * - Trail strokes are batched by colour bucket so the whole swarm costs a
 *   handful of strokeStyle changes rather than one per particle.
 * - Hero blooms (the only radial gradients) are pre-rendered once as sprites and
 *   blitted, so no gradient is constructed per frame.
 * - DPR capped at 2; motion is delta-time driven so it looks identical at any
 *   framerate; the loop stops entirely when hidden or scrolled away.
 *
 * FALLBACKS (hero renders exactly as it does today)
 * prefers-reduced-motion · no 2D context · sustained low framerate even at the
 * cheapest tier.
 *
 * ACCESSIBILITY: decorative only — aria-hidden, conveys no information.
 */

const MAX_DPR = 2;
/** Max trail samples any particle can hold (hero upper bound from the spec). */
const TRAIL_CAP = 34;

/** Pre-rendered soft bloom used for hero nanites (spec: ~9px and ~20px radii). */
function makeBloom(radius: number, rgb: { r: number; g: number; b: number }, peak: number) {
  const d = Math.ceil(radius * 2);
  const c = document.createElement("canvas");
  c.width = d;
  c.height = d;
  const g = c.getContext("2d");
  if (!g) return null;
  const grad = g.createRadialGradient(radius, radius, 0, radius, radius, radius);
  grad.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},${peak})`);
  grad.addColorStop(0.45, `rgba(${rgb.r},${rgb.g},${rgb.b},${peak * 0.35})`);
  grad.addColorStop(1, `rgba(${rgb.r},${rgb.g},${rgb.b},0)`);
  g.fillStyle = grad;
  g.beginPath();
  g.arc(radius, radius, radius, 0, Math.PI * 2);
  g.fill();
  return c;
}

export default function NaniteSwarm({ className }: { className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

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
    /** Ceiling for recovery: measurement may hand tiers back, never invent them. */
    const assignedTier = tier;
    if (tier === "static") return; // hero stays exactly as it is today

    let started = false;
    let cleanupRun: (() => void) | null = null;
    const start = () => {
      if (started) return;
      started = true;
      cleanupRun = run();
    };

    // Lazy init — never compete with hero paint or CTA interactivity.
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
      cancelIdleCallback?: (h: number) => void;
    };
    let cancelSchedule: () => void;
    if (typeof w.requestIdleCallback === "function") {
      const h = w.requestIdleCallback(start, { timeout: 1500 });
      cancelSchedule = () => w.cancelIdleCallback?.(h);
    } else {
      const h = window.setTimeout(start, 400);
      cancelSchedule = () => clearTimeout(h);
    }

    function run(): () => void {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return () => undefined;

      let W = 0;
      let H = 0;
      let dpr = 1;

      const bloomSmall = makeBloom(9, { r: 255, g: 246, b: 220 }, 0.5);
      const bloomLarge = makeBloom(20, { r: 255, g: 246, b: 220 }, 0.22);
      if (!bloomSmall || !bloomLarge) return () => undefined;

      /* ---- population buffers (allocated per tier, never per frame) ----- */
      let n = 0;
      let px = new Float32Array(0);
      let py = new Float32Array(0);
      let pz = new Float32Array(0); // depth 0..1
      let phase = new Float32Array(0);
      let tlen = new Int16Array(0); // trail length in samples
      let kind: NaniteKind[] = [];
      let colIdx = new Uint8Array(0); // 0 gold, 1 blue, 2 warm white
      // Trail ring buffers: TRAIL_CAP samples per particle, flat.
      let tx = new Float32Array(0);
      let ty = new Float32Array(0);
      let thead = new Int16Array(0); // newest sample index
      let tfill = new Int16Array(0); // how many samples are valid

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
      const rnd = mulberry(0x51e3d);

      function build(t: PerfTier) {
        n = swarmCount(t);
        px = new Float32Array(n);
        py = new Float32Array(n);
        pz = new Float32Array(n);
        phase = new Float32Array(n);
        tlen = new Int16Array(n);
        colIdx = new Uint8Array(n);
        kind = new Array(n);
        tx = new Float32Array(n * TRAIL_CAP);
        ty = new Float32Array(n * TRAIL_CAP);
        thead = new Int16Array(n);
        tfill = new Int16Array(n);
        for (let i = 0; i < n; i++) spawn(i, true);
      }

      /** Place a particle. `initial` scatters through the hero; otherwise it
       *  enters from just below the bottom edge. Never from the sides. */
      function spawn(i: number, initial: boolean) {
        const k = classifyNanite(rnd());
        const z = 0.15 + rnd() * 0.85;
        kind[i] = k;
        pz[i] = z;
        phase[i] = rnd() * Math.PI * 2;
        tlen[i] = Math.min(TRAIL_CAP, trailLength(k, z));
        const c = naniteColor(k, rnd());
        colIdx[i] = k === "hero" ? 2 : c.b > 200 ? 1 : 0;
        px[i] = rnd() * (W || 1);
        py[i] = initial ? rnd() * (H || 1) : (H || 1) + rnd() * 60;
        thead[i] = 0;
        tfill[i] = 0;
      }

      function resize() {
        const rect = host!.getBoundingClientRect();
        dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
        W = Math.max(1, Math.round(rect.width));
        H = Math.max(1, Math.round(rect.height));
        canvas!.width = Math.round(W * dpr);
        canvas!.height = Math.round(H * dpr);
        ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      resize();
      build(tier);

      /* ---- text-safety rects, measured from the live DOM --------------- */
      let safeRects: Rect[] = [];
      function measureSafeZones() {
        safeRects = [];
        const section = host!.parentElement;
        if (!section) return;
        const base = host!.getBoundingClientRect();
        // The hero headline and the CTA row are the things that must stay
        // legible. Measured (not hardcoded) so this follows the copy when it
        // reflows on mobile or the CTA row wraps.
        const targets = section.querySelectorAll("h1, [data-hero-ctas]");
        targets.forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) return;
          const pad = 14;
          safeRects.push({
            x: r.left - base.left - pad,
            y: r.top - base.top - pad,
            w: r.width + pad * 2,
            h: r.height + pad * 2,
          });
        });
      }
      measureSafeZones();

      const onResize = () => {
        resize();
        measureSafeZones();
      };
      window.addEventListener("resize", onResize, { passive: true });

      /* ---- surge scheduling -------------------------------------------- */
      const rndSurge = mulberry(0x51236);
      let nextSurgeAt = nextSurgeDelay(rndSurge());
      let surgeY = -1;

      const COLORS = [
        { r: 201, g: 169, b: 97 },
        { r: 143, g: 196, b: 233 },
        { r: 255, g: 246, b: 220 },
      ];

      const t0 = performance.now();
      let last = t0;
      const frameTimes: number[] = [];
      let checkedOnce = false;
      let visible = true;
      let onScreen = true;
      let disposed = false;

      /* ---- adaptive tiering state (shared policy with LivingLogo) ------- */
      // Hero paint is the busiest moment on the page, so the same two guards
      // apply: frames inside the warm-up aren't measured, and a tier lost to a
      // rough patch can be earned back instead of lasting the whole session.
      let builtAt = t0;
      let warmupMs = WARMUP_MS;
      let healthySince = -1;
      let recoveries = 0;

      const rearm = (now: number, ms: number) => {
        builtAt = now;
        warmupMs = ms;
        frameTimes.length = 0;
        healthySince = -1;
      };
      let raf = 0;

      const frame = (now: number) => {
        const dtRaw = (now - last) / 1000;
        const dt = Math.min(dtRaw, 0.05); // clamp motion after a pause/tab switch
        last = now;
        const t = (now - t0) / 1000;

        // --- adaptive degradation ---------------------------------------
        // Only MEASURE frames that reflect render cost. A stalled frame
        // (throttled tab, app switch, long task elsewhere) would otherwise be
        // read as "we are too slow" and shed tiers for no reason — and a run of
        // them would degrade all the way to static.
        const dtMs = dtRaw * 1000;
        const warm = isWarmedUp(now - builtAt, warmupMs);
        if (!isTrustworthyFrame(dtMs)) {
          frameTimes.length = 0; // a stall invalidates the sample window
          healthySince = -1; // ...and breaks the healthy streak
        } else if (warm) {
          frameTimes.push(dtMs);
          if (frameTimes.length > 120) frameTimes.shift();
          // Any frame over the degrade budget restarts the streak, so "healthy
          // for 10s" means what it says rather than "running for 10s".
          if (dtMs > DEGRADE_BUDGET_MS) healthySince = -1;
          else if (healthySince < 0) healthySince = now;
        }

        const windowSize = checkedOnce ? STEADY_CHECK_SAMPLES : FIRST_CHECK_SAMPLES;
        if (warm && shouldDegrade(frameTimes, DEGRADE_BUDGET_MS, windowSize)) {
          checkedOnce = true;
          const next = nextTierDown(tier);
          if (next === "static") {
            ctx.clearRect(0, 0, W, H); // hero returns to exactly as-designed
            return;
          }
          tier = next;
          build(tier);
          rearm(now, REBUILD_WARMUP_MS);
        } else if (
          warm &&
          tierRank(tier) > tierRank(assignedTier) &&
          healthySince >= 0 &&
          shouldRecover(frameTimes, now - healthySince, recoveries)
        ) {
          recoveries++;
          tier = nextTierUp(tier);
          build(tier);
          rearm(now, REBUILD_WARMUP_MS);
        } else if (frameTimes.length >= windowSize) {
          checkedOnce = true;
        }

        // --- surge wave --------------------------------------------------
        if (surgeY < 0 && t >= nextSurgeAt) surgeY = H + 80;
        if (surgeY >= 0) {
          surgeY -= dt * 420; // sweeps upward
          if (surgeY < -120) {
            surgeY = -1;
            nextSurgeAt = t + nextSurgeDelay(rndSurge());
          }
        }

        ctx.clearRect(0, 0, W, H);
        ctx.globalCompositeOperation = "lighter";
        ctx.lineCap = "round";

        // --- advance + record trail -------------------------------------
        for (let i = 0; i < n; i++) {
          const z = pz[i];
          const f = flowAt(px[i], py[i], t, 0.45 + z * 1.15);
          px[i] += f.vx * dt;
          py[i] += f.vy * dt;

          // Off the top → respawn from the bottom. No horizontal wrapping.
          if (py[i] < -40) {
            spawn(i, false);
            continue;
          }
          // Gentle horizontal containment: nudge back rather than wrap, so a
          // particle never teleports across the hero.
          if (px[i] < -30) px[i] = -30;
          else if (px[i] > W + 30) px[i] = W + 30;

          const head = (thead[i] + 1) % TRAIL_CAP;
          thead[i] = head;
          tx[i * TRAIL_CAP + head] = px[i];
          ty[i * TRAIL_CAP + head] = py[i];
          if (tfill[i] < TRAIL_CAP) tfill[i]++;
        }

        // --- draw trails, batched by colour -----------------------------
        for (let c = 0; c < 3; c++) {
          const col = COLORS[c];
          for (let i = 0; i < n; i++) {
            if (colIdx[i] !== c) continue;
            const fill = tfill[i];
            if (fill < 2) continue;
            const z = pz[i];
            const len = Math.min(tlen[i], fill);
            const baseA =
              (0.16 + z * 0.5) *
              flicker(t, phase[i]) *
              (1 + (surgeY >= 0 ? surgeBoost(py[i], surgeY) : 0)) *
              textSafetyFactor(px[i], py[i], safeRects);

            // Tapering polyline: alpha and width rise toward the head.
            const h = thead[i];
            for (let s = 1; s < len; s++) {
              const i0 = (h - s + 1 + TRAIL_CAP) % TRAIL_CAP;
              const i1 = (h - s + TRAIL_CAP) % TRAIL_CAP;
              const x0 = tx[i * TRAIL_CAP + i0];
              const y0 = ty[i * TRAIL_CAP + i0];
              const x1 = tx[i * TRAIL_CAP + i1];
              const y1 = ty[i * TRAIL_CAP + i1];
              // A respawn writes a discontinuity; skip that segment.
              if (Math.abs(y1 - y0) > 120) continue;
              const taper = 1 - s / len;
              const a = baseA * taper * taper;
              if (a < 0.012) break;
              ctx.strokeStyle = `rgba(${col.r},${col.g},${col.b},${a > 1 ? 1 : a})`;
              ctx.lineWidth = (kind[i] === "hero" ? 1.5 : 0.9) * (0.4 + z) * taper;
              ctx.beginPath();
              ctx.moveTo(x0, y0);
              ctx.lineTo(x1, y1);
              ctx.stroke();
            }
          }
        }

        // --- heads + hero blooms ----------------------------------------
        for (let i = 0; i < n; i++) {
          const z = pz[i];
          const col = COLORS[colIdx[i]];
          const safety = textSafetyFactor(px[i], py[i], safeRects);
          const a =
            (0.4 + z * 0.6) *
            flicker(t, phase[i]) *
            (1 + (surgeY >= 0 ? surgeBoost(py[i], surgeY) : 0)) *
            safety;
          const isHero = kind[i] === "hero";
          const size = (isHero ? 2.2 : 0.85 + z * 0.7) * (0.6 + z * 0.6);

          if (isHero) {
            // Double bloom halo, blitted from the pre-rendered sprites.
            ctx.globalAlpha = Math.min(1, a) * 0.9;
            ctx.drawImage(bloomLarge!, px[i] - 20, py[i] - 20, 40, 40);
            ctx.globalAlpha = Math.min(1, a);
            ctx.drawImage(bloomSmall!, px[i] - 9, py[i] - 9, 18, 18);
            ctx.globalAlpha = 1;
          }
          ctx.fillStyle = `rgba(${col.r},${col.g},${col.b},${Math.min(1, a)})`;
          ctx.beginPath();
          ctx.arc(px[i], py[i], size, 0, Math.PI * 2);
          ctx.fill();
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
        window.removeEventListener("resize", onResize);
      };
    }

    return () => {
      cancelSchedule();
      cleanupRun?.();
    };
  }, []);

  return (
    <div
      ref={hostRef}
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      <canvas ref={canvasRef} className="h-full w-full" />
    </div>
  );
}
