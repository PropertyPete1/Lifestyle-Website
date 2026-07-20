import { Link } from "wouter";
import PageShell from "@/components/PageShell";
import LeadForm from "@/components/LeadForm";
import ListingCard from "@/components/ListingCard";
import { trpc } from "@/lib/trpc";
import { IMG } from "@/lib/assets";

const PROCESS = [
  { n: "01", title: "Strategic Pricing", body: "Data-driven pricing built from live comps and buyer demand across your submarket — positioned to create competition, not compromise." },
  { n: "02", title: "Editorial Marketing", body: "Magazine-grade photography, cinematic video, and targeted social campaigns that present your home the way luxury buyers expect to see it." },
  { n: "03", title: "Expert Negotiation", body: "Seasoned negotiators manage every offer, inspection, and contingency — protecting your equity from list to close." },
];

export default function Sell() {
  const { data: listings } = trpc.listings.featured.useQuery();
  const sold = (listings ?? []).filter((l) => l.status === "Sold" || l.status === "Pending");

  return (
    <PageShell>
      <section className="relative min-h-[60svh] flex items-end">
        <div className="absolute inset-0">
          <img src={IMG.listingCordillera} alt="Luxury Texas home" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-black/65" />
          <div className="absolute inset-0 bg-gradient-to-t from-background to-transparent" />
        </div>
        <div className="relative mx-auto w-full max-w-[1400px] px-5 lg:px-8 pb-16 pt-40">
          <p className="eyebrow text-gold">Sellers</p>
          <h1 className="display-serif text-4xl md:text-6xl mt-3">Sell With Lifestyle Design Realty</h1>
          <p className="mt-4 text-muted-foreground max-w-xl">
            A marketing process built for maximum exposure — and results that speak for themselves.
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

      {sold.length > 0 && (
        <section className="bg-[oklch(0.165_0.005_285)] border-y border-border/60">
          <div className="mx-auto max-w-[1400px] px-5 lg:px-8 py-20">
            <div className="flex items-end justify-between mb-10">
              <h2 className="display-serif text-3xl md:text-4xl">Recent Results</h2>
              <Link href="/portfolio" className="text-cta hidden sm:inline-block">Full Portfolio</Link>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
              {sold.slice(0, 3).map((l) => (
                <ListingCard key={l.id} listing={l} />
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="mx-auto max-w-3xl px-5 lg:px-8 py-20">
        <div className="bg-card border border-border p-6 lg:p-10">
          <LeadForm
            sourceTag="Website - Valuation"
            heading="What's Your Home Worth?"
            submitLabel="Get My Valuation"
            qualifying={[
              { key: "timeline", label: "Timeline to list", options: ["ASAP", "3-6 months", "Just exploring"] },
              { key: "valuationElsewhere", label: "Already have a valuation done elsewhere?", options: ["Yes", "No"] },
            ]}
            showMessage
            messageLabel="Property address & details"
          />
        </div>
      </section>
    </PageShell>
  );
}
