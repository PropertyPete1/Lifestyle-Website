import PageShell from "@/components/PageShell";
import LeadForm from "@/components/LeadForm";
import { IMG } from "@/lib/assets";

const PILLARS = [
  { title: "Brokerage-First Brand", body: "Plug into a luxury brand with real marketing infrastructure — not a logo you have to build alone." },
  { title: "Lead Flow That Works", body: "Our City Finder, valuation engine, and social presence generate qualified buyers and sellers for the team." },
  { title: "Broker Support", body: "Direct access to Broker/Owner Peter Allen — deal structuring, negotiation help, and mentorship on demand." },
];

export default function Join() {
  return (
    <PageShell>
      <section className="relative min-h-[55svh] flex items-end">
        <div className="absolute inset-0">
          <img src={IMG.heroDarkInterior} alt="" aria-hidden className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-black/70" />
          <div className="absolute inset-0 bg-gradient-to-t from-background to-transparent" />
        </div>
        <div className="relative mx-auto w-full max-w-[1400px] px-5 lg:px-8 pb-16 pt-40">
          <p className="eyebrow text-gold">Careers</p>
          <h1 className="display-serif text-4xl md:text-6xl mt-3">Join Our Team</h1>
          <p className="mt-4 text-muted-foreground max-w-xl">
            Lifestyle Design Realty is growing across San Antonio, New Braunfels, Austin, DFW, and
            Houston. If you're serious about your craft, let's talk.
          </p>
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

      <section className="mx-auto max-w-3xl px-5 lg:px-8 pb-24">
        <div className="bg-card border border-border p-6 lg:p-10">
          <LeadForm
            sourceTag="Recruit - Website"
            heading="Tell Us About Yourself"
            submitLabel="Apply Now"
            qualifying={[
              { key: "licenseStatus", label: "Current license status", options: ["Licensed active", "Licensed inactive", "In progress", "Not licensed"] },
              { key: "currentBrokerage", label: "Current brokerage (if any)", options: ["Independent", "National franchise", "Boutique brokerage", "None"] },
              { key: "production", label: "Production last 12 months (optional)", options: ["$0–1M", "$1–5M", "$5–10M", "$10M+", "Prefer not to say"] },
            ]}
            showMessage
            messageLabel="Why are you interested in Lifestyle Design Realty?"
          />
        </div>
      </section>
    </PageShell>
  );
}
