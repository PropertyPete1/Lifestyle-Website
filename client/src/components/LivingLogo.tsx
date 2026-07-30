import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  breathe,
  fibonacciSphere,
  nextTierDown,
  particleCount,
  selectTier,
  shouldDegrade,
  type PerfTier,
} from "@shared/livingLogo";

/**
 * LIVING LOGO — a slowly breathing particle sphere around the LDR monogram.
 *
 * WHY CANVAS 2D AND NOT WEBGL/THREE.JS
 * Three.js is ~150KB gzipped for what is decoratively a few hundred additive
 * dots — that fails the "keep total added JS lean" requirement. This is a
 * hand-rolled 2D implementation with zero new dependencies. It also widens the
 * fallback net: instead of "static when WebGL is unavailable" we get "static
 * when a 2D context is unavailable", which covers strictly more devices
 * (WebGL is blocked far more often than 2D).
 *
 * HOW IT HITS 60fps
 * - The glow sprite is rendered ONCE into an offscreen canvas, then blitted per
 *   particle with drawImage. Per-particle createRadialGradient would dominate
 *   the frame budget; a cached blit is roughly an order of magnitude cheaper.
 * - Additive compositing ("lighter") produces the bloom where particles overlap,
 *   so the glow is free rather than another draw pass.
 * - devicePixelRatio is capped at 2. Backing-store cost is quadratic in DPR and
 *   a 3rd pixel of detail is invisible on a ~170px orb.
 * - Particle budget is tiered from device hints, then stepped DOWN if measured
 *   frame times stay over budget. It never steps up.
 *
 * WHEN IT DOESN'T RUN AT ALL (renders the plain static mark)
 * - prefers-reduced-motion: reduce
 * - no 2D canvas context
 * - sustained low framerate even at the cheapest tier
 * It also fully stops the rAF loop when the tab is hidden or the orb scrolls
 * out of view, so it costs nothing in the background.
 *
 * ACCESSIBILITY: decorative only. The canvas is aria-hidden and conveys no
 * information; the monogram beside/behind it is real text.
 */

/** Established canvas-safe gold (matches --gold oklch(0.75 0.09 85)). */
const GOLD = { r: 201, g: 169, b: 97 };
/** Warmer highlight for near-camera particles. */
const GOLD_HI = { r: 232, g: 205, b: 142 };

const MAX_DPR = 2;

/** Pre-render one soft particle into a small offscreen canvas (done once). */
function makeGlowSprite(diameter: number): HTMLCanvasElement | null {
  const c = document.createElement("canvas");
  c.width = diameter;
  c.height = diameter;
  const g = c.getContext("2d");
  if (!g) return null;
  const r = diameter / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, `rgba(${GOLD_HI.r},${GOLD_HI.g},${GOLD_HI.b},1)`);
  grad.addColorStop(0.35, `rgba(${GOLD.r},${GOLD.g},${GOLD.b},0.55)`);
  grad.addColorStop(1, `rgba(${GOLD.r},${GOLD.g},${GOLD.b},0)`);
  g.fillStyle = grad;
  g.beginPath();
  g.arc(r, r, r, 0, Math.PI * 2);
  g.fill();
  return c;
}

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

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

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
    if (tier === "static") return; // stay on the static mark

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

      const SPRITE = 24;
      const sprite = makeGlowSprite(SPRITE);
      if (!sprite) {
        setStaticOnly(true);
        return () => undefined;
      }

      let points = fibonacciSphere(particleCount(tier));
      const cx = size / 2;
      const cy = size / 2;
      const baseR = size * 0.36;

      // Pointer proximity (cheap: one vector per frame, no per-particle hit test)
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

      let t0 = performance.now();
      let last = t0;
      const frameTimes: number[] = [];
      let visible = true;
      let onScreen = true;
      let paused = false;

      const frame = (now: number) => {
        const dt = Math.min((now - last) / 1000, 0.05); // clamp after a pause
        last = now;
        const t = (now - t0) / 1000;

        // --- adaptive degradation -----------------------------------------
        frameTimes.push(dt * 1000);
        if (frameTimes.length > 90) frameTimes.shift();
        if (shouldDegrade(frameTimes)) {
          const next = nextTierDown(tier);
          frameTimes.length = 0;
          if (next === "static") {
            setStaticOnly(true); // give up; show the mark
            return;
          }
          tier = next;
          points = fibonacciSphere(particleCount(tier));
        }

        ctx.clearRect(0, 0, size, size);

        const scale = breathe(t);
        const r = baseR * scale;
        // Slow orbit; the X wobble keeps it from reading as a flat spin.
        const ry = t * 0.16;
        const rx = Math.sin(t * 0.11) * 0.42;
        const cosY = Math.cos(ry), sinY = Math.sin(ry);
        const cosX = Math.cos(rx), sinX = Math.sin(rx);

        // Soft core bloom — one gradient per frame, not per particle.
        const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.15);
        core.addColorStop(0, `rgba(${GOLD.r},${GOLD.g},${GOLD.b},0.10)`);
        core.addColorStop(1, "rgba(0,0,0,0)");
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = core;
        ctx.fillRect(0, 0, size, size);

        ctx.globalCompositeOperation = "lighter";

        for (let i = 0; i < points.length; i++) {
          const p = points[i];
          // Organic drift: two cheap sines per axis instead of a noise library.
          const wob = 1 + Math.sin(t * 0.7 + i * 0.35) * 0.035;

          // rotate Y then X
          let x = p.x * cosY + p.z * sinY;
          let z = p.z * cosY - p.x * sinY;
          let y = p.y * cosX - z * sinX;
          z = z * cosX + p.y * sinX;

          x *= r * wob;
          y *= r * wob;

          // perspective: depth 0 (far) → 1 (near)
          const depth = (z + 1) / 2;
          const persp = 0.72 + depth * 0.42;
          let sx = cx + x * persp;
          let sy = cy + y * persp;

          // pointer proximity: gentle outward push + brighten
          let boost = 0;
          if (pointer) {
            const dx = sx - pointer.x;
            const dy = sy - pointer.y;
            const d2 = dx * dx + dy * dy;
            const R = 52;
            if (d2 < R * R) {
              const f = 1 - Math.sqrt(d2) / R;
              sx += dx * f * 0.22;
              sy += dy * f * 0.22;
              boost = f * 0.5;
            }
          }

          const alpha = (0.16 + depth * 0.5 + boost) * 0.95;
          const dia = (1.1 + depth * 2.5) * (1 + boost * 0.5);
          ctx.globalAlpha = Math.min(alpha, 1);
          ctx.drawImage(sprite!, sx - dia / 2, sy - dia / 2, dia, dia);
        }

        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
        raf = requestAnimationFrame(frame);
      };

      const resume = () => {
        if (paused || !visible || !onScreen) return;
        last = performance.now();
        frameTimes.length = 0; // don't judge fps on the resume frame
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
        paused = true;
        stop();
        io.disconnect();
        document.removeEventListener("visibilitychange", onVis);
        host!.removeEventListener("pointermove", onMove);
        host!.removeEventListener("pointerleave", onLeave);
      };
    }

    return () => {
      cancelSchedule();
      cleanupRun?.();
    };
  }, [size]);

  return (
    <div
      ref={hostRef}
      className={cn("relative shrink-0", className)}
      style={{ width: size, height: size }}>
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
          stays visible on top of the particles so the brand never depends on
          the animation running. */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          className={cn(
            "flex items-center justify-center rounded-full transition-all duration-700",
            // The ring reads as the whole mark in static mode; once particles
            // are alive it recedes so they become the outer form.
            staticOnly ? "border border-gold/60" : "border border-gold/25"
          )}
          style={{ width: size * 0.48, height: size * 0.48 }}>
          <span
            className="font-serif text-gold leading-none"
            style={{ fontSize: Math.round(size * 0.175) }}>
            LDR
          </span>
        </div>
      </div>
    </div>
  );
}
