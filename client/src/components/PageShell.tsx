import { ReactNode } from "react";
import SiteNav from "./SiteNav";
import SiteFooter from "./SiteFooter";
import NowHiringBanner from "./NowHiringBanner";
import { useReveal } from "@/hooks/useReveal";

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
}: {
  children: ReactNode;
  solidNav?: boolean;
  hiringBanner?: boolean;
}) {
  useReveal([children]);
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      {hiringBanner && <NowHiringBanner />}
      <SiteNav solid={solidNav} offsetForBanner={hiringBanner} />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
