import { useEffect, useRef } from "react";
import { Link } from "wouter";
import { ArrowRight, Rocket } from "lucide-react";

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
 */
export default function NowHiringBanner() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = () =>
      document.documentElement.style.setProperty("--hiring-banner-h", `${el.offsetHeight}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty("--hiring-banner-h");
    };
  }, []);

  return (
    <Link href="/join">
      <div
        ref={ref}
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
          <span className="text-[10px] sm:text-[11px] uppercase tracking-[0.14em] text-foreground/90">
            Lease commissions up to $6,000/deal
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
