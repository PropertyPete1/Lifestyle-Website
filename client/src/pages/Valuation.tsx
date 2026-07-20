import PageShell from "@/components/PageShell";
import LeadForm from "@/components/LeadForm";
import { IMG } from "@/lib/assets";
import { CheckCircle2 } from "lucide-react";

const PERKS = ["Instant result", "Sell for more", "Get expert advice"];

export default function Valuation() {
  return (
    <PageShell>
      <section className="relative min-h-[50svh] flex items-end">
        <div className="absolute inset-0">
          <img src={IMG.listingPoolEstate} alt="Luxury Texas estate" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-black/65" />
          <div className="absolute inset-0 bg-gradient-to-t from-background to-transparent" />
        </div>
        <div className="relative mx-auto w-full max-w-[1400px] px-5 lg:px-8 pb-14 pt-40">
          <p className="eyebrow text-gold">Sellers</p>
          <h1 className="display-serif text-4xl md:text-6xl mt-3">Get Your Instant Home Valuation</h1>
          <p className="mt-4 text-muted-foreground max-w-xl">
            Enter your details to see how much your home is worth — and how we'd market it to sell
            for more.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-[1400px] px-5 lg:px-8 py-16 lg:py-24 grid lg:grid-cols-3 gap-12">
        <div className="lg:col-span-2 bg-card border border-border p-6 lg:p-10">
          <LeadForm
            sourceTag="Website - Valuation"
            heading="Unlock Your Free Valuation"
            submitLabel="Unlock Your Free Valuation"
            qualifying={[
              { key: "timeline", label: "Timeline to list", options: ["ASAP", "3-6 months", "Just exploring"] },
              { key: "valuationElsewhere", label: "Already have a valuation done elsewhere?", options: ["Yes", "No"] },
            ]}
            showMessage
            messageLabel="Property address & details"
          />
        </div>
        <aside className="space-y-6">
          {PERKS.map((p) => (
            <div key={p} className="flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-gold shrink-0" />
              <span className="text-sm uppercase tracking-[0.15em]">{p}</span>
            </div>
          ))}
          <div className="hairline" />
          <p className="text-sm text-muted-foreground leading-relaxed">
            Our valuations combine live market comps, local expertise across five Texas markets,
            and a marketing plan built to position your home at the top of its price band.
          </p>
        </aside>
      </section>
    </PageShell>
  );
}
