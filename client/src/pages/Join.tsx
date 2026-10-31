import PageShell from "@/components/PageShell";
import { useEffect, useState } from "react";
import RecruitForm, { BUILDER_DEALS_RECRUIT_SOURCE } from "@/components/RecruitForm";
import LeadFlowDiagram from "@/components/LeadFlowDiagram";
import { SITE } from "@shared/site";
import { BRAND_IMG } from "@/lib/assets";
import { Link } from "wouter";
import { ArrowRight, Flame, HandCoins, Heart, Instagram, Landmark, Link2, ListChecks, Mail } from "lucide-react";

/**
 * Instant payoff for the homepage Now Hiring banner: the three strongest
 * hooks, visible on the first screen before scrolling. The detailed pitch
 * below stays unchanged.
 */
const TOP_HOOKS = [
  { icon: Flame, text: "Warm & hot buyer and seller leads supplied to you" },
  { icon: HandCoins, text: "Lease commissions up to $6,000 on a single deal" },
  { icon: Landmark, text: "Direct broker mentorship — veteran-owned & operated" },
] as const;

const PILLARS = [
  { title: "Warm & Hot Transfer Leads", body: "Our City Finder, valuation engine, and Get Started pipeline deliver qualified buyers and sellers directly to the team. Lease commissions have run up to $6,000 on a single deal." },
  { title: "Brokerage-First Brand", body: "Plug into a luxury brand with real marketing infrastructure — not a logo you have to build alone." },
  { title: "Broker Support", body: "Direct access to Broker & Owner Steven Van Orden and Owner Peter Allen — deal structuring, negotiation help, and mentorship on demand. Proudly veteran-owned and operated, we run our brokerage with the same discipline and accountability." },
];

/**
 * Oct 30, 2026 (Peter: "make sure it makes agents want to join and inquire"): what an agent gets on day one, shown
 * with facts the site already backs. Each line matches a real feature of the agents' Builder Deals portal
 * (client links, picks, saves and tour requests, the /deals/u/<name> bio link that files sign-ups under the agent in
 * Follow Up Boss). No splits, fees or income numbers until Peter supplies real ones.
 */
export const JOIN_TOOLKIT = [
  { icon: Link2, title: "Private client links", body: "Type a client's name and text or email them a private list of new-build deals, with the addresses, rates and photos." },
  { icon: ListChecks, title: "Hand-picked short lists", body: "Pick the homes that fit and send just those, instead of the whole market." },
  { icon: Heart, title: "See what clients like", body: "See which homes each client saves and when they ask for a tour." },
  { icon: Instagram, title: "Your own bio link", body: "Put your link in your Instagram bio. Buyers who sign up through it land in Follow Up Boss under you." },
] as const;

/** The site tools that create the leads, so an agent can see them for themselves. */
export const JOIN_LEAD_TOOLS = [
  { label: "Find My Texas City", href: "/city-finder" },
  { label: "Home Valuation", href: "/valuation" },
  { label: "Builder Deals", href: "/deals" },
] as const;

/** The owners an agent works with, with the titles the team page uses. */
export const JOIN_BROKERS = [
  { name: "Steven Van Orden", title: "Broker & Owner · Designated Broker", photo: "/team/steven-van-orden.webp" },
  { name: "Peter Allen", title: "Owner · REALTOR®", photo: "/team/peter-allen.webp" },
] as const;

/** A realtor sent here from the Builder Deals gate (?from=builder-deals), with the number they typed there (this tab only). */
function builderDealsArrival(): { fromDeals: boolean; phone: string; name: string; email: string } {
  const empty = { phone: "", name: "", email: "" };
  if (typeof window === "undefined") return { fromDeals: false, ...empty };
  const fromDeals = new URLSearchParams(window.location.search).get("from") === "builder-deals";
  if (!fromDeals) return { fromDeals, ...empty };
  try {
    const raw = window.sessionStorage.getItem("ldr_recruit_phone") ?? "";
    const parsed = raw.startsWith("{") ? JSON.parse(raw) as Partial<Record<"phone" | "name" | "email", unknown>> : { phone: raw };
    const text = (value: unknown, max: number) => typeof value === "string" ? value.slice(0, max) : "";
    return { fromDeals, phone: text(parsed.phone, 40), name: text(parsed.name, 190), email: text(parsed.email, 320) };
  } catch { return { fromDeals, ...empty }; }
}

export default function Join() {
  const [arrival] = useState(builderDealsArrival);
  // Straight to the application for an agent sent from Builder Deals.
  useEffect(() => { if (arrival.fromDeals) window.setTimeout(() => document.querySelector("[data-join-from-deals]")?.scrollIntoView({ block: "start" }), 300); }, [arrival.fromDeals]);
  return (
    <PageShell stickyCta stickyCtaLabel="Apply to Join the Team" stickyCtaHref="#apply">
      {/* Oct 30, 2026 (Peter: "fix the black part on the recruiting page"): the white-skin hero, text beside a bright
          photo, with the three hooks and a straight line to the application. */}
      <section className="pt-[calc(68px+2.25rem)] lg:pt-[calc(80px+3rem)]">
        <div className="mx-auto grid max-w-[1400px] items-center gap-8 px-5 pb-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-14 lg:px-8 lg:pb-16">
          <div>
            <p className="eyebrow text-gold">Now Hiring</p>
            <h1 className="mt-3 font-serif text-[2.35rem] font-medium leading-[1.08] text-foreground sm:text-5xl lg:text-[3.6rem]">
              Ready to join a team that helps you boost your sales with warm &amp; hot transfer leads?
            </h1>
            {/* Why Agents Join Us — 3-hook strip, visible on first screen */}
            <div className="mt-7 grid gap-2.5">
              {TOP_HOOKS.map(({ icon: Icon, text }) => (
                <div key={text} className="flex items-center gap-3 border border-border bg-card px-4 py-3.5">
                  <Icon className="h-5 w-5 shrink-0 text-gold" aria-hidden />
                  <span className="text-[12px] font-medium uppercase leading-snug tracking-[0.1em] text-foreground">{text}</span>
                </div>
              ))}
            </div>
            <a href="#apply" className="mt-7 inline-flex min-h-12 items-center justify-center gap-2.5 bg-gold px-8 font-serif text-[19px] text-white transition-colors hover:bg-gold/90">
              Apply to Join the Team <ArrowRight className="h-4 w-4" />
            </a>
          </div>
          <div className="relative aspect-[4/3] overflow-hidden lg:aspect-[5/4]">
            <img src={BRAND_IMG.heroDesktop} alt="Bright Hill Country living room" fetchPriority="high" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1400px] px-5 lg:px-8 py-20 grid md:grid-cols-3 gap-10">
        {PILLARS.map((p, i) => (
          <div key={p.title} className="reveal" style={{ transitionDelay: `${i * 80}ms` }}>
            <h2 className="font-serif text-2xl">{p.title}</h2>
            <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{p.body}</p>
          </div>
        ))}
      </section>

      {/* Oct 30, 2026: the Builder Deals toolkit every agent gets. */}
      <section data-join-toolkit className="mx-auto max-w-[1200px] px-5 pb-20 lg:px-8">
        <div className="mx-auto max-w-2xl text-center reveal">
          <p className="eyebrow text-gold">Builder Deals, for your clients</p>
          <h2 className="display-serif mt-3 text-3xl md:text-4xl">Your own new-construction deal platform</h2>
          <p className="mt-4 leading-relaxed text-muted-foreground">
            Every agent on the team gets our Builder Deals platform: thousands of new-build homes with builder incentives, and the tools to send them to your clients.
          </p>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {JOIN_TOOLKIT.map(({ icon: Icon, title, body }, i) => (
            <div key={title} className="reveal border border-border bg-card p-6" style={{ transitionDelay: `${i * 60}ms` }}>
              <Icon className="h-5 w-5 text-gold" aria-hidden />
              <h3 className="mt-4 font-serif text-xl">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How leads actually move through the system — visual proof, not claims */}
      <section className="border-y border-border/60 bg-secondary/60">
        <div className="mx-auto max-w-[1200px] px-5 lg:px-8 py-20">
          <div className="text-center mb-14 reveal">
            <p className="eyebrow text-gold">The Lead System</p>
            <h2 className="display-serif text-3xl md:text-4xl mt-3">Where Your Next Client Comes From</h2>
          </div>
          <LeadFlowDiagram />
          {/* Proof: the tools that create the leads, one tap away. */}
          <div data-join-lead-tools className="mt-12 text-center">
            <p className="text-sm text-muted-foreground">See the tools behind your leads:</p>
            <div className="mt-4 flex flex-wrap justify-center gap-3">
              {JOIN_LEAD_TOOLS.map((t) => (
                <Link key={t.href} href={t.href} className="inline-flex min-h-11 items-center gap-2 border border-gold/60 bg-card px-5 font-serif text-[17px] text-foreground transition-colors hover:border-gold hover:text-gold">
                  {t.label} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-5 lg:px-8 pb-24">
        {/* Oct 30, 2026: who an agent works with, by face and name, right before the application. */}
        <div data-join-brokers className="pt-16 pb-12 reveal">
          <p className="eyebrow text-center text-gold">Your Brokers</p>
          <h2 className="display-serif mt-3 text-center text-3xl md:text-4xl">Work directly with the owners</h2>
          <p className="mx-auto mt-4 max-w-xl text-center leading-relaxed text-muted-foreground">
            Deal structuring, negotiation help and mentorship, straight from the people who run the brokerage.
          </p>
          <div className="mt-8 grid grid-cols-2 gap-4 sm:gap-6">
            {JOIN_BROKERS.map((b) => (
              <div key={b.name} className="border border-border bg-card">
                <div className="aspect-[4/5] overflow-hidden bg-secondary">
                  <img src={b.photo} alt={b.name} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                </div>
                <div className="p-4 sm:p-5">
                  <p className="font-serif text-lg leading-tight sm:text-xl">{b.name}</p>
                  <p className="mt-1.5 text-[10px] font-medium uppercase leading-snug tracking-[0.14em] text-gold sm:text-[11px]">{b.title}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        {/* Screening message — exact copy per brief */}
        <div className="border-l-2 border-gold pl-6 mb-10 reveal">
          <p className="text-muted-foreground leading-relaxed whitespace-pre-line">
            {"In an effort to find the best fit, can you please tell me the following:\n1. License number\n2. # of transactions closed this year\n3. Are you a full time agent?\n4. Do you currently use a CRM? If yes which one?\n5. What brokerage are you with?\nThanks!"}
          </p>
          <p className="mt-3 font-serif italic text-lg text-foreground/90">— Stefanie</p>
        </div>
        {arrival.fromDeals && <div data-join-from-deals="true" className="mb-6 scroll-mt-28 border border-gold/50 bg-gold/10 p-5">
          <p className="eyebrow text-gold">From Builder Deals</p>
          <p className="mt-2 leading-relaxed text-foreground/90">Builder Deals are for home buyers. Agents on our team get every one of these deals, with the addresses, rates and photos, for their own clients. Tell us about yourself and our broker will reach out.</p>
        </div>}
        <div id="apply" className="scroll-mt-28 bg-card border border-border p-6 lg:p-10">
          <RecruitForm sourceTag={arrival.fromDeals ? BUILDER_DEALS_RECRUIT_SOURCE : undefined} initialPhone={arrival.phone} initialName={arrival.name} initialEmail={arrival.email} />
        </div>

        {/* Closing tagline + email contact for agents who prefer email.
            The screening form above remains the primary application path. */}
        <div className="mt-16 text-center reveal">
          <p className="display-serif text-2xl md:text-3xl leading-snug">
            Lifestyle Design Realty.
            <br />
            <span className="text-gold">We built the brokerage we never had.</span>
          </p>
          <p className="mt-6 text-sm text-muted-foreground">
            Prefer email?{" "}
            <a
              href={`mailto:${SITE.email}`}
              className="inline-flex items-center gap-1.5 text-gold hover:underline underline-offset-4">
              <Mail className="h-3.5 w-3.5" /> Team@lifestyledesignrealty.com
            </a>
          </p>
        </div>
      </section>
    </PageShell>
  );
}
