import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Menu, X, Phone, ChevronDown } from "lucide-react";
import { SITE } from "@shared/site";
import { cn } from "@/lib/utils";
import VeteranBadge from "@/components/VeteranBadge";

/**
 * Transparent top navigation matching the reference design.
 *
 * OVERFLOW-PROOF STRUCTURE (bug fix Jul 28): the previous flat list of 7
 * items + phone + CTA physically could not fit at 1280–1500px and clipped
 * off-screen. Property-related links are now consolidated under one
 * "Properties" dropdown, so the desktop nav renders only 5 top-level
 * items. "Now Hiring" is a standalone priority item that must NEVER be
 * the one that clips — it stays top-level at every width. Below `lg`
 * everything collapses to the hamburger. A vitest width-budget test
 * (server/navOverflow.test.ts) guards this from regressing.
 */
export const PROPERTIES_MENU = [
  { label: "Home Search", href: "/search" },
  { label: "Search by Property Type", href: "/search" },
  { label: "Portfolio", href: "/portfolio" },
  { label: "Neighborhoods", href: "/neighborhoods" },
];

/** Top-level desktop items. Kept short so the row always fits at >=1024px. */
export const NAV_ITEMS = [
  { label: "Properties", href: "/search", menu: PROPERTIES_MENU },
  { label: "Home Valuation", href: "/valuation" },
  { label: "Consultation", href: "/contact" },
  { label: "Now Hiring", href: "/join" },
] as const;

const SECONDARY_ITEMS = [
  { label: "City Finder", href: "/city-finder" },
  { label: "Meet the Team", href: "/team" },
  { label: "Testimonials", href: "/testimonials" },
  { label: "Sell With Us", href: "/sell" },
  { label: "Links", href: "/links" },
];

export default function SiteNav({
  solid = false,
  offsetForBanner = false,
}: {
  solid?: boolean;
  offsetForBanner?: boolean;
}) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [propsOpen, setPropsOpen] = useState(false);
  const [location, navigate] = useLocation();

  /** Jump to the Get Started form: scroll if on homepage, otherwise navigate. */
  const goGetStarted = () => {
    setOpen(false);
    if (location === "/") {
      document.getElementById("get-started")?.scrollIntoView({ behavior: "smooth" });
    } else {
      navigate("/get-started");
    }
  };

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    setOpen(false);
    setPropsOpen(false);
  }, [location]);

  const isSolid = solid || scrolled || open;

  return (
    <header
      className={cn(
        "fixed left-0 right-0 z-50 transition-colors duration-300",
        offsetForBanner ? "top-[var(--hiring-banner-h,0px)]" : "top-0",
        isSolid ? "bg-background/95 backdrop-blur-sm border-b border-border/60" : "bg-transparent"
      )}>
      <div className="mx-auto max-w-[1400px] px-5 lg:px-8">
        <div className="flex h-16 lg:h-20 items-center justify-between gap-4">
          {/* Brokerage wordmark — TREC: brokerage name always prominent */}
          <Link href="/" className="shrink-0 flex flex-col items-start gap-0.5">
            <VeteranBadge compact className="hidden sm:inline-flex" />
            {/* TREC: full brokerage name must always be visible — stack on two
                lines below `sm` instead of truncating or overlapping. */}
            <span className="font-serif text-[13px] leading-[1.15] sm:text-lg xl:text-xl tracking-[0.06em] sm:tracking-[0.12em] text-foreground">
              <span className="block sm:inline whitespace-nowrap">LIFESTYLE DESIGN</span>{" "}
              <span className="text-gold whitespace-nowrap">REALTY</span>
            </span>
          </Link>

          {/* Desktop nav — 5 top-level items max so it can never overflow */}
          <nav className="hidden lg:flex items-center gap-4 xl:gap-6 min-w-0">
            {/* Properties dropdown (consolidates 4 former top-level links) */}
            <div
              className="relative"
              onMouseEnter={() => setPropsOpen(true)}
              onMouseLeave={() => setPropsOpen(false)}>
              <button
                onClick={() => setPropsOpen((v) => !v)}
                aria-expanded={propsOpen}
                aria-haspopup="menu"
                className={cn(
                  "nav-link inline-flex items-center gap-1.5 whitespace-nowrap py-2",
                  PROPERTIES_MENU.some((m) => m.href === location)
                    ? "text-gold"
                    : "text-foreground/90 hover:text-gold"
                )}>
                Properties
                <ChevronDown className={cn("h-3 w-3 transition-transform duration-200", propsOpen && "rotate-180")} />
              </button>
              {propsOpen && (
                <div
                  role="menu"
                  className="absolute left-1/2 -translate-x-1/2 top-full pt-2 min-w-56">
                  <div className="bg-background/98 backdrop-blur-sm border border-border/80 py-2 shadow-xl">
                    {PROPERTIES_MENU.map((m, i) => (
                      <Link
                        key={`${m.label}-${i}`}
                        href={m.href}
                        role="menuitem"
                        className="nav-link block px-5 py-2.5 text-foreground/90 hover:text-gold hover:bg-gold/[0.06] whitespace-nowrap">
                        {m.label}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <Link
              href="/valuation"
              className={cn(
                "nav-link whitespace-nowrap",
                location === "/valuation" ? "text-gold border-b border-gold pb-1" : "text-foreground/90 hover:text-gold"
              )}>
              Home Valuation
            </Link>
            <Link
              href="/contact"
              className={cn(
                "nav-link whitespace-nowrap",
                location === "/contact" ? "text-gold border-b border-gold pb-1" : "text-foreground/90 hover:text-gold"
              )}>
              Consultation
            </Link>
            {/* Priority item — must always be fully visible, never clipped */}
            <Link
              href="/join"
              className={cn(
                "nav-link whitespace-nowrap",
                location === "/join" ? "text-gold border-b border-gold pb-1" : "text-foreground/90 hover:text-gold"
              )}>
              Now Hiring
            </Link>
            <a href={SITE.phoneHref} className="nav-link text-gold whitespace-nowrap hidden xl:inline">
              {SITE.phone}
            </a>
            <a href={SITE.phoneHref} aria-label={`Call ${SITE.phone}`} className="text-gold xl:hidden">
              <Phone className="h-4 w-4" />
            </a>
            {/* Persistent high-intent CTA — visible on every page */}
            <button
              onClick={goGetStarted}
              className="nav-link bg-gold text-primary-foreground px-4 xl:px-5 py-2.5 hover:bg-gold/90 transition-colors whitespace-nowrap">
              Get Started
            </button>
          </nav>

          {/* Mobile: phone + hamburger */}
          <div className="flex lg:hidden items-center gap-2.5 shrink-0">
            <button
              onClick={goGetStarted}
              className="nav-link bg-gold text-primary-foreground px-2.5 py-2 hover:bg-gold/90 transition-colors whitespace-nowrap text-[10px] tracking-[0.1em]">
              Get Started
            </button>
            <a href={SITE.phoneHref} aria-label={`Call ${SITE.phone}`} className="text-gold">
              <Phone className="h-4 w-4" />
            </a>
            <button
              aria-label={open ? "Close menu" : "Open menu"}
              onClick={() => setOpen(!open)}
              className="text-foreground p-1">
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="lg:hidden bg-background border-b border-border max-h-[calc(100dvh-4rem)] overflow-y-auto">
          <nav className="px-6 py-6 flex flex-col gap-4">
            <button
              onClick={goGetStarted}
              className="nav-link bg-gold text-primary-foreground px-5 py-3 hover:bg-gold/90 transition-colors text-center">
              Ready to Buy or Sell? Get Started
            </button>
            {PROPERTIES_MENU.map((item, i) => (
              <Link key={`m-${item.label}-${i}`} href={item.href} className="nav-link text-foreground/90 hover:text-gold py-1">
                {item.label}
              </Link>
            ))}
            <Link href="/valuation" className="nav-link text-foreground/90 hover:text-gold py-1">
              Home Valuation
            </Link>
            <Link href="/contact" className="nav-link text-foreground/90 hover:text-gold py-1">
              Schedule a Consultation
            </Link>
            <Link href="/join" className="nav-link text-gold hover:text-gold py-1">
              Now Hiring — Join Our Team
            </Link>
            <div className="hairline my-2" />
            {SECONDARY_ITEMS.map((item) => (
              <Link key={item.href} href={item.href} className="nav-link text-muted-foreground hover:text-gold py-1">
                {item.label}
              </Link>
            ))}
            <div className="py-1">
              <VeteranBadge />
            </div>
            <a href={SITE.phoneHref} className="nav-link text-gold py-1">
              {SITE.phone}
            </a>
          </nav>
        </div>
      )}
    </header>
  );
}
