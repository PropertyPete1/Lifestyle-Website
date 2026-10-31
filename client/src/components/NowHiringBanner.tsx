import { useEffect, useRef } from "react";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
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

  // Oct 30, 2026 (Peter's white-skin mockups): a slim, readable line. Ivory with charcoal text on phones, the brand's
  // deep gold with white text from desktop up; wording kept ("Now hiring: licensed agents" / "See what we offer").
  return (
    <Link href="/join">
      <div
        ref={ref}
        onClick={logBannerClick}
        className="group fixed top-0 left-0 right-0 z-[60] block w-full cursor-pointer overflow-hidden border-b border-border bg-secondary text-foreground lg:border-gold lg:bg-gold lg:text-white"
        role="banner"
        aria-label="Now hiring licensed agents — see what we offer">
        <div className="relative mx-auto flex max-w-[1400px] flex-wrap items-center justify-center gap-x-3 gap-y-0.5 px-4 py-2 text-center font-serif text-[15px] leading-snug sm:text-base">
          <span>Now hiring: licensed agents</span>
          <span className="h-4 w-px bg-current opacity-40" aria-hidden />
          <span className="inline-flex items-center gap-1 text-gold underline decoration-gold/50 underline-offset-4 transition-colors group-hover:decoration-gold lg:text-white lg:decoration-white/60 lg:group-hover:decoration-white">
            See what we offer
            <ArrowRight className="h-3.5 w-3.5 shrink-0 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </span>
        </div>
      </div>
    </Link>
  );
}
