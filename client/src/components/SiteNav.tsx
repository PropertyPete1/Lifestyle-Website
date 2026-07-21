import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Menu, X, Phone } from "lucide-react";
import { SITE } from "@shared/site";
import { cn } from "@/lib/utils";
import VeteranBadge from "@/components/VeteranBadge";

/**
 * Transparent top navigation matching the reference design.
 * Required order: Portfolio, Neighborhoods, Search by Property Type,
 * Home Search, Home Valuation, Schedule a Consultation, phone number.
 */
const NAV_ITEMS = [
  { label: "Portfolio", href: "/portfolio" },
  { label: "Neighborhoods", href: "/neighborhoods" },
  { label: "Search by Property Type", href: "/search" },
  { label: "Home Search", href: "/search" },
  { label: "Home Valuation", href: "/valuation" },
  { label: "Schedule a Consultation", href: "/contact" },
  { label: "Now Hiring", href: "/join" },
];

const SECONDARY_ITEMS = [
  { label: "City Finder", href: "/city-finder" },
  { label: "Meet the Team", href: "/team" },
  { label: "Testimonials", href: "/testimonials" },
  { label: "Sell With Us", href: "/sell" },
  { label: "Now Hiring — Join Our Team", href: "/join" },
  { label: "Links", href: "/links" },
];

export default function SiteNav({ solid = false }: { solid?: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
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
  }, [location]);

  const isSolid = solid || scrolled || open;

  return (
    <header
      className={cn(
        "fixed top-0 left-0 right-0 z-50 transition-colors duration-300",
        isSolid ? "bg-background/95 backdrop-blur-sm border-b border-border/60" : "bg-transparent"
      )}>
      <div className="mx-auto max-w-[1400px] px-5 lg:px-8">
        <div className="flex h-16 lg:h-20 items-center justify-between gap-4">
          {/* Brokerage wordmark — TREC: brokerage name always prominent */}
          <Link href="/" className="shrink-0 flex flex-col items-start gap-0.5">
            <VeteranBadge compact className="hidden sm:inline-flex" />
            <span className="font-serif text-base sm:text-lg lg:text-xl tracking-[0.1em] sm:tracking-[0.14em] text-foreground whitespace-nowrap">
              LIFESTYLE DESIGN <span className="text-gold">REALTY</span>
            </span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden xl:flex items-center gap-6">
            {NAV_ITEMS.map((item, i) => (
              <Link
                key={`${item.label}-${i}`}
                href={item.href}
                className={cn(
                  "nav-link whitespace-nowrap",
                  location === item.href && item.label !== "Search by Property Type"
                    ? "text-gold border-b border-gold pb-1"
                    : "text-foreground/90 hover:text-gold"
                )}>
                {item.label}
              </Link>
            ))}
            <a href={SITE.phoneHref} className="nav-link text-gold whitespace-nowrap">
              {SITE.phone}
            </a>
            {/* Persistent high-intent CTA — visible on every page */}
            <button
              onClick={goGetStarted}
              className="nav-link bg-gold text-primary-foreground px-5 py-2.5 hover:bg-gold/90 transition-colors whitespace-nowrap">
              Get Started
            </button>
          </nav>

          {/* Mobile: phone + hamburger */}
          <div className="flex xl:hidden items-center gap-4">
            <button
              onClick={goGetStarted}
              className="nav-link bg-gold text-primary-foreground px-3.5 py-2 hover:bg-gold/90 transition-colors whitespace-nowrap text-[10px]">
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
        <div className="xl:hidden bg-background border-b border-border max-h-[calc(100dvh-4rem)] overflow-y-auto">
          <nav className="px-6 py-6 flex flex-col gap-4">
            <button
              onClick={goGetStarted}
              className="nav-link bg-gold text-primary-foreground px-5 py-3 hover:bg-gold/90 transition-colors text-center">
              Ready to Buy or Sell? Get Started
            </button>
            {NAV_ITEMS.map((item, i) => (
              <Link key={`m-${item.label}-${i}`} href={item.href} className="nav-link text-foreground/90 hover:text-gold py-1">
                {item.label}
              </Link>
            ))}
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
