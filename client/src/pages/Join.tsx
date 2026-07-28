import PageShell from "@/components/PageShell";
import RecruitForm from "@/components/RecruitForm";
import LeadFlowDiagram from "@/components/LeadFlowDiagram";
import { SITE } from "@shared/site";
import { IMG } from "@/lib/assets";
import { Flame, HandCoins, Landmark, Mail } from "lucide-react";

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

export default function Join() {
  return (
    <PageShell>
      <section className="relative min-h-[60svh] flex items-end">
        <div className="absolute inset-0">
          <img src={IMG.heroDarkInterior} alt="" aria-hidden className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-black/70" />
          <div className="absolute inset-0 bg-gradient-to-t from-background to-transparent" />
        </div>
        <div className="relative mx-auto w-full max-w-[1400px] px-5 lg:px-8 pb-16 pt-40">
          <p className="eyebrow text-gold">Now Hiring</p>
          <h1 className="display-serif text-4xl md:text-6xl mt-3 max-w-4xl leading-tight">
            Ready to join a team that helps you boost your sales with warm &amp; hot transfer leads?
          </h1>
          {/* Why Agents Join Us — 3-hook strip, visible on first screen */}
          <div className="mt-8 grid gap-2.5 sm:grid-cols-3 max-w-4xl">
            {TOP_HOOKS.map(({ icon: Icon, text }) => (
              <div
                key={text}
                className="flex items-center gap-3 border border-gold/35 bg-black/35 backdrop-blur-sm px-4 py-3">
                <Icon className="h-4 w-4 shrink-0 text-gold" aria-hidden />
                <span className="text-[11px] uppercase tracking-[0.12em] text-foreground/90 leading-snug">
                  {text}
                </span>
              </div>
            ))}
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

      {/* How leads actually move through the system — visual proof, not claims */}
      <section className="border-y border-border/60 bg-[oklch(0.165_0.005_285)]">
        <div className="mx-auto max-w-[1200px] px-5 lg:px-8 py-20">
          <div className="text-center mb-14 reveal">
            <p className="eyebrow text-gold">The Lead System</p>
            <h2 className="display-serif text-3xl md:text-4xl mt-3">Where Your Next Client Comes From</h2>
          </div>
          <LeadFlowDiagram />
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-5 lg:px-8 pb-24">
        <div className="pt-4" />
        {/* Screening message — exact copy per brief */}
        <div className="border-l-2 border-gold pl-6 mb-10 reveal">
          <p className="text-muted-foreground leading-relaxed whitespace-pre-line">
            {"In an effort to find the best fit, can you please tell me the following:\n1. License number\n2. # of transactions closed this year\n3. Are you a full time agent?\n4. Do you currently use a CRM? If yes which one?\n5. What brokerage are you with?\nThanks!"}
          </p>
          <p className="mt-3 font-serif italic text-lg text-foreground/90">— Stefanie</p>
        </div>
        <div className="bg-card border border-border p-6 lg:p-10">
          <RecruitForm />
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
