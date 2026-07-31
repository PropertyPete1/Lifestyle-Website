import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  BORDER_ALPHA_DRAW,
  BORDER_ALPHA_SETTLED,
  borderHeadPaths,
  borderLoop,
  branchBirthMs,
  CROWN_ALPHA_DRAW,
  CROWN_ALPHA_SETTLED,
  contentRevealMs,
  crownHeadPaths,
  crownLoop,
  crownRectFromHeadline,
  EDGE_INSET,
  entranceDurationMs,
  HEAD_SPEED,
  isUsableRect,
  markEntranceSeen,
  pointAt,
  polylineLength,
  racerDistance,
  RACER_TAIL_PX,
  shouldPlayEntrance,
  sliceUpTo,
  tailPoints,
  type Pt,
  type Rect,
} from "@shared/crownBranch";
import {
  DEGRADE_BUDGET_MS,
  isTrustworthyFrame,
  isWarmedUp,
  REBUILD_WARMUP_MS,
  shouldDegrade,
  STEADY_CHECK_SAMPLES,
  WARMUP_MS,
} from "@shared/livingLogo";

/**
 * THE CROWN BRANCH — the homepage hero's line-drawing entrance and its
 * permanent, quietly moving settled state.
 *
 * WHAT IT DRAWS
 * Two heads born at the hero's top centre race in opposite directions around
 * the screen frame. When they pass the headline's top edge a second pair is
 * born on a crown frame around LIFESTYLE DESIGN REALTY and races around that.
 * Once everything lands, the geometry stays as faint permanent lines with slow
 * comet-tail "racers" gliding the border and orbiting the name forever.
 *
 * WHY IT IS CHEAP
 * The whole scene is four polylines and three racers — a handful of strokes per
 * frame, no per-pixel work and no allocation in the hot loop beyond the tail
 * sample arrays. That is a different order of cost from the particle systems,
 * so it needs no tiering: the perf guard is only the shared trustworthy-frame
 * stall detector, and the fallback is to stop moving and leave the settled
 * geometry on screen.
 *
 * WHY THE CROWN IS MEASURED, NEVER HARDCODED
 * The headline wraps to two lines below ~640px, reflows when the custom serif
 * finishes loading, and moves vertically whenever the Now Hiring banner changes
 * height (the hero pads itself by --hiring-banner-h). A hardcoded rectangle
 * would be wrong in all three cases, so the crown is re-derived from live
 * getBoundingClientRect readings.
 *
 * ACCESSIBILITY / LAYOUT: decorative only — absolutely positioned over the
 * hero, aria-hidden, pointer-events-none, and behind the hero content by DOM
 * order. It reserves no space, so it contributes nothing to CLS.
 */
export default function CrownBranch({
  /** The headline the crown frames. Measured live; never assumed. */
  headlineRef,
  /** Called when the hero content should begin its fade in. */
  onReveal,
  className,
}: {
  headlineRef: React.RefObject<HTMLElement | null>;
  onReveal?: () => void;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** Set only when there is no 2D context at all — never leave a blank layer. */
  const [cssFallback, setCssFallback] = useState<Rect | null>(null);
  /** Latest onReveal, so the effect never needs it as a dependency. */
  const revealRef = useRef(onReveal);
  revealRef.current = onReveal;

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;

    const reducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let store: Storage | null = null;
    try {
      store = window.sessionStorage;
    } catch {
      store = null; // privacy mode — entrance simply replays
    }
    const playEntrance = shouldPlayEntrance(store, reducedMotion);

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      // No canvas at all: fall back to CSS lines rather than nothing. Measured
      // the same way, so the crown still lands on the headline.
      const measureFallback = () => {
        const hero = host.getBoundingClientRect();
        const head = headlineRef.current?.getBoundingClientRect();
        setCssFallback(head ? crownRectFromHeadline(head, hero) : null);
      };
      measureFallback();
      window.addEventListener("resize", measureFallback);
      revealRef.current?.();
      return () => window.removeEventListener("resize", measureFallback);
    }

    /* ---- measured geometry, refreshed rather than assumed ---------------- */
    let W = 0;
    let H = 0;
    let dpr = 1;
    let crown: Rect | null = null;
    let borderPaths = borderHeadPaths(0, 0);
    let borderLen = 0;
    let loopBorder: Pt[] = [];
    let loopBorderLen = 0;
    let crownPaths: { left: Pt[]; right: Pt[] } | null = null;
    let crownLen = 0;
    let loopCrown: Pt[] = [];
    let loopCrownLen = 0;
    let branchAt = 0;
    let revealAt = 0;
    let entranceMs = 0;

    const measure = () => {
      const hero = host.getBoundingClientRect();
      const w = Math.max(1, Math.round(hero.width));
      const h = Math.max(1, Math.round(hero.height));
      const nextDpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      if (w !== W || h !== H || nextDpr !== dpr) {
        W = w;
        H = h;
        dpr = nextDpr;
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        canvas.style.width = `${W}px`;
        canvas.style.height = `${H}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      borderPaths = borderHeadPaths(W, H, EDGE_INSET);
      borderLen = polylineLength(borderPaths.left);
      loopBorder = borderLoop(W, H, EDGE_INSET);
      loopBorderLen = polylineLength(loopBorder);

      const headRect = headlineRef.current?.getBoundingClientRect();
      const next = headRect ? crownRectFromHeadline(headRect, hero) : null;
      crown = isUsableRect(next) ? next : null;
      if (crown) {
        crownPaths = crownHeadPaths(crown);
        crownLen = polylineLength(crownPaths.left);
        loopCrown = crownLoop(crown);
        loopCrownLen = polylineLength(loopCrown);
        branchAt = branchBirthMs(borderPaths.left, crown.top);
      } else {
        crownPaths = null;
        crownLen = 0;
        loopCrown = [];
        loopCrownLen = 0;
        branchAt = 0;
      }
      revealAt = contentRevealMs(borderLen);
      entranceMs = entranceDurationMs(borderLen, branchAt, crownLen);
    };

    /* ---- drawing --------------------------------------------------------- */

    const strokePolyline = (pts: Pt[], alpha: number, width: number) => {
      if (pts.length < 2) return;
      ctx.strokeStyle = `rgba(${GOLD.r},${GOLD.g},${GOLD.b},${alpha})`;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    };

    /** Warm-white head point with the two bloom halos, blitted not gradient-ed. */
    const drawHead = (p: Pt, intensity = 1) => {
      ctx.globalCompositeOperation = "lighter";
      if (bloomOuter) {
        ctx.globalAlpha = 0.5 * intensity;
        ctx.drawImage(bloomOuter, p.x - HALO_R, p.y - HALO_R, HALO_R * 2, HALO_R * 2);
      }
      if (bloomInner) {
        ctx.globalAlpha = 0.9 * intensity;
        ctx.drawImage(bloomInner, p.x - CORE_R, p.y - CORE_R, CORE_R * 2, CORE_R * 2);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    };

    /** Comet tail — segments fading back from the head along the loop. */
    const drawRacer = (loop: Pt[], loopLen: number, elapsed: number, phase: number, intensity: number) => {
      if (loopLen <= 0) return;
      const d = racerDistance(elapsed, loopLen, phase);
      const tail = tailPoints(loop, d, RACER_TAIL_PX);
      ctx.globalCompositeOperation = "lighter";
      ctx.lineWidth = LINE_W;
      for (let i = 1; i < tail.length; i++) {
        const fade = 1 - i / tail.length;
        ctx.strokeStyle = `rgba(${GOLD_HI.r},${GOLD_HI.g},${GOLD_HI.b},${fade * fade * 0.75 * intensity})`;
        ctx.beginPath();
        ctx.moveTo(tail[i - 1].x, tail[i - 1].y);
        ctx.lineTo(tail[i].x, tail[i].y);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";
      drawHead(tail[0], intensity);
    };

    /** The permanent faint geometry. Also the static fallback, on its own. */
    const drawSettledLines = () => {
      strokePolyline(loopBorder, BORDER_ALPHA_SETTLED, LINE_W);
      if (loopCrown.length) strokePolyline(loopCrown, CROWN_ALPHA_SETTLED, LINE_W);
    };

    const drawSettled = (elapsed: number, moving: boolean) => {
      drawSettledLines();
      if (!moving) return;
      // Two racers on the border at opposite phases, one on the crown so the
      // name catches a passing light every lap.
      drawRacer(loopBorder, loopBorderLen, elapsed, 0, 1);
      drawRacer(loopBorder, loopBorderLen, elapsed, 0.5, 0.55);
      if (loopCrownLen > 0) drawRacer(loopCrown, loopCrownLen, elapsed, 0.15, 1.15);
    };

    const drawEntrance = (elapsed: number) => {
      // Faint settled frame underneath from the start, so the heads read as
      // tracing an existing structure rather than inventing one.
      const borderDist = Math.min(elapsed * HEAD_SPEED, borderLen);
      strokePolyline(sliceUpTo(borderPaths.left, borderDist), BORDER_ALPHA_DRAW, LINE_W);
      strokePolyline(sliceUpTo(borderPaths.right, borderDist), BORDER_ALPHA_DRAW, LINE_W);

      let crownDist = 0;
      if (crownPaths && elapsed >= branchAt) {
        crownDist = Math.min((elapsed - branchAt) * HEAD_SPEED, crownLen);
        strokePolyline(sliceUpTo(crownPaths.left, crownDist), CROWN_ALPHA_DRAW, LINE_W);
        strokePolyline(sliceUpTo(crownPaths.right, crownDist), CROWN_ALPHA_DRAW, LINE_W);
      }

      // Heads last, so they sit on top of their own trails.
      if (borderDist < borderLen) {
        drawHead(pointAt(borderPaths.left, borderDist));
        drawHead(pointAt(borderPaths.right, borderDist));
      }
      if (crownPaths && elapsed >= branchAt && crownDist < crownLen) {
        drawHead(pointAt(crownPaths.left, crownDist));
        drawHead(pointAt(crownPaths.right, crownDist));
      }
    };

    /* ---- sprites --------------------------------------------------------- */
    const bloomInner = makeBloom(CORE_R, 0.95, GOLD_HI);
    const bloomOuter = makeBloom(HALO_R, 0.3, GOLD);

    /* ---- loop ------------------------------------------------------------ */
    measure();

    const t0 = performance.now();
    let last = t0;
    let measuredAt = t0;
    let raf = 0;
    let disposed = false;
    let visible = true;
    let onScreen = true;
    let revealed = false;
    let settledFrom = playEntrance ? -1 : 0; // ms offset the racers run against
    let staticOnly = false;

    // Shared stall/degrade discipline: only frames that reflect render cost are
    // measured, nothing is measured during warm-up, and sustained slowness stops
    // the motion rather than shedding quality it does not have.
    const frameTimes: number[] = [];
    let builtAt = t0;
    let warmupMs = WARMUP_MS;

    if (!playEntrance) {
      // Reduced motion or a returning visitor: no entrance, content is already
      // up, and the geometry is correct from the very first frame.
      revealed = true;
      revealRef.current?.();
    }

    const paint = (now: number) => {
      if (now - measuredAt > REMEASURE_MS) {
        measure();
        measuredAt = now;
      }
      ctx.clearRect(0, 0, W, H);
      const elapsed = now - t0;

      if (playEntrance && elapsed < entranceMs) {
        drawEntrance(elapsed);
        if (!revealed && elapsed >= revealAt) {
          revealed = true;
          revealRef.current?.();
        }
        return;
      }
      if (settledFrom < 0) {
        settledFrom = elapsed;
        markEntranceSeen(store);
      }
      if (!revealed) {
        revealed = true;
        revealRef.current?.();
      }
      drawSettled(elapsed - settledFrom, !reducedMotion && !staticOnly);
    };

    const frame = (now: number) => {
      const dtMs = now - last;
      last = now;

      const warm = isWarmedUp(now - builtAt, warmupMs);
      if (!isTrustworthyFrame(dtMs)) {
        frameTimes.length = 0;
      } else if (warm) {
        frameTimes.push(dtMs);
        if (frameTimes.length > 120) frameTimes.shift();
      }
      if (warm && shouldDegrade(frameTimes, DEGRADE_BUDGET_MS, STEADY_CHECK_SAMPLES)) {
        // Give up on motion, not on the design: draw the settled frame once and
        // leave it there. Never a blank layer.
        staticOnly = true;
        ctx.clearRect(0, 0, W, H);
        drawSettledLines();
        if (!revealed) {
          revealed = true;
          revealRef.current?.();
        }
        markEntranceSeen(store);
        return;
      }

      paint(now);
      raf = requestAnimationFrame(frame);
    };

    if (reducedMotion) {
      // Static, instant, once — plus on resize. No loop at all.
      const drawStatic = () => {
        measure();
        ctx.clearRect(0, 0, W, H);
        drawSettledLines();
      };
      drawStatic();
      let resizeRaf = 0;
      const onResize = () => {
        cancelAnimationFrame(resizeRaf);
        resizeRaf = requestAnimationFrame(drawStatic);
      };
      window.addEventListener("resize", onResize);
      // The serif reflows the headline after it loads; the crown must follow.
      document.fonts?.ready.then(drawStatic).catch(() => undefined);
      return () => {
        cancelAnimationFrame(resizeRaf);
        window.removeEventListener("resize", onResize);
      };
    }

    const stop = () => cancelAnimationFrame(raf);
    const resume = () => {
      if (disposed || !visible || !onScreen) return;
      const now = performance.now();
      last = now;
      builtAt = now;
      warmupMs = REBUILD_WARMUP_MS;
      frameTimes.length = 0;
      measuredAt = 0; // the hero may have been resized while we were stopped
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
    };

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
      { threshold: 0 }
    );
    io.observe(host);

    // Invalidate rather than measure inline: a resize storm would otherwise
    // reallocate the backing store per event, and — the case that actually
    // bites — deferring the work into rAF would silently drop it while the loop
    // is stopped for a hidden tab or an off-screen hero. The next painted frame
    // picks it up, which is the first frame that could show it anyway.
    const onResize = () => {
      measuredAt = 0;
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    document.fonts?.ready.then(onResize).catch(() => undefined);

    raf = requestAnimationFrame(frame);

    return () => {
      disposed = true;
      stop();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, [headlineRef]);

  return (
    <div
      ref={hostRef}
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      <canvas ref={canvasRef} className="h-full w-full" />
      {/* No 2D context anywhere: CSS lines rather than an empty layer. */}
      {cssFallback && (
        <>
          <div
            className="absolute border border-gold/15"
            style={{ inset: EDGE_INSET }}
          />
          <div
            className="absolute border border-gold/30"
            style={{
              left: cssFallback.left,
              top: cssFallback.top,
              width: Math.max(0, cssFallback.right - cssFallback.left),
              height: Math.max(0, cssFallback.bottom - cssFallback.top),
            }}
          />
        </>
      )}
    </div>
  );
}

/* ---- module-level constants and helpers ---------------------------------- */

/** Canvas-safe gold (matches --gold oklch(0.75 0.09 85)). */
const GOLD = { r: 201, g: 169, b: 97 };
/** Warm white for the heads — same accent colour the orb's hero points use. */
const GOLD_HI = { r: 255, g: 244, b: 222 };

const MAX_DPR = 2;
const LINE_W = 1.5;
/** Head core / halo radii, per the approved prototype. */
const CORE_R = 9;
const HALO_R = 20;
/** Re-measure cadence. Cheap enough to be frequent, rare enough to be free. */
const REMEASURE_MS = 250;

/** Pre-rendered radial bloom, blitted per head rather than built per frame. */
function makeBloom(radius: number, peak: number, color: { r: number; g: number; b: number }) {
  const d = Math.max(2, Math.ceil(radius * 2));
  const c = document.createElement("canvas");
  c.width = d;
  c.height = d;
  const g = c.getContext("2d");
  if (!g) return null;
  const r = d / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, `rgba(${color.r},${color.g},${color.b},${peak})`);
  grad.addColorStop(0.4, `rgba(${color.r},${color.g},${color.b},${peak * 0.35})`);
  grad.addColorStop(1, `rgba(${color.r},${color.g},${color.b},0)`);
  g.fillStyle = grad;
  g.beginPath();
  g.arc(r, r, r, 0, Math.PI * 2);
  g.fill();
  return c;
}
