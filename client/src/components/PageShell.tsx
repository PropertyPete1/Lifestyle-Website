import { ReactNode } from "react";
import SiteNav from "./SiteNav";
import SiteFooter from "./SiteFooter";
import NowHiringBanner from "./NowHiringBanner";
import { useReveal } from "@/hooks/useReveal";
import StickyMobileCta from "./StickyMobileCta";

/**
 * Standard public page wrapper: nav + content + TREC footer.
 *
 * `hiringBanner`: renders the Now Hiring recruiting banner as the very first
 * element (above the fixed nav, which is offset down by the banner height so
 * nothing overlaps at any width — verified at 375px and desktop).
 */
export default function PageShell({
  children,
  solidNav = false,
  hiringBanner = false,
  stickyCta = false,
  stickyCtaLabel,
  stickyCtaHref,
}: {
  children: ReactNode;
  solidNav?: boolean;
  hiringBanner?: boolean;
  /** Slim persistent mobile "Get Started" bar — key conversion pages only. */
  stickyCta?: boolean;
  /** Oct 30, 2026: /join points the bar at its own application instead of Get Started. */
  stickyCtaLabel?: string;
  stickyCtaHref?: string;
}) {
  useReveal([children]);
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      {hiringBanner && <NowHiringBanner />}
      <SiteNav solid={solidNav} offsetForBanner={hiringBanner} />
      <main className="flex-1">{children}</main>
      <SiteFooter />
      {/* Fixed, so it adds no layout; the padding below reserves its height so
          it never covers the end of the page. */}
      {stickyCta && <StickyMobileCta label={stickyCtaLabel} href={stickyCtaHref} />}
      {stickyCta && <div style={{ height: "var(--sticky-cta-h, 0px)" }} aria-hidden />}
    </div>
  );
}
