import PageShell from "@/components/PageShell";
import GetStartedForm from "@/components/GetStartedForm";

/** Dedicated Get Started page — target of the persistent nav CTA on non-home pages. */
export default function GetStarted() {
  return (
    <PageShell solidNav>
      <div className="mx-auto max-w-[1200px] px-5 lg:px-8 pt-28 lg:pt-36 pb-24">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
          <div>
            <p className="eyebrow text-gold">Work With Us</p>
            <h1 className="display-serif text-4xl md:text-6xl mt-3 leading-tight">
              Ready to Buy or Sell?<br />Let's Get Started.
            </h1>
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
          <div className="border border-gold/40 bg-card p-6 lg:p-10">
            <GetStartedForm />
          </div>
        </div>
      </div>
    </PageShell>
  );
}
