import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Menu, X, Phone, ChevronDown } from "lucide-react";
import { SITE, FEATURES } from "@shared/site";
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
/** Full dropdown once IDX is live. */
const PROPERTIES_MENU_FULL = [
  { label: "Home Search", href: "/search" },
  { label: "Search by Property Type", href: "/search" },
  { label: "Portfolio", href: "/portfolio" },
  { label: "Neighborhoods", href: "/neighborhoods" },
  { label: "Sell With Us", href: "/sell" },
  { label: "List for Lease", href: "/lease" },
];

/** Pre-IDX: placeholder-powered links are unreachable; NC Search + Sell only. */
const PROPERTIES_MENU_PRE_IDX = [
  { label: "New Construction Search", href: SITE.newConstructionUrl },
  { label: "Sell With Us", href: "/sell" },
  { label: "List for Lease", href: "/lease" },
];

export const PROPERTIES_MENU: { label: string; href: string; external?: boolean }[] =
  FEATURES.SHOW_PROPERTY_SEARCH ? PROPERTIES_MENU_FULL : PROPERTIES_MENU_PRE_IDX;

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
  { label: "List for Lease", href: "/lease" },
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

  // Oct 30, 2026 (white skin): the header is always the page's warm white; a hairline appears once the page scrolls.
  const isSolid = solid || scrolled || open;
  const linkCls = (active: boolean) => cn("whitespace-nowrap font-serif text-[17px] transition-colors", active ? "text-gold underline decoration-gold/60 underline-offset-8" : "text-foreground hover:text-gold");

  return (
    <header
      className={cn(
        "fixed left-0 right-0 z-50 bg-background/95 backdrop-blur-sm transition-[border-color,box-shadow] duration-300",
        offsetForBanner ? "top-[var(--hiring-banner-h,0px)]" : "top-0",
        isSolid ? "border-b border-border shadow-[0_1px_12px_-8px_rgb(0_0_0/0.18)]" : "border-b border-transparent"
      )}>
      <div className="mx-auto max-w-[1400px] px-5 lg:px-8">
        <div className="relative flex h-[68px] lg:h-20 items-center justify-between gap-4">
          {/* Phones: call on the left, the wordmark centred, the menu on the right (mockup). */}
          <a href={SITE.phoneHref} aria-label={`Call ${SITE.phone}`} className="flex h-11 w-11 items-center justify-center text-gold lg:hidden">
            <Phone className="h-5 w-5" />
          </a>

          {/* Brokerage wordmark — TREC: the full brokerage name is always visible and prominent. */}
          <Link href="/" className="absolute left-1/2 -translate-x-1/2 shrink-0 flex flex-col items-center gap-1 lg:static lg:translate-x-0 lg:items-start">
            <span className="whitespace-nowrap font-serif text-[23px] leading-none tracking-[0.01em] text-foreground sm:text-[26px] lg:text-[30px] lg:text-gold">
              Lifestyle Design Realty
            </span>
            <span className="flex items-center gap-2 whitespace-nowrap text-[8.5px] font-medium uppercase leading-none tracking-[0.3em] text-muted-foreground sm:text-[9.5px]">
              <span className="h-px w-5 bg-border lg:hidden" aria-hidden />
              Veteran-Owned &amp; Operated
              <span className="h-px w-5 bg-border lg:hidden" aria-hidden />
            </span>
          </Link>

          {/* Desktop nav — 4 top-level items max so it can never overflow */}
          <nav className="hidden lg:flex items-center gap-5 xl:gap-8 min-w-0">
            {/* Properties dropdown (consolidates 4 former top-level links) */}
            <div
              className="relative"
              onMouseEnter={() => setPropsOpen(true)}
              onMouseLeave={() => setPropsOpen(false)}>
              <button
                onClick={() => setPropsOpen((v) => !v)}
                aria-expanded={propsOpen}
                aria-haspopup="menu"
                className={cn("inline-flex items-center gap-1.5 py-2", linkCls(PROPERTIES_MENU.some((m) => m.href === location)))}>
                Properties
                <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-200", propsOpen && "rotate-180")} />
              </button>
              {propsOpen && (
                <div
                  role="menu"
                  className="absolute left-1/2 -translate-x-1/2 top-full pt-2 min-w-60">
                  <div className="border border-border bg-card py-2 shadow-[0_18px_40px_-20px_rgb(0_0_0/0.25)]">
                    {PROPERTIES_MENU.map((m, i) => (
                      m.external ? (
                        <a
                          key={`${m.label}-${i}`}
                          href={m.href}
                          target="_blank"
                          rel="noreferrer"
                          role="menuitem"
                          className="block whitespace-nowrap px-5 py-2.5 font-serif text-[17px] text-foreground hover:bg-secondary hover:text-gold">
                          {m.label}
                        </a>
                      ) : (
                        <Link
                          key={`${m.label}-${i}`}
                          href={m.href}
                          role="menuitem"
                          className="block whitespace-nowrap px-5 py-2.5 font-serif text-[17px] text-foreground hover:bg-secondary hover:text-gold">
                          {m.label}
                        </Link>
                      )
                    ))}
                  </div>
                </div>
              )}
            </div>

            <Link href="/valuation" className={linkCls(location === "/valuation")}>Home Valuation</Link>
            <Link href="/contact" className={linkCls(location === "/contact")}>Consultation</Link>
            {/* Priority item — must always be fully visible, never clipped */}
            <Link href="/join" className={linkCls(location === "/join")}>Now Hiring</Link>
            <a href={SITE.phoneHref} className="hidden whitespace-nowrap font-serif text-[17px] text-gold xl:inline">
              {SITE.phone}
            </a>
            <a href={SITE.phoneHref} aria-label={`Call ${SITE.phone}`} className="text-gold xl:hidden">
              <Phone className="h-4 w-4" />
            </a>
            {/* Persistent high-intent CTA — visible on every page */}
            <button
              onClick={goGetStarted}
              className="whitespace-nowrap bg-gold px-7 py-3 font-serif text-[18px] text-primary-foreground transition-colors hover:bg-gold/90">
              Get Started
            </button>
          </nav>

          {/* Phones: the menu */}
          <button
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen(!open)}
            className="flex h-11 w-11 items-center justify-center text-foreground lg:hidden">
            {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" strokeWidth={1.5} />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="lg:hidden bg-background border-b border-border max-h-[calc(100dvh-4rem)] overflow-y-auto">
          <nav className="px-6 py-6 flex flex-col gap-3">
            <button
              onClick={goGetStarted}
              className="bg-gold px-5 py-3 text-center font-serif text-[18px] text-primary-foreground transition-colors hover:bg-gold/90">
              Ready to Buy or Sell? Get Started
            </button>
            {PROPERTIES_MENU.map((item, i) => (
              item.external ? (
                <a key={`m-${item.label}-${i}`} href={item.href} target="_blank" rel="noreferrer" className="py-1.5 font-serif text-[19px] text-foreground hover:text-gold">
                  {item.label}
                </a>
              ) : (
                <Link key={`m-${item.label}-${i}`} href={item.href} className="py-1.5 font-serif text-[19px] text-foreground hover:text-gold">
                  {item.label}
                </Link>
              )
            ))}
            <Link href="/valuation" className="py-1.5 font-serif text-[19px] text-foreground hover:text-gold">
              Home Valuation
            </Link>
            <Link href="/contact" className="py-1.5 font-serif text-[19px] text-foreground hover:text-gold">
              Schedule a Consultation
            </Link>
            <Link href="/join" className="py-1.5 font-serif text-[19px] text-gold">
              Now Hiring — Join Our Team
            </Link>
            <div className="my-2 h-px bg-border" />
            {SECONDARY_ITEMS.map((item) => (
              <Link key={item.href} href={item.href} className="py-1 font-serif text-[17px] text-muted-foreground hover:text-gold">
                {item.label}
              </Link>
            ))}
            <div className="py-1">
              <VeteranBadge />
            </div>
            <a href={SITE.phoneHref} className="py-1 font-serif text-[17px] text-gold">
              {SITE.phone}
            </a>
          </nav>
        </div>
      )}
    </header>
  );
}
