import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import PageShell from "@/components/PageShell";
import StatCounter from "@/components/StatCounter";
import GetStartedForm from "@/components/GetStartedForm";
import NewsletterForm from "@/components/NewsletterForm";
import ListingShowcase from "@/components/ListingShowcase";
import AISearchBar from "@/components/AISearchBar";
import FinancingBanner from "@/components/FinancingBanner";
import TestimonialCarousel from "@/components/TestimonialCarousel";
import VeteranBadge from "@/components/VeteranBadge";
import TechShowcase from "@/components/TechShowcase";
import { trpc } from "@/lib/trpc";
import { SITE } from "@shared/site";
import { IMG } from "@/lib/assets";

const CITY_CARDS = [
  { name: "San Antonio", slug: "san-antonio", img: IMG.citySanAntonio },
  { name: "New Braunfels", slug: "new-braunfels", img: IMG.cityNewBraunfels },
  { name: "Austin", slug: "austin", img: IMG.cityAustin },
  { name: "DFW", slug: "dfw", img: IMG.cityDfw },
  { name: "Houston", slug: "houston", img: IMG.cityHouston },
];

/**
 * Above-the-fold priority (per brief):
 * 1. Hero headline + primary CTAs
 * 2. "Ready to Buy or Sell?" Get Started CTA (jump to form)
 * 3. Compact rotating listing showcase (light visual accent)
 * Everything else follows below the fold.
 */
export default function Home() {
  const { data: stats } = trpc.stats.list.useQuery();
  const { data: team } = trpc.team.list.useQuery();

  return (
    <PageShell>
      {/* ============ HERO ============ */}
      <section className="relative min-h-[88svh] flex items-center">
        <div className="absolute inset-0">
          <img
            src={IMG.heroDarkInterior}
            alt="Luxury interior with sculptural chandelier"
            className="h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-black/65" />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-black/40" />
        </div>
        <div className="relative mx-auto w-full max-w-[1400px] px-5 lg:px-8 pt-32 pb-16">
          <p className="eyebrow text-foreground/90">{SITE.eyebrow}</p>
          <h1 className="display-serif text-[10.5vw] sm:text-6xl md:text-7xl lg:text-[5.5rem] uppercase mt-5 text-foreground">
            {SITE.headline}
          </h1>
          <div className="hairline w-40 my-7" />
          <p className="eyebrow text-foreground/80">{SITE.subheadline}</p>

          {/* Primary CTAs — the three core actions */}
          <div className="mt-12 flex flex-wrap items-center gap-5">
            <a
              href="#get-started"
              className="inline-flex items-center gap-3 bg-gold text-primary-foreground px-9 py-4 uppercase tracking-[0.2em] text-xs font-medium hover:bg-gold/90 transition-colors">
              Ready to Buy or Sell? Get Started <ArrowRight className="h-4 w-4" />
            </a>
            <Link
              href="/city-finder"
              className="inline-flex items-center gap-3 border border-foreground/40 px-9 py-4 uppercase tracking-[0.2em] text-xs font-medium hover:border-gold hover:text-gold transition-colors">
              Find Your Texas City
            </Link>
            <a
              href={SITE.newConstructionUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-3 border border-foreground/40 px-9 py-4 uppercase tracking-[0.2em] text-xs font-medium hover:border-gold hover:text-gold transition-colors">
              New Construction Search
            </a>
          </div>
          <div className="mt-8 flex flex-wrap gap-10">
            <Link href="/search" className="text-cta text-foreground">Browse Properties</Link>
            <Link href="/valuation" className="text-cta text-foreground">Home Valuation</Link>
          </div>

          {/* Builder-buydown claim + required disclosure (adjacent, never buried) */}
          <FinancingBanner className="mt-10 max-w-xl bg-background/70 backdrop-blur-sm" />
        </div>
      </section>

      {/* ============ GET STARTED (high-intent form) ============ */}
      <section id="get-started" className="mx-auto max-w-[1400px] px-5 lg:px-8 py-20 lg:py-28 scroll-mt-24">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
          <div className="reveal">
            <p className="eyebrow text-gold">Work With Us</p>
            <h2 className="display-serif text-4xl md:text-5xl mt-3 leading-tight">
              Ready to Buy or Sell?<br />Let's Get Started.
            </h2>
            <p className="mt-6 text-muted-foreground leading-relaxed max-w-md">
              Tell us what you're planning and a Lifestyle Design Realty professional will reach
              out with a strategy tailored to your goals — no pressure, no obligation.
            </p>
            <div className="mt-8 space-y-3 text-sm text-muted-foreground">
              <p className="flex items-center gap-3"><span className="h-px w-8 bg-gold inline-block" /> Local expertise across five Texas markets</p>
              <p className="flex items-center gap-3"><span className="h-px w-8 bg-gold inline-block" /> Data-driven pricing and negotiation</p>
              <p className="flex items-center gap-3"><span className="h-px w-8 bg-gold inline-block" /> A response within one business day</p>
            </div>
          </div>
          <div className="reveal border border-gold/40 bg-card p-6 lg:p-10">
            <GetStartedForm />
          </div>
        </div>
      </section>

      {/* ============ ROTATING LISTING SHOWCASE (light accent) ============ */}
      <section className="mx-auto max-w-[1400px] px-5 lg:px-8 pb-16 lg:pb-20">
        <div className="flex items-end justify-between gap-6 mb-6 reveal">
          <p className="eyebrow text-gold">Featured Property</p>
          <Link href="/portfolio" className="text-cta hidden sm:inline-block">View All Listings</Link>
        </div>
        <div className="reveal">
          <ListingShowcase />
        </div>
        <div className="mt-6 sm:hidden">
          <Link href="/portfolio" className="text-cta">View All Listings</Link>
        </div>
      </section>

      {/* ============ AI SEARCH ============ */}
      <section className="border-y border-border/60 bg-[oklch(0.165_0.005_285)]">
        <div className="mx-auto max-w-3xl px-5 lg:px-8 py-12">
          <AISearchBar />
        </div>
      </section>

      {/* ============ STATS BAR ============ */}
      <section className="border-b border-border/60 bg-[oklch(0.165_0.005_285)]">
        <div className="mx-auto max-w-[1400px] px-5 lg:px-8 py-14 lg:py-16 grid grid-cols-2 lg:grid-cols-4 gap-10">
          {(stats && stats.length > 0
            ? stats
            : [
                { id: 1, label: "Closed Sales", value: "63" },
                { id: 2, label: "Total Value", value: "$26M" },
                { id: 3, label: "Price Range", value: "$200K–$1.7M" },
                { id: 4, label: "Average Price", value: "$424.4K" },
              ]
          ).map((s) => (
            <StatCounter key={s.id} value={s.value} label={s.label} />
          ))}
        </div>
        {/* Veteran-owned trust line — part of the "why work with us" story */}
        <div className="mx-auto max-w-[1400px] px-5 lg:px-8 pb-10 -mt-2">
          <div className="reveal flex items-center justify-center gap-3 border-t border-border/40 pt-8">
            <VeteranBadge className="text-[10px]" />
            <span className="hidden sm:inline text-muted-foreground text-xs tracking-wide">
              — service, discipline, and integrity in every transaction.
            </span>
          </div>
        </div>
      </section>

      {/* ============ TECHNOLOGY SHOWCASE (show, don't tell) ============ */}
      <TechShowcase />

      {/* ============ CITY FINDER CTA ============ */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0">
          <img src={IMG.areaBoerne} alt="Texas Hill Country" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-black/75" />
        </div>
        <div className="relative mx-auto max-w-[1400px] px-5 lg:px-8 py-24 lg:py-36 text-center">
          <p className="eyebrow text-gold reveal">Signature Tool</p>
          <h2 className="display-serif text-4xl md:text-6xl mt-4 reveal">Find Your Texas City</h2>
          <p className="mt-6 max-w-xl mx-auto text-muted-foreground reveal">
            Answer a few quick questions about your budget, lifestyle, and timeline — we'll match
            you with the Texas cities that fit you best.
          </p>
          <div className="mt-10 reveal">
            <Link
              href="/city-finder"
              className="inline-flex items-center gap-3 bg-gold text-primary-foreground px-10 py-4 uppercase tracking-[0.2em] text-xs font-medium hover:bg-gold/90 transition-colors">
              Take the Quiz <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* ============ CONVINCE YOUR PARTNER (fun secondary placement) ============ */}
      <section className="border-b border-border/60">
        <div className="mx-auto max-w-[1400px] px-5 lg:px-8 py-14 lg:py-16">
          <div className="reveal flex flex-col sm:flex-row items-center justify-between gap-6 border border-gold/30 bg-gold/[0.04] px-8 py-8">
            <div className="text-center sm:text-left">
              <p className="eyebrow text-gold">One of you is already sold on Texas?</p>
              <p className="mt-2 font-serif text-2xl md:text-3xl">
                Let us write the case for the other one.
              </p>
            </div>
            <Link
              href="/convince"
              className="shrink-0 inline-flex items-center gap-3 border border-gold text-gold px-8 py-4 uppercase tracking-[0.2em] text-xs font-medium hover:bg-gold hover:text-primary-foreground transition-colors">
              Convince Your Partner <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* ============ NEW CONSTRUCTION ============ */}
      <section className="mx-auto max-w-[1400px] px-5 lg:px-8 py-20 lg:py-28 grid lg:grid-cols-2 gap-12 items-center">
        <div className="reveal">
          <p className="eyebrow text-gold">New Construction</p>
          <h2 className="display-serif text-4xl md:text-5xl mt-3">Build Your Next Chapter</h2>
          <p className="mt-6 text-muted-foreground leading-relaxed">
            From quick move-in inventory to fully custom builds, we guide you through every new
            construction community across Texas — with builder incentives, lot selection, and
            negotiation handled by professionals who represent you, not the builder.
          </p>
          <a
            href={SITE.newConstructionUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-8 inline-flex items-center gap-3 bg-gold text-primary-foreground px-9 py-4 uppercase tracking-[0.2em] text-xs font-medium hover:bg-gold/90 transition-colors">
            Find New Builds <ArrowRight className="h-4 w-4" />
          </a>
        </div>
        <div className="reveal overflow-hidden aspect-[4/3]">
          <img src={IMG.listingHillCountryWhite} alt="New construction home in Texas" className="h-full w-full object-cover" />
        </div>
      </section>

      {/* ============ MARKETS WE SERVE ============ */}
      <section className="bg-[oklch(0.165_0.005_285)] border-y border-border/60">
        <div className="mx-auto max-w-[1400px] px-5 lg:px-8 py-20 lg:py-28">
          <div className="text-center mb-12 reveal">
            <p className="eyebrow text-gold">Markets We Serve</p>
            <h2 className="display-serif text-4xl md:text-5xl mt-3">Five Texas Markets, One Team</h2>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            {CITY_CARDS.map((c, i) => (
              <Link key={c.slug} href={`/${c.slug}`}>
                <div className="group lux-lift relative aspect-[3/4] overflow-hidden reveal" style={{ transitionDelay: `${i * 50}ms` }}>
                  <img src={c.img} alt={c.name} className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />
                  <div className="absolute inset-0 bg-black/50 group-hover:bg-black/35 transition-colors" />
                  <div className="absolute inset-x-0 bottom-0 p-5">
                    <h3 className="font-serif text-xl text-white">{c.name}</h3>
                    <span className="text-[10px] uppercase tracking-[0.2em] text-gold opacity-0 group-hover:opacity-100 transition-opacity">
                      Explore →
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ============ MEET THE TEAM PREVIEW ============ */}
      <section className="mx-auto max-w-[1400px] px-5 lg:px-8 py-20 lg:py-28">
        <div className="flex items-end justify-between gap-6 mb-10 reveal">
          <div>
            <p className="eyebrow text-gold">The People Behind the Brand</p>
            {/*
             * TREC sizing rule: brokerage name (nav wordmark) renders >= 1/2
             * the size of any agent name on this page (team cards use small text).
             */}
            <h2 className="display-serif text-4xl md:text-5xl mt-3">Meet the Team</h2>
          </div>
          <Link href="/team" className="text-cta hidden sm:inline-block">Full Team</Link>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {(team ?? []).slice(0, 4).map((m, i) => (
            <Link key={m.id} href="/team">
              <div className="group reveal" style={{ transitionDelay: `${i * 50}ms` }}>
                <div className="aspect-[3/4] bg-secondary overflow-hidden flex items-center justify-center">
                  {m.photo ? (
                    <img src={m.photo} alt={m.name} className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />
                  ) : (
                    <span className="font-serif text-5xl text-gold/60">{m.name.charAt(0)}</span>
                  )}
                </div>
                <h3 className="font-sans text-sm uppercase tracking-[0.15em] mt-4">{m.name}</h3>
                <p className="text-[11px] uppercase tracking-[0.15em] text-gold mt-1">{m.title}</p>
              </div>
            </Link>
          ))}
        </div>
        <div className="mt-8 sm:hidden">
          <Link href="/team" className="text-cta">Meet the Full Team</Link>
        </div>
      </section>

      {/* ============ TESTIMONIALS ============ */}
      <section className="bg-[oklch(0.165_0.005_285)] border-y border-border/60">
        <div className="mx-auto max-w-[1400px] px-5 lg:px-8 py-20 lg:py-28">
          <div className="text-center mb-12 reveal">
            <p className="eyebrow text-gold">Client Experiences</p>
            <h2 className="display-serif text-4xl md:text-5xl mt-3">Testimonials</h2>
          </div>
          <TestimonialCarousel />
          <div className="text-center mt-10">
            <Link href="/testimonials" className="text-cta">View All</Link>
          </div>
        </div>
      </section>

      {/* ============ HOME VALUATION BAND ============ */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0">
          <img src={IMG.interiorMoody} alt="" aria-hidden className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-black/80" />
        </div>
        <div className="relative mx-auto max-w-3xl px-5 lg:px-8 py-20 lg:py-28 text-center">
          <p className="eyebrow text-gold reveal">Sellers</p>
          <h2 className="display-serif text-4xl md:text-5xl mt-3 reveal">How Much Is Your Home Worth?</h2>
          <p className="mt-5 text-muted-foreground reveal">
            Instant property valuation · Expert advice · Sell for more
          </p>
          <div className="mt-10 reveal">
            <Link
              href="/valuation"
              className="inline-block bg-gold text-primary-foreground px-10 py-4 uppercase tracking-[0.2em] text-xs font-medium hover:bg-gold/90 transition-colors">
              Get a Free Home Valuation
            </Link>
          </div>
        </div>
      </section>

      {/* ============ NEWSLETTER (lightweight, distinct from Get Started) ============ */}
      <section className="mx-auto max-w-2xl px-5 lg:px-8 py-20 lg:py-24 text-center">
        <p className="eyebrow text-gold reveal">Stay Informed</p>
        <h2 className="display-serif text-3xl md:text-4xl mt-3 reveal">Get New Listings in Your Inbox</h2>
        <p className="mt-4 text-sm text-muted-foreground reveal">
          A curated selection of new Central Texas listings, delivered occasionally. No spam.
        </p>
        <div className="mt-10 reveal">
          <NewsletterForm />
        </div>
      </section>
    </PageShell>
  );
}
