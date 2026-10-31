import TeamPhoto from "@/components/TeamPhoto";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import PageShell from "@/components/PageShell";
import StatCounter from "@/components/StatCounter";
import GetStartedForm from "@/components/GetStartedForm";
import { ResponseBadge, TrustLine } from "@/components/TrustSignals";
import NewsletterForm from "@/components/NewsletterForm";
import ListingShowcase from "@/components/ListingShowcase";
import AISearchBar from "@/components/AISearchBar";
import FinancingBanner from "@/components/FinancingBanner";
import TestimonialCarousel from "@/components/TestimonialCarousel";
import VeteranBadge from "@/components/VeteranBadge";
import TechShowcase from "@/components/TechShowcase";
import { trpc } from "@/lib/trpc";
import { useNcClickTracking, useLeaseClickTracking } from "@/hooks/usePageTracking";
import { SITE, FEATURES } from "@shared/site";
import { BRAND_IMG, IMG } from "@/lib/assets";

const CITY_CARDS = [
  { name: "San Antonio", slug: "san-antonio", img: IMG.citySanAntonio },
  { name: "New Braunfels", slug: "new-braunfels", img: IMG.cityNewBraunfels },
  { name: "Austin", slug: "austin", img: IMG.cityAustin },
  { name: "DFW", slug: "dfw", img: IMG.cityDfw },
  { name: "Houston", slug: "houston", img: IMG.cityHouston },
];

/** The mockups' button: deep gold, white serif label, square corners. */
const GOLD_BUTTON = "inline-flex items-center justify-center gap-2.5 bg-gold font-serif text-white transition-colors hover:bg-gold/90";
const BUTTON_LG = "min-h-12 px-8 text-[19px]";
const BUTTON_SM = "min-h-11 px-6 text-[17px]";

/**
 * Homepage, Oct 30, 2026 (Peter's white-skin mockups: the desktop design and the phone design with the living-room
 * hero). Order:
 * 1. Now Hiring banner (very top, → /join)
 * 2. Light hero: eyebrow, the brokerage name, the subheadline, Get Started; the photo beside it (desktop) or under it
 * 3. "Ready to Buy or Sell? Let's Get Started." band
 * 4. The four paths: Find Your Texas City, New Construction Search (/deals), List for Lease, Home Valuation
 * 5. Builder-buydown claim with its disclosure, then the Get Started form and the rest of the story (markets, track
 *    record, team, testimonials, Convince Your Partner, the tools)
 * The dark hero, its Crown Branch line work and the three dark photo bands are retired; the components stay in the
 * codebase. The featured-listings showcase stays PAUSED until IDX connects (FEATURES.SHOW_PLACEHOLDER_LISTINGS).
 */
export default function Home() {
  const { data: stats } = trpc.stats.list.useQuery();
  const { data: team } = trpc.team.list.useQuery();
  const logNcClick = useNcClickTracking();
  const logLeaseClick = useLeaseClickTracking();

  return (
    <PageShell stickyCta hiringBanner>
      {/* ============ HERO ============ */}
      <section data-home-hero className="pt-[calc(var(--hiring-banner-h,0px)+68px)] lg:pt-[calc(var(--hiring-banner-h,0px)+80px)]">
        <div className="lg:grid lg:min-h-[460px] lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] xl:min-h-[500px]">
          <div className="flex flex-col items-center px-5 pb-8 pt-10 text-center sm:pt-14 lg:items-start lg:justify-center lg:py-10 lg:pl-[max(2rem,calc((100vw-1400px)/2+2.5rem))] lg:pr-10 lg:text-left">
            <p className="eyebrow text-gold max-[399px]:text-[10px] max-[399px]:tracking-[0.22em] lg:text-foreground/70">{SITE.eyebrow}</p>
            <h1 className="mt-4 font-serif text-[2.6rem] font-medium leading-[1.02] tracking-[-0.01em] text-foreground sm:text-6xl lg:mt-6 lg:text-[4.6rem] lg:leading-[0.98] lg:text-[#6f5320] xl:text-[5.6rem]">
              Lifestyle <br className="hidden lg:block" />Design Realty
            </h1>
            <p className="mt-4 text-[9px] font-medium uppercase tracking-[0.2em] text-foreground/80 min-[400px]:text-[10px] min-[400px]:tracking-[0.24em] sm:text-xs sm:tracking-[0.3em] lg:mt-7 lg:text-[13px]">{SITE.subheadline}</p>
            <a href="#get-started" data-hero-cta className={cn(GOLD_BUTTON, BUTTON_LG, "mt-7 lg:mt-10")}>
              Get Started <ArrowRight className="h-4 w-4" />
            </a>
          </div>
          <div className="relative aspect-[16/9] w-full overflow-hidden lg:aspect-auto lg:h-full">
            <picture>
              <source media="(min-width: 1024px)" srcSet={BRAND_IMG.heroDesktop} />
              <img src={BRAND_IMG.heroMobile} alt="Bright Hill Country living room with lake views" fetchPriority="high" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
            </picture>
            {/* Phones: the photo rises out of the page under the button, as in the mockup. */}
            <div className="pointer-events-none absolute inset-x-0 top-0 h-2/5 bg-gradient-to-b from-background to-transparent lg:hidden" />
          </div>
        </div>
      </section>

      {/* ============ READY TO BUY OR SELL ============ */}
      <section className="mx-auto max-w-[1400px] px-4 pt-6 sm:px-6 lg:px-8 lg:pt-3">
        <div className="flex items-center justify-between gap-3 border border-border bg-card px-4 py-4 min-[400px]:px-5 sm:gap-4 sm:px-8 sm:py-6 lg:border-0 lg:bg-secondary/70 lg:px-8 lg:py-5">
          <div className="flex min-w-0 items-center gap-8">
            <span className="hidden h-px w-16 shrink-0 bg-gold lg:block" aria-hidden />
            <h2 className="font-serif text-[1.2rem] font-medium leading-[1.15] text-foreground min-[400px]:text-[1.35rem] sm:text-[2rem] lg:text-[2.6rem]">
              Ready to Buy or Sell?<br className="lg:hidden" /> Let&rsquo;s Get Started.
            </h2>
          </div>
          <span className="hidden h-14 w-px shrink-0 bg-border sm:block lg:hidden" aria-hidden />
          <a href="#get-started" className={cn(GOLD_BUTTON, "min-h-11 shrink-0 px-3.5 text-[15px] min-[400px]:px-5 min-[400px]:text-[16px] sm:px-8 sm:text-[19px]")}>
            Get Started <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </section>

      {/* ============ THE FOUR PATHS ============ */}
      <section data-home-paths className="mx-auto max-w-[1400px] px-4 pt-5 sm:px-6 lg:px-8 lg:pt-5">
        {/* Desktop: four cards in a row, photo on top. */}
        <div className="hidden gap-4 lg:grid lg:grid-cols-4">
          <PathCard img={BRAND_IMG.texasRiver} alt="Texas Hill Country river at sunset" title="Find Your Texas City" href="/city-finder" cta="Take the Quiz"
            text="Answer a few quick questions about your budget, lifestyle, and timeline — we'll match you with the Texas cities that fit you best." />
          <PathCard img={BRAND_IMG.newBuild} alt="New construction home with a standing-seam roof" title="New Construction Search" href={SITE.newConstructionUrl} cta="Build Your Next Chapter" onClick={logNcClick} />
          <PathCard img={BRAND_IMG.lease} alt="House key on a front door" title="List for Lease" href="/lease" cta="List for Lease" onClick={logLeaseClick} />
          <PathCard img={BRAND_IMG.valuation} alt="Bright kitchen with a marble island" title="Home Valuation" href="/valuation" cta="How Much Is Your Home Worth?" />
        </div>

        {/* Phones and tablets: the mockup's stacked cards. */}
        <div className="space-y-4 lg:hidden">
          <Link href="/city-finder" className="group grid grid-cols-[44%_minmax(0,1fr)] overflow-hidden border border-border bg-card">
            <img src={BRAND_IMG.texasRiver} alt="Texas Hill Country river at sunset" loading="lazy" decoding="async" className="h-full min-h-[180px] w-full object-cover" />
            <span className="flex flex-col justify-center p-3.5 min-[400px]:p-4 sm:p-6">
              <span className="font-serif text-[1.4rem] font-medium leading-[1.08] text-foreground min-[400px]:text-[1.5rem] sm:text-[2rem]">Find Your Texas City</span>
              <span className="mt-1.5 text-[12px] leading-[1.4] text-muted-foreground sm:text-[15px]">Answer a few quick questions about your budget, lifestyle, and timeline — we&rsquo;ll match you with the Texas cities that fit you best.</span>
              <span className={cn(GOLD_BUTTON, "mt-3 min-h-10 self-start px-4 text-[15px] sm:text-[17px]")}>Take the Quiz <ArrowRight className="h-3.5 w-3.5" /></span>
            </span>
          </Link>

          <Link href={SITE.newConstructionUrl} onClick={logNcClick} className="group relative block min-h-[160px] overflow-hidden border border-border bg-card sm:min-h-[200px]">
            <img src={BRAND_IMG.newBuildBanner} alt="New construction limestone home under an oak" loading="lazy" decoding="async" className="absolute inset-y-0 right-0 h-full w-[64%] object-cover" />
            <span className="pointer-events-none absolute inset-y-0 left-[36%] w-[34%] bg-gradient-to-r from-card via-card/75 to-transparent" aria-hidden />
            <span className="relative flex h-full min-h-[160px] w-[58%] flex-col justify-center p-5 sm:min-h-[200px] sm:p-7">
              <span className="text-[9.5px] font-medium uppercase leading-snug tracking-[0.22em] text-gold sm:text-xs">New Construction Search</span>
              <span className="mt-2 font-serif text-[1.75rem] font-medium leading-[1.08] text-foreground sm:text-[2.4rem]">Build Your Next Chapter</span>
              <ArrowRight className="mt-3 h-5 w-5 text-gold transition-transform group-hover:translate-x-1" aria-hidden />
            </span>
          </Link>

          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            <SmallPath img={BRAND_IMG.lease} imgClass="object-[85%_center]" alt="House key on a front door" title="List for Lease" href="/lease" onClick={logLeaseClick} />
            <SmallPath img={BRAND_IMG.valuation} alt="Bright kitchen with a marble island" title="Home Valuation" href="/valuation" note="How much is your home worth?" />
          </div>
        </div>

        {/* Builder-buydown claim + its required disclosure (adjacent, never buried). */}
        <FinancingBanner className="mt-5 lg:mt-6" />
      </section>

      {/* ============ GET STARTED (high-intent form) ============ */}
      <section id="get-started" className="mx-auto max-w-[1400px] scroll-mt-28 px-5 py-16 lg:px-8 lg:py-24">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-20">
          <div className="reveal">
            <p className="eyebrow text-gold">Work With Us</p>
            <h2 className="mt-3 font-serif text-4xl font-medium leading-tight md:text-5xl">
              Ready to Buy or Sell?<br />Let&rsquo;s Get Started.
            </h2>
            <p className="mt-6 max-w-md leading-relaxed text-muted-foreground">
              Tell us what you&rsquo;re planning and a Lifestyle Design Realty professional will reach
              out with a strategy tailored to your goals — no pressure, no obligation.
            </p>
            <div className="mt-8 space-y-3 text-sm text-muted-foreground">
              <p className="flex items-center gap-3"><span className="inline-block h-px w-8 bg-gold" /> Local expertise across five Texas markets</p>
              <p className="flex items-center gap-3"><span className="inline-block h-px w-8 bg-gold" /> Data-driven pricing and negotiation</p>
              <p className="flex items-center gap-3"><span className="inline-block h-px w-8 bg-gold" /> We typically respond within 30 minutes</p>
            </div>
          </div>
          <div className="reveal border border-border bg-card p-6 shadow-[0_18px_50px_-30px_rgb(0_0_0/0.25)] lg:p-10">
            {/* Social proof + the response promise, right where the visitor
                decides whether to hand over their details. */}
            <div className="mb-5 flex flex-col gap-3">
              <ResponseBadge className="self-start" />
              <TrustLine />
            </div>
            <GetStartedForm />
          </div>
        </div>
      </section>

      {/* ============ ROTATING LISTING SHOWCASE — PAUSED until IDX (flip FEATURES.SHOW_PLACEHOLDER_LISTINGS) ============ */}
      {FEATURES.SHOW_PLACEHOLDER_LISTINGS && (
        <section className="mx-auto max-w-[1400px] px-5 pb-16 lg:px-8 lg:pb-20">
          <div className="reveal mb-6 flex items-end justify-between gap-6">
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
      )}

      {/* ============ AI SEARCH — paused until IDX (FEATURES.SHOW_PROPERTY_SEARCH) ============ */}
      {FEATURES.SHOW_PROPERTY_SEARCH && (
        <section className="border-y border-border bg-secondary/60">
          <div className="mx-auto max-w-3xl px-5 py-12 lg:px-8">
            <AISearchBar />
          </div>
        </section>
      )}

      {/* ============ MARKETS WE SERVE ============ */}
      <section className="border-y border-border bg-secondary/60">
        <div className="mx-auto max-w-[1400px] px-5 py-16 lg:px-8 lg:py-24">
          <div className="reveal mb-12 text-center">
            <p className="eyebrow text-gold">Markets We Serve</p>
            <h2 className="mt-3 font-serif text-4xl font-medium md:text-5xl">Five Texas Markets, One Team</h2>
          </div>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            {CITY_CARDS.map((c, i) => (
              <Link key={c.slug} href={`/${c.slug}`}>
                <div className="group lux-lift reveal relative aspect-[3/4] overflow-hidden" style={{ transitionDelay: `${i * 50}ms` }}>
                  <img src={c.img} alt={c.name} loading="lazy" className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                  <div className="absolute inset-x-0 bottom-0 p-5">
                    <h3 className="font-serif text-2xl text-white">{c.name}</h3>
                    <p className="mt-0.5 text-[10px] uppercase tracking-[0.18em] text-white/80">&amp; Surrounding Areas</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ============ TRACK RECORD — slim live-data strip ============ */}
      <section className="border-b border-border bg-card">
        <div className="mx-auto max-w-[1400px] px-5 py-10 lg:px-8 lg:py-12">
          <div className="grid grid-cols-2 gap-8 lg:grid-cols-4 lg:gap-10">
            {(stats && stats.length > 0
              ? stats
              : [
                  { id: 1, label: "Closed Sales", value: "63" },
                  { id: 2, label: "Total Value", value: "$26M" },
                  { id: 3, label: "Price Range", value: "$200K–$1.7M" },
                  { id: 4, label: "Average Price", value: "$424.4K" },
                ]
            ).map((s) => (
              <StatCounter key={s.id} value={s.value} label={s.label} compact />
            ))}
          </div>
          {/* Veteran-owned trust line — part of the "why work with us" story */}
          <div className="reveal mt-8 flex items-center justify-center gap-3 border-t border-border pt-6">
            <VeteranBadge className="text-[10px]" />
            <span className="hidden text-xs tracking-wide text-muted-foreground sm:inline">
              — service, discipline, and integrity in every transaction.
            </span>
          </div>
        </div>
      </section>

      {/* ============ MEET THE TEAM PREVIEW ============ */}
      <section className="mx-auto max-w-[1400px] px-5 py-16 lg:px-8 lg:py-24">
        <div className="reveal mb-10 flex items-end justify-between gap-6">
          <div>
            <p className="eyebrow text-gold">The People Behind the Brand</p>
            {/*
             * TREC sizing rule: brokerage name (nav wordmark) renders >= 1/2
             * the size of any agent name on this page (team cards use small text).
             */}
            <h2 className="mt-3 font-serif text-4xl font-medium md:text-5xl">Meet the Team</h2>
          </div>
          <Link href="/team" className="text-cta hidden sm:inline-block">Full Team</Link>
        </div>
        <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
          {(team ?? []).slice(0, 4).map((m, i) => (
            <Link key={m.id} href="/team">
              <div className="group reveal" style={{ transitionDelay: `${i * 50}ms` }}>
                <div className="relative flex aspect-[3/4] items-center justify-center overflow-hidden bg-secondary">
                  <TeamPhoto photo={m.photo} name={m.name} className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />
                </div>
                <h3 className="mt-4 font-sans text-sm uppercase tracking-[0.15em]">{m.name}</h3>
                <p className="mt-1 text-[11px] uppercase tracking-[0.15em] text-gold">{m.title}</p>
              </div>
            </Link>
          ))}
        </div>
        <div className="mt-8 sm:hidden">
          <Link href="/team" className="text-cta">Meet the Full Team</Link>
        </div>
      </section>

      {/* ============ TESTIMONIALS ============ */}
      <section className="border-y border-border bg-secondary/60">
        <div className="mx-auto max-w-[1400px] px-5 py-16 lg:px-8 lg:py-24">
          <div className="reveal mb-12 text-center">
            <p className="eyebrow text-gold">Client Experiences</p>
            <h2 className="mt-3 font-serif text-4xl font-medium md:text-5xl">Testimonials</h2>
          </div>
          <TestimonialCarousel />
          <div className="mt-10 text-center">
            <Link href="/testimonials" className="text-cta">View All</Link>
          </div>
        </div>
      </section>

      {/* ============ CONVINCE YOUR PARTNER (fun secondary placement) ============ */}
      <section>
        <div className="mx-auto max-w-[1400px] px-5 py-14 lg:px-8 lg:py-16">
          <div className="reveal flex flex-col items-center justify-between gap-6 border border-gold/30 bg-gold/[0.04] px-8 py-8 sm:flex-row">
            <div className="text-center sm:text-left">
              <p className="eyebrow text-gold">One of you is already sold on Texas?</p>
              <p className="mt-2 font-serif text-2xl md:text-3xl">
                Let us write the case for the other one.
              </p>
            </div>
            <Link href="/convince" className={cn(GOLD_BUTTON, BUTTON_SM, "shrink-0")}>
              Convince Your Partner <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* ============ TECHNOLOGY SHOWCASE (show, don't tell) ============ */}
      <TechShowcase />

      {/* ============ NEWSLETTER — PAUSED until IDX (flip FEATURES.SHOW_NEWSLETTER) ============ */}
      {FEATURES.SHOW_NEWSLETTER && (
        <section className="mx-auto max-w-2xl px-5 py-20 text-center lg:px-8 lg:py-24">
          <p className="eyebrow reveal text-gold">Stay Informed</p>
          <h2 className="reveal mt-3 font-serif text-3xl md:text-4xl">Get New Listings in Your Inbox</h2>
          <p className="reveal mt-4 text-sm text-muted-foreground">
            A curated selection of new Central Texas listings, delivered occasionally. No spam.
          </p>
          <div className="reveal mt-10">
            <NewsletterForm />
          </div>
        </section>
      )}
    </PageShell>
  );
}

/** A desktop path card: photo on top, the title, an optional line, the gold button. The whole card is the link. */
function PathCard({ img, alt, title, text, href, cta, onClick }: { img: string; alt: string; title: string; text?: string; href: string; cta: string; onClick?: () => void }) {
  return (
    <Link href={href} onClick={onClick} className="group flex flex-col border border-border bg-card p-3.5 transition-shadow hover:shadow-[0_18px_40px_-26px_rgb(0_0_0/0.35)]">
      <span className="block aspect-[2.1/1] overflow-hidden">
        <img src={img} alt={alt} loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.03]" />
      </span>
      <span className="mt-4 font-serif text-[1.45rem] font-medium leading-tight text-foreground xl:text-[1.65rem]">{title}</span>
      {text && <span className="mt-2 text-[15px] leading-snug text-muted-foreground">{text}</span>}
      <span className="min-h-3 flex-1" aria-hidden />
      <span className={cn(GOLD_BUTTON, "min-h-11 max-w-full self-start px-5 py-2 text-left text-[16px] leading-tight xl:whitespace-nowrap xl:px-6 xl:text-[17px]")}>
        {cta} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}

/** A phone path card: photo on the left, the title and an arrow on the right. */
function SmallPath({ img, imgClass, alt, title, href, note, onClick }: { img: string; imgClass?: string; alt: string; title: string; href: string; note?: string; onClick?: () => void }) {
  return (
    <Link href={href} onClick={onClick} className="group grid min-h-[118px] grid-cols-[42%_minmax(0,1fr)] overflow-hidden border border-border bg-card sm:min-h-[150px]">
      <img src={img} alt={alt} loading="lazy" decoding="async" className={cn("h-full w-full object-cover", imgClass)} />
      <span className="flex min-w-0 flex-col justify-center p-3 sm:p-5">
        <span className="font-serif text-[1.25rem] font-medium leading-[1.1] text-foreground sm:text-[1.7rem]">{title}</span>
        {note && <span className="mt-1.5 text-[8.5px] font-medium uppercase leading-snug tracking-[0.16em] text-muted-foreground sm:text-[10px]">{note}</span>}
        <ArrowRight className="mt-2 h-4 w-4 text-gold transition-transform group-hover:translate-x-1" aria-hidden />
      </span>
    </Link>
  );
}
