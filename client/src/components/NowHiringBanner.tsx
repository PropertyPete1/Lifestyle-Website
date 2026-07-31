import { useEffect, useRef } from "react";
import { Link } from "wouter";
import { ArrowRight, Rocket } from "lucide-react";
import { useBannerClickTracking } from "@/hooks/usePageTracking";

/**
 * Eye-catching recruiting banner — the very first element on the homepage,
 * pinned above the fixed nav. Whole banner is clickable → /join. Short hook
 * only; the full pitch lives on /join.
 *
 * Layout contract (fits fully at 375px and desktop — the prior-revision
 * cut-off bug):
 * - The banner is `fixed` at top with wrappable inline segments, never nowrap
 *   on the full line and no fixed widths → no horizontal overflow.
 * - Its real rendered height is measured via ResizeObserver into the
 *   `--hiring-banner-h` CSS var on <html>, which SiteNav uses as its `top`
 *   offset — so banner and nav never overlap at any width or wrap count.
 *
 * Feedback-loop contract (the "ResizeObserver loop completed with undelivered
 * notifications" bug): the measured height is written to a CSS var that other
 * elements lay out against, so a naive write inside the observer callback can
 * re-trigger the observer in the same delivery cycle. Three guards prevent it:
 *   1. Read the size off the ResizeObserverEntry rather than `offsetHeight`,
 *      so the callback never forces a synchronous layout.
 *   2. Round to whole pixels — subpixel jitter alone was enough to keep
 *      re-arming the loop.
 *   3. Apply the write in a requestAnimationFrame, and skip it entirely when
 *      the value has not changed, so at most one style write happens per frame
 *      and a settled banner writes nothing at all.
 */
export default function NowHiringBanner() {
  const ref = useRef<HTMLDivElement>(null);
  const logBannerClick = useBannerClickTracking();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let last = -1;
    let frame = 0;

    const write = (height: number) => {
      const next = Math.round(height);
      if (next === last) return; // no-op writes are what keep the loop alive
      last = next;
      document.documentElement.style.setProperty("--hiring-banner-h", `${next}px`);
    };

    // Initial measurement happens once, outside any observer callback.
    write(el.getBoundingClientRect().height);

    const ro = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      // borderBoxSize matches offsetHeight semantics; contentRect is the
      // fallback for older engines that don't report box sizes.
      const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
      // Defer the style write out of the resize delivery cycle.
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => write(height));
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      document.documentElement.style.removeProperty("--hiring-banner-h");
    };
  }, []);

  return (
    <Link href="/join">
      <div
        ref={ref}
        onClick={logBannerClick}
        className="group fixed top-0 left-0 right-0 z-[60] block w-full cursor-pointer overflow-hidden border-b border-gold/40 bg-[oklch(0.14_0.01_285)]"
        role="banner"
        aria-label="Now hiring licensed agents — see what we offer">
        {/* Gold shimmer wash */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-gold/[0.14] via-gold/[0.05] to-gold/[0.14]" />
        <div className="pointer-events-none absolute inset-0 opacity-60 [background:radial-gradient(60%_120%_at_50%_0%,oklch(0.75_0.12_85_/_0.18),transparent_70%)]" />
        <div className="relative mx-auto flex max-w-[1400px] flex-wrap items-center justify-center gap-x-3 gap-y-0.5 px-3 py-2.5 sm:py-3 text-center">
          <span className="inline-flex items-center gap-1.5 text-gold">
            <Rocket className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.2em]">
              Now Hiring: Licensed Agents
            </span>
          </span>
          <span className="hidden sm:inline h-3.5 w-px bg-gold/40" aria-hidden />
          {/* No dollar figures here — all visitors see this banner; the $6,000
              detail lives on /join as the payoff for clicking. */}
          <span className="text-[10px] sm:text-[11px] uppercase tracking-[0.14em] text-foreground/90">
            Real leads. Real support. Real growth.
          </span>
          <span className="inline-flex items-center gap-1 text-[10px] sm:text-[11px] font-medium uppercase tracking-[0.16em] text-gold underline underline-offset-4 decoration-gold/50 group-hover:decoration-gold transition-colors">
            See what we offer
            <ArrowRight className="h-3 w-3 shrink-0 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </span>
        </div>
      </div>
    </Link>
  );
}
