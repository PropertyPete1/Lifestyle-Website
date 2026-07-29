import PageShell from "@/components/PageShell";
import LeadForm from "@/components/LeadForm";
import { IMG } from "@/lib/assets";
import { CalendarCheck, Globe2, KeyRound, ShieldCheck, Zap } from "lucide-react";

/**
 * List Your Property for Lease — landlord/investor page modeled on /sell.
 * Same luxury layout & section structure; leasing-specific copy, Expert
 * Tenant Screening (replaces Expert Negotiation), and a Speed-to-Market
 * automation timeline. Form routes to FUB as a LANDLORD lead.
 */
const PROCESS = [
  {
    n: "01",
    title: "Strategic Pricing",
    body: "Rental pricing built from live lease comps and tenant demand across your submarket — positioned for maximum monthly rent with minimum vacancy, so the property never sits empty losing money.",
  },
  {
    n: "02",
    title: "Professional Photography",
    body: "Magazine-grade photography and media that make your listing stop the scroll on Zillow, Apartments.com, and the MLS — quality tenants choose the listing that looks cared for.",
  },
  {
    n: "03",
    title: "Expert Tenant Screening",
    body: "Every applicant is verified before a lease is offered: income verification, rental history, and background checks. You get tenants who pay on time and treat the property like their own.",
  },
];

const TIMELINE = [
  {
    day: "Day 1",
    title: "Pricing Analysis + Photos Scheduled",
    body: "We run the rental comps, set the number, and get the photographer booked — same day you sign.",
    icon: Zap,
  },
  {
    day: "Day 2–3",
    title: "Live on MLS + Syndicated Everywhere",
    body: "Your listing goes live on the MLS and syndicates automatically to the major rental platforms tenants actually search.",
    icon: Globe2,
  },
  {
    day: "Then",
    title: "Showings Begin",
    body: "Automated scheduling keeps showings moving without phone tag — prospects book, we confirm, you stay hands-off.",
    icon: CalendarCheck,
  },
  {
    day: "Finally",
    title: "Tenant Screened & Placed",
    body: "Applications are screened, the lease is executed, and keys are handed to a verified, qualified tenant.",
    icon: KeyRound,
  },
];

export default function Lease() {
  return (
    <PageShell>
      <section className="relative min-h-[60svh] flex items-end">
        <div className="absolute inset-0">
          <img src={IMG.listingAustinModern} alt="Modern Texas rental property" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-black/65" />
          <div className="absolute inset-0 bg-gradient-to-t from-background to-transparent" />
        </div>
        <div className="relative mx-auto w-full max-w-[1400px] px-5 lg:px-8 pb-16 pt-40">
          <p className="eyebrow text-gold">Landlords & Investors</p>
          <h1 className="display-serif text-4xl md:text-6xl mt-3">List Your Property for Lease</h1>
          <p className="mt-4 text-muted-foreground max-w-xl">
            Rented fast, to quality tenants — with pricing, marketing, and screening handled by
            professionals so your investment performs from day one.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-[1400px] px-5 lg:px-8 py-20 grid md:grid-cols-3 gap-10">
        {PROCESS.map((p, i) => (
          <div key={p.n} className="reveal" style={{ transitionDelay: `${i * 80}ms` }}>
            <div className="font-serif text-5xl text-gold/50">{p.n}</div>
            <h2 className="font-serif text-2xl mt-4">{p.title}</h2>
            <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{p.body}</p>
          </div>
        ))}
      </section>

      {/* Speed to Market — automation timeline */}
      <section className="bg-[oklch(0.165_0.005_285)] border-y border-border/60">
        <div className="mx-auto max-w-[1400px] px-5 lg:px-8 py-20">
          <p className="eyebrow text-gold">Speed to Market</p>
          <h2 className="display-serif text-3xl md:text-4xl mt-3">Listed in Days. Leased in Record Time.</h2>
          <p className="mt-4 text-sm text-muted-foreground max-w-2xl leading-relaxed">
            The same team that runs AI-powered lead follow-up runs your listing. Our automation
            handles the busywork — syndication, scheduling, screening workflows — so every day
            between signing and a signed lease is compressed.
          </p>
          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {TIMELINE.map((t, i) => (
              <div key={t.title} className="relative bg-card border border-border p-6 lux-lift reveal" style={{ transitionDelay: `${i * 80}ms` }}>
                {/* connector line between steps (desktop) */}
                {i < TIMELINE.length - 1 && (
                  <div className="hidden lg:block absolute top-9 -right-6 w-6 border-t border-dashed border-gold/40" aria-hidden="true" />
                )}
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center border border-gold/50 text-gold">
                    <t.icon className="h-4 w-4" />
                  </span>
                  <span className="eyebrow text-gold">{t.day}</span>
                </div>
                <h3 className="font-serif text-lg mt-4">{t.title}</h3>
                <p className="mt-2 text-xs text-muted-foreground leading-relaxed">{t.body}</p>
              </div>
            ))}
          </div>
          <div className="mt-10 flex items-center gap-3 text-xs text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-gold shrink-0" />
            <span>Every applicant screened — income verified, rental history checked, background cleared — before a lease is ever offered.</span>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-5 lg:px-8 py-20">
        <div className="bg-card border border-border p-6 lg:p-10">
          <LeadForm
            sourceTag="Lease Listing Inquiry"
            heading="Get Your Property Leased"
            submitLabel="Request My Rental Analysis"
            qualifying={[
              {
                key: "monthlyRentExpectation",
                label: "Monthly rent expectation",
                options: ["Under $1,500", "$1,500–$2,500", "$2,500–$4,000", "$4,000+", "Not sure — advise me"],
              },
            ]}
            showMessage
            messageLabel="Property address & details"
          />
        </div>
      </section>
    </PageShell>
  );
}
