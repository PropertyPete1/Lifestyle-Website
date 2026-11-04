import PageShell from "@/components/PageShell";
import GetStartedForm from "@/components/GetStartedForm";
import { ResponseBadge } from "@/components/TrustSignals";

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
              Drop your number and we'll text you in a few minutes to hear what you&rsquo;re
              looking for — no forms, no pressure, no obligation.
            </p>
            <div className="mt-8 space-y-3 text-sm text-muted-foreground">
              <p className="flex items-center gap-3"><span className="h-px w-8 bg-gold inline-block" /> Local expertise across five Texas markets</p>
              <p className="flex items-center gap-3"><span className="h-px w-8 bg-gold inline-block" /> Data-driven pricing and negotiation</p>
              <p className="flex items-center gap-3"><span className="h-px w-8 bg-gold inline-block" /> We typically respond within 30 minutes</p>
            </div>
          </div>
          <div className="border border-gold/40 bg-card p-6 lg:p-10">
            <div className="mb-5 flex flex-col gap-3">
              <p data-agent-reaching-out className="font-serif text-2xl leading-tight text-foreground">One of our agents will be reaching out.</p>
              <ResponseBadge className="self-start" />
            </div>
            <GetStartedForm />
          </div>
        </div>
      </div>
    </PageShell>
  );
}
