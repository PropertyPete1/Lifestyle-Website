import PageShell from "@/components/PageShell";
import LeadForm from "@/components/LeadForm";
import { ResponseBadge, TrustLine } from "@/components/TrustSignals";

/**
 * List Your Property for Lease — landlords and investors.
 *
 * Oct 30, 2026 (Peter: "lease page just needs to ask the questions and have the person sign up so we can call"): a
 * short intro and the questions, nothing else. The form routes to FUB as a LANDLORD lead (sourceTag below).
 */
export default function Lease() {
  return (
    <PageShell solidNav>
      <section className="mx-auto max-w-2xl px-5 pb-20 pt-28 lg:px-8 lg:pt-36">
        <p className="eyebrow text-center text-gold">Landlords &amp; Investors</p>
        <h1 className="mt-3 text-center font-serif text-4xl font-medium leading-tight md:text-5xl">List Your Property for Lease</h1>
        <p className="mx-auto mt-4 max-w-lg text-center leading-relaxed text-muted-foreground">
          Answer a few quick questions and we&rsquo;ll call you with a rental price and a plan to get your property leased.
        </p>
        <div className="mt-5 flex flex-col items-center gap-2.5">
          <ResponseBadge />
          <TrustLine className="justify-center" />
        </div>
        <div className="mt-8 border border-border bg-card p-6 shadow-[0_18px_50px_-30px_rgb(0_0_0/0.25)] lg:p-10">
          <LeadForm
            sourceTag="Lease Listing Inquiry"
            heading="Tell us about your property"
            submitLabel="Request My Rental Analysis"
            qualifying={[
              {
                key: "propertyType",
                label: "Property type",
                options: ["Single-family home", "Townhome / condo", "Duplex / multi-family", "Other"],
              },
              {
                key: "availableWhen",
                label: "When is it available?",
                options: ["Available now", "Within 30 days", "1–3 months", "Just exploring"],
              },
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
