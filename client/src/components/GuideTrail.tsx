import { useEffect, useRef } from "react";
import {
  GUIDE_TOTAL_MS,
  easeInOutCubic,
  guideLineX,
  guideOpacity,
  guideProgress,
  guideSegment,
} from "@shared/guideTrail";

/**
 * A one-shot gold pulse that draws itself down the page gutter from one element
 * to another, so a jump-to-form tap reads as a connection rather than a
 * teleport. Purely decorative: fixed, pointer-events-none and aria-hidden, so
 * it contributes no layout, no CLS, and never intercepts a button tap.
 *
 * The overlay is always mounted (hidden) rather than conditionally rendered:
 * the animation drives SVG attributes imperatively from rAF, so there is no
 * per-frame React render and no race between mounting and the first frame.
 *
 * Callers bump `runId` to fire it. Reduced-motion callers simply never do.
 */
export default function GuideTrail({
  runId,
  fromRef,
  toRef,
}: {
  /** Increment to play the trail. 0 = never played. */
  runId: number;
  fromRef: React.RefObject<HTMLElement | null>;
  toRef: React.RefObject<HTMLElement | null>;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const trackRef = useRef<SVGLineElement>(null);
  const headRef = useRef<SVGLineElement>(null);

  useEffect(() => {
    if (runId <= 0) return;
    const svg = svgRef.current;
    if (!svg) return;

    let raf = 0;
    const start = performance.now();

    const hide = () => {
      svg.style.opacity = "0";
      svg.style.visibility = "hidden";
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      hide();
    };

    const draw = (line: SVGLineElement | null, x: number, y1: number, y2: number) => {
      if (!line) return;
      line.setAttribute("x1", String(x));
      line.setAttribute("x2", String(x));
      line.setAttribute("y1", String(y1));
      line.setAttribute("y2", String(y2));
    };

    const frame = (now: number) => {
      const elapsed = now - start;
      const from = fromRef.current;
      const to = toRef.current;
      if (elapsed >= GUIDE_TOTAL_MS || !from || !to) {
        stop();
        return;
      }
      const a = from.getBoundingClientRect();
      const b = to.getBoundingClientRect();
      const seg = guideSegment(
        a.bottom,
        b.top,
        window.innerHeight,
        easeInOutCubic(guideProgress(elapsed)),
      );
      if (seg.visible) {
        const x = guideLineX(a.left, window.innerWidth);
        draw(trackRef.current, x, seg.top, seg.head);
        draw(headRef.current, x, seg.tailTop, seg.head);
        svg.style.opacity = String(guideOpacity(elapsed));
        svg.style.visibility = "visible";
      } else {
        hide();
      }
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    // rAF is throttled to a standstill in hidden/background tabs, which would
    // otherwise leave the overlay lit forever. Wall-clock backstop.
    const safety = window.setTimeout(stop, GUIDE_TOTAL_MS + 600);

    return () => {
      window.clearTimeout(safety);
      stop();
    };
  }, [runId, fromRef, toRef]);

  return (
    <svg
      ref={svgRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-40 h-full w-full"
      style={{ opacity: 0, visibility: "hidden" }}>
      {/* Faint path already travelled */}
      <line
        ref={trackRef}
        x1={0}
        x2={0}
        y1={0}
        y2={0}
        stroke="var(--gold)"
        strokeWidth={1}
        strokeOpacity={0.32}
        strokeLinecap="round"
      />
      {/* Bright head + tail */}
      <line
        ref={headRef}
        x1={0}
        x2={0}
        y1={0}
        y2={0}
        stroke="var(--gold)"
        strokeWidth={2}
        strokeLinecap="round"
        style={{ filter: "drop-shadow(0 0 6px var(--gold))" }}
      />
    </svg>
  );
}
